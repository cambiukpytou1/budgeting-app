DROP TABLE IF EXISTS entries;
--> statement-breakpoint
CREATE TABLE accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'manual',
  external_id TEXT,
  name TEXT NOT NULL,
  account_type TEXT NOT NULL DEFAULT 'other',
  currency TEXT NOT NULL DEFAULT 'USD',
  balance_cents INTEGER NOT NULL DEFAULT 0,
  balance_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX accounts_provider_external_unique ON accounts(provider, external_id);
--> statement-breakpoint
CREATE TABLE transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  provider_external_id TEXT,
  posted_at INTEGER NOT NULL,
  description TEXT NOT NULL,
  payee TEXT,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  category TEXT,
  pending INTEGER NOT NULL DEFAULT 0,
  reviewed INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX transactions_account_external_unique ON transactions(account_id, provider_external_id);
--> statement-breakpoint
CREATE INDEX transactions_posted_at_idx ON transactions(posted_at);
--> statement-breakpoint
CREATE TABLE budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  month TEXT NOT NULL,
  category TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX budgets_month_category_unique ON budgets(month, category);
--> statement-breakpoint
CREATE TABLE app_state (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);