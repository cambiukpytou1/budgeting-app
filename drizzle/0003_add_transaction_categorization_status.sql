ALTER TABLE `transactions` ADD `categorization_status` text NOT NULL DEFAULT 'pending';
--> statement-breakpoint
ALTER TABLE `transactions` ADD `category_confidence` integer;
--> statement-breakpoint
UPDATE `transactions`
SET `categorization_status` = CASE
  WHEN `reviewed` = 1 THEN 'manual'
  ELSE 'pending'
END;
