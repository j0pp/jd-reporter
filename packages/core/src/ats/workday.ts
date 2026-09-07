import { stripHtml } from '../html.ts';
import type { RangeResult, RawPosting } from '../types.ts';
import { cleanName, metaContent, titleOf } from './identity.ts';
import type { BoardAdapter, BoardFetchOptions, BoardFetchResult, FetchCtx, UrlMatch } from './types.ts';
import { dedupeStrings } from './types.ts';
import { arr, num, obj, str } from './util.ts';

// slug is `tenant|wdN|site`, recovered from posting urls because the vendor only exposes the tenant
const HOST_RE = /^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/i;
const LOCALE_RE = /^[a-z]{2}-[A-Z]{2}$/;
const PAGE_SIZE = 20;

export interface WorkdaySlug {
  tenant: string;
  wd: string;
  site: string;
}

export function parseWorkdaySlug(slug: string): WorkdaySlug {
  const [tenant, wd, site] = slug.split('|');
  if (!tenant || !wd || !site) throw new Error(`bad workday slug ${slug}, expected tenant|wdN|site`);
  return { tenant, wd, site };
}

function base(s: WorkdaySlug) {
  return `https://${s.tenant}.${s.wd}.myworkdayjobs.com`;
}

function reqIdFromPath(externalPath: string): string | null {
  const m = /_([A-Za-z0-9.-]+)$/.exec(externalPath);
  return m?.[1] ?? null;
}

function normalizeListRow(row: unknown, s: WorkdaySlug): RawPosting {
  const r = obj(row);
  const externalPath = str(r.externalPath) ?? '';
  const bullets = arr(r.bulletFields).map(str).filter(Boolean) as string[];
  return {
    externalId: bullets[0] ?? reqIdFromPath(externalPath) ?? externalPath,
    url: `${base(s)}/${s.site}${externalPath}`,
    title: str(r.title) ?? '',
    // "5 Locations" until the detail call replaces it
    locations: dedupeStrings([str(r.locationsText)]),
    isRemote: /\bremote\b/i.test(str(r.locationsText) ?? ''),
    descriptionText: '',
    structuredComp: null,
    employmentType: str(r.timeType),
    publishedAt: null,
    updatedAt: null,
    needsDetail: true,
    raw: { ...r, externalPath },
  };
}

export const workday: BoardAdapter = {
  vendor: 'workday',
  accessTier: 1,
  hostPatterns: [/myworkdayjobs\.com$/i, /myworkdaysite\.com$/i, /(^|\.)workday\.com$/i],

  matchUrl(url: URL): UrlMatch | null {
    const m = HOST_RE.exec(url.host);
    if (!m) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] && LOCALE_RE.test(parts[0])) parts.shift();
    const site = parts[0];
    if (!site) return null;
    const slug = `${m[1]!.toLowerCase()}|${m[2]!.toLowerCase()}|${site}`;
    const jobIdx = parts.indexOf('job');
    if (jobIdx >= 0 && parts.length > jobIdx + 1) {
      const externalPath = '/' + parts.slice(jobIdx).join('/');
      return { slug, externalId: reqIdFromPath(externalPath) ?? externalPath };
    }
    return { slug };
  },

  boardUrl(slug) {
    const s = parseWorkdaySlug(slug);
    return `${base(s)}/${s.site}`;
  },

  boardPageUrl(slug) {
    const s = parseWorkdaySlug(slug);
    return `${base(s)}/${s.site}`;
  },

  // the page is js-rendered (empty title), but the tenant logo is served at {site}/assets/logo and og:image
  // points at it. no name: the 50 hand-picked tenants get theirs in the verify card
  parseIdentity(html, slug) {
    const s = parseWorkdaySlug(slug);
    const og = metaContent(html, 'og:image');
    return { name: cleanName(titleOf(html), slug), logoUrl: og ?? `${base(s)}/${s.site}/assets/logo` };
  },

  normalizeBoard(json) {
    // callers pass one search page; the slug is unknown here so urls are relative to the site
    const rows = arr(obj(json).jobPostings);
    return rows.map((r) => normalizeListRow(r, { tenant: '', wd: '', site: '' }));
  },

  async fetchBoard(slug, ctx, opts: BoardFetchOptions = {}): Promise<BoardFetchResult> {
    const s = parseWorkdaySlug(slug);
    const searchText = opts.searchText ?? 'New York';
    const maxPages = opts.maxPages ?? 10;
    const url = `${base(s)}/wday/cxs/${s.tenant}/${s.site}/jobs`;
    const postings: RawPosting[] = [];
    const raw: { url: string; body: string }[] = [];
    let offset = 0;
    let total: number | null = null;
    for (let page = 0; page < maxPages && (total === null || offset < total); page++) {
      const res = await ctx.http(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ appliedFacets: {}, limit: PAGE_SIZE, offset, searchText }),
      });
      const json = obj(res.json());
      raw.push({ url: `${url}?offset=${offset}&q=${encodeURIComponent(searchText)}`, body: res.text });
      total = num(json.total) ?? 0;
      const rows = arr(json.jobPostings);
      if (!rows.length) break;
      for (const r of rows) postings.push(normalizeListRow(r, s));
      offset += PAGE_SIZE;
    }
    return { postings, raw, boardName: null };
  },

  async fetchPosting(slug, externalId, ctx: FetchCtx) {
    // externalId may be a req id or an externalPath; only the path form is directly fetchable
    if (!externalId.startsWith('/job/')) return null;
    const s = parseWorkdaySlug(slug);
    const stub: RawPosting = {
      externalId,
      url: `${base(s)}/${s.site}${externalId}`,
      title: '',
      locations: [],
      isRemote: null,
      descriptionText: '',
      structuredComp: null,
      employmentType: null,
      publishedAt: null,
      updatedAt: null,
      needsDetail: true,
      raw: { externalPath: externalId },
    };
    try {
      return await this.fetchDetail(slug, stub, ctx);
    } catch {
      return null;
    }
  },

  needsDetail(posting: RawPosting, _verdict: RangeResult) {
    return posting.needsDetail;
  },

  async fetchDetail(slug, posting, ctx) {
    const s = parseWorkdaySlug(slug);
    const externalPath = str(obj(posting.raw).externalPath) ?? '';
    const url = `${base(s)}/wday/cxs/${s.tenant}/${s.site}${externalPath}`;
    const res = await ctx.http(url);
    const json = obj(res.json());
    const info = obj(json.jobPostingInfo);
    const locations = dedupeStrings([str(info.location), ...arr(info.additionalLocations).map(str)]);
    return {
      ...posting,
      externalId: str(info.jobReqId) ?? posting.externalId,
      url: str(info.externalUrl) || posting.url,
      title: str(info.title) ?? posting.title,
      locations: locations.length ? locations : posting.locations,
      isRemote: locations.some((l) => /\bremote\b/i.test(l)),
      descriptionText: stripHtml(str(info.jobDescription)),
      employmentType: str(info.timeType) ?? posting.employmentType,
      publishedAt: str(info.startDate) ?? null,
      needsDetail: false,
      raw: { list: posting.raw, detail: json },
    };
  },
};
