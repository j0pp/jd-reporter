import { classifyPosting, classifySubmittedUrl, createHttp, detectEmbeddedBoard, getAdapter, isNySignal, DISCLOSED_METHODS } from '@jdr/core';
import { claimQueuedSubmissions, ensureBoard, finishRun, startRun, type Db, type Submission } from '@jdr/db';
import { boards, companies, findings, postings, submissions } from '@jdr/db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { BlobStore } from './blobs.ts';
import { crawlBoard, describeError, httpForVendor } from './crawl.ts';
import type { Config } from './env.ts';

const STALE_MS = 20 * 3600_000;

// drains the queue the worker fills. every submission ends verified, rejected or error with a plain sentence
export async function processSubmissions(db: Db, blobs: BlobStore, cfg: Config, opts: { limit: number; log: (m: string) => void }) {
  const runId = await startRun(db, 'process');
  const claimed = await claimQueuedSubmissions(db, opts.limit);
  opts.log(`process: ${claimed.length} submissions claimed`);
  let ok = 0;
  for (const s of claimed) {
    try {
      await processOne(db, blobs, cfg, s, runId, opts.log);
      ok += 1;
    } catch (e) {
      const msg = describeError(e);
      opts.log(`process: submission ${s.id} failed: ${msg}`);
      await db
        .update(submissions)
        .set({ status: 'error', statusMessage: `we could not process this link (${msg}); it will be retried`, processedAt: new Date().toISOString() })
        .where(eq(submissions.id, s.id));
    }
  }
  await finishRun(db, runId, { boardsAttempted: claimed.length, boardsOk: ok });
}

async function processOne(db: Db, blobs: BlobStore, cfg: Config, s: Submission, runId: number, log: (m: string) => void) {
  const done = (patch: Partial<typeof submissions.$inferInsert>) =>
    db
      .update(submissions)
      .set({ ...patch, processedAt: new Date().toISOString() })
      .where(eq(submissions.id, s.id));

  const info = classifySubmittedUrl(s.canonicalUrl ?? s.submittedUrl);
  if (!info) return done({ status: 'rejected', statusMessage: 'that is not a url we can read' });
  if (info.kind === 'aggregator') {
    return done({ status: 'rejected', rejectedDomain: info.host, statusMessage: 'job aggregators are not supported; open the job, click apply, and paste the employer page' });
  }

  let vendor = info.vendor;
  let slug = info.slug;
  const externalId = info.externalId;
  if (!vendor || !slug) {
    // an employer's own page: look for the ats it embeds
    const http = createHttp({ userAgent: cfg.userAgent, delayMs: 500, log });
    const res = await http(info.canonical, { retries: 1, headers: { accept: 'text/html' } });
    const found = detectEmbeddedBoard(res.text);
    if (!found) {
      return done({ status: 'rejected', statusMessage: 'we could not find a supported job board (greenhouse, lever, ashby or workday) behind that page' });
    }
    vendor = found.vendor;
    slug = found.slug;
  }

  const { board: initial, created } = await ensureBoard(db, { vendor, slug, discoveredVia: 'submission' });
  let [board] = await db.select().from(boards).where(eq(boards.id, initial.id));
  const stale = !board!.lastOkAt || Date.now() - Date.parse(board!.lastOkAt) > STALE_MS;
  if (created || stale) {
    const r = await crawlBoard(db, blobs, cfg, board!, runId, { dryRun: false, maxDetailCalls: 200, maxPageFetches: 100, workdayMaxPages: 15, log });
    if (!r.ok) return done({ status: 'error', boardId: board!.id, companyId: board!.companyId, statusMessage: `we could not read that board right now (${r.error}); we will retry` });
    [board] = await db.select().from(boards).where(eq(boards.id, initial.id));
  }
  const [company] = await db.select().from(companies).where(eq(companies.id, board!.companyId));

  const notes: string[] = [];
  let status: (typeof submissions.$inferInsert)['status'] = 'verified';
  let postingId: number | null = null;
  let findingId: number | null = null;

  if (externalId) {
    const [p] = await db
      .select()
      .from(postings)
      .where(and(eq(postings.boardId, board!.id), sql`lower(${postings.externalId}) = ${externalId.toLowerCase()}`))
      .limit(1);
    if (!p) {
      // not stored: out of scope or gone. one call tells the submitter which
      const adapter = getAdapter(vendor);
      const raw = await adapter.fetchPosting(slug, externalId, { http: httpForVendor(cfg, vendor, board!.learnedDelayMs, log), log });
      if (!raw) notes.push('that posting is no longer on the employer\u2019s board');
      else if (!isNySignal(classifyPosting(vendor, raw).coverage)) notes.push(`that posting lists "${raw.locations.join('; ') || 'no location'}", which we do not read as New York, so it is out of scope`);
      else notes.push('that posting will be picked up on the next crawl of this board');
    } else {
      postingId = p.id;
      const fs = await db
        .select()
        .from(findings)
        .where(and(eq(findings.postingId, p.id), inArray(findings.status, ['needs_review', 'published'])));
      const f = fs[0];
      if (DISCLOSED_METHODS.has(p.range.method as never)) {
        notes.push(`range found: ${p.range.evidenceSpan ?? `${p.range.min ?? '?'}-${p.range.max ?? '?'}`}`);
      } else if (f) {
        findingId = f.id;
        if (f.status === 'published') status = 'published';
        notes.push(f.status === 'published' ? 'no pay range on this posting; the finding is published' : 'no pay range detected; it is waiting for human review');
      } else {
        notes.push(`we read this posting as "${p.range.method.replace(/_/g, ' ')}", which needs a human look rather than a finding`);
      }
    }
  } else {
    const [c] = await db
      .select({ ny: sql<number>`count(*)`, missing: sql<number>`sum(case when json_extract(${postings.range}, '$.method') in ('none','open_ended','placeholder_range') then 1 else 0 end)` })
      .from(postings)
      .where(and(eq(postings.boardId, board!.id), sql`${postings.removedAt} is null`));
    notes.push(`board read: ${Number(c?.ny ?? 0)} New York postings, ${Number(c?.missing ?? 0)} without a detected pay range (pending review)`);
  }

  if (company && !company.inCohort) {
    notes.push(company.isStaffingFirm ? 'this looks like a staffing firm, which the laws exempt' : `this employer has ${company.openPostingsTotal} open postings, fewer than the 5 we require to infer it has 4+ employees, so it is listed but not scored`);
  }

  await done({ status, boardId: board!.id, companyId: board!.companyId, postingId, findingId, statusMessage: notes.join('. ') });
}
