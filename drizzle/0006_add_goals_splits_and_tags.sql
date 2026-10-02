CREATE TABLE `savings_goals` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `target_cents` integer NOT NULL,
  `saved_cents` integer NOT NULL DEFAULT 0,
  `target_date` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transaction_splits` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `transaction_id` integer NOT NULL REFERENCES `transactions`(`id`) ON DELETE CASCADE,
  `category` text NOT NULL,
  `amount_cents` integer NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `transaction_splits_tx_idx` ON `transaction_splits` (`transaction_id`);
--> statement-breakpoint
CREATE TABLE `transaction_tags` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `transaction_id` integer NOT NULL REFERENCES `transactions`(`id`) ON DELETE CASCADE,
  `tag` text NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transaction_tags_tx_tag_unique` ON `transaction_tags` (`transaction_id`,`tag`);
