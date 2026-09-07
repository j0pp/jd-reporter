import { ensureBoard, type Db } from '@jdr/db';
import { boards, jurisdictions } from '@jdr/db/schema';
import { parse } from 'csv-parse/sync';
import { and, eq, inArray } from 'drizzle-orm';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from './env.ts';

const VENDORS = new Set(['greenhouse', 'lever', 'ashby', 'workday']);

type Row = Record<string, string>;

function readCsv(path: string): Row[] {
  if (!existsSync(path)) return [];
  return parse(readFileSync(path, 'utf8'), { columns: true, skip_empty_lines: true, relax_column_count: true }) as Row[];
}

const truthy = (v: string | undefined) => v === 'true' || v === 'True' || v === '1';

interface SectorTag {
  sector: string;
  source: 'manual' | 'agent';
  confidence: string | null;
}

function loadSectorOverrides(dir: string): Map<string, SectorTag> {
  const out = new Map<string, SectorTag>();
  for (const r of readCsv(join(dir, 'sector_agent.csv'))) {
    if (r.ats_vendor && r.ats_slug && r.sector && r.sector !== 'unknown') {
      out.set(`${r.ats_vendor}:${r.ats_slug}`, { sector: r.sector, source: 'agent', confidence: r.confidence || null });
    }
  }
  for (const r of readCsv(join(dir, 'sector_manual.csv'))) {
    if (r.ats_vendor && r.ats_slug && r.sector) out.set(`${r.ats_vendor}:${r.ats_slug}`, { sector: r.sector, source: 'manual', confidence: 'high' });
  }
  return out;
}

// the seed analysis (docs/FINDINGS.md) decided where to look; this loads its exported answer from data/seed
// and the sector tags from data/sectors. one company per board to start.
export async function seed(db: Db, cfg: Config, opts: { workdayTop: number; log: (m: string) => void }) {
  const seedDir = join(cfg.dataDir, 'seed');
  const cohort = readCsv(join(seedDir, 'cohort.csv'));
  const candidates = readCsv(join(seedDir, 'candidates.csv'));
  if (!cohort.length && !candidates.length) throw new Error(`no seed csvs under ${seedDir}`);
  const sectors = loadSectorOverrides(join(cfg.dataDir, 'sectors'));

  const cohortKey = new Set(cohort.map((r) => `${r.ats_vendor}:${r.ats_slug}`));
  let created = 0;
  let seen = 0;

  // cohort rows carry the reason and the hand-checked sector; candidates fill in the ledger
  const rows: { r: Row; cohort: boolean }[] = [
    ...cohort.map((r) => ({ r, cohort: true })),
    ...candidates.filter((r) => !cohortKey.has(`${r.ats_vendor}:${r.ats_slug}`)).map((r) => ({ r, cohort: false })),
  ];

  const workdayRanked = cohort
    .filter((r) => r.ats_vendor === 'workday')
    .sort((a, b) => Number(b.nyc_count ?? 0) - Number(a.nyc_count ?? 0))
    .slice(0, opts.workdayTop)
    .map((r) => r.ats_slug);
  const workdayActive = new Set(workdayRanked);

  for (const { r, cohort: inCohort } of rows) {
    if (!VENDORS.has(r.ats_vendor ?? '') || !r.ats_slug) continue;
    seen += 1;
    // manual tag beats the llm pass beats whatever the export row carried
    const override = sectors.get(`${r.ats_vendor}:${r.ats_slug}`);
    const sector = override?.sector ?? (r.sector && r.sector !== 'unknown' ? r.sector : null);
    const { board, created: isNew } = await ensureBoard(db, {
      vendor: r.ats_vendor as never,
      slug: r.ats_slug,
      discoveredVia: inCohort ? 'seed:cohort' : 'seed:candidates',
      accessTier: Number(r.access_tier ?? 1) || 1,
      sector,
      sectorSource: override?.source ?? r.sector_source ?? null,
      sectorConfidence: override?.confidence ?? r.sector_confidence ?? null,
      naics2: r.naics2 || null,
      cohortReason: inCohort ? r.cohort_reason || null : null,
      isStaffingFirm: truthy(r.is_recruiter),
    });
    if (isNew) created += 1;
    // workday is expensive (pagination plus a detail call per posting); only hand-picked tenants crawl
    if (r.ats_vendor === 'workday' && !workdayActive.has(r.ats_slug)) {
      await db.update(boards).set({ status: 'inactive' }).where(and(eq(boards.id, board.id), eq(boards.status, 'active')));
    }
  }

  await seedJurisdictions(db);
  opts.log(`seed: ${seen} board rows read, ${created} boards created, ${workdayActive.size} workday tenants active`);
  return { seen, created };
}

// reference rows for the two laws, verified against the agencies' pages on 2026-09-05:
// nyc: the cchr online report form takes anonymous tips (an official complaint is a separate notarized filing)
// nys: the dol's combined pay equity / salary history / pay transparency complaint form; the dol faq says
// members of the public who merely noticed a non-compliant posting may report it, and nyc postings may go to either
export async function seedJurisdictions(db: Db) {
  const rows = [
    {
      code: 'nyc',
      name: 'New York City',
      statuteCite: 'NYC Admin. Code § 8-107(32) (Local Laws 32 and 59 of 2022)',
      agency: 'NYC Commission on Human Rights',
      complaintUrl: 'https://www.nyc.gov/site/cchr/about/report-discrimination.page',
      complaintLabel: 'Report to the NYC Commission on Human Rights',
      requiredFields: ['min', 'max'],
      coverageRule:
        'Employers with 4+ employees (at least one in NYC). Any advertised job that can or will be performed at least in part in New York City. Temporary help firms exempt. No penalty for a first complaint fixed within 30 days. Anonymous tips accepted; call 311 or (212) 416-0197.',
    },
    {
      code: 'nys',
      name: 'New York State',
      statuteCite: 'NY Labor Law § 194-b',
      agency: 'New York State Department of Labor',
      complaintUrl: 'https://dol.ny.gov/pay-equitysalary-historypay-transparency-complaint-form',
      complaintLabel: 'Report to the NYS Department of Labor',
      requiredFields: ['min', 'max', 'job_description'],
      coverageRule:
        'Employers with 4+ employees. Any advertised job physically performed at least in part in New York State, or performed elsewhere but reporting to a NYS supervisor, office or worksite. Temporary help firms exempt. Anyone who notices a non-compliant posting may report it; Division of Labor Standards, 1-888-52-LABOR, LSAsk@labor.ny.gov.',
    },
  ];
  const existing = await db.select({ code: jurisdictions.code }).from(jurisdictions).where(inArray(jurisdictions.code, ['nyc', 'nys']));
  const have = new Set(existing.map((e) => e.code));
  for (const r of rows) {
    if (have.has(r.code)) await db.update(jurisdictions).set(r).where(eq(jurisdictions.code, r.code));
    else await db.insert(jurisdictions).values(r);
  }
}
