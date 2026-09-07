import type { HttpClient } from '../http.ts';
import type { AtsVendor, RangeResult, RawPosting } from '../types.ts';

export interface FetchCtx {
  http: HttpClient;
  log?: (msg: string) => void;
}

export interface BoardFetchOptions {
  // workday: the search text used to pre-filter server side ("New York")
  searchText?: string;
  maxPages?: number;
}

export interface BoardFetchResult {
  postings: RawPosting[];
  // every raw response body that produced this result, in fetch order, for blob storage
  raw: { url: string; body: string }[];
  boardName: string | null;
}

export interface UrlMatch {
  slug: string;
  externalId?: string;
}

// one file per vendor implements this. adding an ats = one adapter + a registry entry + fixtures
export interface BoardAdapter {
  vendor: AtsVendor;
  accessTier: 1 | 2 | 3;
  // hosts the vendor itself serves postings from; anything else is an employer page (is_offsite)
  hostPatterns: RegExp[];
  matchUrl(url: URL): UrlMatch | null;
  boardUrl(slug: string): string;
  // pure: vendor json -> RawPosting[]; fetchBoard is this plus http
  normalizeBoard(json: unknown): RawPosting[];
  fetchBoard(slug: string, ctx: FetchCtx, opts?: BoardFetchOptions): Promise<BoardFetchResult>;
  fetchPosting(slug: string, externalId: string, ctx: FetchCtx): Promise<RawPosting | null>;
  // whether a per-posting call would add evidence the list response lacks
  needsDetail(posting: RawPosting, verdict: RangeResult): boolean;
  fetchDetail(slug: string, posting: RawPosting, ctx: FetchCtx): Promise<RawPosting>;
}

export function isVendorHost(adapter: BoardAdapter, url: string): boolean {
  try {
    const host = new URL(url).host;
    return adapter.hostPatterns.some((re) => re.test(host));
  } catch {
    return false;
  }
}

export function dedupeStrings(xs: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const x of xs) {
    const s = (x ?? '').trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}
