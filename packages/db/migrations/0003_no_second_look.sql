PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_findings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`posting_id` integer NOT NULL,
	`company_id` integer NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'needs_review' NOT NULL,
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
INSERT INTO `__new_findings`("id", "posting_id", "company_id", "type", "status", "review_reasons", "first_raw_key", "first_page_key", "evidence_span", "range_at_detection", "classifier_version", "wayback_url", "wayback_at", "fixed_raw_key", "detected_at", "withdrawn_at", "review_at", "published_at", "rejected_at", "fixed_at", "stale_at", "snoozed_until") SELECT "id", "posting_id", "company_id", "type", "status", "review_reasons", "first_raw_key", "first_page_key", "evidence_span", "range_at_detection", "classifier_version", "wayback_url", "wayback_at", "fixed_raw_key", "detected_at", "withdrawn_at", "review_at", "published_at", "rejected_at", "fixed_at", "stale_at", "snoozed_until" FROM `findings`;--> statement-breakpoint
DROP TABLE `findings`;--> statement-breakpoint
ALTER TABLE `__new_findings` RENAME TO `findings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `findings_posting_type_idx` ON `findings` (`posting_id`,`type`);--> statement-breakpoint
CREATE INDEX `findings_company_status_idx` ON `findings` (`company_id`,`status`);--> statement-breakpoint
UPDATE `findings` SET `status` = 'needs_review', `review_at` = coalesce(`review_at`, `detected_at`) WHERE `status` IN ('detected', 'confirmed');
