import { finishRun, recomputeCompanyRollups, startRun, type Db } from '@jdr/db';
import { findings, postings } from '@jdr/db/schema';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Config } from './env.ts';
import { waybackSave } from './wayback.ts';

// after the daily crawls: archive queued findings to wayback, refresh rollups. findings enter the review
// queue on the crawl that detects them, so there is nothing to promote here
export async function finalize(db: Db, cfg: Config, opts: { waybackCap: number; log: (m: string) => void }) {
  const runId = await startRun(db, 'finalize');

  // wayback before the human looks, so the reviewer sees a stable third-party link
  let archived = 0;
  if (cfg.waybackAccessKey) {
    const rows = await db
      .select({ id: findings.id, url: postings.canonicalUrl })
      .from(findings)
      .innerJoin(postings, eq(postings.id, findings.postingId))
      .where(and(eq(findings.status, 'needs_review'), isNull(findings.waybackUrl)))
      .limit(opts.waybackCap);
    for (const r of rows) {
      const url = await waybackSave(cfg, r.url, opts.log);
      if (url) {
        await db.update(findings).set({ waybackUrl: url, waybackAt: new Date().toISOString() }).where(eq(findings.id, r.id));
        archived += 1;
      }
    }
    opts.log(`finalize: ${archived} findings archived to wayback`);
  } else {
    opts.log('finalize: no wayback keys, skipping archive');
  }

  // rollups for every company that has any finding at all; cheap and keeps the leaderboard honest
  const touched = await db.selectDistinct({ companyId: findings.companyId }).from(findings);
  await recomputeCompanyRollups(
    db,
    touched.map((t) => t.companyId),
  );

  const [open] = await db.select({ n: sql<number>`count(*)` }).from(findings).where(eq(findings.status, 'needs_review'));
  await finishRun(db, runId, { meta: { archived, needsReview: Number(open?.n ?? 0) } });
  opts.log(`finalize: ${Number(open?.n ?? 0)} findings waiting in the review queue`);
}
