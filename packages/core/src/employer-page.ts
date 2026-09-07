import { arr, num, obj, str } from './ats/util.ts';
import { stripHtml } from './html.ts';
import type { StructuredComp } from './types.ts';

// schema.org JobPosting on the employer's own page: the compliance surface for offsite postings (stripe),
// and later the whole tier-2 adapter for icims, paylocity and custom career sites
export interface EmployerPage {
  jsonLd: StructuredComp[] | null;
  text: string;
  title: string | null;
  locations: string[];
}

function* jobPostings(node: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(node)) {
    for (const n of node) yield* jobPostings(n);
    return;
  }
  const o = obj(node);
  if (!Object.keys(o).length) return;
  const type = o['@type'];
  const types = Array.isArray(type) ? type : [type];
  if (types.includes('JobPosting')) yield o;
  if (o['@graph']) yield* jobPostings(o['@graph']);
}

function salaryFrom(jp: Record<string, unknown>): StructuredComp[] | null {
  const salaries = arr(jp.baseSalary).length ? arr(jp.baseSalary) : jp.baseSalary ? [jp.baseSalary] : [];
  const out: StructuredComp[] = [];
  for (const s of salaries) {
    const sal = obj(s);
    const value = obj(sal.value);
    const flat = num(sal.value);
    const min = num(value.minValue) ?? (flat !== null ? flat : num(value.value));
    const max = num(value.maxValue) ?? (flat !== null ? flat : num(value.value));
    if (min === null && max === null) continue;
    out.push({
      min,
      max,
      currency: str(sal.currency) ?? str(value.currency),
      interval: str(value.unitText),
      summary: `jsonld baseSalary ${min ?? '?'}-${max ?? '?'} ${str(sal.currency) ?? ''}/${str(value.unitText) ?? ''}`.trim(),
    });
  }
  return out.length ? out : null;
}

export function parseEmployerPage(html: string): EmployerPage {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  let jsonLd: StructuredComp[] | null = null;
  let title: string | null = null;
  const locations: string[] = [];
  let ldText = '';
  for (const m of scripts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(m[1]!.trim());
    } catch {
      continue;
    }
    for (const jp of jobPostings(parsed)) {
      const sal = salaryFrom(jp);
      if (sal) jsonLd = [...(jsonLd ?? []), ...sal];
      title ??= str(jp.title);
      for (const loc of arr(jp.jobLocation).length ? arr(jp.jobLocation) : jp.jobLocation ? [jp.jobLocation] : []) {
        const addr = obj(obj(loc).address);
        const s = [str(addr.addressLocality), str(addr.addressRegion)].filter(Boolean).join(', ');
        if (s) locations.push(s);
      }
      const desc = str(jp.description);
      if (desc) ldText += ' ' + stripHtml(desc);
    }
  }
  // drop scripts and styles, then read the body the way an applicant would
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  const text = `${stripHtml(body)} ${ldText}`.replace(/\s+/g, ' ').trim();
  return { jsonLd, text, title, locations };
}
