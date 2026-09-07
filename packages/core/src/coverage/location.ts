import type { LocClass } from '../types.ts';

// ported from the seed analysis's nyc.sql (see docs/FINDINGS.md). deliberately conservative: strict means unambiguously
// the city, bare means just "New York" (almost always the city in an office list), state means could be buffalo

const NYC_STRICT_RE =
  /\bNYC\b|New York City|New York,\s*(NY|N\.Y\.|New York)\b|\bNY,?\s*NY\b|NY\s*-\s*New York|New York (Metro|Metropolitan)/i;
const BOROUGH_RE = /\b(Manhattan|Brooklyn|Bronx|Staten Island|Queens|Long Island City)\b/i;
const BOROUGH_EXCLUDE_RE =
  /Brooklyn Park|Manhattan Beach|Queensland|Queens Village|Queensbury|Queens Park|Queenstown|Queensway|Queenston|Manhattan,?\s*(KS|Kansas)|Brooklyn,?\s*(OH|MI|CT|IL|IN|WI|MD)/i;
// every us state code except ny, for the other brooklyns and manhattans
const BOROUGH_OTHER_STATE_RE =
  /\b(Manhattan|Brooklyn|Bronx|Queens),\s*(A[LKZR]|C[AOT]|D[EC]|FL|GA|HI|I[DLNA]|K[SY]|LA|M[EDAINSOT]|N[EVHJMCD]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[TA]|W[AVIY])\b/i;
// neighborhoods exist elsewhere too (williamsburg va, astoria or), so they need an ny token next to them
const NEIGHBORHOOD_RE = /\b(Astoria|Flushing|Harlem|Midtown|Tribeca|Williamsburg|SoHo|Dumbo|NoMad|Financial District|Hudson Yards|Chelsea)\b/i;
const NY_TOKEN_RE = /New York|\bNY\b/i;
const NY_ANY_RE = /New York|\bNY\b|\bN\.Y\./i;
const NY_EXCLUDE_RE = /West New York|New York Mills|New York Ave/i;
const NY_BARE_RE =
  /^\s*New York\s*(Office|\(HQ\)|HQ|-\s*HQ|\(Hybrid\)|\(Remote\)|Hybrid|,\s*(US|USA|United States)(\s+of\s+America)?)?\s*$/i;
const REMOTE_RE = /\bremote\b|work from home|\bwfh\b|\bdistributed\b|\banywhere\b/i;
const US_RE = /\b(US|USA|U\.S\.A?|United States|America|Nationwide)\b/i;
// separators employers use to list several offices in one string. a bare "/" is skipped on purpose:
// it shows up inside single addresses ("TMC/Children's Hospital") far more than between cities
const MULTI_SEP_RE = /[;|•]|\s\/\s|\s+or\s+|\+\s*\d+\s*more|\s+and\s+|\s*,\s*(?=[A-Z][a-z]+(?:\s[A-Z][a-z]+)*,\s*[A-Z]{2}\b)/;

export function isNycStrict(loc: string): boolean {
  if (NY_EXCLUDE_RE.test(loc)) return false;
  if (NYC_STRICT_RE.test(loc)) return true;
  if (BOROUGH_RE.test(loc) && !BOROUGH_EXCLUDE_RE.test(loc) && !BOROUGH_OTHER_STATE_RE.test(loc)) return true;
  if (NEIGHBORHOOD_RE.test(loc) && NY_TOKEN_RE.test(loc)) return true;
  return false;
}

export function isNyBare(loc: string): boolean {
  return NY_BARE_RE.test(loc);
}

export function isNyAny(loc: string): boolean {
  return NY_ANY_RE.test(loc) && !NY_EXCLUDE_RE.test(loc);
}

export function isRemote(loc: string): boolean {
  return REMOTE_RE.test(loc);
}

export function isRemoteUs(loc: string): boolean {
  return isRemote(loc) && US_RE.test(loc);
}

// one string may hold several offices; split before classifying so "New York City; Austin" counts both
export function splitLocations(loc: string): string[] {
  return loc
    .split(MULTI_SEP_RE)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function classifyLocation(loc: string): LocClass {
  const s = loc.trim();
  if (!s) return 'other';
  if (isNycStrict(s)) return 'nyc_strict';
  if (isNyBare(s)) return 'ny_bare';
  if (isNyAny(s)) return 'ny_state';
  if (isRemoteUs(s)) return 'remote_us';
  return 'other';
}

// a part that names somewhere else (not ny, not a remote marker, not a country/generic token)
export function isElsewhere(part: string): boolean {
  const s = part.trim();
  if (!s) return false;
  if (classifyLocation(s) !== 'other') return false;
  if (isRemote(s)) return false;
  if (/^(US|USA|United States|North America|Americas|Global|Worldwide|Hybrid|On-?site|In[- ]office|Multiple Locations|\d+ Locations)$/i.test(s)) return false;
  return /[A-Za-z]{3,}/.test(s);
}
