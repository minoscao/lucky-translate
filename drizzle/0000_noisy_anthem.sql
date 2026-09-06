CREATE TABLE `app_config` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cloud_records` (
	`id` text NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`data` text NOT NULL,
	`bytes` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_cloud_records_user_oldest` ON `cloud_records` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `price_history` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`period` text NOT NULL,
	`cache_hit_micros_per_million` integer NOT NULL,
	`input_micros_per_million` integer NOT NULL,
	`output_micros_per_million` integer NOT NULL,
	`effective_at` integer NOT NULL,
	`retired_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_price_history_model_effective` ON `price_history` (`model`,`effective_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_user_expires` ON `sessions` (`user_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `usage_daily` (
	`user_id` text NOT NULL,
	`day` text NOT NULL,
	`tokens` integer DEFAULT 0 NOT NULL,
	`cost_micros` integer DEFAULT 0 NOT NULL,
	`active_seconds` integer DEFAULT 0 NOT NULL,
	`training_seconds` integer DEFAULT 0 NOT NULL,
	`translation_seconds` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `day`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_usage_daily_day` ON `usage_daily` (`day`);--> statement-breakpoint
CREATE TABLE `usage_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`feature` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`cached_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`cost_micros` integer DEFAULT 0 NOT NULL,
	`price_snapshot` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_usage_events_user_created` ON `usage_events` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_usage_events_created` ON `usage_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`email` text,
	`password_hash` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`level` text DEFAULT 'pending' NOT NULL,
	`daily_seconds_limit` integer DEFAULT 0 NOT NULL,
	`monthly_seconds_limit` integer DEFAULT 0 NOT NULL,
	`daily_token_limit` integer DEFAULT 0 NOT NULL,
	`monthly_price_cents` integer DEFAULT 0 NOT NULL,
	`storage_limit_bytes` integer DEFAULT 104857600 NOT NULL,
	`membership_expires_at` integer,
	`admin_note` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_login_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_username` ON `users` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_email` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `idx_users_status` ON `users` (`status`);