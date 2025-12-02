CREATE TABLE `entitlements` (
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`plan_id` text,
	`max_concurrent_sessions` integer DEFAULT 1,
	`rate_limit_rpm` integer DEFAULT 60,
	`features` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`subject_type`, `subject_id`),
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`plan_id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `plans` (
	`plan_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`monthly_quota_tokens` integer NOT NULL,
	`price_cents` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `processed_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wallet_ledger` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`amount_tokens` integer NOT NULL,
	`event_type` text NOT NULL,
	`reference_type` text,
	`reference_id` text,
	`plan_id` text,
	`external_event_id` text,
	`description` text,
	`metadata` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`plan_id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_ledger_subject` ON `wallet_ledger` (`subject_type`,`subject_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_ledger_external` ON `wallet_ledger` (`external_event_id`);--> statement-breakpoint
CREATE INDEX `idx_ledger_event_type` ON `wallet_ledger` (`event_type`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_ledger_reference` ON `wallet_ledger` (`reference_type`,`reference_id`);--> statement-breakpoint
CREATE TABLE `wallets` (
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`balance_tokens` integer DEFAULT 0 NOT NULL,
	`frozen` integer DEFAULT false NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`subject_type`, `subject_id`)
);
--> statement-breakpoint
CREATE TABLE `webhook_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` text NOT NULL,
	`event_type` text NOT NULL,
	`user_id` text,
	`raw_payload` text NOT NULL,
	`headers` text,
	`processed_at` integer,
	`processing_status` text DEFAULT 'pending',
	`error_message` text,
	`retry_count` integer DEFAULT 0,
	`webhook_signature` text,
	`ip_address` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_logs_event_id_unique` ON `webhook_logs` (`event_id`);--> statement-breakpoint
CREATE INDEX `idx_webhook_logs_event_id` ON `webhook_logs` (`event_id`);--> statement-breakpoint
CREATE INDEX `idx_webhook_logs_event_type` ON `webhook_logs` (`event_type`);--> statement-breakpoint
CREATE INDEX `idx_webhook_logs_user_id` ON `webhook_logs` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_webhook_logs_created_at` ON `webhook_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_webhook_logs_processing_status` ON `webhook_logs` (`processing_status`);