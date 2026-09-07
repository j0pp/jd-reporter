import { createD1RestDb } from '@jdr/db/rest';
import { createLocalDb, migrateLocalDb } from '@jdr/db/local';
import type { Db } from '@jdr/db';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createBlobStore, type BlobStore } from './blobs.ts';

export interface Config {
  dbMode: 'local' | 'd1';
  localDbPath: string;
  cfAccountId: string;
  cfApiToken: string;
  d1DatabaseId: string;
  blobMode: 'local' | 'r2';
  localBlobDir: string;
  r2Bucket: string;
  r2AccessKeyId: string;
  r2SecretAccessKey: string;
  waybackAccessKey: string;
  waybackSecretKey: string;
  userAgent: string;
  // committed seed data: data/seed (board lists), data/sectors (taxonomy + tags), data/nyc-employers.csv
  dataDir: string;
  repoRoot: string;
}

const ROOT = resolve(import.meta.dirname, '..', '..', '..');

export function loadConfig(): Config {
  const e = process.env;
  return {
    dbMode: (e.DB_MODE as Config['dbMode']) || 'local',
    localDbPath: resolve(ROOT, e.LOCAL_DB_PATH || '.local/jd.db'),
    cfAccountId: e.CF_ACCOUNT_ID || '',
    cfApiToken: e.CF_API_TOKEN || '',
    d1DatabaseId: e.D1_DATABASE_ID || '',
    blobMode: (e.BLOB_MODE as Config['blobMode']) || 'local',
    localBlobDir: resolve(ROOT, e.LOCAL_BLOB_DIR || '.local/blobs'),
    r2Bucket: e.R2_BUCKET || 'jd-reporter',
    r2AccessKeyId: e.R2_ACCESS_KEY_ID || '',
    r2SecretAccessKey: e.R2_SECRET_ACCESS_KEY || '',
    waybackAccessKey: e.WAYBACK_ACCESS_KEY || '',
    waybackSecretKey: e.WAYBACK_SECRET_KEY || '',
    userAgent: e.USER_AGENT || 'jd-reporter/0.1 (research crawler; see repository for contact)',
    dataDir: resolve(ROOT, 'data'),
    repoRoot: ROOT,
  };
}

export async function openDb(cfg: Config): Promise<Db> {
  if (cfg.dbMode === 'd1') {
    for (const k of ['cfAccountId', 'cfApiToken', 'd1DatabaseId'] as const) {
      if (!cfg[k]) throw new Error(`DB_MODE=d1 needs ${k} (CF_ACCOUNT_ID, CF_API_TOKEN, D1_DATABASE_ID)`);
    }
    return createD1RestDb({ accountId: cfg.cfAccountId, databaseId: cfg.d1DatabaseId, apiToken: cfg.cfApiToken }) as unknown as Db;
  }
  mkdirSync(dirname(cfg.localDbPath), { recursive: true });
  const db = createLocalDb(cfg.localDbPath);
  await migrateLocalDb(db);
  return db as unknown as Db;
}

export function openBlobs(cfg: Config): BlobStore {
  return createBlobStore(cfg);
}

export const VENDOR_DELAY_MS: Record<string, number> = { greenhouse: 1000, lever: 1500, ashby: 3000, workday: 1500 };
