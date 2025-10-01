CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`accountId` text NOT NULL,
	`providerId` text NOT NULL,
	`userId` text NOT NULL,
	`accessToken` text,
	`refreshToken` text,
	`idToken` text,
	`accessTokenExpiresAt` integer,
	`refreshTokenExpiresAt` integer,
	`scope` text,
	`password` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `app_user` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`better_auth_user_id` text NOT NULL,
	`first_name` text,
	`last_name` text,
	`subscription` text DEFAULT 'free_plan',
	`token_quota` integer DEFAULT 0,
	`tokens_used` integer DEFAULT 0,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
	FOREIGN KEY (`better_auth_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_user_better_auth_user_id_unique` ON `app_user` (`better_auth_user_id`);--> statement-breakpoint
CREATE INDEX `idx_app_user_better_auth_user_id` ON `app_user` (`better_auth_user_id`);--> statement-breakpoint
CREATE TABLE `entitlements` (
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`plan_id` text,
	`max_concurrent_sessions` integer DEFAULT 1,
	`rate_limit_rpm` integer DEFAULT 60,
	`features` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
	PRIMARY KEY(`subject_type`, `subject_id`),
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`plan_id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `plans` (
	`plan_id` text PRIMARY KEY NOT NULL,
	`monthly_quota_tokens` integer NOT NULL,
	`price_cents` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
--> statement-breakpoint
CREATE TABLE `processed_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expiresAt` integer NOT NULL,
	`token` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`ipAddress` text,
	`userAgent` text,
	`userId` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE TABLE `usage_logs` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`endpoint` text,
	`method` text,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`adjusted_input_tokens` integer,
	`adjusted_output_tokens` integer,
	`adjusted_total_tokens` integer,
	`input_ratio` real,
	`output_ratio` real,
	`modality` text,
	`session_id` text,
	`request_id` text,
	`response_id` text,
	`event_type` text,
	`ledger_id` text,
	`metadata` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
	FOREIGN KEY (`ledger_id`) REFERENCES `wallet_ledger`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_usage_logs_subject` ON `usage_logs` (`subject_type`,`subject_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_usage_logs_provider` ON `usage_logs` (`provider`);--> statement-breakpoint
CREATE INDEX `idx_usage_logs_model` ON `usage_logs` (`model`);--> statement-breakpoint
CREATE INDEX `idx_usage_logs_session_id` ON `usage_logs` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_usage_logs_event_type` ON `usage_logs` (`event_type`);--> statement-breakpoint
CREATE INDEX `idx_usage_logs_created_at` ON `usage_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_usage_logs_modality` ON `usage_logs` (`modality`);--> statement-breakpoint
CREATE INDEX `idx_usage_logs_ledger_id` ON `usage_logs` (`ledger_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`emailVerified` integer NOT NULL,
	`image` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`createdAt` integer,
	`updatedAt` integer
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
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
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
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
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
	`createdAt` integer DEFAULT (unixepoch()),
	`updatedAt` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_logs_event_id_unique` ON `webhook_logs` (`event_id`);--> statement-breakpoint
CREATE INDEX `idx_webhook_logs_event_id` ON `webhook_logs` (`event_id`);--> statement-breakpoint
CREATE INDEX `idx_webhook_logs_event_type` ON `webhook_logs` (`event_type`);--> statement-breakpoint
CREATE INDEX `idx_webhook_logs_user_id` ON `webhook_logs` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_webhook_logs_created_at` ON `webhook_logs` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_webhook_logs_processing_status` ON `webhook_logs` (`processing_status`);--> statement-breakpoint
CREATE INDEX `idx_webhook_logs_processed_at` ON `webhook_logs` (`processed_at`);