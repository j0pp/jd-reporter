import { describe, expect, it } from 'vitest';
import { classifyJurisdiction, classifyLocation, splitLocations } from '../src/jurisdiction/index.ts';

describe('location tiers (ported from nyc.sql)', () => {
  it.each([
    ['New York, NY', 'nyc_strict'],
    ['New York, New York', 'nyc_strict'],
    ['NYC', 'nyc_strict'],
    ['New York City', 'nyc_strict'],
    ['Brooklyn, NY', 'nyc_strict'],
    ['Brooklyn', 'nyc_strict'],
    ['Long Island City, NY', 'nyc_strict'],
    ['Williamsburg, Brooklyn, NY', 'nyc_strict'],
    ['Astoria, New York', 'nyc_strict'],
    ['Greater New York City Area', 'nyc_strict'],
    ['New York', 'ny_bare'],
    ['New York Office', 'ny_bare'],
    ['New York (HQ)', 'ny_bare'],
    ['New York, United States', 'ny_bare'],
    ['Buffalo, New York', 'ny_state'],
    ['Albany, NY', 'ny_state'],
    ['Rochester, New York, United States', 'ny_state'],
    ['Remote - US', 'remote_us'],
    ['Remote (United States)', 'remote_us'],
    ['Manhattan, KS', 'other'],
    ['Manhattan Beach, CA', 'other'],
    ['Brooklyn Park, MN', 'other'],
    ['Brooklyn, OH', 'other'],
    ['Williamsburg, VA', 'other'],
    ['Astoria, OR', 'other'],
    ['Queensland', 'other'],
    ['West New York, NJ', 'other'],
    ['San Francisco, CA', 'other'],
    ['Remote', 'other'],
    ['', 'other'],
  ])('%s -> %s', (loc, cls) => {
    expect(classifyLocation(loc)).toBe(cls);
  });

  it('splits multi-office strings on the separators employers actually use', () => {
    expect(splitLocations('New York City; Austin; Boston')).toEqual(['New York City', 'Austin', 'Boston']);
    expect(splitLocations('New York, NY / San Francisco, CA')).toEqual(['New York, NY', 'San Francisco, CA']);
    expect(splitLocations('New York or Remote')).toEqual(['New York', 'Remote']);
    // a bare slash inside an address is not a separator
    expect(splitLocations("TMC/Children's Hospital")).toEqual(["TMC/Children's Hospital"]);
  });
});

describe('jurisdiction: three answers, not two', () => {
  const j = (locations: string[], isRemote: boolean | null = null, text?: string) => classifyJurisdiction({ locations, isRemote, text });

  it('an unambiguous city string covers both laws', () => {
    const r = j(['New York, NY']);
    expect(r.nyc).toBe('covered');
    expect(r.nys).toBe('covered');
    expect(r.locClass).toBe('nyc_strict');
    expect(r.multiCity).toBe(false);
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('bare "New York" is covered at lower confidence', () => {
    const r = j(['New York']);
    expect(r.nyc).toBe('covered');
    expect(r.confidence).toBeLessThan(0.7);
    expect(r.reasons.join(' ')).toMatch(/bare/);
  });

  it('upstate is nys only', () => {
    const r = j(['Buffalo, New York']);
    expect(r.nyc).toBe('no');
    expect(r.nys).toBe('covered');
  });

  it('multi-city with a non-ny city stays covered but is flagged for review', () => {
    const r = j(['New York City; Austin; Boston; Chicago; San Francisco']);
    expect(r.nyc).toBe('covered');
    expect(r.multiCity).toBe(true);
    expect(r.reasons.join(' ')).toMatch(/also lists Austin/);
    expect(r.confidence).toBeLessThan(0.9);
  });

  it('coreweave: preferred nj but also new york is multi-city', () => {
    const r = j(['Livingston, NJ', 'New York, NY']);
    expect(r.nyc).toBe('covered');
    expect(r.multiCity).toBe(true);
  });

  it('remote us is not assessed until hq is known', () => {
    expect(j(['Remote - US']).nyc).toBe('not_assessed');
    expect(j(['Remote'], true).nyc).toBe('not_assessed');
    expect(j([], true).nyc).toBe('not_assessed');
  });

  it('remote plus an ny office is covered by the office', () => {
    const r = j(['New York, NY', 'Remote']);
    expect(r.nyc).toBe('covered');
    expect(r.multiCity).toBe(false);
  });

  it('the other manhattans and brooklyns are not covered', () => {
    expect(j(['Manhattan, KS']).nyc).toBe('no');
    expect(j(['Brooklyn Park, MN']).nys).toBe('no');
  });

  it('description text excluding new york downgrades to possible', () => {
    const r = j(['New York, NY', 'Denver, CO'], null, 'This role cannot be performed in New York.');
    expect(r.nyc).toBe('possible');
    expect(r.nys).toBe('possible');
    expect(r.reasons.join(' ')).toMatch(/cannot be performed/);
  });

  it('no location at all is no, at low confidence', () => {
    const r = j([]);
    expect(r.nyc).toBe('no');
    expect(r.confidence).toBeLessThan(0.5);
  });
});
