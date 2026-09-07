import type { PayPeriod, RangeResult, RangeSource, StructuredComp } from '../types.ts';
import { isEvergreenTitle } from './evergreen.ts';
import {
  inferPeriod,
  MALFORMED_RE,
  moneyValue,
  normalizeText,
  NOT_PAY_AFTER_RE,
  NOT_PAY_BEFORE_RE,
  OPEN_RE,
  PAY_CONTEXT_RE,
  PLACEHOLDER_X_RE,
  RANGE_RE,
  scaleShorthand,
  SINGLE_RE,
  windowAround,
} from './money.ts';

export const CLASSIFIER_VERSION = '2026.09.05-1';

export interface ClassifyInput {
  text: string;
  structured: StructuredComp[] | null;
  title?: string;
  source?: RangeSource;
}

function periodFromInterval(interval: string | null, max: number | null): PayPeriod {
  const i = (interval ?? '').toLowerCase();
  if (/hour/.test(i)) return 'hour';
  if (/month/.test(i)) return 'month';
  if (/year|annual|salary/.test(i)) return 'year';
  return inferPeriod('', max ?? 0);
}

function fromStructured(comps: StructuredComp[], source: RangeSource): RangeResult | null {
  const numeric = comps.filter((c) => c.min !== null || c.max !== null);
  if (numeric.length) {
    // largest maximum is base pay when a posting lists several tiers or components
    const best = numeric.reduce((a, b) => ((b.max ?? b.min ?? 0) > (a.max ?? a.min ?? 0) ? b : a));
    const period = periodFromInterval(best.interval, best.max ?? best.min);
    const currency = best.currency ?? 'USD';
    const fmt = (v: number | null) => (v === null ? '?' : v.toLocaleString('en-US'));
    const span = `${best.summary ? `${best.summary.replace(/:\s*$/, '')}: ` : ''}${fmt(best.min)} - ${fmt(best.max)} ${currency} per ${period}`;
    if (best.min !== null && best.max !== null) {
      if (best.max < 10 && best.min < 10) {
        return { method: 'placeholder_range', min: best.min, max: best.max, currency, period, evidenceSpan: span, source, confidence: 0.9 };
      }
      return { method: 'structured', min: best.min, max: best.max, currency, period, evidenceSpan: span, source, confidence: 1 };
    }
    return { method: 'open_ended', min: best.min ?? undefined, max: best.max ?? undefined, currency, period, evidenceSpan: span, source, confidence: 0.85 };
  }
  // ashby-style summary strings with no parsed numbers: read them like text, but the method stays structured
  const summaries = comps.map((c) => c.summary).filter((s): s is string => !!s);
  for (const s of summaries) {
    const r = fromText(s, source);
    if (r && (r.method === 'text_range' || r.method === 'fixed_rate')) return { ...r, method: 'structured', confidence: 0.95 };
    if (r && r.method !== 'none' && r.method !== 'dollar_mention_only') return r;
  }
  return null;
}

interface RangeHit {
  span: string;
  start: number;
  end: number;
  min: number;
  max: number;
  sep: string;
}

function findRanges(text: string): RangeHit[] {
  const hits: RangeHit[] = [];
  RANGE_RE.lastIndex = 0;
  for (const m of text.matchAll(RANGE_RE)) {
    const a = m[1]!;
    const sep = m[2]!;
    const b = m[3]!;
    let min = moneyValue(a);
    let max = moneyValue(b);
    // "$120-150k": the k belongs to both sides
    if (/[kK]$/.test(b.trim()) && !/[kK]$/.test(a.trim()) && min < 1000) min *= 1000;
    if (max < min) [min, max] = [max, min];
    const start = m.index ?? 0;
    hits.push({ span: m[0], start, end: start + m[0].length, min, max, sep: sep.toLowerCase() });
  }
  return hits;
}

// only exclusions here: the largest range on a page is pay unless the words right around it say otherwise
function isPay(text: string, start: number, end: number): boolean {
  const before = text.slice(Math.max(0, start - 45), start);
  if (NOT_PAY_BEFORE_RE.test(before)) return false;
  const after = text.slice(end, end + 40);
  // "$18.00/hr + full tip earnings", "$175k + bonus + equity": what follows a plus is an addition to pay, not pay
  const addition = /^\s*(\+|plus\b|and\b|with\b|&)/i.test(after);
  if (!addition && NOT_PAY_AFTER_RE.test(after)) return false;
  // "million/billion" right after is funding or revenue, not pay
  if (/^\s*(million|billion|[mb]\b)/i.test(after)) return false;
  return true;
}

function plausiblePay(v: number, period: string): boolean {
  return (period === 'hour' && v >= 10 && v < 1000) || (period === 'month' && v >= 800) || (period === 'year' && v >= 15_000);
}

function fromText(rawText: string, source: RangeSource): RangeResult | null {
  const text = normalizeText(rawText);
  if (!text) return null;

  const px = PLACEHOLDER_X_RE.exec(text);
  if (px) {
    return { method: 'placeholder_range', evidenceSpan: windowAround(text, px.index, px.index + px[0].length, 40, 40), source, confidence: 0.95 };
  }

  const mal = MALFORMED_RE.exec(text);
  if (mal) {
    return { method: 'malformed_range', evidenceSpan: windowAround(text, mal.index, mal.index + mal[0].length, 40, 40), source, confidence: 0.7 };
  }

  // the largest range on the page is the pay range: "$17 - $18 / hour ... + $2-3/hour in tips"
  const ranges = findRanges(text).filter((h) => !/tips?\b/i.test(text.slice(h.end, h.end + 25)));
  if (ranges.length) {
    const best = ranges.reduce((a, b) => (b.max > a.max ? b : a));
    const window = windowAround(text, best.start, best.end);
    if (best.max < 10) {
      return { method: 'placeholder_range', min: best.min, max: best.max, currency: 'USD', evidenceSpan: window, source, confidence: 0.9 };
    }
    // a benefits range like "$500 - $1,000 stipend" is not pay; a real range is >= $10/hr or >= $10k/yr
    const period = inferPeriod(window, best.max);
    const min = scaleShorthand(best.min, period);
    const max = scaleShorthand(best.max, period);
    const plausible = (period === 'hour' && max >= 10) || (period === 'month' && max >= 800) || (period === 'year' && max >= 10_000);
    if (plausible && isPay(text, best.start, best.end)) {
      return {
        method: 'text_range',
        min,
        max,
        currency: 'USD',
        period,
        evidenceSpan: window,
        source,
        confidence: best.sep === 'and' ? 0.75 : 0.9,
      };
    }
  }

  OPEN_RE.lastIndex = 0;
  for (const m of text.matchAll(OPEN_RE)) {
    const amount = m[1] ?? m[2] ?? '';
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const window = windowAround(text, start, end, 50, 40);
    const rawV = moneyValue(amount);
    const period = inferPeriod(window, rawV);
    const v = scaleShorthand(rawV, period);
    const plausible = (period === 'hour' && v >= 10) || (period === 'month' && v >= 800) || (period === 'year' && v >= 15_000);
    if (!plausible || !isPay(text, start, end)) continue;
    const isFloor = m[1] !== undefined;
    return { method: 'open_ended', ...(isFloor ? { min: v } : { max: v }), currency: 'USD', period, evidenceSpan: window, source, confidence: 0.85 };
  }

  SINGLE_RE.lastIndex = 0;
  for (const m of text.matchAll(SINGLE_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const v = moneyValue(m[0]);
    const window = windowAround(text, start, end, 50, 40);
    const period = inferPeriod(window, v);
    const plausible = (period === 'hour' && v >= 10 && v < 1000) || (period === 'month' && v >= 800) || (period === 'year' && v >= 15_000);
    if (!plausible || !isPay(text, start, end)) continue;
    return { method: 'fixed_rate', min: v, max: v, currency: 'USD', period, evidenceSpan: window, source, confidence: 0.8 };
  }

  // a pay-sized dollar figure near pay words that none of the patterns understood ("$18/00/hr"): a human
  // looks, no finding. perks money ("$50.00 per month cellphone stipend") is filtered by size and context
  for (const m of text.matchAll(/\$\s?\d[\d,.]*(?:\s?[kK]\b)?/g)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const window = windowAround(text, start, end, 80, 40);
    const rawV = moneyValue(m[0]);
    const period = inferPeriod(window, rawV);
    const v = scaleShorthand(rawV, period);
    if (PAY_CONTEXT_RE.test(window) && plausiblePay(v, period) && isPay(text, start, end)) {
      return { method: 'dollar_mention_only', evidenceSpan: window, source, confidence: 0.4 };
    }
  }

  return null;
}

// ordered decision, each step records the span it decided on (FINDINGS section 4)
export function classifyRange(input: ClassifyInput): RangeResult {
  const source = input.source ?? 'ats_api';
  if (input.structured?.length) {
    const s = fromStructured(input.structured, source);
    if (s) return s;
  }
  if (input.title && isEvergreenTitle(input.title)) {
    return { method: 'evergreen', evidenceSpan: input.title, source, confidence: 0.95 };
  }
  const t = fromText(input.text, source);
  if (t) return t;
  return { method: 'none', source, confidence: 0.9 };
}

// the ats json proves nothing when the posting lives on the employer's own site (stripe). the crawler clears
// this by fetching the page; until then it is not a finding
export function applyOffsiteRule(result: RangeResult, isOffsite: boolean): RangeResult {
  if (isOffsite && result.method === 'none' && result.source === 'ats_api') {
    return { ...result, method: 'offsite_unverified', confidence: 0.5 };
  }
  return result;
}
