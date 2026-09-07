import type { Coverage, CoverageResult, LocClass } from '../types.ts';
import { classifyLocation, isElsewhere, isRemote, splitLocations } from './location.ts';

export * from './location.ts';

// "this role is not available to residents of new york", "cannot be performed in new york"
const TEXT_EXCLUDES_NY_RE =
  /(not|cannot|can.t|unable to|won.t)\s+(be\s+)?(performed|hired?|hiring|work(ed|ing)?|available|open|eligible|considered)[^.]{0,80}\b(in|to|for|from)\s+(the state of\s+)?New York|except(ing)?\s+(for\s+)?(the state of\s+)?New York|excluding\s+(the state of\s+)?New York|New York[^.]{0,40}\b(excluded|not eligible|ineligible)/i;

export interface CoverageInput {
  locations: string[];
  isRemote: boolean | null;
  text?: string;
}

const RANK: Record<LocClass, number> = { nyc_strict: 0, ny_bare: 1, ny_state: 2, remote_us: 3, other: 4 };

// three answers, never two (FINDINGS #2): covered, possible (human decides), no, or not_assessed for
// remote postings until company hq is known
export function classifyCoverage(input: CoverageInput): CoverageResult {
  const parts = input.locations.flatMap(splitLocations);
  const classes = parts.map((p) => ({ part: p, cls: classifyLocation(p) }));
  const reasons: string[] = [];

  const best = classes.reduce<LocClass>((acc, c) => (RANK[c.cls] < RANK[acc] ? c.cls : acc), 'other');
  const hasNy = classes.some((c) => c.cls === 'nyc_strict' || c.cls === 'ny_bare' || c.cls === 'ny_state');
  const elsewhere = classes.filter((c) => isElsewhere(c.part)).map((c) => c.part);
  const multiCity = hasNy && elsewhere.length > 0;
  const remoteMarker = input.isRemote === true || parts.some(isRemote);
  const remoteUs = classes.some((c) => c.cls === 'remote_us') || (remoteMarker && !hasNy);

  for (const c of classes) {
    if (c.cls !== 'other') reasons.push(`location "${c.part}" reads as ${c.cls}`);
  }
  if (multiCity) reasons.push(`also lists ${elsewhere.slice(0, 4).join(', ')}${elsewhere.length > 4 ? ` and ${elsewhere.length - 4} more` : ''}`);

  let coverage: Coverage;
  let confidence: number;
  switch (best) {
    case 'nyc_strict':
      coverage = 'covered';
      confidence = multiCity ? 0.75 : 0.9;
      break;
    case 'ny_bare':
      coverage = 'covered';
      confidence = multiCity ? 0.55 : 0.65;
      reasons.push('bare "New York" with no other city; treated as the city at lower confidence');
      break;
    case 'ny_state':
      coverage = 'covered';
      confidence = 0.8;
      break;
    case 'remote_us':
      coverage = 'not_assessed';
      confidence = 0.5;
      reasons.push('remote us posting; coverage depends on company hq, which is not known');
      break;
    default:
      if (remoteUs || (remoteMarker && parts.length === 0)) {
        coverage = 'not_assessed';
        confidence = 0.5;
        reasons.push('remote posting with no ny location; coverage depends on company hq');
      } else {
        coverage = 'no';
        confidence = parts.length ? 0.9 : 0.4;
        if (!parts.length) reasons.push('no location string at all');
      }
  }

  if (input.text && hasNy && TEXT_EXCLUDES_NY_RE.test(input.text)) {
    const m = TEXT_EXCLUDES_NY_RE.exec(input.text)!;
    reasons.push(`description says "${m[0].slice(0, 80)}"`);
    if (coverage === 'covered') coverage = 'possible';
    confidence = Math.min(confidence, 0.5);
  }

  return { coverage, locClass: best, multiCity, remoteUs, reasons, confidence };
}

export function isNySignal(c: CoverageResult): boolean {
  return c.locClass === 'nyc_strict' || c.locClass === 'ny_bare' || c.locClass === 'ny_state';
}
