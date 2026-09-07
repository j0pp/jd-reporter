export type AtsVendor = 'greenhouse' | 'lever' | 'ashby' | 'workday';
export const ATS_VENDORS: readonly AtsVendor[] = ['greenhouse', 'lever', 'ashby', 'workday'];

export interface StructuredComp {
  min: number | null;
  max: number | null;
  currency: string | null;
  // vendor's own interval string, normalized later by the classifier
  interval: string | null;
  summary: string | null;
}

// one posting as an adapter hands it to the classifier. vendor-neutral, no db ids.
export interface RawPosting {
  externalId: string;
  url: string;
  title: string;
  locations: string[];
  isRemote: boolean | null;
  descriptionText: string;
  structuredComp: StructuredComp[] | null;
  employmentType: string | null;
  publishedAt: string | null;
  updatedAt: string | null;
  // workday list rows carry no description until the detail call
  needsDetail: boolean;
  raw: unknown;
}

export type RangeMethod =
  | 'structured'
  | 'text_range'
  | 'fixed_rate'
  | 'open_ended'
  | 'placeholder_range'
  | 'malformed_range'
  | 'dollar_mention_only'
  | 'evergreen'
  | 'offsite_unverified'
  | 'none';

export type RangeSource = 'ats_api' | 'detail_call' | 'employer_page_jsonld' | 'employer_page_text';

export type PayPeriod = 'year' | 'hour' | 'month' | 'other';

export interface RangeResult {
  method: RangeMethod;
  min?: number;
  max?: number;
  currency?: string;
  period?: PayPeriod;
  evidenceSpan?: string;
  source: RangeSource;
  confidence: number;
}

// disclosed means the employer stated pay in a form the law accepts; a single stated figure counts
export const DISCLOSED_METHODS: ReadonlySet<RangeMethod> = new Set(['structured', 'text_range', 'fixed_rate']);
// these become findings once confirmed. malformed and dollar_mention_only are review-only, never findings
export const FINDING_METHODS: ReadonlySet<RangeMethod> = new Set(['none', 'open_ended', 'placeholder_range']);

export type Coverage = 'covered' | 'possible' | 'no' | 'not_assessed';
export type LocClass = 'nyc_strict' | 'ny_bare' | 'ny_state' | 'remote_us' | 'other';

export interface JurisdictionResult {
  nyc: Coverage;
  nys: Coverage;
  locClass: LocClass;
  multiCity: boolean;
  remoteUs: boolean;
  reasons: string[];
  confidence: number;
}

export type FindingType = 'missing_range' | 'open_ended_range' | 'placeholder_range';

export function findingTypeFor(method: RangeMethod): FindingType | null {
  switch (method) {
    case 'none':
      return 'missing_range';
    case 'open_ended':
      return 'open_ended_range';
    case 'placeholder_range':
      return 'placeholder_range';
    default:
      return null;
  }
}
