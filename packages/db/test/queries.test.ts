import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createLocalDb, migrateLocalDb, type LocalDb } from '../src/client-local.ts';
import {
  applyBoardDiff,
  claimQueuedSubmissions,
  confirmDetectedFindings,
  ensureBoard,
  markBoardCrawled,
  queueConfirmedForReview,
  recomputeCompanyRollups,
  reconcileFindings,
  transitionFinding,
  type ClassifiedPostingInput,
} from '../src/queries.ts';
import { boards, companies, findings, postings, reviews, submissions } from '../src/schema.ts';

let db: LocalDb;

beforeEach(async () => {
  db = createLocalDb(':memory:');
  await migrateLocalDb(db);
});

const covered = { nyc: 'covered', nys: 'covered', locClass: 'nyc_strict', multiCity: false, remoteUs: false, reasons: [], confidence: 0.9 };

function posting(externalId: string, method: string, sha = `sha-${externalId}-${method}`, rawKey = 'r2/board.json.gz'): ClassifiedPostingInput {
  return {
    externalId,
    canonicalUrl: `https://boards.greenhouse.io/acme/jobs/${externalId}`,
    isOffsite: false,
    title: `Engineer ${externalId}`,
    locations: ['New York, NY'],
    locClass: 'nyc_strict',
    multiCity: false,
    remoteUs: false,
    isEvergreen: false,
    employmentType: null,
    contentSha256: sha,
    rawKey,
    pageKey: null,
    jurisdiction: covered,
    range: method === 'text_range' ? { method, min: 100000, max: 120000, source: 'ats_api', confidence: 0.9, evidenceSpan: '$100,000 - $120,000' } : { method, source: 'ats_api', confidence: 0.9 },
    classifierVersion: 'v1',
    needsDetail: false,
  };
}

describe('boards and companies', () => {
  it('ensureBoard creates one company per board and dedupes on lowercase slug', async () => {
    const a = await ensureBoard(db, { vendor: 'greenhouse', slug: 'Acme', discoveredVia: 'seed' });
    const b = await ensureBoard(db, { vendor: 'greenhouse', slug: 'acme', discoveredVia: 'submission' });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.board.id).toBe(a.board.id);
    const [c] = await db.select().from(companies);
    expect(c!.displayName).toBe('Acme');
    expect(c!.slug).toBe('acme');
    const w = await ensureBoard(db, { vendor: 'workday', slug: 'msk|wd108|mskcc_careers_primary', discoveredVia: 'seed' });
    const wc = await db.select().from(companies).where(eq(companies.id, w.board.companyId));
    expect(wc[0]!.displayName).toBe('Msk');
  });

  it('four failed crawls in a row park a board in crawl_error; a success resets', async () => {
    const { board } = await ensureBoard(db, { vendor: 'lever', slug: 'x', discoveredVia: 'seed' });
    for (let i = 0; i < 4; i++) await markBoardCrawled(db, board.id, { runId: 1, ok: false, error: 'boom' });
    let [b] = await db.select().from(boards);
    expect(b!.status).toBe('crawl_error');
    expect(b!.errorCount).toBe(4);
    await markBoardCrawled(db, board.id, { runId: 2, ok: true, openPostingsTotal: 12 });
    [b] = await db.select().from(boards);
    expect(b!.status).toBe('active');
    expect(b!.errorCount).toBe(0);
    expect(b!.openPostingsTotal).toBe(12);
  });
});

describe('diff-only posting writes', () => {
  it('inserts new, leaves unchanged alone, updates changed, removes gone', async () => {
    const { board } = await ensureBoard(db, { vendor: 'greenhouse', slug: 'acme', discoveredVia: 'seed' });
    const ctx = { boardId: board.id, companyId: board.companyId, markRemoved: true };

    const d1 = await applyBoardDiff(db, { ...ctx, seen: [posting('1', 'text_range'), posting('2', 'none'), posting('3', 'text_range')] });
    expect(d1.inserted).toHaveLength(3);
    expect(d1.unchanged).toBe(0);

    const d2 = await applyBoardDiff(db, { ...ctx, seen: [posting('1', 'text_range'), posting('2', 'none'), posting('3', 'text_range')] });
    expect(d2.inserted).toHaveLength(0);
    expect(d2.updated).toHaveLength(0);
    expect(d2.unchanged).toBe(3);
    expect(d2.touchedIds).toEqual([]);

    // posting 2 gains a range, posting 3 disappears, posting 4 is new
    const d3 = await applyBoardDiff(db, { ...ctx, seen: [posting('1', 'text_range'), posting('2', 'text_range'), posting('4', 'none')] });
    expect(d3.updated.map((u) => u.input.externalId)).toEqual(['2']);
    expect(d3.inserted.map((u) => u.input.externalId)).toEqual(['4']);
    expect(d3.removedIds).toHaveLength(1);
    const rows = await db.select().from(postings);
    expect(rows.find((r) => r.externalId === '3')!.removedAt).not.toBeNull();
    expect(rows.find((r) => r.externalId === '2')!.range.method).toBe('text_range');

    // a partial fetch must never remove anything
    const d4 = await applyBoardDiff(db, { ...ctx, seen: [posting('1', 'text_range')], markRemoved: false });
    expect(d4.removedIds).toEqual([]);

    // a removed posting that comes back is revived
    const d5 = await applyBoardDiff(db, { ...ctx, seen: [posting('1', 'text_range'), posting('2', 'text_range'), posting('3', 'text_range'), posting('4', 'none')] });
    expect(d5.updated.map((u) => u.input.externalId)).toEqual(['3']);
    expect((await db.select().from(postings)).find((r) => r.externalId === '3')!.removedAt).toBeNull();
  });

  it('a classifier version bump rewrites the row even when the content hash is the same', async () => {
    const { board } = await ensureBoard(db, { vendor: 'greenhouse', slug: 'acme', discoveredVia: 'seed' });
    const ctx = { boardId: board.id, companyId: board.companyId, markRemoved: true };
    await applyBoardDiff(db, { ...ctx, seen: [posting('1', 'none', 'same')] });
    const d = await applyBoardDiff(db, { ...ctx, seen: [{ ...posting('1', 'text_range', 'same'), classifierVersion: 'v2' }] });
    expect(d.updated).toHaveLength(1);
  });
});

describe('finding state machine', () => {
  async function setup() {
    const { board } = await ensureBoard(db, { vendor: 'greenhouse', slug: 'acme', discoveredVia: 'seed' });
    const ctx = { boardId: board.id, companyId: board.companyId, markRemoved: true };
    const d = await applyBoardDiff(db, { ...ctx, seen: [posting('1', 'none'), posting('2', 'text_range'), posting('3', 'open_ended')] });
    const c = await reconcileFindings(db, d.touchedIds, { actor: 'system' });
    return { board, ctx, c };
  }

  it('creates detected findings only for covered non-disclosed postings', async () => {
    const { c } = await setup();
    expect(c.created).toBe(2);
    const fs = await db.select().from(findings);
    expect(fs.map((f) => [f.type, f.status]).sort()).toEqual([
      ['missing_range', 'detected'],
      ['open_ended_range', 'detected'],
    ]);
    expect(fs[0]!.firstRawKey).toBe('r2/board.json.gz');
    expect(fs.find((f) => f.type === 'open_ended_range')!.reviewReasons).toContain('open_ended_range');
  });

  it('a range that shows up before anyone looked withdraws; after publication it fixes; removal stales', async () => {
    const { board, ctx } = await setup();
    const all = await db.select().from(postings);
    const p1 = all.find((p) => p.externalId === '1')!;
    const p3 = all.find((p) => p.externalId === '3')!;
    const f1 = (await db.select().from(findings).where(eq(findings.postingId, p1.id)))[0]!;

    // publish f1 by hand (the admin path), then the posting gains a range
    expect(await transitionFinding(db, { id: f1.id, from: 'detected', to: 'published', actor: 'jon' })).toBe(true);
    let d = await applyBoardDiff(db, {
      ...ctx,
      seen: [posting('1', 'text_range', undefined, 'r2/board2.json.gz'), posting('2', 'text_range'), posting('3', 'text_range', undefined, 'r2/board2.json.gz')],
    });
    let c = await reconcileFindings(db, d.touchedIds, { actor: 'system' });
    expect(c.fixed).toBe(1);
    expect(c.withdrawn).toBe(1);
    const after = await db.select().from(findings);
    expect(after.find((f) => f.postingId === p1.id)!.status).toBe('fixed');
    expect(after.find((f) => f.postingId === p1.id)!.fixedRawKey).toBe('r2/board2.json.gz');
    expect(after.find((f) => f.postingId === p3.id)!.status).toBe('withdrawn');

    // the range disappears again: redetected with fresh evidence, not the old published row
    d = await applyBoardDiff(db, { ...ctx, seen: [posting('1', 'none', 'sha-1-none-b', 'r2/board3.json.gz'), posting('2', 'text_range'), posting('3', 'text_range', undefined, 'r2/board2.json.gz')] });
    c = await reconcileFindings(db, d.touchedIds, { actor: 'system' });
    expect(c.redetected).toBe(1);
    const re = (await db.select().from(findings).where(eq(findings.postingId, p1.id)))[0]!;
    expect(re.status).toBe('detected');
    expect(re.firstRawKey).toBe('r2/board3.json.gz');
    expect(re.publishedAt).toBeNull();

    // publish again, then the posting vanishes
    await transitionFinding(db, { id: re.id, from: 'detected', to: 'published', actor: 'jon' });
    d = await applyBoardDiff(db, { ...ctx, seen: [posting('2', 'text_range'), posting('3', 'text_range')] });
    c = await reconcileFindings(db, d.touchedIds, { actor: 'system' });
    expect(c.stale).toBe(1);

    // every transition left a review row
    const log = await db.select().from(reviews).where(eq(reviews.findingId, re.id));
    expect(log.map((r) => r.toStatus)).toEqual(['published', 'fixed', 'detected', 'published', 'stale']);
    expect(board.id).toBeGreaterThan(0);
  });

  it('rejected stays rejected even when the posting still reads as none', async () => {
    const { ctx } = await setup();
    const f = (await db.select().from(findings))[0]!;
    await transitionFinding(db, { id: f.id, from: 'detected', to: 'rejected', actor: 'jon', falsePositiveReason: 'parser_missed_format' });
    const d = await applyBoardDiff(db, { ...ctx, seen: [posting('1', 'none', 'sha-1-none-c'), posting('2', 'text_range'), posting('3', 'open_ended', 'sha-3-b')] });
    await reconcileFindings(db, d.touchedIds, { actor: 'system' });
    expect((await db.select().from(findings).where(eq(findings.id, f.id)))[0]!.status).toBe('rejected');
  });

  it('conditional transitions refuse the wrong from-state', async () => {
    await setup();
    const f = (await db.select().from(findings))[0]!;
    expect(await transitionFinding(db, { id: f.id, from: 'needs_review', to: 'published', actor: 'jon' })).toBe(false);
    expect((await db.select().from(reviews)).length).toBe(0);
  });

  it('confirmation needs 20 hours and a later successful crawl of the board', async () => {
    const { board } = await setup();
    expect(await confirmDetectedFindings(db)).toBe(0);
    const old = new Date(Date.now() - 30 * 3600_000).toISOString();
    await db.update(findings).set({ detectedAt: old });
    // board last ok before the 20 h mark: still no
    await db.update(boards).set({ lastOkAt: new Date(Date.now() - 25 * 3600_000).toISOString() }).where(eq(boards.id, board.id));
    expect(await confirmDetectedFindings(db)).toBe(0);
    await db.update(boards).set({ lastOkAt: new Date().toISOString() }).where(eq(boards.id, board.id));
    expect(await confirmDetectedFindings(db)).toBe(2);
    expect(await queueConfirmedForReview(db)).toBe(2);
    const statuses = (await db.select().from(findings)).map((f) => f.status);
    expect(statuses).toEqual(['needs_review', 'needs_review']);
  });
});

describe('rollups and the 5+ proxy', () => {
  it('counts ny postings, disclosed, published and sets in_cohort from the board total', async () => {
    const { board } = await ensureBoard(db, { vendor: 'greenhouse', slug: 'acme', discoveredVia: 'seed' });
    const ctx = { boardId: board.id, companyId: board.companyId, markRemoved: true };
    const d = await applyBoardDiff(db, { ...ctx, seen: [posting('1', 'none'), posting('2', 'text_range'), posting('3', 'text_range')] });
    await reconcileFindings(db, d.touchedIds, { actor: 'system' });
    await markBoardCrawled(db, board.id, { runId: 1, ok: true, openPostingsTotal: 3 });
    await recomputeCompanyRollups(db, [board.companyId]);
    let [c] = await db.select().from(companies);
    expect(c!.openPostingsNy).toBe(3);
    expect(c!.disclosedNy).toBe(2);
    expect(c!.inCohort).toBe(false);
    expect(c!.publishedFindings).toBe(0);

    await markBoardCrawled(db, board.id, { runId: 2, ok: true, openPostingsTotal: 40 });
    const f = (await db.select().from(findings))[0]!;
    await transitionFinding(db, { id: f.id, from: 'detected', to: 'published', actor: 'jon' });
    await recomputeCompanyRollups(db, [board.companyId]);
    [c] = await db.select().from(companies);
    expect(c!.inCohort).toBe(true);
    expect(c!.cohortReason).toBe('threshold: 5+ open postings');
    expect(c!.publishedFindings).toBe(1);
  });
});

describe('submission queue', () => {
  it('claims queued rows exactly once', async () => {
    await db.insert(submissions).values([
      { publicToken: 'a', submittedUrl: 'https://x', sourceType: 'ats_posting', status: 'queued', ipHash: 'h' },
      { publicToken: 'b', submittedUrl: 'https://y', sourceType: 'ats_board', status: 'queued', ipHash: 'h' },
      { publicToken: 'c', submittedUrl: 'https://z', sourceType: 'aggregator', status: 'rejected', ipHash: 'h' },
    ]);
    const first = await claimQueuedSubmissions(db, 10);
    expect(first.map((s) => s.publicToken)).toEqual(['a', 'b']);
    expect(first[0]!.attempts).toBe(1);
    expect(await claimQueuedSubmissions(db, 10)).toEqual([]);
  });
});
