import { getAdapter } from '@jdr/core';
import type { Db } from '@jdr/db';
import { boards, companies, crawlRuns, findings, jurisdictions, postings } from '@jdr/db/schema';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BlobStore } from './blobs.ts';
import type { Config } from './env.ts';

const DISCLOSED = ['structured', 'text_range', 'fixed_rate'];
const NY = ['nyc_strict', 'ny_bare', 'ny_state'];

export interface SiteFinding {
  id: number;
  companySlug: string;
  companyName: string;
  postingId: number;
  externalId: string;
  title: string;
  url: string;
  locations: string[];
  locClass: string;
  jurisdictionCodes: string[];
  type: string;
  evidenceSpan: string | null;
  rangeAtDetection: { method: string; min?: number; max?: number; evidenceSpan?: string; source: string };
  detectedAt: string;
  publishedAt: string | null;
  waybackUrl: string | null;
  firstRawKey: string | null;
  firstPageKey: string | null;
  classifierVersion: string;
  reasons: string[];
}

export interface SiteCompany {
  slug: string;
  displayName: string;
  sector: string | null;
  hqCity: string | null;
  hqState: string | null;
  inCohort: boolean;
  cohortReason: string | null;
  isStaffingFirm: boolean;
  verified: boolean;
  openPostingsTotal: number;
  openPostingsNy: number;
  disclosedNy: number;
  currentFindings: number;
  boards: { vendor: string; slug: string; url: string; lastOkAt: string | null }[];
  rollupAt: string | null;
}

// the public site never queries d1: this writes the json the next build reads, plus the public dataset
export async function exportSiteData(db: Db, blobs: BlobStore, cfg: Config, opts: { log: (m: string) => void }) {
  const outDir = join(cfg.repoRoot, 'apps', 'web', 'data');
  mkdirSync(outDir, { recursive: true });

  const allCompanies = await db.select().from(companies).where(eq(companies.status, 'active'));
  const allBoards = await db.select().from(boards).where(inArray(boards.status, ['active', 'crawl_error']));
  const boardsByCompany = new Map<number, typeof allBoards>();
  for (const b of allBoards) boardsByCompany.set(b.companyId, [...(boardsByCompany.get(b.companyId) ?? []), b]);

  // published findings on postings that are still open: the only thing that is "current"
  const rows = await db
    .select({ f: findings, p: postings })
    .from(findings)
    .innerJoin(postings, eq(postings.id, findings.postingId))
    .where(and(eq(findings.status, 'published'), isNull(postings.removedAt)))
    .orderBy(desc(findings.publishedAt));

  const companyById = new Map(allCompanies.map((c) => [c.id, c]));
  const currentByCompany = new Map<number, number>();
  const siteFindings: SiteFinding[] = [];
  for (const { f, p } of rows) {
    const c = companyById.get(f.companyId);
    if (!c || !c.inCohort || !c.verifiedAt) continue;
    currentByCompany.set(c.id, (currentByCompany.get(c.id) ?? 0) + 1);
    siteFindings.push({
      id: f.id,
      companySlug: c.slug,
      companyName: c.displayName,
      postingId: p.id,
      externalId: p.externalId,
      title: p.title,
      url: p.canonicalUrl,
      locations: p.locations,
      locClass: p.locClass,
      jurisdictionCodes: f.jurisdictionCodes,
      type: f.type,
      evidenceSpan: f.evidenceSpan,
      rangeAtDetection: f.rangeAtDetection,
      detectedAt: f.detectedAt,
      publishedAt: f.publishedAt,
      waybackUrl: f.waybackUrl,
      firstRawKey: f.firstRawKey,
      firstPageKey: f.firstPageKey,
      classifierVersion: f.classifierVersion,
      reasons: p.jurisdiction.reasons,
    });
  }

  const siteCompanies: SiteCompany[] = allCompanies
    .filter((c) => (boardsByCompany.get(c.id)?.length ?? 0) > 0 && c.openPostingsNy > 0)
    .map((c) => ({
      slug: c.slug,
      displayName: c.displayName,
      sector: c.sector,
      hqCity: c.hqCity,
      hqState: c.hqState,
      inCohort: c.inCohort,
      cohortReason: c.cohortReason,
      isStaffingFirm: c.isStaffingFirm,
      verified: !!c.verifiedAt,
      openPostingsTotal: c.openPostingsTotal,
      openPostingsNy: c.openPostingsNy,
      disclosedNy: c.disclosedNy,
      currentFindings: currentByCompany.get(c.id) ?? 0,
      boards: (boardsByCompany.get(c.id) ?? []).map((b) => ({ vendor: b.atsVendor, slug: b.atsSlug, url: boardUrl(b.atsVendor, b.atsSlug), lastOkAt: b.lastOkAt })),
      rollupAt: c.rollupAt,
    }))
    .sort((a, b) => b.currentFindings - a.currentFindings || b.openPostingsNy - a.openPostingsNy);

  // the leaderboard: cohort only, floor of two current findings, count first
  const leaderboard = siteCompanies.filter((c) => c.inCohort && c.currentFindings >= 2);

  const [stats] = await db
    .select({
      postingsNy: sql<number>`count(*)`,
      disclosed: sql<number>`sum(case when json_extract(${postings.range}, '$.method') in (${sql.join(DISCLOSED.map((d) => sql`${d}`), sql`, `)}) then 1 else 0 end)`,
      companiesChecked: sql<number>`count(distinct ${postings.companyId})`,
    })
    .from(postings)
    .where(and(isNull(postings.removedAt), inArray(postings.locClass, NY as never), eq(postings.isEvergreen, false)));
  const [lastCrawl] = await db.select().from(crawlRuns).where(eq(crawlRuns.kind, 'crawl')).orderBy(desc(crawlRuns.startedAt)).limit(1);
  const laws = await db.select().from(jurisdictions);

  const site = {
    generatedAt: new Date().toISOString(),
    lastCrawlAt: lastCrawl?.finishedAt ?? lastCrawl?.startedAt ?? null,
    stats: {
      companiesChecked: Number(stats?.companiesChecked ?? 0),
      postingsNy: Number(stats?.postingsNy ?? 0),
      disclosedNy: Number(stats?.disclosed ?? 0),
      currentFindings: siteFindings.length,
      companiesOnLeaderboard: leaderboard.length,
    },
    jurisdictions: laws,
  };

  writeFileSync(join(outDir, 'site.json'), JSON.stringify(site, null, 1));
  writeFileSync(join(outDir, 'companies.json'), JSON.stringify(siteCompanies));
  writeFileSync(join(outDir, 'leaderboard.json'), JSON.stringify(leaderboard));
  writeFileSync(join(outDir, 'findings.json'), JSON.stringify(siteFindings));
  writeFileSync(
    join(outDir, 'search-index.json'),
    JSON.stringify(siteCompanies.map((c) => ({ slug: c.slug, name: c.displayName, sector: c.sector, findings: c.currentFindings, ny: c.openPostingsNy }))),
  );

  // per-finding evidence files: the posting's own raw record as we read it at detection, served statically
  const evidenceDir = join(cfg.repoRoot, 'apps', 'web', 'public', 'evidence');
  mkdirSync(evidenceDir, { recursive: true });
  const blobCache = new Map<string, string | null>();
  let evidenceWritten = 0;
  for (const f of siteFindings) {
    if (!f.firstRawKey) continue;
    let body = blobCache.get(f.firstRawKey);
    if (body === undefined) {
      body = await blobs.getGzip(f.firstRawKey).catch(() => null);
      blobCache.set(f.firstRawKey, body);
    }
    if (!body) continue;
    const record = extractPostingRecord(body, f);
    if (!record) continue;
    writeFileSync(join(evidenceDir, `${f.id}.json`), JSON.stringify({ findingId: f.id, rawKey: f.firstRawKey, pageKey: f.firstPageKey, ...record }, null, 1));
    evidenceWritten += 1;
  }
  opts.log(`export: ${evidenceWritten} evidence files written`);

  // public dataset (cc by): what is published, nothing more
  const csv = [
    ['company', 'company_slug', 'title', 'locations', 'jurisdictions', 'finding_type', 'evidence', 'detected_at', 'published_at', 'posting_url', 'wayback_url'].join(','),
    ...siteFindings.map((f) =>
      [f.companyName, f.companySlug, f.title, f.locations.join('; '), f.jurisdictionCodes.join('; '), f.type, f.evidenceSpan ?? '', f.detectedAt, f.publishedAt ?? '', f.url, f.waybackUrl ?? '']
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(','),
    ),
  ].join('\n');
  const publicDir = join(cfg.repoRoot, 'apps', 'web', 'public', 'data');
  mkdirSync(publicDir, { recursive: true });
  writeFileSync(join(publicDir, 'findings.csv'), csv);
  if (cfg.blobMode === 'r2') await blobs.putPublic('public/findings.csv', csv, 'text/csv');

  opts.log(`export: ${siteCompanies.length} companies, ${leaderboard.length} on the leaderboard, ${siteFindings.length} current findings`);
}

// a blob is either a per-posting detail response or a whole board response; find the posting either way
function extractPostingRecord(body: string, f: SiteFinding): { capturedAt: string | null; vendor: string; record: unknown } | null {
  let parsed: { capturedAt?: string; board?: { vendor: string; slug: string }; responses?: { url: string; body: string }[]; response?: unknown };
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const vendor = f.firstRawKey?.split('/')[1] ?? 'unknown';
  if (parsed.response !== undefined) return { capturedAt: parsed.capturedAt ?? null, vendor, record: parsed.response };
  if (!parsed.responses || !parsed.board) return null;
  const adapter = getAdapter(parsed.board.vendor);
  for (const r of parsed.responses) {
    let json: unknown;
    try {
      json = JSON.parse(r.body);
    } catch {
      continue;
    }
    const hit = adapter.normalizeBoard(json).find((p) => p.externalId === f.externalId || (p.url && p.url === f.url));
    if (hit) return { capturedAt: parsed.capturedAt ?? null, vendor: parsed.board.vendor, record: hit.raw };
  }
  return null;
}

function boardUrl(vendor: string, slug: string): string {
  switch (vendor) {
    case 'greenhouse':
      return `https://job-boards.greenhouse.io/${slug}`;
    case 'lever':
      return `https://jobs.lever.co/${slug}`;
    case 'ashby':
      return `https://jobs.ashbyhq.com/${slug}`;
    case 'workday': {
      const [tenant, wd, site] = slug.split('|');
      return `https://${tenant}.${wd}.myworkdayjobs.com/${site}`;
    }
    default:
      return '';
  }
}
