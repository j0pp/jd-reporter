import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// iso timestamps as text: d1 has no timestamp type and iso strings sort correctly
const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const ts = (name: string) => text(name);
const tsNow = (name: string) => text(name).notNull().default(now);
const bool = (name: string) => integer(name, { mode: 'boolean' });
const json = <T>(name: string) => text(name, { mode: 'json' }).$type<T>();

export const ATS_VENDORS = ['greenhouse', 'lever', 'ashby', 'workday'] as const;
export const COMPANY_STATUSES = ['active', 'excluded', 'merged'] as const;
export const BOARD_STATUSES = ['active', 'inactive', 'crawl_error', 'excluded'] as const;
export const LOC_CLASSES = ['nyc_strict', 'ny_bare', 'ny_state', 'remote_us', 'other'] as const;
export const FINDING_TYPES = ['missing_range', 'open_ended_range', 'placeholder_range'] as const;
export const FINDING_STATUSES = ['detected', 'withdrawn', 'confirmed', 'needs_review', 'published', 'rejected', 'fixed', 'stale'] as const;
export const SUBMISSION_STATUSES = ['received', 'rejected', 'queued', 'processing', 'verified', 'published', 'error'] as const;
export const SUBMISSION_SOURCES = ['ats_posting', 'ats_board', 'careers_page', 'aggregator', 'unknown'] as const;
export const FALSE_POSITIVE_REASONS = [
  'parser_missed_format',
  'plain_field_empty',
  'offsite_page_had_range',
  'tips_or_bonus_not_pay',
  'evergreen',
  'location_false_positive',
  'multi_city_preferred_elsewhere',
  'not_an_employer',
  'other',
] as const;

export type FindingStatus = (typeof FINDING_STATUSES)[number];
export type FindingType = (typeof FINDING_TYPES)[number];
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export interface JurisdictionJson {
  nyc: string;
  nys: string;
  locClass: string;
  multiCity: boolean;
  remoteUs: boolean;
  reasons: string[];
  confidence: number;
}

export interface RangeJson {
  method: string;
  min?: number;
  max?: number;
  currency?: string;
  period?: string;
  evidenceSpan?: string;
  source: string;
  confidence: number;
}

// the public entity: what the leaderboard and company page are about
export const companies = sqliteTable(
  'companies',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    slug: text('slug').notNull(),
    displayName: text('display_name').notNull(),
    careersDomain: text('careers_domain'),
    hqCity: text('hq_city'),
    hqState: text('hq_state'),
    hqSource: text('hq_source'),
    sector: text('sector'),
    sectorSource: text('sector_source'),
    sectorConfidence: text('sector_confidence'),
    naics2: text('naics2'),
    enrichment: json<Record<string, unknown>>('enrichment'),
    isStaffingFirm: bool('is_staffing_firm').notNull().default(false),
    // 5+ open postings anywhere: the observable proxy for the 4-employee threshold
    inCohort: bool('in_cohort').notNull().default(false),
    cohortReason: text('cohort_reason'),
    // you confirmed the display name and sector; nothing publishes under an unverified name (nyuhs)
    verifiedAt: ts('verified_at'),
    verifiedBy: text('verified_by'),
    status: text('status', { enum: COMPANY_STATUSES }).notNull().default('active'),
    mergedIntoId: integer('merged_into_id'),
    // rollups, recomputed only for companies touched in a run
    openPostingsTotal: integer('open_postings_total').notNull().default(0),
    openPostingsNy: integer('open_postings_ny').notNull().default(0),
    disclosedNy: integer('disclosed_ny').notNull().default(0),
    publishedFindings: integer('published_findings').notNull().default(0),
    rollupAt: ts('rollup_at'),
    createdAt: tsNow('created_at'),
    updatedAt: tsNow('updated_at'),
  },
  (t) => [uniqueIndex('companies_slug_idx').on(t.slug), index('companies_status_idx').on(t.status)],
);

// the crawl unit. one company has one or more (ats migrations, staff vs faculty sites)
export const boards = sqliteTable(
  'boards',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id),
    atsVendor: text('ats_vendor', { enum: ATS_VENDORS }).notNull(),
    atsSlug: text('ats_slug').notNull(),
    accessTier: integer('access_tier').notNull().default(1),
    discoveredVia: text('discovered_via'),
    status: text('status', { enum: BOARD_STATUSES }).notNull().default('active'),
    lastCrawlRunId: integer('last_crawl_run_id'),
    lastCrawledAt: ts('last_crawled_at'),
    lastOkAt: ts('last_ok_at'),
    lastResponseSha256: text('last_response_sha256'),
    // every posting on the board, any location, from the last successful fetch: the 5+ proxy input
    openPostingsTotal: integer('open_postings_total').notNull().default(0),
    learnedDelayMs: integer('learned_delay_ms'),
    errorCount: integer('error_count').notNull().default(0),
    lastError: text('last_error'),
    createdAt: tsNow('created_at'),
  },
  (t) => [uniqueIndex('boards_vendor_slug_idx').on(t.atsVendor, t.atsSlug), index('boards_company_idx').on(t.companyId)],
);

// current state of one ny-signal posting. never a history row; history is the r2 blobs
export const postings = sqliteTable(
  'postings',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    boardId: integer('board_id')
      .notNull()
      .references(() => boards.id),
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id),
    externalId: text('external_id').notNull(),
    canonicalUrl: text('canonical_url').notNull(),
    isOffsite: bool('is_offsite').notNull().default(false),
    title: text('title').notNull(),
    locations: json<string[]>('locations').notNull(),
    locClass: text('loc_class', { enum: LOC_CLASSES }).notNull(),
    multiCity: bool('multi_city').notNull().default(false),
    remoteUs: bool('remote_us').notNull().default(false),
    isEvergreen: bool('is_evergreen').notNull().default(false),
    employmentType: text('employment_type'),
    contentSha256: text('content_sha256').notNull(),
    // r2 keys: the board response this state was read from, and the employer page when offsite
    rawKey: text('raw_key'),
    pageKey: text('page_key'),
    jurisdiction: json<JurisdictionJson>('jurisdiction').notNull(),
    range: json<RangeJson>('range').notNull(),
    classifierVersion: text('classifier_version').notNull(),
    classifiedAt: tsNow('classified_at'),
    needsDetail: bool('needs_detail').notNull().default(false),
    detailFetchedAt: ts('detail_fetched_at'),
    firstSeenAt: tsNow('first_seen_at'),
    lastChangedAt: tsNow('last_changed_at'),
    removedAt: ts('removed_at'),
    replacementOfId: integer('replacement_of_id'),
  },
  (t) => [
    uniqueIndex('postings_board_external_idx').on(t.boardId, t.externalId),
    index('postings_company_open_idx').on(t.companyId, t.removedAt),
  ],
);

// one claim about one posting, moving through the state machine. evidence is frozen at detection
export const findings = sqliteTable(
  'findings',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    postingId: integer('posting_id')
      .notNull()
      .references(() => postings.id),
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id),
    type: text('type', { enum: FINDING_TYPES }).notNull(),
    status: text('status', { enum: FINDING_STATUSES }).notNull().default('detected'),
    jurisdictionCodes: json<string[]>('jurisdiction_codes').notNull(),
    reviewReasons: json<string[]>('review_reasons').notNull(),
    firstRawKey: text('first_raw_key'),
    firstPageKey: text('first_page_key'),
    evidenceSpan: text('evidence_span'),
    rangeAtDetection: json<RangeJson>('range_at_detection').notNull(),
    classifierVersion: text('classifier_version').notNull(),
    waybackUrl: text('wayback_url'),
    waybackAt: ts('wayback_at'),
    fixedRawKey: text('fixed_raw_key'),
    detectedAt: tsNow('detected_at'),
    withdrawnAt: ts('withdrawn_at'),
    confirmedAt: ts('confirmed_at'),
    reviewAt: ts('review_at'),
    publishedAt: ts('published_at'),
    rejectedAt: ts('rejected_at'),
    fixedAt: ts('fixed_at'),
    staleAt: ts('stale_at'),
    snoozedUntil: ts('snoozed_until'),
  },
  (t) => [uniqueIndex('findings_posting_type_idx').on(t.postingId, t.type), index('findings_company_status_idx').on(t.companyId, t.status)],
);

// append-only log of every finding status change, human or system
export const reviews = sqliteTable(
  'reviews',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    findingId: integer('finding_id')
      .notNull()
      .references(() => findings.id),
    actor: text('actor').notNull(),
    fromStatus: text('from_status', { enum: FINDING_STATUSES }).notNull(),
    toStatus: text('to_status', { enum: FINDING_STATUSES }).notNull(),
    reason: text('reason'),
    falsePositiveReason: text('false_positive_reason', { enum: FALSE_POSITIVE_REASONS }),
    createdAt: tsNow('created_at'),
  },
  (t) => [index('reviews_finding_idx').on(t.findingId)],
);

// the queue between the worker and actions, and what the status page reads
export const submissions = sqliteTable(
  'submissions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    publicToken: text('public_token').notNull(),
    submittedUrl: text('submitted_url').notNull(),
    canonicalUrl: text('canonical_url'),
    sourceType: text('source_type', { enum: SUBMISSION_SOURCES }).notNull(),
    host: text('host'),
    rejectedDomain: text('rejected_domain'),
    atsVendor: text('ats_vendor', { enum: ATS_VENDORS }),
    atsSlug: text('ats_slug'),
    externalId: text('external_id'),
    quickResult: json<Record<string, unknown>>('quick_result'),
    status: text('status', { enum: SUBMISSION_STATUSES }).notNull().default('received'),
    statusMessage: text('status_message'),
    boardId: integer('board_id'),
    postingId: integer('posting_id'),
    companyId: integer('company_id'),
    findingId: integer('finding_id'),
    note: text('note'),
    ipHash: text('ip_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    createdAt: tsNow('created_at'),
    processedAt: ts('processed_at'),
  },
  (t) => [
    uniqueIndex('submissions_token_idx').on(t.publicToken),
    index('submissions_canonical_idx').on(t.canonicalUrl, t.createdAt),
    index('submissions_status_idx').on(t.status),
  ],
);

// one row per pipeline run; the site's "as of"
export const crawlRuns = sqliteTable('crawl_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  kind: text('kind', { enum: ['crawl', 'discover', 'process', 'finalize', 'seed'] }).notNull(),
  vendor: text('vendor'),
  startedAt: tsNow('started_at'),
  finishedAt: ts('finished_at'),
  boardsAttempted: integer('boards_attempted').notNull().default(0),
  boardsOk: integer('boards_ok').notNull().default(0),
  postingsSeen: integer('postings_seen').notNull().default(0),
  postingsChanged: integer('postings_changed').notNull().default(0),
  postingsRemoved: integer('postings_removed').notNull().default(0),
  findingsCreated: integer('findings_created').notNull().default(0),
  findingsFixed: integer('findings_fixed').notNull().default(0),
  errors: json<{ board: string; error: string }[]>('errors').notNull().default([]),
  meta: json<Record<string, unknown>>('meta'),
});

// reference data, one row per law
export const jurisdictions = sqliteTable('jurisdictions', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  statuteCite: text('statute_cite').notNull(),
  agency: text('agency').notNull(),
  complaintUrl: text('complaint_url'),
  complaintLabel: text('complaint_label'),
  requiredFields: json<string[]>('required_fields').notNull(),
  coverageRule: text('coverage_rule').notNull(),
});

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
export type Board = typeof boards.$inferSelect;
export type NewBoard = typeof boards.$inferInsert;
export type Posting = typeof postings.$inferSelect;
export type NewPosting = typeof postings.$inferInsert;
export type Finding = typeof findings.$inferSelect;
export type NewFinding = typeof findings.$inferInsert;
export type Review = typeof reviews.$inferSelect;
export type Submission = typeof submissions.$inferSelect;
export type NewSubmission = typeof submissions.$inferInsert;
export type CrawlRun = typeof crawlRuns.$inferSelect;
export type Jurisdiction = typeof jurisdictions.$inferSelect;
