import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const accounts = sqliteTable(
  "accounts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    provider: text("provider", { enum: ["manual", "simplefin"] }).notNull().default("manual"),
    externalId: text("external_id"),
    name: text("name").notNull(),
    institution: text("institution"),
    accountType: text("account_type").notNull().default("other"),
    classificationVersion: integer("classification_version").notNull().default(0),
    currency: text("currency").notNull().default("USD"),
    balanceCents: integer("balance_cents").notNull().default(0),
    balanceAt: integer("balance_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [uniqueIndex("accounts_provider_external_unique").on(table.provider, table.externalId)],
);

export const transactions = sqliteTable(
  "transactions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountId: integer("account_id").references(() => accounts.id, { onDelete: "set null" }),
    providerExternalId: text("provider_external_id"),
    postedAt: integer("posted_at", { mode: "timestamp_ms" }).notNull(),
    description: text("description").notNull(),
    payee: text("payee"),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    category: text("category"),
    categorizationStatus: text("categorization_status", { enum: ["pending", "auto", "review", "manual"] }).notNull().default("pending"),
    categoryConfidence: integer("category_confidence"),
    pending: integer("pending", { mode: "boolean" }).notNull().default(false),
    reviewed: integer("reviewed", { mode: "boolean" }).notNull().default(false),
    source: text("source", { enum: ["manual", "simplefin"] }).notNull().default("manual"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("transactions_account_external_unique").on(table.accountId, table.providerExternalId),
    index("transactions_posted_at_idx").on(table.postedAt),
  ],
);

export const accountBalanceSnapshots = sqliteTable(
  "account_balance_snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountId: integer("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    capturedOn: text("captured_on").notNull(),
    balanceCents: integer("balance_cents").notNull(),
    currency: text("currency").notNull(),
    accountType: text("account_type").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("account_balance_snapshots_account_day_unique").on(table.accountId, table.capturedOn),
    index("account_balance_snapshots_day_idx").on(table.capturedOn),
  ],
);

export const budgets = sqliteTable(
  "budgets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    month: text("month").notNull(),
    category: text("category").notNull(),
    amountCents: integer("amount_cents").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [uniqueIndex("budgets_month_category_unique").on(table.month, table.category)],
);

export const savingsGoals = sqliteTable("savings_goals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  targetCents: integer("target_cents").notNull(),
  savedCents: integer("saved_cents").notNull().default(0),
  targetDate: text("target_date"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const transactionSplits = sqliteTable(
  "transaction_splits",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    transactionId: integer("transaction_id").notNull().references(() => transactions.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    amountCents: integer("amount_cents").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [index("transaction_splits_tx_idx").on(table.transactionId)],
);

export const transactionTags = sqliteTable(
  "transaction_tags",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    transactionId: integer("transaction_id").notNull().references(() => transactions.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [uniqueIndex("transaction_tags_tx_tag_unique").on(table.transactionId, table.tag)],
);

export const transactionRules = sqliteTable(
  "transaction_rules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    merchantKey: text("merchant_key"),
    descriptionContains: text("description_contains"),
    minAmountCents: integer("min_amount_cents"),
    maxAmountCents: integer("max_amount_cents"),
    accountId: integer("account_id").references(() => accounts.id, { onDelete: "set null" }),
    category: text("category").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [index("transaction_rules_account_idx").on(table.accountId)],
);

export const appState = sqliteTable("app_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});
