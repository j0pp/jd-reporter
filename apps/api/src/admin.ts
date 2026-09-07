import { classifyPosting, createHttp, getAdapter } from '@jdr/core';
import { recomputeCompanyRollups, transitionFinding, type Db, type FindingStatus } from '@jdr/db';
import { boards, companies, FALSE_POSITIVE_REASONS, findings, postings, reviews, submissions } from '@jdr/db/schema';
import { and, desc, eq, inArray, isNull, like, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { requireAdmin } from './auth.ts';
import type { AppEnv } from './env.ts';

export const adminRoutes = new Hono<AppEnv>();
adminRoutes.use('*', requireAdmin);

const asDb = (c: { get: (k: 'db') => unknown }) => c.get('db') as unknown as Db;

// the review queue, grouped by company so one sitting clears one employer
adminRoutes.get('/queue', async (c) => {
  const db = asDb(c);
  const now = new Date().toISOString();
  const rows = await db
    .select({ f: findings, p: postings, company: companies, board: boards })
    .from(findings)
    .innerJoin(postings, eq(postings.id, findings.postingId))
    .innerJoin(companies, eq(companies.id, findings.companyId))
    .innerJoin(boards, eq(boards.id, postings.boardId))
    .where(and(eq(findings.status, 'needs_review'), or(isNull(findings.snoozedUntil), sql`${findings.snoozedUntil} <= ${now}`)))
    .orderBy(desc(companies.openPostingsNy), companies.id, findings.detectedAt)
    .limit(500);

  const groups = new Map<number, { company: typeof companies.$inferSelect; items: unknown[] }>();
  for (const r of rows) {
    const g = groups.get(r.company.id) ?? { company: r.company, items: [] };
    g.items.push({
      finding: r.f,
      posting: { ...r.p, board: { vendor: r.board.atsVendor, slug: r.board.atsSlug } },
    });
    groups.set(r.company.id, g);
  }
  const [counts] = await db
    .select({
      needsReview: sql<number>`sum(case when ${findings.status} = 'needs_review' then 1 else 0 end)`,
      detected: sql<number>`sum(case when ${findings.status} = 'detected' then 1 else 0 end)`,
      published: sql<number>`sum(case when ${findings.status} = 'published' then 1 else 0 end)`,
    })
    .from(findings);
  return c.json({ groups: [...groups.values()], counts });
});

adminRoutes.post('/findings/:id', async (c) => {
  const db = asDb(c);
  const id = Number(c.req.param('id'));
  const body = (await c.req.json().catch(() => ({}))) as {
    action?: 'publish' | 'reject' | 'snooze' | 'unpublish';
    reason?: string;
    falsePositiveReason?: (typeof FALSE_POSITIVE_REASONS)[number];
    snoozeDays?: number;
  };
  const actor = c.get('actor');
  const [f] = await db.select().from(findings).where(eq(findings.id, id));
  if (!f) return c.json({ error: 'no such finding' }, 404);
  const [company] = await db.select().from(companies).where(eq(companies.id, f.companyId));

  switch (body.action) {
    case 'publish': {
      // the two gates that keep a wrong name or a tiny employer off the public site
      if (!company?.verifiedAt) return c.json({ error: 'verify the company name and sector first' }, 400);
      if (!company.inCohort) return c.json({ error: `company has ${company.openPostingsTotal} open postings, below the 5 needed to score it` }, 400);
      const ok = await transitionFinding(db, { id, from: 'needs_review', to: 'published', actor, reason: body.reason });
      if (!ok) return c.json({ error: `finding is ${f.status}, not needs_review` }, 409);
      await recomputeCompanyRollups(db, [f.companyId]);
      return c.json({ ok: true, status: 'published' });
    }
    case 'reject': {
      if (!body.falsePositiveReason || !FALSE_POSITIVE_REASONS.includes(body.falsePositiveReason)) {
        return c.json({ error: 'a false_positive_reason is required so the miss becomes a test', reasons: FALSE_POSITIVE_REASONS }, 400);
      }
      const ok = await transitionFinding(db, { id, from: ['needs_review', 'published'], to: 'rejected', actor, reason: body.reason, falsePositiveReason: body.falsePositiveReason });
      if (!ok) return c.json({ error: `finding is ${f.status}` }, 409);
      await recomputeCompanyRollups(db, [f.companyId]);
      return c.json({ ok: true, status: 'rejected' });
    }
    case 'unpublish': {
      const ok = await transitionFinding(db, { id, from: 'published', to: 'needs_review', actor, reason: body.reason ?? 'unpublished for another look' });
      if (!ok) return c.json({ error: `finding is ${f.status}` }, 409);
      await recomputeCompanyRollups(db, [f.companyId]);
      return c.json({ ok: true, status: 'needs_review' });
    }
    case 'snooze': {
      const days = Math.min(Math.max(body.snoozeDays ?? 7, 1), 60);
      await db
        .update(findings)
        .set({ snoozedUntil: new Date(Date.now() + days * 86_400_000).toISOString() })
        .where(and(eq(findings.id, id), eq(findings.status, 'needs_review')));
      await db.insert(reviews).values({ findingId: id, actor, fromStatus: 'needs_review', toStatus: 'needs_review', reason: `snoozed ${days}d${body.reason ? `: ${body.reason}` : ''}` });
      return c.json({ ok: true, status: 'needs_review', snoozedDays: days });
    }
    default:
      return c.json({ error: 'action must be publish, reject, snooze or unpublish' }, 400);
  }
});

adminRoutes.get('/findings/:id/history', async (c) => {
  const db = asDb(c);
  const rows = await db.select().from(reviews).where(eq(reviews.findingId, Number(c.req.param('id')))).orderBy(reviews.createdAt);
  return c.json(rows);
});

// the stored blob, streamed as-is; the browser decompresses it (content-encoding) and finds the posting.
// zero cpu here, which matters on the free plan
adminRoutes.get('/blob', async (c) => {
  const key = c.req.query('key');
  if (!key || !/^(boards|postings|pages)\//.test(key)) return c.json({ error: 'bad key' }, 400);
  const obj = await c.env.BLOBS.get(key);
  if (!obj) return c.json({ error: 'blob not found' }, 404);
  const headers = new Headers({ 'content-type': key.endsWith('.html.gz') ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8', 'cache-control': 'private, max-age=3600' });
  headers.set('content-encoding', 'gzip');
  return new Response(obj.body, { headers });
});

// what the posting says right now, one vendor call; ashby has no single-posting endpoint
adminRoutes.get('/postings/:id/live', async (c) => {
  const db = asDb(c);
  const [row] = await db
    .select({ p: postings, board: boards })
    .from(postings)
    .innerJoin(boards, eq(boards.id, postings.boardId))
    .where(eq(postings.id, Number(c.req.param('id'))));
  if (!row) return c.json({ error: 'no such posting' }, 404);
  if (row.board.atsVendor === 'ashby') return c.json({ error: 'ashby has no single-posting endpoint; use the stored blob' }, 422);
  const adapter = getAdapter(row.board.atsVendor);
  const http = createHttp({ userAgent: 'jd-reporter/0.1 (admin live view)', delayMs: 0, maxRetries: 0, timeoutMs: 8000 });
  const raw = await adapter.fetchPosting(row.board.atsSlug, row.board.atsVendor === 'workday' ? String((row.p.canonicalUrl.match(/\/job\/.*$/) ?? [row.p.externalId])[0]) : row.p.externalId, { http });
  if (!raw) return c.json({ error: 'posting not found on the board right now (removed?)' }, 404);
  const cl = classifyPosting(row.board.atsVendor, raw);
  return c.json({ title: raw.title, locations: raw.locations, text: raw.descriptionText, structured: raw.structuredComp, url: raw.url, classification: cl });
});

adminRoutes.get('/submissions', async (c) => {
  const db = asDb(c);
  const limit = Math.min(Number(c.req.query('limit') ?? 100), 500);
  const rows = await db.select().from(submissions).orderBy(desc(submissions.createdAt)).limit(limit);
  const [rejected] = await db
    .select({ host: submissions.rejectedDomain, n: sql<number>`count(*)` })
    .from(submissions)
    .where(sql`${submissions.rejectedDomain} is not null`)
    .groupBy(submissions.rejectedDomain)
    .orderBy(desc(sql`count(*)`))
    .limit(1);
  const rejectedHosts = await db
    .select({ host: submissions.rejectedDomain, n: sql<number>`count(*)` })
    .from(submissions)
    .where(sql`${submissions.rejectedDomain} is not null`)
    .groupBy(submissions.rejectedDomain)
    .orderBy(desc(sql`count(*)`))
    .limit(20);
  return c.json({ submissions: rows, rejectedHosts, topRejected: rejected ?? null });
});

adminRoutes.get('/companies', async (c) => {
  const db = asDb(c);
  const q = (c.req.query('q') ?? '').trim();
  const filter = c.req.query('filter') ?? 'unverified';
  const conds = [eq(companies.status, 'active')];
  if (filter === 'unverified') conds.push(isNull(companies.verifiedAt));
  if (q) conds.push(or(like(companies.displayName, `%${q}%`), like(companies.slug, `%${q}%`))!);
  const rows = await db
    .select()
    .from(companies)
    .where(and(...conds))
    .orderBy(desc(companies.openPostingsNy))
    .limit(200);
  const ids = rows.map((r) => r.id);
  const bs = ids.length ? await db.select().from(boards).where(inArray(boards.companyId, ids)) : [];
  return c.json(
    rows.map((r) => ({ ...r, boards: bs.filter((b) => b.companyId === r.id).map((b) => ({ id: b.id, vendor: b.atsVendor, slug: b.atsSlug, status: b.status, lastOkAt: b.lastOkAt, openPostingsTotal: b.openPostingsTotal })) })),
  );
});

adminRoutes.post('/companies/:id', async (c) => {
  const db = asDb(c);
  const id = Number(c.req.param('id'));
  const body = (await c.req.json().catch(() => ({}))) as {
    displayName?: string;
    sector?: string | null;
    hqCity?: string | null;
    hqState?: string | null;
    isStaffingFirm?: boolean;
    verify?: boolean;
    exclude?: boolean;
    mergeIntoId?: number;
  };
  const actor = c.get('actor');
  const [existing] = await db.select().from(companies).where(eq(companies.id, id));
  if (!existing) return c.json({ error: 'no such company' }, 404);

  if (body.mergeIntoId) {
    const [target] = await db.select().from(companies).where(eq(companies.id, body.mergeIntoId));
    if (!target) return c.json({ error: 'merge target not found' }, 404);
    // boards, postings and findings move; the old slug stays as a merged stub so links keep resolving
    await db.update(boards).set({ companyId: target.id }).where(eq(boards.companyId, id));
    await db.update(postings).set({ companyId: target.id }).where(eq(postings.companyId, id));
    await db.update(findings).set({ companyId: target.id }).where(eq(findings.companyId, id));
    await db.update(companies).set({ status: 'merged', mergedIntoId: target.id, updatedAt: new Date().toISOString() }).where(eq(companies.id, id));
    await recomputeCompanyRollups(db, [target.id]);
    return c.json({ ok: true, mergedInto: target.slug });
  }

  const patch: Partial<typeof companies.$inferInsert> = { updatedAt: new Date().toISOString() };
  if (typeof body.displayName === 'string' && body.displayName.trim()) patch.displayName = body.displayName.trim();
  if (body.sector !== undefined) {
    patch.sector = body.sector;
    patch.sectorSource = 'manual';
    patch.sectorConfidence = 'high';
  }
  if (body.hqCity !== undefined) {
    patch.hqCity = body.hqCity;
    patch.hqSource = 'manual';
  }
  if (body.hqState !== undefined) patch.hqState = body.hqState;
  if (typeof body.isStaffingFirm === 'boolean') patch.isStaffingFirm = body.isStaffingFirm;
  if (body.verify === true) {
    patch.verifiedAt = new Date().toISOString();
    patch.verifiedBy = actor;
  }
  if (body.verify === false) {
    patch.verifiedAt = null;
    patch.verifiedBy = null;
  }
  if (body.exclude === true) patch.status = 'excluded';
  if (body.exclude === false) patch.status = 'active';
  await db.update(companies).set(patch).where(eq(companies.id, id));
  await recomputeCompanyRollups(db, [id]);
  const [updated] = await db.select().from(companies).where(eq(companies.id, id));
  return c.json(updated);
});

adminRoutes.get('/stats', async (c) => {
  const db = asDb(c);
  const byStatus = await db.select({ status: findings.status, n: sql<number>`count(*)` }).from(findings).groupBy(findings.status);
  const [b] = await db
    .select({ active: sql<number>`sum(case when status='active' then 1 else 0 end)`, errors: sql<number>`sum(case when status='crawl_error' then 1 else 0 end)`, total: sql<number>`count(*)` })
    .from(boards);
  const [unverified] = await db
    .select({ n: sql<number>`count(*)` })
    .from(companies)
    .where(and(isNull(companies.verifiedAt), sql`${companies.publishedFindings} > 0 or exists(select 1 from findings f where f.company_id = companies.id and f.status = 'needs_review')`));
  return c.json({ findings: Object.fromEntries(byStatus.map((r) => [r.status, Number(r.n)])) as Record<FindingStatus, number>, boards: b, companiesNeedingVerification: Number(unverified?.n ?? 0) });
});
