import { stripHtml } from '../html.ts';
import type { RawPosting, StructuredComp } from '../types.ts';
import { cleanName, metaContent, titleOf } from './identity.ts';
import type { BoardAdapter, BoardFetchResult, FetchCtx, UrlMatch } from './types.ts';
import { dedupeStrings } from './types.ts';
import { arr, num, obj, str, UUID_RE } from './util.ts';

const API = 'https://api.ashbyhq.com/posting-api/job-board';
const HOSTS = /^jobs\.ashbyhq\.com$/i;

function compensation(job: Record<string, unknown>): StructuredComp[] | null {
  const comp = obj(job.compensation);
  const out: StructuredComp[] = [];
  for (const tier of arr(comp.compensationTiers)) {
    const t = obj(tier);
    for (const c of arr(t.components)) {
      const o = obj(c);
      const type = (str(o.compensationType) ?? '').toLowerCase();
      // equity and bonus components are not base pay
      if (type && !/salary|hourly|wage|base/.test(type)) continue;
      out.push({
        min: num(o.minValue),
        max: num(o.maxValue),
        currency: str(o.currencyCode),
        interval: str(o.interval),
        summary: str(o.summary),
      });
    }
  }
  if (out.length) return out;
  const summary = str(comp.scrapeableCompensationSalarySummary) ?? str(comp.compensationTierSummary);
  // a summary with no numbers still tells the classifier something was stated; it will regex the summary
  return summary ? [{ min: null, max: null, currency: null, interval: null, summary }] : null;
}

function normalizeJob(j: unknown): RawPosting {
  const job = obj(j);
  const secondary = arr(job.secondaryLocations).map((s) => str(obj(s).location));
  const isRemote = typeof job.isRemote === 'boolean' ? job.isRemote : null;
  return {
    externalId: String(job.id),
    url: str(job.jobUrl) ?? '',
    title: str(job.title) ?? '',
    locations: dedupeStrings([str(job.location), ...secondary]),
    isRemote,
    // descriptionHtml over descriptionPlain, same lesson as lever
    descriptionText: stripHtml(str(job.descriptionHtml)) || (str(job.descriptionPlain) ?? ''),
    structuredComp: compensation(job),
    employmentType: str(job.employmentType),
    publishedAt: str(job.publishedAt),
    updatedAt: null,
    needsDetail: false,
    raw: job,
  };
}

export const ashby: BoardAdapter = {
  vendor: 'ashby',
  accessTier: 1,
  hostPatterns: [/(^|\.)ashbyhq\.com$/i],

  matchUrl(url: URL): UrlMatch | null {
    if (!HOSTS.test(url.host)) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    const slug = parts[0];
    if (!slug) return null;
    if (parts[1] && UUID_RE.test(parts[1])) return { slug: slug.toLowerCase(), externalId: parts[1].toLowerCase() };
    return { slug: slug.toLowerCase() };
  },

  boardUrl(slug) {
    return `https://jobs.ashbyhq.com/${slug}`;
  },

  boardPageUrl(slug) {
    return `https://jobs.ashbyhq.com/${slug}`;
  },

  // <title> is "{name} Jobs"; og:image is the org logo
  parseIdentity(html, slug) {
    return {
      name: cleanName(titleOf(html), slug) ?? cleanName(metaContent(html, 'og:title'), slug),
      logoUrl: metaContent(html, 'og:image'),
    };
  },

  normalizeBoard(json) {
    return arr(obj(json).jobs).map(normalizeJob);
  },

  async fetchBoard(slug, ctx): Promise<BoardFetchResult> {
    const url = `${API}/${encodeURIComponent(slug)}?includeCompensation=true`;
    const res = await ctx.http(url);
    return { postings: this.normalizeBoard(res.json()), raw: [{ url, body: res.text }], boardName: null };
  },

  // ashby has no public single-posting endpoint, so this is a board fetch plus a filter
  async fetchPosting(slug, externalId, ctx: FetchCtx) {
    const { postings } = await this.fetchBoard(slug, ctx);
    return postings.find((p) => p.externalId.toLowerCase() === externalId.toLowerCase()) ?? null;
  },

  needsDetail() {
    return false;
  },

  async fetchDetail(_slug, posting) {
    return posting;
  },
};
