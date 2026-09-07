import type { AtsVendor } from '../types.ts';
import { matchAnyAdapter } from './registry.ts';

// job aggregators we refuse on submit: login walls, anti-bot, and the range is often lost in their own scrape
const AGGREGATOR_HOSTS = [
  'linkedin.com',
  'indeed.com',
  'glassdoor.com',
  'ziprecruiter.com',
  'monster.com',
  'dice.com',
  'simplyhired.com',
  'wellfound.com',
  'angel.co',
  'builtin.com',
  'builtinnyc.com',
  'google.com',
  'jobs.google.com',
  'careerbuilder.com',
  'lensa.com',
  'talent.com',
  'jooble.org',
  'adzuna.com',
  'welcometothejungle.com',
  'otta.com',
  'hiring.cafe',
  'levels.fyi',
  'ycombinator.com',
  'workatastartup.com',
];

const TRACKING_PARAMS = /^(utm_|gh_src$|lever-|ashby_|source$|src$|ref$|referrer$|fbclid$|gclid$|mc_)/i;

export type SubmittedUrlKind = 'ats_posting' | 'ats_board' | 'aggregator' | 'careers_page' | 'unknown';

export interface SubmittedUrl {
  kind: SubmittedUrlKind;
  canonical: string;
  host: string;
  vendor?: AtsVendor;
  slug?: string;
  externalId?: string;
}

export function canonicalizeUrl(input: string): URL | null {
  let u: URL;
  try {
    u = new URL(input.trim().match(/^https?:\/\//i) ? input.trim() : `https://${input.trim()}`);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.protocol = 'https:';
  u.hash = '';
  u.host = u.host.toLowerCase();
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
  }
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1);
  return u;
}

function hostMatches(host: string, base: string) {
  return host === base || host.endsWith(`.${base}`);
}

export function isAggregatorHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, '');
  return AGGREGATOR_HOSTS.some((a) => hostMatches(h, a));
}

export function classifySubmittedUrl(input: string): SubmittedUrl | null {
  const u = canonicalizeUrl(input);
  if (!u) return null;
  const host = u.host.replace(/^www\./, '');
  if (isAggregatorHost(host)) return { kind: 'aggregator', canonical: u.toString(), host };
  const m = matchAnyAdapter(u);
  if (m) {
    return {
      kind: m.externalId ? 'ats_posting' : 'ats_board',
      canonical: u.toString(),
      host,
      vendor: m.vendor,
      slug: m.slug,
      externalId: m.externalId,
    };
  }
  // an employer domain: worth a careers-page fetch in the processor, nothing more we can say here
  if (/careers|jobs|join|work-with-us|opportunit/i.test(u.pathname + u.host)) {
    return { kind: 'careers_page', canonical: u.toString(), host };
  }
  return { kind: 'unknown', canonical: u.toString(), host };
}

// embed signatures employers leave in their own careers pages. returns the first ats board we can see
export function detectEmbeddedBoard(html: string): { vendor: AtsVendor; slug: string } | null {
  const patterns: [AtsVendor, RegExp][] = [
    ['greenhouse', /boards\.greenhouse\.io\/embed\/job_board(?:\/js)?\?(?:[^"'\s]*&)?for=([a-z0-9_-]+)/i],
    ['greenhouse', /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/([a-z0-9_-]+)(?:["'/?]|$)/i],
    ['greenhouse', /boards-api\.greenhouse\.io\/v1\/boards\/([a-z0-9_-]+)/i],
    ['ashby', /__ashbyBaseJobBoardUrl\s*=\s*["']https?:\/\/jobs\.ashbyhq\.com\/([a-z0-9._-]+)/i],
    ['ashby', /jobs\.ashbyhq\.com\/([a-z0-9._-]+)(?:["'/?]|$)/i],
    ['ashby', /api\.ashbyhq\.com\/posting-api\/job-board\/([a-z0-9._-]+)/i],
    ['lever', /api\.lever\.co\/v0\/postings\/([a-z0-9_-]+)/i],
    ['lever', /jobs(?:\.eu)?\.lever\.co\/([a-z0-9_-]+)(?:["'/?]|$)/i],
    ['workday', /https?:\/\/([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/],
  ];
  for (const [vendor, re] of patterns) {
    const m = re.exec(html);
    if (!m) continue;
    if (vendor === 'workday') return { vendor, slug: `${m[1]!.toLowerCase()}|${m[2]!.toLowerCase()}|${m[3]!}` };
    const slug = m[1]!.toLowerCase();
    if (slug === 'embed' || slug === 'v1') continue;
    return { vendor, slug };
  }
  return null;
}
