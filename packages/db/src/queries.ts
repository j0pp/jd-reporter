import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import * as schema from './schema.ts';
import {
  boards,
  companies,
  crawlRuns,
  findings,
  postings,
  reviews,
  submissions,
  type CoverageJson,
  type FindingStatus,
  type FindingType,
  type NewPosting,
  type RangeJson,
} from './schema.ts';

// one type for all three drivers (d1 binding, d1 rest proxy, local libsql); all are async sqlite
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = BaseSQLiteDatabase<'async', any, typeof schema>;

export const nowIso = () => new Date().toISOString();

const DISCLOSED = ['structured', 'text_range', 'fixed_rate'];
const NY_CLASSES = ['nyc_strict', 'ny_bare', 'ny_state'];
// findings are born in the queue; there is no waiting state before a person sees them
const UNPUBLISHED: FindingStatus[] = ['needs_review'];

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// ---------- boards and companies ----------

export interface EnsureBoardInput {
  vendor: (typeof schema.ATS_VENDORS)[number];
  slug: string;
  displayName?: string;
  discoveredVia: string;
  cohortReason?: string | null;
  isStaffingFirm?: boolean;
}

export async function findBoard(db: Db, vendor: string, slug: string) {
  const rows = await db
    .select()
    .from(boards)
    .where(and(eq(boards.atsVendor, vendor as never), eq(boards.atsSlug, slug.toLowerCase())))
    .limit(1);
  return rows[0] ?? null;
}

// one company per board to start; merges are an admin action later
export async function ensureBoard(db: Db, input: EnsureBoardInput) {
  const slug = input.slug.toLowerCase();
  const existing = await findBoard(db, input.vendor, slug);
  if (existing) return { board: existing, created: false };

  const name = input.displayName ?? displayNameFromSlug(input.vendor, slug);
  const companySlug = await uniqueCompanySlug(db, slugify(name) || slugify(`${input.vendor}-${slug}`));

  const [company] = await db
    .insert(companies)
    .values({
      slug: companySlug,
      displayName: name,
      cohortReason: input.cohortReason ?? null,
      isStaffingFirm: input.isStaffingFirm ?? false,
    })
    .returning();
  const [board] = await db
    .insert(boards)
    .values({
      companyId: company!.id,
      atsVendor: input.vendor,
      atsSlug: slug,
      discoveredVia: input.discoveredVia,
    })
    .returning();
  return { board: board!, created: true };
}

// a company with several workday sites (or the same name on two vendors) needs a distinct public slug
export async function uniqueCompanySlug(db: Db, base: string): Promise<string> {
  const root = base.slice(0, 56) || 'company';
  for (let n = 1; n < 1000; n++) {
    const candidate = n === 1 ? root : `${root}-${n}`;
    const clash = await db.select({ id: companies.id }).from(companies).where(eq(companies.slug, candidate)).limit(1);
    if (!clash.length) return candidate;
  }
  throw new Error(`could not allocate a slug for ${base}`);
}

export function displayNameFromSlug(vendor: string, slug: string): string {
  const base = vendor === 'workday' ? (slug.split('|')[0] ?? slug) : slug;
  return base
    .replace(/[-_.]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

// stalest first, companies with open findings first, so a truncated run self-heals tomorrow
export async function activeBoardsForCrawl(db: Db, vendor: string, limit?: number) {
  const rows = await db
    .select({ board: boards, hasOpenFinding: sql<number>`exists(select 1 from ${findings} f where f.company_id = ${boards.companyId} and f.status in ('needs_review','published'))` })
    .from(boards)
    .where(and(eq(boards.atsVendor, vendor as never), eq(boards.status, 'active')))
    .orderBy(desc(sql`exists(select 1 from ${findings} f where f.company_id = ${boards.companyId} and f.status in ('needs_review','published'))`), asc(sql`coalesce(${boards.lastCrawledAt}, '')`));
  const out = rows.map((r) => r.board);
  return limit ? out.slice(0, limit) : out;
}

export async function markBoardCrawled(
  db: Db,
  boardId: number,
  patch: { runId: number; ok: boolean; error?: string; responseSha256?: string; openPostingsTotal?: number; learnedDelayMs?: number },
) {
  const now = nowIso();
  await db
    .update(boards)
    .set(
      patch.ok
        ? {
            lastCrawlRunId: patch.runId,
            lastCrawledAt: now,
            lastOkAt: now,
            lastResponseSha256: patch.responseSha256,
            openPostingsTotal: patch.openPostingsTotal,
            learnedDelayMs: patch.learnedDelayMs,
            errorCount: 0,
            lastError: null,
            status: 'active',
          }
        : {
            lastCrawlRunId: patch.runId,
            lastCrawledAt: now,
            errorCount: sql`${boards.errorCount} + 1`,
            lastError: (patch.error ?? 'unknown').slice(0, 500),
            // four bad days in a row and the board stops costing requests until someone looks
            status: sql`case when ${boards.errorCount} + 1 >= 4 then 'crawl_error' else ${boards.status} end`,
          },
    )
    .where(eq(boards.id, boardId));
}

// ---------- postings: diff-only writes ----------

export interface ClassifiedPostingInput {
  externalId: string;
  canonicalUrl: string;
  isOffsite: boolean;
  title: string;
  locations: string[];
  locClass: (typeof schema.LOC_CLASSES)[number];
  multiCity: boolean;
  remoteUs: boolean;
  isEvergreen: boolean;
  employmentType: string | null;
  contentSha256: string;
  rawKey: string | null;
  pageKey: string | null;
  coverage: CoverageJson;
  range: RangeJson;
  classifierVersion: string;
  needsDetail: boolean;
}

export interface DiffResult {
  inserted: { id: number; input: ClassifiedPostingInput }[];
  updated: { id: number; input: ClassifiedPostingInput }[];
  removedIds: number[];
  unchanged: number;
  touchedIds: number[];
}

export async function boardPostingState(db: Db, boardId: number) {
  return db
    .select({
      id: postings.id,
      externalId: postings.externalId,
      contentSha256: postings.contentSha256,
      removedAt: postings.removedAt,
      classifierVersion: postings.classifierVersion,
      needsDetail: postings.needsDetail,
    })
    .from(postings)
    .where(eq(postings.boardId, boardId));
}

// write only what changed. a posting row is touched when its content hash, its classifier version or its
// presence changed; everything else is left alone so a no-change day costs zero row writes
export async function applyBoardDiff(
  db: Db,
  args: { boardId: number; companyId: number; seen: ClassifiedPostingInput[]; markRemoved: boolean },
): Promise<DiffResult> {
  const existing = await boardPostingState(db, args.boardId);
  const byExt = new Map(existing.map((e) => [e.externalId, e]));
  const now = nowIso();
  const result: DiffResult = { inserted: [], updated: [], removedIds: [], unchanged: 0, touchedIds: [] };
  const toInsert: { row: NewPosting; input: ClassifiedPostingInput }[] = [];

  for (const p of args.seen) {
    const e = byExt.get(p.externalId);
    if (!e) {
      toInsert.push({ row: rowFor(args, p, now), input: p });
      continue;
    }
    byExt.delete(p.externalId);
    const changed = e.contentSha256 !== p.contentSha256 || e.removedAt !== null || e.classifierVersion !== p.classifierVersion || (e.needsDetail && !p.needsDetail);
    if (!changed) {
      result.unchanged += 1;
      continue;
    }
    await db
      .update(postings)
      .set({ ...rowFor(args, p, now), firstSeenAt: undefined, removedAt: null, lastChangedAt: now, classifiedAt: now })
      .where(eq(postings.id, e.id));
    result.updated.push({ id: e.id, input: p });
  }

  // d1 allows 100 bound params per statement; a posting row has ~25 columns
  for (let i = 0; i < toInsert.length; i += 3) {
    const chunk = toInsert.slice(i, i + 3);
    const ids = await db
      .insert(postings)
      .values(chunk.map((c) => c.row))
      .returning({ id: postings.id, externalId: postings.externalId });
    for (const c of chunk) {
      const id = ids.find((r) => r.externalId === c.input.externalId)?.id;
      if (id !== undefined) result.inserted.push({ id, input: c.input });
    }
  }

  if (args.markRemoved) {
    const gone = [...byExt.values()].filter((e) => e.removedAt === null).map((e) => e.id);
    for (let i = 0; i < gone.length; i += 50) {
      const chunk = gone.slice(i, i + 50);
      await db.update(postings).set({ removedAt: now }).where(inArray(postings.id, chunk));
    }
    result.removedIds = gone;
  }

  result.touchedIds = [...result.inserted.map((x) => x.id), ...result.updated.map((x) => x.id), ...result.removedIds];
  return result;
}

function rowFor(args: { boardId: number; companyId: number }, p: ClassifiedPostingInput, now: string): NewPosting {
  return {
    boardId: args.boardId,
    companyId: args.companyId,
    externalId: p.externalId,
    canonicalUrl: p.canonicalUrl,
    isOffsite: p.isOffsite,
    title: p.title,
    locations: p.locations,
    locClass: p.locClass,
    multiCity: p.multiCity,
    remoteUs: p.remoteUs,
    isEvergreen: p.isEvergreen,
    employmentType: p.employmentType,
    contentSha256: p.contentSha256,
    rawKey: p.rawKey,
    pageKey: p.pageKey,
    coverage: p.coverage,
    range: p.range,
    classifierVersion: p.classifierVersion,
    classifiedAt: now,
    needsDetail: p.needsDetail,
    detailFetchedAt: p.needsDetail ? null : now,
    firstSeenAt: now,
    lastChangedAt: now,
    removedAt: null,
  };
}

// ---------- findings: state machine ----------

export function findingTypeFor(method: string): FindingType | null {
  if (method === 'none') return 'missing_range';
  if (method === 'open_ended') return 'open_ended_range';
  if (method === 'placeholder_range') return 'placeholder_range';
  return null;
}

export function reviewReasonsFor(p: { coverage: CoverageJson; range: RangeJson; isOffsite: boolean; employmentType: string | null; title: string }): string[] {
  const reasons: string[] = [];
  if (p.coverage.coverage === 'possible') reasons.push('coverage_possible');
  if (p.coverage.multiCity) reasons.push('multi_city');
  if (p.coverage.locClass === 'ny_bare') reasons.push('bare_new_york');
  if (p.isOffsite) reasons.push('offsite_posting');
  if (/contract|1099|temp|freelance|consult/i.test(`${p.employmentType ?? ''} ${p.title}`)) reasons.push('contractor_or_temp');
  if (/intern|fellow|apprentice/i.test(p.title)) reasons.push('intern_or_fellow');
  if (p.range.method === 'open_ended') reasons.push('open_ended_range');
  if (p.range.method === 'placeholder_range') reasons.push('placeholder_range');
  if (p.range.confidence < 0.8) reasons.push('low_confidence');
  return reasons;
}

export async function transitionFinding(
  db: Db,
  args: {
    id: number;
    from: FindingStatus | FindingStatus[];
    to: FindingStatus;
    actor: string;
    reason?: string;
    falsePositiveReason?: (typeof schema.FALSE_POSITIVE_REASONS)[number];
    patch?: Partial<typeof findings.$inferInsert>;
  },
): Promise<boolean> {
  const froms = Array.isArray(args.from) ? args.from : [args.from];
  const now = nowIso();
  const stamp: Partial<typeof findings.$inferInsert> = {};
  const stampCol: Partial<Record<FindingStatus, keyof typeof findings.$inferInsert>> = {
    withdrawn: 'withdrawnAt',
    needs_review: 'reviewAt',
    published: 'publishedAt',
    rejected: 'rejectedAt',
    fixed: 'fixedAt',
    stale: 'staleAt',
  };
  const col = stampCol[args.to];
  if (col) (stamp as Record<string, unknown>)[col] = now;

  const updated = await db
    .update(findings)
    .set({ status: args.to, ...stamp, ...(args.patch ?? {}) })
    .where(and(eq(findings.id, args.id), inArray(findings.status, froms)))
    .returning({ id: findings.id });
  if (!updated.length) return false;
  // the from status is whichever one matched; when several were allowed, read it back is one more query,
  // so record the first allowed one unless the caller passed a single status
  await db.insert(reviews).values({
    findingId: args.id,
    actor: args.actor,
    fromStatus: froms.length === 1 ? froms[0]! : froms[0]!,
    toStatus: args.to,
    reason: args.reason ?? null,
    falsePositiveReason: args.falsePositiveReason ?? null,
  });
  return true;
}

export interface ReconcileCounts {
  created: number;
  withdrawn: number;
  fixed: number;
  stale: number;
  redetected: number;
}

// bring findings in line with the current state of a set of postings. the crawler owns these transitions:
// queued for review on a non-disclosed covered posting, withdrawn when a range shows up before anyone
// published, fixed when it shows up after publication, stale when a published posting disappears.
export async function reconcileFindings(db: Db, postingIds: number[], ctx: { actor: string }): Promise<ReconcileCounts> {
  const counts: ReconcileCounts = { created: 0, withdrawn: 0, fixed: 0, stale: 0, redetected: 0 };
  if (!postingIds.length) return counts;
  for (let i = 0; i < postingIds.length; i += 50) {
    const chunk = postingIds.slice(i, i + 50);
    const rows = await db.select().from(postings).where(inArray(postings.id, chunk));
    const existing = await db.select().from(findings).where(inArray(findings.postingId, chunk));
    const byPosting = new Map<number, typeof existing>();
    for (const f of existing) byPosting.set(f.postingId, [...(byPosting.get(f.postingId) ?? []), f]);

    for (const p of rows) {
      const fs = byPosting.get(p.id) ?? [];
      const wantType = p.removedAt || p.isEvergreen ? null : coveredFor(p.coverage) ? findingTypeFor(p.range.method) : null;

      for (const f of fs) {
        const stillWanted = wantType === f.type;
        if (stillWanted) continue;
        if (p.removedAt && f.status === 'published') {
          if (await transitionFinding(db, { id: f.id, from: 'published', to: 'stale', actor: ctx.actor, reason: 'posting no longer on the board' })) counts.stale += 1;
        } else if (p.removedAt && UNPUBLISHED.includes(f.status)) {
          if (await transitionFinding(db, { id: f.id, from: UNPUBLISHED, to: 'withdrawn', actor: ctx.actor, reason: 'posting removed before publication' })) counts.withdrawn += 1;
        } else if (!p.removedAt && f.status === 'published') {
          if (await transitionFinding(db, { id: f.id, from: 'published', to: 'fixed', actor: ctx.actor, reason: `posting now reads as ${p.range.method}`, patch: { fixedRawKey: p.rawKey } })) counts.fixed += 1;
        } else if (!p.removedAt && UNPUBLISHED.includes(f.status)) {
          if (await transitionFinding(db, { id: f.id, from: UNPUBLISHED, to: 'withdrawn', actor: ctx.actor, reason: `posting now reads as ${p.range.method}` })) counts.withdrawn += 1;
        }
      }

      if (!wantType) continue;
      const same = fs.find((f) => f.type === wantType);
      if (!same) {
        const now = nowIso();
        await db.insert(findings).values({
          postingId: p.id,
          companyId: p.companyId,
          type: wantType,
          status: 'needs_review',
          reviewReasons: reviewReasonsFor(p),
          firstRawKey: p.rawKey,
          firstPageKey: p.pageKey,
          evidenceSpan: p.range.evidenceSpan ?? null,
          rangeAtDetection: p.range,
          classifierVersion: p.classifierVersion,
          detectedAt: now,
          reviewAt: now,
        });
        counts.created += 1;
      } else if (same.status === 'fixed' || same.status === 'stale' || same.status === 'withdrawn') {
        // the posting regressed or came back: back into the queue with fresh evidence, never the old row's
        if (
          await transitionFinding(db, {
            id: same.id,
            from: same.status,
            to: 'needs_review',
            actor: ctx.actor,
            reason: 'posting reads as non-disclosed again',
            patch: {
              firstRawKey: p.rawKey,
              firstPageKey: p.pageKey,
              evidenceSpan: p.range.evidenceSpan ?? null,
              rangeAtDetection: p.range,
              classifierVersion: p.classifierVersion,
              reviewReasons: reviewReasonsFor(p),
              detectedAt: nowIso(),
              publishedAt: null,
              waybackUrl: null,
              waybackAt: null,
            },
          })
        )
          counts.redetected += 1;
      }
      // rejected stays rejected: a human said no
    }
  }
  return counts;
}

// possible still gets a finding: it goes to review with coverage_possible on it, a person decides
function coveredFor(c: CoverageJson): boolean {
  return c.coverage === 'covered' || c.coverage === 'possible';
}

// ---------- rollups ----------

export async function recomputeCompanyRollups(db: Db, companyIds: number[]) {
  const now = nowIso();
  for (const id of [...new Set(companyIds)]) {
    const [ny] = await db
      .select({
        open: sql<number>`count(*)`,
        disclosed: sql<number>`sum(case when json_extract(${postings.range}, '$.method') in (${sql.join(DISCLOSED.map((d) => sql`${d}`), sql`, `)}) then 1 else 0 end)`,
      })
      .from(postings)
      .where(and(eq(postings.companyId, id), isNull(postings.removedAt), inArray(postings.locClass, NY_CLASSES as never), eq(postings.isEvergreen, false)));
    const [total] = await db.select({ total: sql<number>`coalesce(sum(${boards.openPostingsTotal}), 0)` }).from(boards).where(and(eq(boards.companyId, id), eq(boards.status, 'active')));
    const [pub] = await db
      .select({ n: sql<number>`count(*)` })
      .from(findings)
      .innerJoin(postings, eq(postings.id, findings.postingId))
      .where(and(eq(findings.companyId, id), eq(findings.status, 'published'), isNull(postings.removedAt)));
    const [c] = await db.select({ isStaffingFirm: companies.isStaffingFirm, cohortReason: companies.cohortReason }).from(companies).where(eq(companies.id, id));
    const openTotal = Number(total?.total ?? 0);
    const manual = c?.cohortReason?.startsWith('manual') ?? false;
    await db
      .update(companies)
      .set({
        openPostingsTotal: openTotal,
        openPostingsNy: Number(ny?.open ?? 0),
        disclosedNy: Number(ny?.disclosed ?? 0),
        publishedFindings: Number(pub?.n ?? 0),
        inCohort: !c?.isStaffingFirm && (openTotal >= 5 || manual),
        cohortReason: manual ? c?.cohortReason : openTotal >= 5 ? 'threshold: 5+ open postings' : null,
        rollupAt: now,
        updatedAt: now,
      })
      .where(eq(companies.id, id));
  }
}

// ---------- runs ----------

export async function startRun(db: Db, kind: (typeof crawlRuns.$inferInsert)['kind'], vendor?: string) {
  const [row] = await db.insert(crawlRuns).values({ kind, vendor: vendor ?? null }).returning({ id: crawlRuns.id });
  return row!.id;
}

export async function finishRun(db: Db, id: number, patch: Partial<typeof crawlRuns.$inferInsert>) {
  await db
    .update(crawlRuns)
    .set({ ...patch, finishedAt: nowIso() })
    .where(eq(crawlRuns.id, id));
}

// ---------- submissions ----------

// claim rows one at a time with a conditional update; d1 serializes writes so two runners cannot both win
export async function claimQueuedSubmissions(db: Db, limit = 20) {
  const candidates = await db
    .select({ id: submissions.id })
    .from(submissions)
    .where(eq(submissions.status, 'queued'))
    .orderBy(asc(submissions.createdAt))
    .limit(limit);
  const claimed: (typeof submissions.$inferSelect)[] = [];
  for (const c of candidates) {
    const rows = await db
      .update(submissions)
      .set({ status: 'processing', attempts: sql`${submissions.attempts} + 1` })
      .where(and(eq(submissions.id, c.id), eq(submissions.status, 'queued')))
      .returning();
    if (rows[0]) claimed.push(rows[0]);
  }
  return claimed;
}
