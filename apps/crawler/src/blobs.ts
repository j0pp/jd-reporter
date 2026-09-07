import { AwsClient } from 'aws4fetch';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { Config } from './env.ts';

// raw responses and employer pages, gzipped, keyed by content hash. this is the changeset history:
// every board response that ever differed is here with a timestamp in its metadata
export interface BlobStore {
  putGzip(key: string, body: string, contentType: string): Promise<void>;
  getGzip(key: string): Promise<string | null>;
  exists(key: string): Promise<boolean>;
  putPublic(key: string, body: string, contentType: string): Promise<void>;
  // raw bytes, not gzipped: logos
  putBytes(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  getBytes(key: string): Promise<Uint8Array | null>;
}

class LocalBlobStore implements BlobStore {
  constructor(private readonly dir: string) {}
  private path(key: string) {
    return join(this.dir, key);
  }
  async putGzip(key: string, body: string) {
    const p = this.path(key);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, gzipSync(Buffer.from(body, 'utf8')));
  }
  async getGzip(key: string) {
    const p = this.path(key);
    return existsSync(p) ? gunzipSync(readFileSync(p)).toString('utf8') : null;
  }
  async exists(key: string) {
    return existsSync(this.path(key));
  }
  async putPublic(key: string, body: string) {
    const p = this.path(key);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  async putBytes(key: string, bytes: Uint8Array) {
    const p = this.path(key);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, bytes);
  }
  async getBytes(key: string) {
    const p = this.path(key);
    return existsSync(p) ? new Uint8Array(readFileSync(p)) : null;
  }
}

class R2BlobStore implements BlobStore {
  private readonly client: AwsClient;
  private readonly base: string;
  constructor(cfg: Config) {
    this.client = new AwsClient({ accessKeyId: cfg.r2AccessKeyId, secretAccessKey: cfg.r2SecretAccessKey, service: 's3', region: 'auto' });
    this.base = `https://${cfg.cfAccountId}.r2.cloudflarestorage.com/${cfg.r2Bucket}`;
  }
  private url(key: string) {
    return `${this.base}/${key.split('/').map(encodeURIComponent).join('/')}`;
  }
  async exists(key: string) {
    const res = await this.client.fetch(this.url(key), { method: 'HEAD' });
    return res.status === 200;
  }
  async putGzip(key: string, body: string, contentType: string) {
    const gz = gzipSync(Buffer.from(body, 'utf8'));
    const res = await this.client.fetch(this.url(key), {
      method: 'PUT',
      body: gz,
      headers: { 'content-type': contentType, 'content-encoding': 'gzip', 'x-amz-meta-captured-at': new Date().toISOString() },
    });
    if (!res.ok) throw new Error(`r2 put ${key} failed: ${res.status} ${await res.text()}`);
  }
  async getGzip(key: string) {
    const res = await this.client.fetch(this.url(key));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`r2 get ${key} failed: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    // s3 clients do not transparently decode content-encoding
    return (buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString('utf8');
  }
  async putPublic(key: string, body: string, contentType: string) {
    const res = await this.client.fetch(this.url(key), { method: 'PUT', body, headers: { 'content-type': contentType } });
    if (!res.ok) throw new Error(`r2 put ${key} failed: ${res.status}`);
  }
  async putBytes(key: string, bytes: Uint8Array, contentType: string) {
    const res = await this.client.fetch(this.url(key), { method: 'PUT', body: bytes as BodyInit, headers: { 'content-type': contentType } });
    if (!res.ok) throw new Error(`r2 put ${key} failed: ${res.status}`);
  }
  async getBytes(key: string) {
    const res = await this.client.fetch(this.url(key));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`r2 get ${key} failed: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
}

export function createBlobStore(cfg: Config): BlobStore {
  if (cfg.blobMode === 'r2') {
    if (!cfg.r2AccessKeyId || !cfg.r2SecretAccessKey || !cfg.cfAccountId) throw new Error('BLOB_MODE=r2 needs R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and CF_ACCOUNT_ID');
    return new R2BlobStore(cfg);
  }
  return new LocalBlobStore(cfg.localBlobDir);
}

const safe = (s: string) => s.replace(/[^A-Za-z0-9_.-]+/g, '_');

export const blobKeys = {
  board: (vendor: string, slug: string, sha: string) => `boards/${vendor}/${safe(slug)}/${sha}.json.gz`,
  // a per-posting detail response is more specific evidence than the board list it came from
  posting: (vendor: string, slug: string, externalId: string, sha: string) => `postings/${vendor}/${safe(slug)}/${safe(externalId)}/${sha}.json.gz`,
  page: (sha: string) => `pages/${sha}.html.gz`,
  logo: (companyId: number, sha: string, ext: string) => `logos/${companyId}/${sha}.${ext}`,
};
