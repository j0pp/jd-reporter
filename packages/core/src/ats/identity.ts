import { decodeEntities } from '../html.ts';
import type { BoardAdapter, FetchCtx } from './types.ts';

// who a board belongs to, read from the vendor's public board page. slugs are not names (nyuhs), and
// only greenhouse's feed carries a company name, so this is the one extra fetch that fixes display names
// and gives us a logo without needing a company domain
export interface Identity {
  name: string | null;
  logoUrl: string | null;
}

export function metaContent(html: string, key: string): string | null {
  // <meta property="og:image" content="..."> in either attribute order, property or name
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`, 'i');
  const tag = re.exec(html)?.[0];
  if (!tag) return null;
  const m = /content=["']([^"']*)["']/i.exec(tag);
  return m?.[1] ? decodeEntities(m[1]).trim() || null : null;
}

export function titleOf(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m?.[1] ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() || null : null;
}

const GENERIC = /^(jobs?|careers?|job board|open positions|openings|work with us|join us)$/i;

// "Jobs at Acme", "Acme Jobs", "Careers at Acme | Lever" -> "Acme". a name that is just the slug is no name
export function cleanName(raw: string | null, slug: string): string | null {
  if (!raw) return null;
  let s = decodeEntities(raw).replace(/\s+/g, ' ').trim();
  s = s.replace(/\s*[|\-–—]\s*(jobs?|careers?|job board|lever|greenhouse|ashby|workday)\s*$/i, '');
  s = s.replace(/^(jobs?|careers?|openings|open positions|work)\s+(at|with|@)\s+/i, '');
  s = s.replace(/\s+(jobs?|careers?|job board|job openings|open positions)$/i, '');
  s = s.trim();
  if (!s || GENERIC.test(s)) return null;
  // lever's default title is the slug verbatim; "Insomnia Cookies" for insomniacookies is a real name and stays
  const slugCore = slug.split('|')[0] ?? slug;
  if (s === slug || s === slugCore) return null;
  return s;
}

export function absoluteUrl(url: string | null, base: string): string | null {
  if (!url) return null;
  try {
    return new URL(url, base).toString();
  } catch {
    return null;
  }
}

export async function fetchIdentity(adapter: BoardAdapter, slug: string, ctx: FetchCtx): Promise<Identity> {
  const url = adapter.boardPageUrl(slug);
  const res = await ctx.http(url, { retries: 1, headers: { accept: 'text/html,application/xhtml+xml' } });
  const id = adapter.parseIdentity(res.text, slug);
  return { name: id.name, logoUrl: absoluteUrl(id.logoUrl, url) };
}
