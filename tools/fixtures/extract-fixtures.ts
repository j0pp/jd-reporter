// replays 48 cached board responses (tools/fixtures/boards.txt) through the real adapters and classifier and
// writes small golden cases into packages/core/test/fixtures. rerun after classifier changes and read the
// summary diff before committing the new expectations.
//
//   pnpm fixtures            # replay .local/fixture-cache (gitignored)
//   pnpm fixtures --refresh  # re-fetch the 48 boards live into the cache first (~60 polite requests)

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import {
  adapters,
  ATS_VENDORS,
  classifyPosting,
  createHttp,
  isNySignal,
  type AtsVendor,
  type HttpClient,
  type HttpResponse,
  type RawPosting,
} from '../../packages/core/src/index.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const CACHE = join(ROOT, '.local', 'fixture-cache');
const OUT = join(ROOT, 'packages', 'core', 'test', 'fixtures');
const BOARDS = join(ROOT, 'tools', 'fixtures', 'boards.txt');
const REFRESH = process.argv.includes('--refresh');
const WORKDAY_MAX_PAGES = 5;
const WORKDAY_DETAIL_CAP = 20;
const DELAY_MS: Record<string, number> = { greenhouse: 1000, lever: 1500, ashby: 3000, workday: 1500 };

const safe = (s: string) => s.replace(/[^A-Za-z0-9_.-]+/g, '_');

// cache keys follow the seed probe's layout so its data/raw could be copied in as the first cache
function cacheKeyFor(url: string, init?: RequestInit): string | null {
  const u = new URL(url);
  if (u.host === 'boards-api.greenhouse.io') {
    const m = /^\/v1\/boards\/([^/]+)\/jobs$/.exec(u.pathname);
    return m ? join('greenhouse', `${safe(decodeURIComponent(m[1]!))}.json.gz`) : null;
  }
  if (u.host === 'api.lever.co') {
    const m = /^\/v0\/postings\/([^/]+)$/.exec(u.pathname);
    return m ? join('lever', `${safe(decodeURIComponent(m[1]!))}.json.gz`) : null;
  }
  if (u.host === 'api.ashbyhq.com') {
    const m = /^\/posting-api\/job-board\/([^/]+)$/.exec(u.pathname);
    return m ? join('ashby', `${safe(decodeURIComponent(m[1]!))}.json.gz`) : null;
  }
  const wd = /^([^.]+)\.(wd\d+)\.myworkdayjobs\.com$/.exec(u.host);
  if (wd) {
    const m = /^\/wday\/cxs\/([^/]+)\/([^/]+)(\/.*)?$/.exec(u.pathname);
    if (!m) return null;
    const slug = `${wd[1]}|${wd[2]}|${m[2]}`;
    const rest = m[3] ?? '';
    if (rest === '/jobs') {
      const body = init?.body ? (JSON.parse(String(init.body)) as { offset?: number }) : {};
      return join('workday', `${safe(`${slug}__p${body.offset ?? 0}`)}.json.gz`);
    }
    return join('workday', `${safe(`${slug}__${rest.replace(/[^A-Za-z0-9]+/g, '_').slice(-60)}`)}.json.gz`);
  }
  return null;
}

class NotCached extends Error {}

const cacheHttp: HttpClient = Object.assign(
  async (url: string, init?: RequestInit): Promise<HttpResponse> => {
    const key = cacheKeyFor(url, init);
    const path = key ? join(CACHE, key) : null;
    if (!path || !existsSync(path)) throw new NotCached(url);
    const text = gunzipSync(readFileSync(path)).toString('utf8');
    return { status: 200, url, headers: new Headers(), text, json: () => JSON.parse(text) };
  },
  { delayMs: 0 },
);

// live client that writes every response into the cache under the same keys
function refreshHttp(vendor: string): HttpClient {
  return createHttp({
    userAgent: 'jd-reporter/0.1 (fixture refresh; see repository)',
    delayMs: DELAY_MS[vendor] ?? 1500,
    log: (m) => console.log(`   ${m}`),
    onResponse: (res, init) => {
      const key = cacheKeyFor(res.url, init);
      if (!key) return;
      const path = join(CACHE, key);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, gzipSync(Buffer.from(res.text, 'utf8')));
    },
  });
}

interface FixtureCase {
  externalId: string;
  title: string;
  url: string;
  locations: string[];
  isRemote: boolean | null;
  structuredComp: RawPosting['structuredComp'];
  text: string | null;
  expected: { method: string; coverage: string; locClass: string; multiCity: boolean; isOffsite: boolean };
}

function boards(): { vendor: AtsVendor; slug: string }[] {
  return readFileSync(BOARDS, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf(':');
      return { vendor: l.slice(0, i) as AtsVendor, slug: l.slice(i + 1) };
    })
    .filter((b) => (ATS_VENDORS as readonly string[]).includes(b.vendor));
}

async function main() {
  if (!REFRESH && !existsSync(CACHE)) {
    console.error(`no cache at ${CACHE}; run \`pnpm fixtures --refresh\` to fetch the boards live`);
    process.exit(1);
  }
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const summary: Record<string, Record<string, number>> = {};

  for (const { vendor, slug } of boards()) {
    const adapter = adapters[vendor];
    const http = REFRESH ? refreshHttp(vendor) : cacheHttp;
    let postings: RawPosting[];
    try {
      ({ postings } = await adapter.fetchBoard(slug, { http }, { maxPages: WORKDAY_MAX_PAGES }));
    } catch (e) {
      if (e instanceof NotCached) {
        console.log(`${vendor.padEnd(10)} ${slug.padEnd(42)} not in cache, skipped`);
        continue;
      }
      console.log(`${vendor.padEnd(10)} ${slug.padEnd(42)} ERROR ${e instanceof Error ? e.message : e}`);
      continue;
    }
    const cases: FixtureCase[] = [];
    const counts: Record<string, number> = {};
    let textRangeKept = 0;
    let detailCalls = 0;
    for (let p of postings) {
      let c = classifyPosting(vendor, p);
      if (!isNySignal(c.coverage) && !p.needsDetail) continue;
      if (adapter.needsDetail(p, c.range)) {
        if (vendor === 'workday' && detailCalls >= WORKDAY_DETAIL_CAP) continue;
        try {
          p = await adapter.fetchDetail(slug, p, { http });
          detailCalls += 1;
          c = classifyPosting(vendor, p);
        } catch (e) {
          if (!(e instanceof NotCached)) throw e;
          if (vendor === 'workday') continue; // no cached detail, nothing to classify
        }
        if (!isNySignal(c.coverage)) continue;
      }
      counts[c.range.method] = (counts[c.range.method] ?? 0) + 1;
      // keep text only where the text decided it; structured cases do not need it, and cap the boring ones
      const decidedByText = c.range.method !== 'structured' && c.range.method !== 'evergreen';
      if (c.range.method === 'text_range' && textRangeKept++ >= 6) continue;
      if (c.range.method === 'structured' && (counts.structured ?? 0) > 4) continue;
      cases.push({
        externalId: p.externalId,
        title: p.title,
        url: p.url,
        locations: p.locations,
        isRemote: p.isRemote,
        structuredComp: p.structuredComp,
        text: decidedByText ? p.descriptionText : null,
        expected: {
          method: c.range.method,
          coverage: c.coverage.coverage,
          locClass: c.coverage.locClass,
          multiCity: c.coverage.multiCity,
          isOffsite: c.isOffsite,
        },
      });
    }
    summary[`${vendor}:${slug}`] = counts;
    mkdirSync(join(OUT, vendor), { recursive: true });
    writeFileSync(join(OUT, vendor, `${safe(slug)}.json`), JSON.stringify({ vendor, slug, cases }, null, 1));
    const n = Object.values(counts).reduce((a, b) => a + b, 0);
    const disclosed = (counts.structured ?? 0) + (counts.text_range ?? 0) + (counts.fixed_rate ?? 0);
    console.log(
      `${vendor.padEnd(10)} ${slug.padEnd(42)} ny=${String(n).padStart(4)} disclosed=${n ? String(Math.round((100 * disclosed) / n)).padStart(3) : '  -'}%  ${Object.entries(counts)
        .filter(([k]) => !['structured', 'text_range', 'fixed_rate'].includes(k))
        .map(([k, v]) => `${k}=${v}`)
        .join(' ')}`,
    );
  }
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
}

await main();
