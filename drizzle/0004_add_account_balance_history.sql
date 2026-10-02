CREATE TABLE `account_balance_snapshots` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `account_id` integer NOT NULL,
  `captured_on` text NOT NULL,
  `balance_cents` integer NOT NULL,
  `currency` text NOT NULL,
  `account_type` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_balance_snapshots_account_day_unique` ON `account_balance_snapshots` (`account_id`,`captured_on`);
--> statement-breakpoint
CREATE INDEX `account_balance_snapshots_day_idx` ON `account_balance_snapshots` (`captured_on`);
