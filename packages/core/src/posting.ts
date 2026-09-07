import { isOffsite } from './ats/registry.ts';
import { applyOffsiteRule, CLASSIFIER_VERSION, classifyRange } from './classifier/range.ts';
import { sha256Hex, stableStringify } from './hash.ts';
import { classifyJurisdiction } from './jurisdiction/index.ts';
import type { AtsVendor, JurisdictionResult, RangeResult, RawPosting } from './types.ts';

export interface Classified {
  jurisdiction: JurisdictionResult;
  range: RangeResult;
  isOffsite: boolean;
  classifierVersion: string;
}

// the whole per-posting decision in one call so crawler, submission processor and tests agree
export function classifyPosting(vendor: AtsVendor, p: RawPosting): Classified {
  const jurisdiction = classifyJurisdiction({ locations: p.locations, isRemote: p.isRemote, text: p.descriptionText });
  const offsite = isOffsite(vendor, p.url);
  const range = applyOffsiteRule(
    classifyRange({ text: p.descriptionText, structured: p.structuredComp, title: p.title, source: 'ats_api' }),
    offsite,
  );
  return { jurisdiction, range, isOffsite: offsite, classifierVersion: CLASSIFIER_VERSION };
}

// what "changed" means for the diff: the fields a person would notice, not vendor timestamps
export async function postingContentHash(p: RawPosting): Promise<string> {
  return sha256Hex(
    stableStringify({
      title: p.title,
      url: p.url,
      locations: p.locations,
      isRemote: p.isRemote,
      text: p.descriptionText,
      structured: p.structuredComp,
      employmentType: p.employmentType,
    }),
  );
}
