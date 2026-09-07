import { stripHtml } from '../html.ts';
import type { RawPosting, StructuredComp } from '../types.ts';
import type { BoardAdapter, BoardFetchResult, FetchCtx, UrlMatch } from './types.ts';
import { dedupeStrings } from './types.ts';
import { arr, isoFromMs, num, obj, str, UUID_RE } from './util.ts';

const API = 'https://api.lever.co/v0/postings';
const HOSTS = /^jobs(\.eu)?\.lever\.co$/i;

function salary(job: Record<string, unknown>): StructuredComp[] | null {
  const sr = obj(job.salaryRange);
  const min = num(sr.min);
  const max = num(sr.max);
  if (min === null && max === null) return null;
  return [{ min, max, currency: str(sr.currency), interval: str(sr.interval), summary: null }];
}

function normalizeJob(j: unknown): RawPosting {
  const job = obj(j);
  const cat = obj(job.categories);
  const locations = dedupeStrings([str(cat.location), ...arr(cat.allLocations).map(str)]);
  // never read the *Plain siblings: palantir's salary paragraph lived in `additional` with an empty additionalPlain
  const text = [
    stripHtml(str(job.opening)),
    stripHtml(str(job.description)),
    stripHtml(str(job.descriptionBody)),
    ...arr(job.lists).map((l) => `${str(obj(l).text) ?? ''} ${stripHtml(str(obj(l).content))}`),
    stripHtml(str(job.additional)),
    stripHtml(str(job.salaryDescription)),
  ]
    .filter(Boolean)
    .join(' ');
  const workplace = str(job.workplaceType);
  return {
    externalId: String(job.id),
    url: str(job.hostedUrl) ?? '',
    title: str(job.text) ?? '',
    locations,
    isRemote: workplace ? workplace.toLowerCase() === 'remote' : null,
    descriptionText: text,
    structuredComp: salary(job),
    employmentType: str(cat.commitment),
    publishedAt: isoFromMs(job.createdAt),
    updatedAt: null,
    needsDetail: false,
    raw: job,
  };
}

export const lever: BoardAdapter = {
  vendor: 'lever',
  accessTier: 1,
  hostPatterns: [/(^|\.)lever\.co$/i],

  matchUrl(url: URL): UrlMatch | null {
    if (!HOSTS.test(url.host)) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    const slug = parts[0];
    if (!slug) return null;
    if (parts[1] && UUID_RE.test(parts[1])) return { slug: slug.toLowerCase(), externalId: parts[1].toLowerCase() };
    return { slug: slug.toLowerCase() };
  },

  boardUrl(slug) {
    return `https://jobs.lever.co/${slug}`;
  },

  normalizeBoard(json) {
    return arr(json).map(normalizeJob);
  },

  async fetchBoard(slug, ctx): Promise<BoardFetchResult> {
    const url = `${API}/${encodeURIComponent(slug)}?mode=json`;
    const res = await ctx.http(url);
    return { postings: this.normalizeBoard(res.json()), raw: [{ url, body: res.text }], boardName: null };
  },

  async fetchPosting(slug, externalId, ctx: FetchCtx) {
    const url = `${API}/${encodeURIComponent(slug)}/${encodeURIComponent(externalId)}?mode=json`;
    try {
      const res = await ctx.http(url, { retries: 1 });
      return normalizeJob(res.json());
    } catch {
      return null;
    }
  },

  needsDetail() {
    return false;
  },

  async fetchDetail(_slug, posting) {
    return posting;
  },
};
