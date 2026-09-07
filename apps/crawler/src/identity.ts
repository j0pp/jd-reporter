import { fetchIdentity, getAdapter, sha256Hex, type HttpClient } from '@jdr/core';
import type { Board, Company, Db } from '@jdr/db';
import { companies } from '@jdr/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { blobKeys, type BlobStore } from './blobs.ts';
import { describeError } from './errors.ts';
import type { Config } from './env.ts';

const REFRESH_MS = 30 * 86_400_000;
const MAX_LOGO_BYTES = 1_000_000;
const IMAGE_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/gif': 'gif',
};

// verified companies still get a logo; verification only freezes the name
export function identityDue(company: Pick<Company, 'verifiedAt' | 'enrichment' | 'logoKey'>): boolean {
  const at = company.enrichment?.identityAt;
  if (company.verifiedAt && company.logoKey) return false;
  return !at || Date.now() - Date.parse(at) > REFRESH_MS;
}

// one fetch of the vendor's board page for a real name and a logo, then one fetch of the logo. the name is
// applied only while the company is unverified: a name you confirmed is never overwritten by a vendor's page
export async function enrichIdentity(
  db: Db,
  blobs: BlobStore,
  cfg: Config,
  board: Board,
  company: Company,
  http: HttpClient,
  log: (m: string) => void,
): Promise<{ name: string | null; logo: boolean }> {
  const adapter = getAdapter(board.atsVendor);
  let identity: { name: string | null; logoUrl: string | null };
  try {
    identity = await fetchIdentity(adapter, board.atsSlug, { http, log });
  } catch (e) {
    log(`identity: ${board.atsVendor}:${board.atsSlug} page failed (${describeError(e)})`);
    identity = { name: null, logoUrl: null };
  }

  let logoKey: string | null = null;
  if (identity.logoUrl) {
    try {
      logoKey = await storeLogo(blobs, cfg, company.id, identity.logoUrl);
    } catch (e) {
      log(`identity: logo failed for ${board.atsVendor}:${board.atsSlug} (${describeError(e)})`);
    }
  }

  const now = new Date().toISOString();
  const applyName = !!identity.name && !company.verifiedAt;
  const patch: Partial<typeof companies.$inferInsert> = {
    enrichment: { ...(company.enrichment ?? {}), identityAt: now, logoUrl: identity.logoUrl, ...(applyName ? { nameSource: 'vendor_page' as const } : {}) },
    updatedAt: now,
  };
  if (applyName) patch.displayName = identity.name!;
  if (logoKey) {
    patch.logoKey = logoKey;
    patch.logoSource = identity.logoUrl;
  }
  await db
    .update(companies)
    .set(patch)
    .where(applyName ? and(eq(companies.id, company.id), isNull(companies.verifiedAt)) : eq(companies.id, company.id));
  return { name: applyName ? identity.name : null, logo: !!logoKey };
}

// the raw http client reads text; logos need bytes, so this is a plain fetch with the same manners
async function storeLogo(blobs: BlobStore, cfg: Config, companyId: number, url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'user-agent': cfg.userAgent, accept: 'image/*' }, signal: ctrl.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`http ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!bytes.length) throw new Error('empty body');
  if (bytes.length > MAX_LOGO_BYTES) throw new Error(`too large: ${bytes.length} bytes`);
  // lever's s3 bucket serves logos as application/octet-stream, so the bytes decide, not the header
  const headerType = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  const type = IMAGE_EXT[headerType] ? headerType : sniffImageType(bytes);
  const ext = type ? IMAGE_EXT[type] : undefined;
  if (!type || !ext) throw new Error(`not an image: ${headerType || 'no content-type'}`);
  const key = blobKeys.logo(companyId, (await sha256Hex(bytes)).slice(0, 32), ext);
  if (!(await blobs.exists(key))) await blobs.putBytes(key, bytes, type);
  return key;
}

export function sniffImageType(b: Uint8Array): string | null {
  if (b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  const head = new TextDecoder().decode(b.slice(0, 512)).trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head)) return 'image/svg+xml';
  return null;
}

export function logoContentType(key: string): string {
  const ext = key.split('.').pop() ?? '';
  return Object.entries(IMAGE_EXT).find(([, e]) => e === ext)?.[0] ?? 'application/octet-stream';
}
