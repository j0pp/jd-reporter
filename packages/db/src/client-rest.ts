import { drizzle } from 'drizzle-orm/sqlite-proxy';
import * as schema from './schema.ts';

export interface D1RestOptions {
  accountId: string;
  databaseId: string;
  apiToken: string;
  fetch?: typeof fetch;
  // cloudflare's api allows 1200 requests per 5 minutes; the crawler stays far under with diff-only writes
  minIntervalMs?: number;
}

interface RawResult {
  success: boolean;
  errors?: { code: number; message: string }[];
  result?: { results?: { columns: string[]; rows: unknown[][] }; success: boolean; meta?: Record<string, unknown> }[];
}

// from github actions: the d1 rest api through drizzle's sqlite-proxy driver. the /raw endpoint returns
// rows as arrays, which is exactly what the proxy wants. batches are sequential because the api has no
// per-statement params for multi-statement bodies.
export function createD1RestDb(opts: D1RestOptions) {
  const f = opts.fetch ?? fetch;
  const url = `https://api.cloudflare.com/client/v4/accounts/${opts.accountId}/d1/database/${opts.databaseId}/raw`;
  const minInterval = opts.minIntervalMs ?? 260;
  let lastAt = 0;

  async function run(sql: string, params: unknown[]): Promise<unknown[][]> {
    const wait = lastAt + minInterval - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
    for (let attempt = 0; ; attempt++) {
      const res = await f(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${opts.apiToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ sql, params }),
      });
      if (res.status === 429 || res.status >= 500) {
        if (attempt >= 4) throw new Error(`d1 rest ${res.status} after ${attempt} retries: ${await res.text()}`);
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      const json = (await res.json()) as RawResult;
      if (!json.success) {
        const msg = json.errors?.map((e) => `${e.code}: ${e.message}`).join('; ') ?? 'unknown error';
        // the free tier hard-fails past its daily row budget; make that unmistakable in the logs
        if (/daily/i.test(msg) && /limit/i.test(msg)) throw new Error(`d1 daily limit reached: ${msg}`);
        throw new Error(`d1 rest error for ${sql.slice(0, 80)}: ${msg}`);
      }
      return json.result?.[0]?.results?.rows ?? [];
    }
  }

  return drizzle(
    async (sql, params, method) => {
      const rows = await run(sql, params);
      if (method === 'get') return { rows: rows[0] ?? [] };
      return { rows };
    },
    async (queries) => {
      const out: { rows: unknown[] }[] = [];
      for (const q of queries) {
        const rows = await run(q.sql, q.params);
        out.push(q.method === 'get' ? { rows: rows[0] ?? [] } : { rows });
      }
      return out;
    },
    { schema },
  );
}

export type D1RestDb = ReturnType<typeof createD1RestDb>;
