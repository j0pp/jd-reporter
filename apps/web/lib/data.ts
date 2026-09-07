import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// everything the public site knows comes from apps/web/data/*.json, written by `jdr export-site-data`.
// no page ever queries the database. missing files mean an empty site, not a broken build.

export interface Site {
  generatedAt: string | null;
  lastCrawlAt: string | null;
  stats: { companiesChecked: number; postingsNy: number; disclosedNy: number; currentFindings: number; companiesOnLeaderboard: number };
}

export interface SiteCompany {
  slug: string;
  displayName: string;
  logo: string | null;
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

export interface SiteFinding {
  id: number;
  companySlug: string;
  companyName: string;
  companyLogo: string | null;
  postingId: number;
  externalId: string;
  title: string;
  url: string;
  locations: string[];
  locClass: string;
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

export interface SearchEntry {
  slug: string;
  name: string;
  logo: string | null;
  sector: string | null;
  findings: number;
  ny: number;
}

const DATA_DIR = join(process.cwd(), 'data');

function read<T>(name: string, fallback: T): T {
  const p = join(DATA_DIR, name);
  if (!existsSync(p)) return fallback;
  return JSON.parse(readFileSync(p, 'utf8')) as T;
}

const EMPTY_SITE: Site = {
  generatedAt: null,
  lastCrawlAt: null,
  stats: { companiesChecked: 0, postingsNy: 0, disclosedNy: 0, currentFindings: 0, companiesOnLeaderboard: 0 },
};

export const getSite = () => read<Site>('site.json', EMPTY_SITE);
export const getCompanies = () => read<SiteCompany[]>('companies.json', []);
export const getLeaderboard = () => read<SiteCompany[]>('leaderboard.json', []);
export const getFindings = () => read<SiteFinding[]>('findings.json', []);
export const getSearchIndex = () => read<SearchEntry[]>('search-index.json', []);

export const getCompany = (slug: string) => getCompanies().find((c) => c.slug === slug) ?? null;
export const getFindingsForCompany = (slug: string) => getFindings().filter((f) => f.companySlug === slug);
export const getFinding = (id: number) => getFindings().find((f) => f.id === id) ?? null;
