import type { PayPeriod } from '../types.ts';

// every one of these shapes came from a real posting in the seed (FINDINGS section 2):
// `$124,979.94 — $141,000`, `$85 — $97 USD`, `$400,000-600,000`, `$ 243 , 800 -$ 303 , 000 /year`,
// `USD$115,000.00 - USD$147,500.00`, `$120-150k`. first amount needs a dollar sign, the second may drop it
const K = String.raw`(?:\s?[kK](?![a-z]))?`;
export const MONEY = String.raw`(?:USD?\s?)?\$\s?\d{1,3}(?:\s?,\s?\d{3})*(?:\.\d{1,2})?${K}`;
export const MONEY_LOOSE = String.raw`(?:USD?\s?)?\$?\s?\d{1,3}(?:\s?,\s?\d{3})*(?:\.\d{1,2})?${K}`;

export const RANGE_RE = new RegExp(`(${MONEY})\\s*(-|–|—|‒|to|and)\\s*(${MONEY_LOOSE})(?![\\d]|,\\d)`, 'gi');

// "$110,000 (OTE ...)", "$10,000/month", "$18 per hour", "USD $17.25", "21.50 per hour", "54,313.06 USD"
export const SINGLE_RE = new RegExp(
  [
    String.raw`(?:USD?\s?)?\$\s?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?(?!\s*(?:million|billion|[MB]\b|\+?\s*(?:in\s+)?ARR))`,
    String.raw`\$\s?\d{1,3}(?:\.\d{1,2})?\s*(?:\/|per|an?)\s*(?:hour|hr|month|year|annum)`,
    String.raw`USD\s?\$?\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?`,
    String.raw`\$\s?\d{1,3}\.\d{2}\b`,
    String.raw`\b\d{1,3}(?:,\d{3})+(?:\.\d{2})?\s?USD\b`,
    String.raw`\b\d{2,3}(?:\.\d{2})?\s*(?:per|\/|an)\s*(?:hour|hr)\b`,
    String.raw`\$\s?\d{2,3}[kK]\b`,
  ].join('|'),
  'gi',
);

// "$1 — $2" (anthropic), "$1 — $1" (mediabrands), "$XX and $XX" (braze), "$XXX" (doordash)
export const PLACEHOLDER_X_RE = /\$\s?X{1,3}\b(?!\s*(?:million|billion|[MB]\b))/i;

// "$143,00", "$190,0000": they tried, the groups are wrong. review only, never a finding
export const MALFORMED_RE = /\$\s?\d{1,3},\d{1,2}\b(?![,\d])|\$\s?\d{1,3},\d{4,}/;

// one bound only: "$120+", "up to $325K". "$175k + bonus" is a fixed figure with extras, not a floor
export const OPEN_RE = new RegExp(
  String.raw`(${MONEY})\s*\+(?!\s*(?:\$|equity|bonus|benefit|commission|variable|stock|rsu|ote|\d))|up to\s+(${MONEY})(?!\s*(?:-|–|—|to)\s*\$)`,
  'gi',
);

// funding, benefits and perks money must never read as pay. the noun has to lead straight into the amount
// ("401(k) match up to $5,000", "raised $250 million"); a "bonus" two sentences earlier is not a reason to
// throw away "Compensation Range $180,000 — $200,000" (success academy, lifestance, le pain quotidien)
export const NOT_PAY_BEFORE_RE =
  /\b(401\s?\(?k\)?|bonus(?:es)?|stipend|match(?:ing|es)?|reimburse\w*|allowance|credit|budget|referral|relocation|tips?|per diem|gift|discount|grant|scholarship|award|raised|raising|funding|round|valuation|revenue|arr|aum|assets|loan|deductible|premium|contribut\w*|donat\w*|tuition|prize|worth|valued)\W{0,3}(?:(?:of|up to|to|is|are|at|worth|totaling|total|around|approximately|about|over|under|from|between|the|a|an|for|per|each|every)\s+){0,4}$/i;

// the same idea looking forward a few words: "$15K sign-on bonus", "$500 - $1,000 stipend"
export const NOT_PAY_AFTER_RE =
  /^\W{0,3}(?:[a-z-]+\s){0,2}(bonus|stipend|match(?:ing)?|credit|allowance|reimburse\w*|tips?|per diem|referral|relocation|sign[- ]?on|gift|discount|budget|grant|scholarship|award)\b/i;

export const PAY_CONTEXT_RE = /\b(salary|salaries|compensation|comp\b|pay\b|paid|wage|wages|rate|base|earn\w*|remuneration|hourly|annual|per year|per hour|ote|range)/i;

// "$120+ / OTE $240k+" or "$120 - $150 base salary": a 2-3 digit whole number in a yearly context means thousands.
// cents ("$17.25") never scale; that is an hourly rate whatever the surrounding words say
export function scaleShorthand(v: number, period: PayPeriod): number {
  return period === 'year' && Number.isInteger(v) && v >= 20 && v < 1000 ? v * 1000 : v;
}

export const HOURLY_RE = /\b(?:per|an?|\/)\s*(?:hour|hr)\b|hourly|\/hr\b/i;
export const MONTHLY_RE = /\b(?:per|a|\/)\s*month\b|monthly/i;
export const YEARLY_RE = /\b(?:per|a|\/)\s*(?:year|yr|annum)\b|annual(?:ly|ized)?|yearly|salary/i;

export function moneyValue(s: string): number {
  const cleaned = s.replace(/[^\d.kK]/g, '');
  const k = /[kK]$/.test(cleaned);
  const v = parseFloat(cleaned.replace(/[kK]$/, ''));
  if (!Number.isFinite(v)) return 0;
  return k ? v * 1000 : v;
}

export function inferPeriod(window: string, max: number): PayPeriod {
  if (HOURLY_RE.test(window)) return 'hour';
  if (MONTHLY_RE.test(window)) return 'month';
  // "$17.25" is an hourly rate even when "salary range" appears in the next sentence (gopuff)
  if (max > 0 && max < 1000 && !Number.isInteger(max)) return 'hour';
  if (YEARLY_RE.test(window)) return 'year';
  if (max > 0 && max < 1000) return 'hour';
  return 'year';
}

export function windowAround(text: string, start: number, end: number, before = 60, after = 60): string {
  return text.slice(Math.max(0, start - before), Math.min(text.length, end + after)).replace(/\s+/g, ' ').trim();
}

// unicode dashes, nbsp and thin spaces show up in pasted pay text; fold them before any regex sees them
export function normalizeText(text: string): string {
  return text
    .replace(/[\u00a0\u2009\u202f\u2007]/g, ' ')
    .replace(/[\u2010\u2011\u2012]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}
