ALTER TABLE `postings` RENAME COLUMN "jurisdiction" TO "coverage";--> statement-breakpoint
DROP TABLE `jurisdictions`;--> statement-breakpoint
ALTER TABLE `findings` DROP COLUMN `jurisdiction_codes`;