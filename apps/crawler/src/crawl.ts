import {
  classifyPosting,
  classifyRange,
  createHttp,
  getAdapter,
  HttpError,
  isEvergreenTitle,
  isNySignal,
  parseEmployerPage,
  postingContentHash,
  RateLimitedError,
  sha256Hex,
  type BoardAdapter,
  type FetchCtx,
  type HttpClient,
  type RawPosting,
} from '@jdr/core';
import {
  applyBoardDiff,
  markBoardCrawled,
  reconcileFindings,
  recomputeCompanyRollups,
  type Board,
  type ClassifiedPostingInput,
  type Db,
  type ReconcileCounts,
} from '@jdr/db';
import { companies } from '@jdr/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { blobKeys, type BlobStore } from './blobs.ts';
import { VENDOR_DELAY_MS, type Config } from './env.ts';
import { enrichIdentity, identityDue } from './identity.ts';
export { describeError } from './errors.ts';
import { describeError } from './errors.ts';

export interface CrawlOptions {
  dryRun: boolean;
  // per board per run; postings past the cap carry needs_detail and go first next time
  maxDetailCalls: number;
  maxPageFetches: number;
  workdayMaxPages: number;
  log: (msg: string) => void;
}

export interface BoardCrawlResult {
  ok: boolean;
  error?: string;
  postingsTotal: number;
  nySeen: number;
  inserted: number;
  updated: number;
  removed: number;
  unchanged: number;
  detailCalls: number;
  pageFetches: number;
  findings?: ReconcileCounts;
  methods: Record<string, number>;
}

export function httpForVendor(cfg: Config, vendor: string, learnedDelayMs: number | null | undefined, log: (m: string) => void): HttpClient {
  return createHttp({
    userAgent: cfg.userAgent,
    delayMs: Math.max(VENDOR_DELAY_MS[vendor] ?? 1500, learnedDelayMs ?? 0),
    log,
  });
}

// the whole per-board pipeline: fetch -> classify -> detail calls for the uncleared -> employer page for
// offsite silence -> diff against content hashes -> findings -> rollups. one board failing never stops the loop
export async function crawlBoard(db: Db, blobs: BlobStore, cfg: Config, board: Board, runId: number, opts: CrawlOptions): Promise<BoardCrawlResult> {
  const adapter = getAdapter(board.atsVendor);
  const http = httpForVendor(cfg, board.atsVendor, board.learnedDelayMs, opts.log);
  const ctx: FetchCtx = { http, log: opts.log };
  const result: BoardCrawlResult = { ok: false, postingsTotal: 0, nySeen: 0, inserted: 0, updated: 0, removed: 0, unchanged: 0, detailCalls: 0, pageFetches: 0, methods: {} };

  let fetched;
  try {
    fetched = await adapter.fetchBoard(board.atsSlug, ctx, { maxPages: opts.workdayMaxPages });
  } catch (e) {
    result.error = describeError(e);
    if (!opts.dryRun) await markBoardCrawled(db, board.id, { runId, ok: false, error: result.error });
    return result;
  }

  const { postings, raw, boardName } = fetched;
  result.postingsTotal = postings.length;
  const responseSha = await sha256Hex(raw.map((r) => r.body).join('\n'));
  const rawKey = blobKeys.board(board.atsVendor, board.atsSlug, responseSha);
  if (!opts.dryRun && responseSha !== board.lastResponseSha256 && !(await blobs.exists(rawKey))) {
    await blobs.putGzip(rawKey, JSON.stringify({ capturedAt: new Date().toISOString(), board: { vendor: board.atsVendor, slug: board.atsSlug }, responses: raw }), 'application/json');
  }

  // a board that had many postings and suddenly has none is more likely an api hiccup than a mass delisting
  if (postings.length === 0 && board.openPostingsTotal >= 10 && board.errorCount < 2) {
    result.error = `suspicious empty response (had ${board.openPostingsTotal} postings)`;
    if (!opts.dryRun) await markBoardCrawled(db, board.id, { runId, ok: false, error: result.error });
    return result;
  }

  const seen: ClassifiedPostingInput[] = [];
  let truncated = false;
  for (let p of postings) {
    let c = classifyPosting(board.atsVendor, p);
    if (!isNySignal(c.coverage) && !p.needsDetail) continue;

    let needsDetail = false;
    let postingRawKey = rawKey;
    if (adapter.needsDetail(p, c.range)) {
      if (result.detailCalls >= opts.maxDetailCalls) {
        needsDetail = true;
        truncated = true;
      } else {
        try {
          p = await adapter.fetchDetail(board.atsSlug, p, ctx);
          result.detailCalls += 1;
          c = classifyPosting(board.atsVendor, p);
          const detailBody = JSON.stringify({ capturedAt: new Date().toISOString(), url: p.url, response: p.raw });
          postingRawKey = blobKeys.posting(board.atsVendor, board.atsSlug, p.externalId, await sha256Hex(detailBody));
          if (!opts.dryRun && !(await blobs.exists(postingRawKey))) await blobs.putGzip(postingRawKey, detailBody, 'application/json');
        } catch (e) {
          if (e instanceof RateLimitedError) throw e;
          opts.log(`detail failed for ${board.atsVendor}:${board.atsSlug} ${p.externalId}: ${describeError(e)}`);
          needsDetail = true;
        }
      }
      // workday rows only reveal their real locations in the detail call
      if (!isNySignal(c.coverage)) continue;
    }

    let pageKey: string | null = null;
    if (c.range.method === 'offsite_unverified' && result.pageFetches < opts.maxPageFetches) {
      result.pageFetches += 1;
      try {
        const res = await http(p.url, { retries: 1, headers: { accept: 'text/html,application/xhtml+xml' } });
        const pageSha = await sha256Hex(res.text);
        pageKey = blobKeys.page(pageSha);
        if (!opts.dryRun && !(await blobs.exists(pageKey))) await blobs.putGzip(pageKey, res.text, 'text/html');
        const page = parseEmployerPage(res.text);
        const range = classifyRange({ text: page.text, structured: page.jsonLd, title: p.title, source: page.jsonLd ? 'employer_page_jsonld' : 'employer_page_text' });
        c = { ...c, range };
      } catch (e) {
        if (e instanceof RateLimitedError) throw e;
        opts.log(`employer page failed for ${p.url}: ${describeError(e)}`);
      }
    }

    result.methods[c.range.method] = (result.methods[c.range.method] ?? 0) + 1;
    seen.push({
      externalId: p.externalId,
      canonicalUrl: p.url,
      isOffsite: c.isOffsite,
      title: p.title,
      locations: p.locations,
      locClass: c.coverage.locClass,
      multiCity: c.coverage.multiCity,
      remoteUs: c.coverage.remoteUs,
      isEvergreen: isEvergreenTitle(p.title),
      employmentType: p.employmentType,
      contentSha256: await postingContentHash(p),
      rawKey: postingRawKey,
      pageKey,
      coverage: c.coverage,
      range: c.range,
      classifierVersion: c.classifierVersion,
      needsDetail,
    });
  }
  result.nySeen = seen.length;

  if (opts.dryRun) {
    result.ok = true;
    return result;
  }

  // removals only after a complete successful read. workday capped at maxPages is not complete
  const complete = !(board.atsVendor === 'workday' && postings.length >= opts.workdayMaxPages * 20);
  const diff = await applyBoardDiff(db, { boardId: board.id, companyId: board.companyId, seen, markRemoved: complete });
  result.inserted = diff.inserted.length;
  result.updated = diff.updated.length;
  result.removed = diff.removedIds.length;
  result.unchanged = diff.unchanged;
  result.findings = await reconcileFindings(db, diff.touchedIds, { actor: 'system' });

  await markBoardCrawled(db, board.id, {
    runId,
    ok: true,
    responseSha256: responseSha,
    openPostingsTotal: postings.length,
    learnedDelayMs: http.delayMs > (VENDOR_DELAY_MS[board.atsVendor] ?? 1500) ? http.delayMs : undefined,
  });

  if (boardName) await adoptBoardName(db, board.companyId, boardName);
  // first crawl of a board (or once a month while unverified): real name and logo from the vendor page
  const [company] = await db.select().from(companies).where(eq(companies.id, board.companyId));
  if (company && identityDue(company)) {
    const id = await enrichIdentity(db, blobs, cfg, board, company, http, opts.log);
    if (id.name || id.logo) opts.log(`${board.atsVendor}:${board.atsSlug} identity: ${id.name ?? '(no name)'}${id.logo ? ' + logo' : ''}`);
  }
  if (diff.touchedIds.length || !board.lastOkAt) await recomputeCompanyRollups(db, [board.companyId]);
  result.ok = true;
  if (truncated) opts.log(`${board.atsVendor}:${board.atsSlug} hit the detail cap; ${seen.filter((s) => s.needsDetail).length} postings wait for tomorrow`);
  return result;
}

// the vendor's feed name (greenhouse company_name) beats a slug-derived guess, but never a name you verified
// or one already read from the vendor's page
async function adoptBoardName(db: Db, companyId: number, name: string) {
  const [c] = await db.select({ displayName: companies.displayName, verifiedAt: companies.verifiedAt, enrichment: companies.enrichment }).from(companies).where(eq(companies.id, companyId));
  if (!c || c.verifiedAt || c.displayName === name || !name.trim() || c.enrichment?.nameSource === 'vendor_page') return;
  await db
    .update(companies)
    .set({ displayName: name.trim(), enrichment: { ...(c.enrichment ?? {}), nameSource: 'vendor_feed' } })
    .where(and(eq(companies.id, companyId), isNull(companies.verifiedAt)));
}


export type { BoardAdapter, RawPosting };
