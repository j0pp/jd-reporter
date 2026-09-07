import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyPosting } from '../src/posting.ts';
import type { AtsVendor, RawPosting } from '../src/types.ts';

// golden cases extracted from the 48 probed boards by tools/fixtures/extract-fixtures.ts.
// a diff here means the classifier changed its mind about a real posting; read it before updating.
const FIXTURES = join(import.meta.dirname, 'fixtures');

interface Fixture {
  vendor: AtsVendor;
  slug: string;
  cases: {
    externalId: string;
    title: string;
    url: string;
    locations: string[];
    isRemote: boolean | null;
    structuredComp: RawPosting['structuredComp'];
    text: string | null;
    expected: { method: string; coverage: string; locClass: string; multiCity: boolean; isOffsite: boolean };
  }[];
}

function load(): Fixture[] {
  const out: Fixture[] = [];
  for (const vendor of readdirSync(FIXTURES, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    for (const f of readdirSync(join(FIXTURES, vendor.name)).filter((f) => f.endsWith('.json'))) {
      out.push(JSON.parse(readFileSync(join(FIXTURES, vendor.name, f), 'utf8')) as Fixture);
    }
  }
  return out;
}

const fixtures = load();
const summary = JSON.parse(readFileSync(join(FIXTURES, 'summary.json'), 'utf8')) as Record<string, Record<string, number>>;

describe('golden fixtures from the 48 probed boards', () => {
  it('loaded every vendor', () => {
    expect(new Set(fixtures.map((f) => f.vendor))).toEqual(new Set(['greenhouse', 'lever', 'ashby', 'workday']));
    expect(fixtures.length).toBeGreaterThanOrEqual(40);
  });

  for (const fx of fixtures) {
    it(`${fx.vendor}:${fx.slug} (${fx.cases.length} cases)`, () => {
      for (const c of fx.cases) {
        const posting: RawPosting = {
          externalId: c.externalId,
          url: c.url,
          title: c.title,
          locations: c.locations,
          isRemote: c.isRemote,
          descriptionText: c.text ?? '',
          structuredComp: c.structuredComp,
          employmentType: null,
          publishedAt: null,
          updatedAt: null,
          needsDetail: false,
          raw: null,
        };
        const r = classifyPosting(fx.vendor, posting);
        const got = {
          method: r.range.method,
          coverage: r.coverage.coverage,
          locClass: r.coverage.locClass,
          multiCity: r.coverage.multiCity,
          isOffsite: r.isOffsite,
        };
        expect(got, `${fx.vendor}:${fx.slug} ${c.externalId} "${c.title}"`).toEqual(c.expected);
      }
    });
  }
});

describe('board-level facts from FINDINGS hold', () => {
  const counts = (key: string) => summary[key] ?? {};
  const disclosedPct = (key: string) => {
    const c = counts(key);
    const n = Object.values(c).reduce((a, b) => a + b, 0);
    const d = (c.structured ?? 0) + (c.text_range ?? 0) + (c.fixed_rate ?? 0);
    return n ? (100 * d) / n : NaN;
  };

  it('stripe: the api has no pay data, so nearly everything is offsite_unverified and nothing is none', () => {
    expect(counts('greenhouse:stripe').offsite_unverified).toBeGreaterThan(100);
    expect(counts('greenhouse:stripe').none ?? 0).toBe(0);
  });

  it('polymarket and nitra are the mixed boards', () => {
    expect(counts('ashby:polymarket').none).toBe(15);
    expect(counts('lever:nitra').none).toBeGreaterThanOrEqual(4);
    expect(counts('lever:nitra').open_ended).toBe(2);
  });

  it('placeholders and typos land in their own buckets, never in none', () => {
    expect(counts('greenhouse:anthropic').placeholder_range).toBe(2);
    expect(counts('greenhouse:braze').placeholder_range).toBe(1);
    expect(counts('greenhouse:doordashusa').placeholder_range).toBe(1);
    expect(counts('greenhouse:mediabrands').placeholder_range).toBe(1);
    expect(counts('greenhouse:coreweave').malformed_range).toBeGreaterThanOrEqual(3);
    expect(counts('ashby:eliseai').malformed_range).toBe(1);
    expect(counts('ashby:eliseai').open_ended).toBe(1);
    expect(counts('greenhouse:anthropic').none ?? 0).toBe(0);
  });

  it('the boards behind the five false alarms are fully disclosed', () => {
    for (const key of ['lever:palantir', 'lever:gopuff', 'workday:blackrock|wd1|blackrock_professional', 'greenhouse:diginnother', 'greenhouse:successacademycharterschool', 'lever:lifestance']) {
      expect(disclosedPct(key), key).toBeGreaterThanOrEqual(95);
      expect(counts(key).none ?? 0, key).toBe(0);
    }
    expect(counts('ashby:eliseai').none ?? 0).toBe(0);
  });

  it('most big boards disclose on 95%+ of postings', () => {
    const keys = Object.keys(summary).filter((k) => !k.startsWith('greenhouse:stripe'));
    const high = keys.filter((k) => disclosedPct(k) >= 95).length;
    expect(high / keys.length).toBeGreaterThan(0.85);
  });
});
