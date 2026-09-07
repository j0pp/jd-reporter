export interface AdminFinding {
  id: number;
  postingId: number;
  companyId: number;
  type: string;
  status: string;
  reviewReasons: string[];
  firstRawKey: string | null;
  firstPageKey: string | null;
  evidenceSpan: string | null;
  rangeAtDetection: { method: string; min?: number; max?: number; evidenceSpan?: string; source: string; confidence: number };
  classifierVersion: string;
  waybackUrl: string | null;
  detectedAt: string;
  reviewAt: string | null;
}

export interface AdminPosting {
  id: number;
  externalId: string;
  canonicalUrl: string;
  isOffsite: boolean;
  title: string;
  locations: string[];
  locClass: string;
  multiCity: boolean;
  employmentType: string | null;
  rawKey: string | null;
  pageKey: string | null;
  coverage: { coverage: string; reasons: string[]; confidence: number };
  range: { method: string; evidenceSpan?: string; min?: number; max?: number };
  board: { vendor: string; slug: string };
}

export interface AdminCompany {
  id: number;
  slug: string;
  displayName: string;
  sector: string | null;
  hqCity: string | null;
  hqState: string | null;
  isStaffingFirm: boolean;
  inCohort: boolean;
  verifiedAt: string | null;
  logoKey: string | null;
  enrichment: { identityAt?: string; nameSource?: string; logoUrl?: string | null } | null;
  openPostingsTotal: number;
  openPostingsNy: number;
  disclosedNy: number;
  publishedFindings: number;
  boards?: { id: number; vendor: string; slug: string; status: string; lastOkAt: string | null; openPostingsTotal: number }[];
}

export interface QueueItem {
  finding: AdminFinding;
  posting: AdminPosting;
}

export interface QueueGroup {
  company: AdminCompany;
  items: QueueItem[];
}

export interface AdminSubmission {
  id: number;
  publicToken: string;
  submittedUrl: string;
  sourceType: string;
  status: string;
  statusMessage: string | null;
  quickResult: Record<string, unknown> | null;
  rejectedDomain: string | null;
  companyId: number | null;
  findingId: number | null;
  createdAt: string;
  processedAt: string | null;
}

export const FP_REASONS = [
  ['parser_missed_format', 'parser missed a pay format'],
  ['plain_field_empty', 'vendor plain field empty, html had it'],
  ['offsite_page_had_range', 'employer page had the range'],
  ['tips_or_bonus_not_pay', 'money was tips/bonus, misread'],
  ['evergreen', 'not a real job (evergreen)'],
  ['location_false_positive', 'not actually new york'],
  ['multi_city_preferred_elsewhere', 'multi-city, ny not the real location'],
  ['not_an_employer', 'staffing firm or not an employer'],
  ['other', 'other'],
] as const;

export { SECTORS } from '@/lib/format';
