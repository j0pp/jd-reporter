CREATE TABLE `boards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`ats_vendor` text NOT NULL,
	`ats_slug` text NOT NULL,
	`access_tier` integer DEFAULT 1 NOT NULL,
	`discovered_via` text,
	`status` text DEFAULT 'active' NOT NULL,
	`last_crawl_run_id` integer,
	`last_crawled_at` text,
	`last_ok_at` text,
	`last_response_sha256` text,
	`open_postings_total` integer DEFAULT 0 NOT NULL,
	`learned_delay_ms` integer,
	`error_count` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `boards_vendor_slug_idx` ON `boards` (`ats_vendor`,`ats_slug`);--> statement-breakpoint
CREATE INDEX `boards_company_idx` ON `boards` (`company_id`);--> statement-breakpoint
CREATE TABLE `companies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`display_name` text NOT NULL,
	`careers_domain` text,
	`hq_city` text,
	`hq_state` text,
	`hq_source` text,
	`sector` text,
	`sector_source` text,
	`sector_confidence` text,
	`naics2` text,
	`enrichment` text,
	`is_staffing_firm` integer DEFAULT false NOT NULL,
	`in_cohort` integer DEFAULT false NOT NULL,
	`cohort_reason` text,
	`verified_at` text,
	`verified_by` text,
	`status` text DEFAULT 'active' NOT NULL,
	`merged_into_id` integer,
	`open_postings_total` integer DEFAULT 0 NOT NULL,
	`open_postings_ny` integer DEFAULT 0 NOT NULL,
	`disclosed_ny` integer DEFAULT 0 NOT NULL,
	`published_findings` integer DEFAULT 0 NOT NULL,
	`rollup_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `companies_slug_idx` ON `companies` (`slug`);--> statement-breakpoint
CREATE INDEX `companies_status_idx` ON `companies` (`status`);--> statement-breakpoint
CREATE TABLE `crawl_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`vendor` text,
	`started_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`finished_at` text,
	`boards_attempted` integer DEFAULT 0 NOT NULL,
	`boards_ok` integer DEFAULT 0 NOT NULL,
	`postings_seen` integer DEFAULT 0 NOT NULL,
	`postings_changed` integer DEFAULT 0 NOT NULL,
	`postings_removed` integer DEFAULT 0 NOT NULL,
	`findings_created` integer DEFAULT 0 NOT NULL,
	`findings_fixed` integer DEFAULT 0 NOT NULL,
	`errors` text DEFAULT '[]' NOT NULL,
	`meta` text
);
--> statement-breakpoint
CREATE TABLE `findings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`posting_id` integer NOT NULL,
	`company_id` integer NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'detected' NOT NULL,
	`jurisdiction_codes` text NOT NULL,
	`review_reasons` text NOT NULL,
	`first_raw_key` text,
	`first_page_key` text,
	`evidence_span` text,
	`range_at_detection` text NOT NULL,
	`classifier_version` text NOT NULL,
	`wayback_url` text,
	`wayback_at` text,
	`fixed_raw_key` text,
	`detected_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`withdrawn_at` text,
	`confirmed_at` text,
	`review_at` text,
	`published_at` text,
	`rejected_at` text,
	`fixed_at` text,
	`stale_at` text,
	`snoozed_until` text,
	FOREIGN KEY (`posting_id`) REFERENCES `postings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `findings_posting_type_idx` ON `findings` (`posting_id`,`type`);--> statement-breakpoint
CREATE INDEX `findings_company_status_idx` ON `findings` (`company_id`,`status`);--> statement-breakpoint
CREATE TABLE `jurisdictions` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`statute_cite` text NOT NULL,
	`agency` text NOT NULL,
	`complaint_url` text,
	`complaint_label` text,
	`required_fields` text NOT NULL,
	`coverage_rule` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `postings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`board_id` integer NOT NULL,
	`company_id` integer NOT NULL,
	`external_id` text NOT NULL,
	`canonical_url` text NOT NULL,
	`is_offsite` integer DEFAULT false NOT NULL,
	`title` text NOT NULL,
	`locations` text NOT NULL,
	`loc_class` text NOT NULL,
	`multi_city` integer DEFAULT false NOT NULL,
	`remote_us` integer DEFAULT false NOT NULL,
	`is_evergreen` integer DEFAULT false NOT NULL,
	`employment_type` text,
	`content_sha256` text NOT NULL,
	`raw_key` text,
	`page_key` text,
	`jurisdiction` text NOT NULL,
	`range` text NOT NULL,
	`classifier_version` text NOT NULL,
	`classified_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`needs_detail` integer DEFAULT false NOT NULL,
	`detail_fetched_at` text,
	`first_seen_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`last_changed_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`removed_at` text,
	`replacement_of_id` integer,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `postings_board_external_idx` ON `postings` (`board_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `postings_company_open_idx` ON `postings` (`company_id`,`removed_at`);--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`finding_id` integer NOT NULL,
	`actor` text NOT NULL,
	`from_status` text NOT NULL,
	`to_status` text NOT NULL,
	`reason` text,
	`false_positive_reason` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`finding_id`) REFERENCES `findings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `reviews_finding_idx` ON `reviews` (`finding_id`);--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_token` text NOT NULL,
	`submitted_url` text NOT NULL,
	`canonical_url` text,
	`source_type` text NOT NULL,
	`host` text,
	`rejected_domain` text,
	`ats_vendor` text,
	`ats_slug` text,
	`external_id` text,
	`quick_result` text,
	`status` text DEFAULT 'received' NOT NULL,
	`status_message` text,
	`board_id` integer,
	`posting_id` integer,
	`company_id` integer,
	`finding_id` integer,
	`note` text,
	`ip_hash` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`processed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `submissions_token_idx` ON `submissions` (`public_token`);--> statement-breakpoint
CREATE INDEX `submissions_canonical_idx` ON `submissions` (`canonical_url`,`created_at`);--> statement-breakpoint
CREATE INDEX `submissions_status_idx` ON `submissions` (`status`);