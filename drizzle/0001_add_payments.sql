CREATE TABLE IF NOT EXISTS `payments` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `amount_cents` integer NOT NULL,
  `currency` text DEFAULT 'USD' NOT NULL,
  `status` text DEFAULT 'paid' NOT NULL,
  `note` text DEFAULT '' NOT NULL,
  `paid_at` integer NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_payments_paid_at` ON `payments` (`paid_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_payments_user_paid_at` ON `payments` (`user_id`,`paid_at`);
