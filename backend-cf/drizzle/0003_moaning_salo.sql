DROP TABLE `entitlements`;--> statement-breakpoint
DROP TABLE `plans`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_wallet_ledger` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`amount_tokens` integer NOT NULL,
	`event_type` text NOT NULL,
	`reference_type` text,
	`reference_id` text,
	`external_event_id` text,
	`description` text,
	`metadata` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_wallet_ledger`("id", "subject_type", "subject_id", "amount_tokens", "event_type", "reference_type", "reference_id", "external_event_id", "description", "metadata", "created_at") SELECT "id", "subject_type", "subject_id", "amount_tokens", "event_type", "reference_type", "reference_id", "external_event_id", "description", "metadata", "created_at" FROM `wallet_ledger`;--> statement-breakpoint
DROP TABLE `wallet_ledger`;--> statement-breakpoint
ALTER TABLE `__new_wallet_ledger` RENAME TO `wallet_ledger`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_ledger_subject` ON `wallet_ledger` (`subject_type`,`subject_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_ledger_external` ON `wallet_ledger` (`external_event_id`);--> statement-breakpoint
CREATE INDEX `idx_ledger_event_type` ON `wallet_ledger` (`event_type`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_ledger_reference` ON `wallet_ledger` (`reference_type`,`reference_id`);