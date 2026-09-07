import { createClient } from '@libsql/client';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.ts';

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

// local dev and tests: the same schema on a sqlite file (or :memory:), same async drizzle surface as d1
export function createLocalDb(path: string) {
  const client = createClient({ url: path === ':memory:' ? 'file::memory:' : `file:${path}` });
  return drizzle(client, { schema });
}

// a wrangler-managed file (wrangler d1 migrations apply --local) already has the schema but not drizzle's
// bookkeeping table; leave it alone so the crawler can point at the same sqlite the worker reads
export async function migrateLocalDb(db: ReturnType<typeof createLocalDb>) {
  const rows = await db.all<{ name: string }>(sql`select name from sqlite_master where type = 'table' and name in ('boards', '__drizzle_migrations')`);
  const names = new Set(rows.map((r) => r.name));
  if (names.has('boards')) {
    if (!names.has('__drizzle_migrations')) return;
    const [row] = await db.all<{ n: number }>(sql`select count(*) as n from __drizzle_migrations`);
    if (Number(row?.n ?? 0) === 0) return;
  }
  await migrate(db, { migrationsFolder: MIGRATIONS });
}

export type LocalDb = ReturnType<typeof createLocalDb>;
