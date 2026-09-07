import { classifyLocation } from '@jdr/core';
import { ensureBoard, findBoard, type Db } from '@jdr/db';
import { boards } from '@jdr/db/schema';
import { eq } from 'drizzle-orm';
import { gunzipSync } from 'node:zlib';
import type { Config } from './env.ts';

// discovery never probes blind slug lists. feashliaa already fetched every posting with its location, so a
// weekly diff of their dump against our boards costs zero ats requests. their data is cc by-nc 4.0.
const DATA_REPO = 'https://raw.githubusercontent.com/Feashliaa/job-board-data/main';
const VENDORS: Record<string, string> = { greenhouse: 'greenhouse', lever: 'lever', ashby: 'ashby', workday: 'workday' };
const NY = new Set(['nyc_strict', 'ny_bare', 'ny_state']);

interface DumpJob {
  ats?: string;
  company?: string;
  location?: string | null;
  url?: string;
  is_recruiter?: boolean;
}

export async function discover(db: Db, cfg: Config, opts: { activateWorkday: boolean; dryRun: boolean; log: (m: string) => void }) {
  const headers = { 'user-agent': cfg.userAgent };
  const manifest = (await (await fetch(`${DATA_REPO}/data/chunks/jobs_manifest.json`, { headers })).json()) as { chunks: string[] };
  opts.log(`discover: ${manifest.chunks.length} chunks in the feashliaa manifest`);

  const counts = new Map<string, { vendor: string; slug: string; ny: number; total: number; recruiter: boolean }>();
  for (const [i, name] of manifest.chunks.entries()) {
    const res = await fetch(`${DATA_REPO}/data/chunks/${name}`, { headers });
    if (!res.ok) {
      opts.log(`discover: chunk ${name} returned ${res.status}, skipping`);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const jobs = JSON.parse((buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString('utf8')) as DumpJob[];
    for (const j of jobs) {
      const vendor = VENDORS[(j.ats ?? '').toLowerCase()];
      if (!vendor) continue;
      const slug = slugFor(vendor, j);
      if (!slug) continue;
      const key = `${vendor}:${slug}`;
      const c = counts.get(key) ?? { vendor, slug, ny: 0, total: 0, recruiter: false };
      c.total += 1;
      if (NY.has(classifyLocation(j.location ?? ''))) c.ny += 1;
      if (j.is_recruiter) c.recruiter = true;
      counts.set(key, c);
    }
    opts.log(`discover: chunk ${i + 1}/${manifest.chunks.length} (${jobs.length} jobs), ${counts.size} boards so far`);
  }

  let added = 0;
  let known = 0;
  for (const c of counts.values()) {
    if (c.ny === 0) continue;
    if (await findBoard(db, c.vendor, c.slug)) {
      known += 1;
      continue;
    }
    added += 1;
    if (opts.dryRun) continue;
    const { board } = await ensureBoard(db, {
      vendor: c.vendor as never,
      slug: c.slug,
      discoveredVia: 'feashliaa',
      isStaffingFirm: c.recruiter,
      cohortReason: c.ny >= 5 ? 'threshold: 5+ nyc postings (dump)' : null,
    });
    if (c.vendor === 'workday' && !opts.activateWorkday) await db.update(boards).set({ status: 'inactive' }).where(eq(boards.id, board.id));
  }
  opts.log(`discover: ${known} boards already known, ${added} new boards with ny postings${opts.dryRun ? ' (dry run, nothing written)' : ''}`);
  return { added, known };
}

function slugFor(vendor: string, j: DumpJob): string | null {
  if (vendor !== 'workday') return j.company ? j.company.toLowerCase() : null;
  const m = /^https?:\/\/([^.]+)\.(wd\d+)\.myworkdayjobs\.com\/([^/]+)\//i.exec(j.url ?? '');
  return m ? `${m[1]!.toLowerCase()}|${m[2]!.toLowerCase()}|${m[3]}` : null;
}
