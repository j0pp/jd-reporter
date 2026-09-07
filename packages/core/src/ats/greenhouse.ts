import { stripHtml } from '../html.ts';
import type { RangeResult, RawPosting, StructuredComp } from '../types.ts';
import { cleanName, metaContent, titleOf } from './identity.ts';
import type { BoardAdapter, BoardFetchResult, FetchCtx, UrlMatch } from './types.ts';
import { dedupeStrings } from './types.ts';
import { arr, num, obj, str } from './util.ts';

const API = 'https://boards-api.greenhouse.io/v1/boards';
const HOSTS = /^(boards|job-boards)(\.eu)?\.greenhouse\.io$/i;

function payRanges(job: Record<string, unknown>): StructuredComp[] | null {
  const ranges = arr(job.pay_input_ranges);
  if (!ranges.length) return null;
  return ranges.map((r) => {
    const o = obj(r);
    const min = num(o.min_cents);
    const max = num(o.max_cents);
    return {
      min: min === null ? null : min / 100,
      max: max === null ? null : max / 100,
      currency: str(o.currency_type),
      interval: null,
      summary: str(o.title),
    };
  });
}

function normalizeJob(j: unknown): RawPosting {
  const job = obj(j);
  const location = str(obj(job.location).name);
  const offices = arr(job.offices).map((o) => str(obj(o).name));
  return {
    externalId: String(job.id),
    url: str(job.absolute_url) ?? '',
    title: str(job.title) ?? '',
    locations: dedupeStrings([location, ...offices]),
    isRemote: location ? /\bremote\b/i.test(location) : null,
    descriptionText: stripHtml(str(job.content)),
    structuredComp: payRanges(job),
    employmentType: null,
    publishedAt: str(job.first_published),
    updatedAt: str(job.updated_at),
    needsDetail: false,
    raw: job,
  };
}

export const greenhouse: BoardAdapter = {
  vendor: 'greenhouse',
  accessTier: 1,
  hostPatterns: [/(^|\.)greenhouse\.io$/i],

  matchUrl(url: URL): UrlMatch | null {
    if (!HOSTS.test(url.host)) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'embed') {
      const slug = url.searchParams.get('for');
      if (!slug) return null;
      const token = url.searchParams.get('token');
      return token ? { slug: slug.toLowerCase(), externalId: token } : { slug: slug.toLowerCase() };
    }
    const slug = parts[0];
    if (!slug) return null;
    if (parts[1] === 'jobs' && parts[2] && /^\d+$/.test(parts[2])) {
      return { slug: slug.toLowerCase(), externalId: parts[2] };
    }
    // greenhouse also accepts ?gh_jid=123 on the board url
    const jid = url.searchParams.get('gh_jid');
    return jid ? { slug: slug.toLowerCase(), externalId: jid } : { slug: slug.toLowerCase() };
  },

  boardUrl(slug) {
    return `https://job-boards.greenhouse.io/${slug}`;
  },

  boardPageUrl(slug) {
    return `https://job-boards.greenhouse.io/${slug}`;
  },

  // og:title is the board name ("SEO (Sponsors for Educational Opportunity)"), og:image the logo
  parseIdentity(html, slug) {
    const name = cleanName(metaContent(html, 'og:title'), slug) ?? cleanName(titleOf(html), slug);
    const logoUrl = metaContent(html, 'og:image') ?? /<img[^>]+class=["'][^"']*\blogo\b[^"']*["'][^>]*src=["']([^"']+)["']/i.exec(html)?.[1] ?? null;
    return { name, logoUrl };
  },

  normalizeBoard(json) {
    return arr(obj(json).jobs).map(normalizeJob);
  },

  async fetchBoard(slug, ctx): Promise<BoardFetchResult> {
    const url = `${API}/${encodeURIComponent(slug)}/jobs?content=true`;
    const res = await ctx.http(url);
    const json = res.json();
    let boardName: string | null = null;
    const first = arr(obj(json).jobs)[0];
    if (first) boardName = str(obj(first).company_name);
    return { postings: this.normalizeBoard(json), raw: [{ url, body: res.text }], boardName };
  },

  async fetchPosting(slug, externalId, ctx) {
    const url = `${API}/${encodeURIComponent(slug)}/jobs/${encodeURIComponent(externalId)}?pay_transparency=true`;
    try {
      const res = await ctx.http(url, { retries: 1 });
      return normalizeJob(res.json());
    } catch {
      return null;
    }
  },

  needsDetail(posting: RawPosting, verdict: RangeResult) {
    // the list has no pay_input_ranges; only pay for the call when the text did not settle it
    if (posting.structuredComp) return false;
    return ['none', 'open_ended', 'dollar_mention_only', 'offsite_unverified', 'placeholder_range', 'malformed_range'].includes(verdict.method);
  },

  async fetchDetail(slug, posting, ctx) {
    const url = `${API}/${encodeURIComponent(slug)}/jobs/${encodeURIComponent(posting.externalId)}?pay_transparency=true`;
    const res = await ctx.http(url);
    const detailed = normalizeJob(res.json());
    return { ...detailed, locations: detailed.locations.length ? detailed.locations : posting.locations };
  },
};
