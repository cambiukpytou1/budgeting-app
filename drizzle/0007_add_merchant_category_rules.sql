CREATE TABLE `transaction_rules` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `merchant_key` text,
  `description_contains` text,
  `min_amount_cents` integer,
  `max_amount_cents` integer,
  `account_id` integer REFERENCES `accounts`(`id`) ON DELETE SET NULL,
  `category` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `transaction_rules_account_idx` ON `transaction_rules` (`account_id`);
