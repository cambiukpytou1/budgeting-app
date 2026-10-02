import { defineAction, z, type ActionsModule, type Ctx } from "@hatch/space-sdk";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import * as schema from "./schema";

const categoryNames = [
  "Housing",
  "Mortgage & rent",
  "Home maintenance",
  "Home improvement",
  "Home supplies",
  "Food & dining",
  "Groceries",
  "Restaurants & bars",
  "Coffee shops",
  "Transportation",
  "Gas & fuel",
  "Auto payment",
  "Auto maintenance",
  "Parking & tolls",
  "Public transit",
  "Rideshare & taxi",
  "Shopping",
  "Clothing",
  "Electronics",
  "Bills & utilities",
  "Phone & internet",
  "Electric & gas",
  "Water & sewer",
  "Insurance",
  "Health",
  "Medical",
  "Pharmacy",
  "Fitness",
  "Personal care",
  "Entertainment",
  "Movies & events",
  "Subscriptions",
  "Travel",
  "Hotels",
  "Flights",
  "Education",
  "Childcare",
  "Pets",
  "Gifts",
  "Donations",
  "Taxes",
  "Bank fees",
  "Professional services",
  "Business expenses",
  "Debt payments",
  "ATM & cash",
  "Income",
  "Transfer",
  "Other",
] as const;

function normalizeRuleText(value: string): string {
  return value.trim().toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

type RuleCondition = {
  merchantKey: string | null;
  descriptionContains: string | null;
  minAmountCents: number | null;
  maxAmountCents: number | null;
  accountId: number | null;
};

type RuleTransaction = {
  description: string;
  payee: string | null;
  amountCents: number;
  accountId: number | null;
};

function transactionMatchesRule(transaction: RuleTransaction, rule: RuleCondition): boolean {
  const merchant = normalizeRuleText(transaction.payee ?? transaction.description);
  const searchable = normalizeRuleText(`${transaction.payee ?? ""} ${transaction.description}`);
  const amount = Math.abs(transaction.amountCents);
  if (rule.merchantKey && merchant !== rule.merchantKey) return false;
  if (rule.descriptionContains && !searchable.includes(rule.descriptionContains)) return false;
  if (rule.minAmountCents !== null && amount < rule.minAmountCents) return false;
  if (rule.maxAmountCents !== null && amount > rule.maxAmountCents) return false;
  if (rule.accountId !== null && transaction.accountId !== rule.accountId) return false;
  return true;
}

async function applyTransactionRule(ctx: Ctx, rule: RuleCondition & { category: string }): Promise<number> {
  const db = ctx.db<typeof schema>();
  const [rows, accountRows] = await Promise.all([
    db.select({
      id: schema.transactions.id,
      description: schema.transactions.description,
      payee: schema.transactions.payee,
      amountCents: schema.transactions.amountCents,
      accountId: schema.transactions.accountId,
      status: schema.transactions.categorizationStatus,
    }).from(schema.transactions),
    db.select({ id: schema.accounts.id, accountType: schema.accounts.accountType }).from(schema.accounts),
  ]);
  const investmentAccountIds = new Set(accountRows.filter((account) => account.accountType === "investment").map((account) => account.id));
  const matches = rows.filter((row) => row.status !== "manual" && (row.accountId === null || !investmentAccountIds.has(row.accountId)) && transactionMatchesRule(row, rule));
  const now = new Date();
  for (const row of matches) {
    await db.update(schema.transactions).set({ category: rule.category, categorizationStatus: "auto", categoryConfidence: 100, reviewed: true, updatedAt: now }).where(eq(schema.transactions.id, row.id));
  }
  return matches.length;
}

const accountResponse = z.object({
  id: z.number(),
  name: z.string(),
  institution: z.string().nullable(),
  provider: z.string(),
  account_type: z.string(),
  classification_version: z.number(),
  currency: z.string(),
  balance_cents: z.number(),
  balance_at: z.string().nullable(),
  balance_history: z.array(z.object({ date: z.string(), balance_cents: z.number() })),
});

const transactionResponse = z.object({
  id: z.number(),
  account_id: z.number().nullable(),
  account_name: z.string().nullable(),
  account_institution: z.string().nullable(),
  account_type: z.string().nullable(),
  posted_at: z.string(),
  description: z.string(),
  payee: z.string().nullable(),
  amount_cents: z.number(),
  currency: z.string(),
  category: z.string().nullable(),
  pending: z.boolean(),
  reviewed: z.boolean(),
  categorization_status: z.enum(["pending", "auto", "review", "manual"]),
  category_confidence: z.number().nullable(),
  source: z.string(),
  tags: z.array(z.string()),
  splits: z.array(z.object({ category: z.string(), amount_cents: z.number() })),
});

const categorizationResponse = z.object({
  transactions: z.array(z.object({
    id: z.number().int().positive(),
    category: z.enum(categoryNames),
    confidence: z.number().min(0).max(1),
  })),
  accounts: z.array(z.object({
    id: z.number().int().positive(),
    type: z.enum(["checking", "savings", "cash", "credit", "investment", "loan", "other"]),
    confidence: z.number().min(0).max(1),
  })),
});

function safeError(error: unknown): string {
  if (error instanceof Error) {
    if (/timeout|aborted/i.test(error.message)) return "SimpleFIN took too long to respond. Generate a fresh setup token and try again.";
    if (/403|401/.test(error.message)) return "That setup token was rejected or already used. Generate a fresh token in SimpleFIN Bridge.";
  }
  return "SimpleFIN could not complete the import. No connection secret was saved; generate a fresh token and try again.";
}

function validSimpleFinUrl(value: string, requireCredentials: boolean): URL | null {
  try {
    const url = new URL(value);
    const hostOk = url.hostname === "simplefin.org" || url.hostname.endsWith(".simplefin.org");
    if (url.protocol !== "https:" || !hostOk) return null;
    if (requireCredentials && (!url.username || !url.password)) return null;
    if (!requireCredentials && (url.username || url.password || url.hash || url.search)) return null;
    return url;
  } catch {
    return null;
  }
}

const simpleFinTransaction = z.object({
  id: z.union([z.string(), z.number()]),
  posted: z.number(),
  amount: z.union([z.string(), z.number()]),
  description: z.string().optional().default("Transaction"),
  payee: z.string().nullable().optional(),
  pending: z.boolean().optional().default(false),
});

const simpleFinPayload = z.object({
  accounts: z.array(
    z.object({
      id: z.union([z.string(), z.number()]),
      name: z.string(),
      currency: z.string().optional().default("USD"),
      balance: z.union([z.string(), z.number()]),
      "balance-date": z.number().optional(),
      conn_id: z.string().optional(),
      org: z.object({ name: z.string().optional() }).optional(),
      transactions: z.array(simpleFinTransaction).optional().default([]),
    }),
  ),
  connections: z.array(z.object({ conn_id: z.string(), name: z.string().optional(), org_id: z.string().optional() })).optional().default([]),
  errors: z.array(z.unknown()).optional(),
  errlist: z.array(z.unknown()).optional(),
});

const syncResponse = z.object({
  ok: z.boolean(),
  message: z.string(),
  account_count: z.number(),
  transaction_count: z.number(),
  provider_errors: z.array(z.string()),
  needs_setup: z.boolean(),
});

type SyncResult = z.infer<typeof syncResponse>;

async function clearStoredSimpleFinAccess(ctx: Ctx) {
  const db = ctx.db<typeof schema>();
  await db.delete(schema.appState).where(eq(schema.appState.key, "simplefin_access_url"));
}

async function syncSimpleFin(ctx: Ctx, storedAccessUrl: string): Promise<SyncResult> {
  try {
    const accessUrl = validSimpleFinUrl(storedAccessUrl, true);
    if (!accessUrl) {
      await clearStoredSimpleFinAccess(ctx);
      return { ok: false, message: "Your saved SimpleFIN connection is no longer valid. Connect again with a new setup token.", account_count: 0, transaction_count: 0, provider_errors: [], needs_setup: true };
    }
    const username = decodeURIComponent(accessUrl.username);
    const password = decodeURIComponent(accessUrl.password);
    accessUrl.username = "";
    accessUrl.password = "";
    accessUrl.search = "";
    accessUrl.hash = "";
    accessUrl.pathname = `${accessUrl.pathname.replace(/\/$/, "")}/accounts`;
    const endSeconds = Math.floor(Date.now() / 1000) + 86_400;
    const startSeconds = endSeconds - 90 * 86_400;
    accessUrl.searchParams.set("version", "2");
    accessUrl.searchParams.set("start-date", String(startSeconds));
    accessUrl.searchParams.set("end-date", String(endSeconds));
    accessUrl.searchParams.set("pending", "1");
    const dataController = new AbortController();
    const dataTimer = setTimeout(() => dataController.abort(), 45_000);
    const response = await fetch(accessUrl, { headers: { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` }, redirect: "error", signal: dataController.signal });
    clearTimeout(dataTimer);
    if (response.status === 401 || response.status === 403) {
      await clearStoredSimpleFinAccess(ctx);
      return { ok: false, message: "Your SimpleFIN connection was revoked or expired. Connect again with a new setup token.", account_count: 0, transaction_count: 0, provider_errors: [], needs_setup: true };
    }
    if (!response.ok) return { ok: false, message: `SimpleFIN returned ${response.status}. Your saved connection is still available; try refreshing again.`, account_count: 0, transaction_count: 0, provider_errors: [], needs_setup: false };
    const length = Number(response.headers.get("content-length") ?? "0");
    if (length > 10_000_000) return { ok: false, message: "SimpleFIN returned more data than can be safely imported at once.", account_count: 0, transaction_count: 0, provider_errors: [], needs_setup: false };
    const rawText = await response.text();
    if (rawText.length > 10_000_000) return { ok: false, message: "SimpleFIN returned more data than can be safely imported at once.", account_count: 0, transaction_count: 0, provider_errors: [], needs_setup: false };
    const parsedJson: unknown = JSON.parse(rawText);
    const parsed = simpleFinPayload.safeParse(parsedJson);
    if (!parsed.success) return { ok: false, message: "SimpleFIN returned account data this app could not read. Your saved connection is still available.", account_count: 0, transaction_count: 0, provider_errors: [], needs_setup: false };
    const db = ctx.db<typeof schema>();
    const now = new Date();
    const transactionRules = await db.select().from(schema.transactionRules).orderBy(schema.transactionRules.createdAt);
    const connectionsById = new Map(parsed.data.connections.map((connection) => [connection.conn_id, connection]));
    let importedTransactions = 0;
    for (const account of parsed.data.accounts) {
      const externalId = String(account.id);
      const balance = Number(account.balance);
      if (!Number.isFinite(balance)) continue;
      const connection = account.conn_id ? connectionsById.get(account.conn_id) : undefined;
      const institution = account.org?.name?.trim() || connection?.name?.trim() || connection?.org_id?.trim() || null;
      await db.insert(schema.accounts).values({ provider: "simplefin", externalId, name: account.name, institution, accountType: "bank", currency: account.currency || "USD", balanceCents: Math.round(balance * 100), balanceAt: new Date((account["balance-date"] ?? Math.floor(Date.now() / 1000)) * 1000), createdAt: now, updatedAt: now }).onConflictDoUpdate({ target: [schema.accounts.provider, schema.accounts.externalId], set: { name: account.name, institution, currency: account.currency || "USD", balanceCents: Math.round(balance * 100), balanceAt: new Date((account["balance-date"] ?? Math.floor(Date.now() / 1000)) * 1000), updatedAt: now } });
      const accountRows = await db.select({ id: schema.accounts.id, accountType: schema.accounts.accountType }).from(schema.accounts).where(and(eq(schema.accounts.provider, "simplefin"), eq(schema.accounts.externalId, externalId))).limit(1);
      const localAccount = accountRows[0];
      if (!localAccount) continue;
      await db.insert(schema.accountBalanceSnapshots).values({ accountId: localAccount.id, capturedOn: now.toISOString().slice(0, 10), balanceCents: Math.round(balance * 100), currency: account.currency || "USD", accountType: localAccount.accountType, createdAt: now }).onConflictDoUpdate({ target: [schema.accountBalanceSnapshots.accountId, schema.accountBalanceSnapshots.capturedOn], set: { balanceCents: Math.round(balance * 100), currency: account.currency || "USD", accountType: localAccount.accountType } });
      for (const tx of account.transactions) {
        const amount = Number(tx.amount);
        if (!Number.isFinite(amount) || !Number.isFinite(tx.posted)) continue;
        const providerExternalId = String(tx.id);
        const transactionDraft = { accountId: localAccount.id, description: tx.description || tx.payee || "Transaction", payee: tx.payee ?? null, amountCents: Math.round(amount * 100) };
        const matchingRule = transactionRules.find((rule) => transactionMatchesRule(transactionDraft, rule));
        await db.insert(schema.transactions).values({ accountId: localAccount.id, providerExternalId, postedAt: new Date(tx.posted * 1000), description: transactionDraft.description, payee: transactionDraft.payee, amountCents: transactionDraft.amountCents, currency: account.currency || "USD", pending: tx.pending, category: matchingRule?.category ?? null, categorizationStatus: matchingRule ? "auto" : "pending", categoryConfidence: matchingRule ? 100 : null, reviewed: Boolean(matchingRule), source: "simplefin", createdAt: now, updatedAt: now }).onConflictDoUpdate({ target: [schema.transactions.accountId, schema.transactions.providerExternalId], set: { postedAt: new Date(tx.posted * 1000), description: transactionDraft.description, payee: transactionDraft.payee, amountCents: transactionDraft.amountCents, pending: tx.pending, updatedAt: now } });
        importedTransactions += 1;
      }
    }
    await db.insert(schema.appState).values({ key: "last_simplefin_sync_at", value: now.toISOString(), updatedAt: now }).onConflictDoUpdate({ target: schema.appState.key, set: { value: now.toISOString(), updatedAt: now } });
    const providerErrors = [...(parsed.data.errors ?? []), ...(parsed.data.errlist ?? [])].slice(0, 5).map((value) => typeof value === "string" ? value : JSON.stringify(value));
    ctx.invalidateQueries();
    return { ok: true, message: `Synced ${importedTransactions} transaction${importedTransactions === 1 ? "" : "s"} from SimpleFIN.`, account_count: parsed.data.accounts.length, transaction_count: importedTransactions, provider_errors: providerErrors, needs_setup: false };
  } catch (error) {
    return { ok: false, message: safeError(error), account_count: 0, transaction_count: 0, provider_errors: [], needs_setup: false };
  }
}

export const Actions = {
  getDashboard: defineAction({
    request: z.object({
      month: z.string().regex(/^\d{4}-\d{2}$/),
      start_ms: z.number().int(),
      end_ms: z.number().int(),
    }),
    response: z.object({
      accounts: z.array(accountResponse),
      transaction_count: z.number(),
      summary_currency: z.string(),
      has_mixed_currency: z.boolean(),
      income_cents: z.number(),
      spent_cents: z.number(),
      budget_cents: z.number(),
      available_cents: z.number(),
      needs_review: z.number(),
      asset_cents: z.number(),
      liability_cents: z.number(),
      net_worth_cents: z.number(),
      net_worth_daily: z.array(z.object({ date: z.string(), net_worth_cents: z.number() })),
      monthly_history: z.array(z.object({ month: z.string(), income_cents: z.number(), spent_cents: z.number(), net_cents: z.number() })),
      last_sync_at: z.string().nullable(),
      simplefin_connected: z.boolean(),
      refresh_due: z.boolean(),
      categories: z.array(z.object({ category: z.string(), spent_cents: z.number(), budget_cents: z.number() })),
      daily: z.array(z.object({ date: z.string(), income_cents: z.number(), spent_cents: z.number() })),
      previous_daily: z.array(z.object({ date: z.string(), income_cents: z.number(), spent_cents: z.number() })),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const selectedStart = new Date(args.start_ms);
      const historyStart = new Date(selectedStart.getFullYear(), selectedStart.getMonth() - 5, 1);
      const [accounts, txRows, historyRows, budgetRows, stateRows, snapshotRows] = await Promise.all([
        db.select().from(schema.accounts).orderBy(schema.accounts.name),
        db.select().from(schema.transactions).where(and(gte(schema.transactions.postedAt, selectedStart), lt(schema.transactions.postedAt, new Date(args.end_ms)))).orderBy(desc(schema.transactions.postedAt)),
        db.select().from(schema.transactions).where(and(gte(schema.transactions.postedAt, historyStart), lt(schema.transactions.postedAt, new Date(args.end_ms)))).orderBy(schema.transactions.postedAt),
        db.select().from(schema.budgets).where(eq(schema.budgets.month, args.month)),
        db.select().from(schema.appState),
        db.select().from(schema.accountBalanceSnapshots).orderBy(schema.accountBalanceSnapshots.capturedOn),
      ]);
      const investmentAccountIds = new Set(accounts.filter((account) => account.accountType === "investment").map((account) => account.id));
      const cashFlowTxRows = txRows.filter((row) => row.accountId === null || !investmentAccountIds.has(row.accountId));
      const cashFlowHistoryRows = historyRows.filter((row) => row.accountId === null || !investmentAccountIds.has(row.accountId));
      const currencies = [...new Set(accounts.map((row) => row.currency))];
      const summaryCurrency = currencies.includes("USD") ? "USD" : (currencies[0] ?? "USD");
      const budgetByCategory = new Map(budgetRows.map((row) => [row.category, row.amountCents]));
      const spentByCategory = new Map<string, number>();
      const spentByDay = new Map<string, number>();
      const incomeByDay = new Map<string, number>();
      let income = 0;
      let spent = 0;
      let needsReview = 0;
      for (const row of cashFlowTxRows) {
        if (!row.reviewed) needsReview += 1;
        if (row.currency !== summaryCurrency || row.category === "Transfer") continue;
        const day = row.postedAt.toISOString().slice(0, 10);
        if (row.amountCents > 0) {
          income += row.amountCents;
          incomeByDay.set(day, (incomeByDay.get(day) ?? 0) + row.amountCents);
        }
        if (row.amountCents < 0) {
          const outflow = Math.abs(row.amountCents);
          spent += outflow;
          const category = row.category ?? "Uncategorized";
          spentByCategory.set(category, (spentByCategory.get(category) ?? 0) + outflow);
          spentByDay.set(day, (spentByDay.get(day) ?? 0) + outflow);
        }
      }
      const categorySet = new Set([...budgetByCategory.keys(), ...spentByCategory.keys()]);
      const categories = [...categorySet]
        .map((category) => ({ category, spent_cents: spentByCategory.get(category) ?? 0, budget_cents: budgetByCategory.get(category) ?? 0 }))
        .sort((a, b) => b.spent_cents - a.spent_cents || a.category.localeCompare(b.category));
      const lastSync = stateRows.find((row) => row.key === "last_simplefin_sync_at")?.value ?? null;
      const lastSyncMs = lastSync ? Date.parse(lastSync) : Number.NaN;
      const summarizeBalances = (rows: Array<{ balanceCents: number; currency: string; accountType: string }>) => {
        let assets = 0;
        let liabilities = 0;
        for (const row of rows) {
          if (row.currency !== summaryCurrency) continue;
          if (row.accountType === "cash" || row.accountType === "checking" || row.accountType === "savings" || row.accountType === "investment") assets += row.balanceCents;
          else if (row.accountType === "credit" || row.accountType === "loan") liabilities += Math.abs(row.balanceCents);
          else if (row.balanceCents >= 0) assets += row.balanceCents;
          else liabilities += Math.abs(row.balanceCents);
        }
        return { assets, liabilities, netWorth: assets - liabilities };
      };
      const currentWorth = summarizeBalances(accounts);
      const snapshotsByDay = new Map<string, Array<(typeof snapshotRows)[number]>>();
      for (const row of snapshotRows) {
        const dayRows = snapshotsByDay.get(row.capturedOn) ?? [];
        dayRows.push(row);
        snapshotsByDay.set(row.capturedOn, dayRows);
      }
      const netWorthDaily = [...snapshotsByDay.entries()].map(([date, rows]) => ({ date, net_worth_cents: summarizeBalances(rows).netWorth })).sort((a, b) => a.date.localeCompare(b.date));
      const historyByMonth = new Map<string, { income: number; spent: number }>();
      const previousMonthKey = `${new Date(selectedStart.getFullYear(), selectedStart.getMonth() - 1, 1).getFullYear()}-${String(new Date(selectedStart.getFullYear(), selectedStart.getMonth() - 1, 1).getMonth() + 1).padStart(2, "0")}`;
      const previousSpentByDay = new Map<string, number>();
      const previousIncomeByDay = new Map<string, number>();
      for (let offset = 0; offset < 6; offset += 1) {
        const cursor = new Date(selectedStart.getFullYear(), selectedStart.getMonth() - 5 + offset, 1);
        historyByMonth.set(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`, { income: 0, spent: 0 });
      }
      for (const row of cashFlowHistoryRows) {
        if (row.currency !== summaryCurrency || row.category === "Transfer") continue;
        const key = `${row.postedAt.getFullYear()}-${String(row.postedAt.getMonth() + 1).padStart(2, "0")}`;
        const current = historyByMonth.get(key);
        if (!current) continue;
        const day = row.postedAt.toISOString().slice(0, 10);
        if (row.amountCents > 0) {
          current.income += row.amountCents;
          if (key === previousMonthKey) previousIncomeByDay.set(day, (previousIncomeByDay.get(day) ?? 0) + row.amountCents);
        }
        if (row.amountCents < 0) {
          const outflow = Math.abs(row.amountCents);
          current.spent += outflow;
          if (key === previousMonthKey) previousSpentByDay.set(day, (previousSpentByDay.get(day) ?? 0) + outflow);
        }
      }
      const monthlyHistory = [...historyByMonth.entries()].map(([month, value]) => ({ month, income_cents: value.income, spent_cents: value.spent, net_cents: value.income - value.spent }));
      const historyByAccount = new Map<number, Array<{ date: string; balance_cents: number }>>();
      for (const row of snapshotRows) {
        const history = historyByAccount.get(row.accountId) ?? [];
        history.push({ date: row.capturedOn, balance_cents: row.balanceCents });
        historyByAccount.set(row.accountId, history);
      }
      return {
        accounts: accounts.map((row) => ({ id: row.id, name: row.name, institution: row.institution, provider: row.provider, account_type: row.accountType, classification_version: row.classificationVersion, currency: row.currency, balance_cents: row.balanceCents, balance_at: row.balanceAt?.toISOString() ?? null, balance_history: historyByAccount.get(row.id) ?? [] })),
        transaction_count: cashFlowTxRows.length,
        summary_currency: summaryCurrency,
        has_mixed_currency: currencies.length > 1,
        income_cents: income,
        spent_cents: spent,
        budget_cents: budgetRows.reduce((sum, row) => sum + row.amountCents, 0),
        available_cents: income - spent,
        needs_review: needsReview,
        asset_cents: currentWorth.assets,
        liability_cents: currentWorth.liabilities,
        net_worth_cents: currentWorth.netWorth,
        net_worth_daily: netWorthDaily,
        monthly_history: monthlyHistory,
        last_sync_at: lastSync,
        simplefin_connected: stateRows.some((row) => row.key === "simplefin_access_url"),
        refresh_due: !Number.isFinite(lastSyncMs) || Date.now() - lastSyncMs > 36 * 60 * 60 * 1000,
        categories,
        daily: [...new Set([...spentByDay.keys(), ...incomeByDay.keys()])].map((date) => ({ date, spent_cents: spentByDay.get(date) ?? 0, income_cents: incomeByDay.get(date) ?? 0 })).sort((a, b) => a.date.localeCompare(b.date)),
        previous_daily: [...new Set([...previousSpentByDay.keys(), ...previousIncomeByDay.keys()])].map((date) => ({ date, spent_cents: previousSpentByDay.get(date) ?? 0, income_cents: previousIncomeByDay.get(date) ?? 0 })).sort((a, b) => a.date.localeCompare(b.date)),
      };
    },
  }),

  listTransactions: defineAction({
    request: z.object({ limit: z.number().int().positive().max(1000).default(500) }),
    response: z.object({ transactions: z.array(transactionResponse) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const rows = await db.select({ tx: schema.transactions, accountName: schema.accounts.name, accountInstitution: schema.accounts.institution, accountType: schema.accounts.accountType }).from(schema.transactions).leftJoin(schema.accounts, eq(schema.transactions.accountId, schema.accounts.id)).orderBy(desc(schema.transactions.postedAt), desc(schema.transactions.id)).limit(args.limit);
      const ids = new Set(rows.map(({ tx }) => tx.id));
      const [allTags, allSplits] = await Promise.all([db.select().from(schema.transactionTags), db.select().from(schema.transactionSplits)]);
      const tagsById = new Map<number, string[]>();
      const splitsById = new Map<number, Array<{ category: string; amount_cents: number }>>();
      for (const tag of allTags) {
        if (!ids.has(tag.transactionId)) continue;
        const existing = tagsById.get(tag.transactionId) ?? [];
        existing.push(tag.tag);
        tagsById.set(tag.transactionId, existing);
      }
      for (const split of allSplits) {
        if (!ids.has(split.transactionId)) continue;
        const existing = splitsById.get(split.transactionId) ?? [];
        existing.push({ category: split.category, amount_cents: split.amountCents });
        splitsById.set(split.transactionId, existing);
      }
      return { transactions: rows.map(({ tx, accountName, accountInstitution, accountType }) => ({ id: tx.id, account_id: tx.accountId, account_name: accountName ?? null, account_institution: accountInstitution ?? null, account_type: accountType ?? null, posted_at: tx.postedAt.toISOString(), description: tx.description, payee: tx.payee, amount_cents: tx.amountCents, currency: tx.currency, category: tx.category, pending: tx.pending, reviewed: tx.reviewed, categorization_status: tx.categorizationStatus, category_confidence: tx.categoryConfidence, source: tx.source, tags: tagsById.get(tx.id) ?? [], splits: splitsById.get(tx.id) ?? [] })) };
    },
  }),

  autoOrganizeFinancialData: defineAction({
    request: z.object({ limit: z.number().int().positive().max(600).default(500) }),
    response: z.object({ categorized_count: z.number(), review_count: z.number(), accounts_organized: z.number(), has_more: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const [pendingTransactions, allAccounts, transactionRules] = await Promise.all([
        db.select({
          id: schema.transactions.id,
          description: schema.transactions.description,
          payee: schema.transactions.payee,
          amountCents: schema.transactions.amountCents,
          accountId: schema.transactions.accountId,
        }).from(schema.transactions).where(eq(schema.transactions.categorizationStatus, "pending")).orderBy(desc(schema.transactions.postedAt)).limit(args.limit),
        db.select({ id: schema.accounts.id, name: schema.accounts.name, currentType: schema.accounts.accountType, classificationVersion: schema.accounts.classificationVersion }).from(schema.accounts),
        db.select().from(schema.transactionRules).orderBy(schema.transactionRules.createdAt),
      ]);
      const accountsToOrganize = allAccounts.filter((account) => account.classificationVersion < 2);
      const knownInvestmentAccountIds = new Set(allAccounts.filter((account) => account.currentType === "investment").map((account) => account.id));
      const knownInvestmentTransactions = pendingTransactions.filter((transaction) => transaction.accountId !== null && knownInvestmentAccountIds.has(transaction.accountId));
      for (const transaction of knownInvestmentTransactions) {
        await db.update(schema.transactions).set({ categorizationStatus: "auto", reviewed: true, updatedAt: new Date() }).where(eq(schema.transactions.id, transaction.id));
      }
      const ruleMatchById = new Map<number, (typeof transactionRules)[number]>();
      for (const transaction of pendingTransactions) {
        if (transaction.accountId !== null && knownInvestmentAccountIds.has(transaction.accountId)) continue;
        const match = transactionRules.find((rule) => transactionMatchesRule(transaction, rule));
        if (match) ruleMatchById.set(transaction.id, match);
      }
      const transactionsForInference = pendingTransactions.filter((transaction) => (transaction.accountId === null || !knownInvestmentAccountIds.has(transaction.accountId)) && !ruleMatchById.has(transaction.id));
      if (transactionsForInference.length === 0 && accountsToOrganize.length === 0 && ruleMatchById.size === 0) {
        ctx.invalidateQueries();
        return { categorized_count: 0, review_count: 0, accounts_organized: 0, has_more: false };
      }
      const accountNameById = new Map(allAccounts.map((account) => [account.id, account.name]));
      const result = transactionsForInference.length > 0 || accountsToOrganize.length > 0 ? await ctx.inference.complete(
        `Classify these financial records conservatively. For transactions, choose exactly one allowed category. Confidence means how obvious the classification is from the merchant or description: use 0.82 or higher only when a typical reviewer would be unlikely to disagree. Transfers, checks, ambiguous abbreviations, generic payment descriptions, and unfamiliar merchants should have lower confidence. Positive amounts are usually Income or Transfer, but use context. For accounts, classify ordinary checking accounts as checking, savings accounts as savings, cash-management or money-market accounts as cash, credit cards or revolving credit lines as credit, brokerage/retirement/securities as investment, mortgages and installment debt as loan, and other when unclear.\n\nTransactions:\n${JSON.stringify(transactionsForInference.map((row) => ({ id: row.id, description: row.description, payee: row.payee, amount_cents: row.amountCents, account: row.accountId ? accountNameById.get(row.accountId) ?? null : null })))}\n\nAccounts:\n${JSON.stringify(accountsToOrganize.map((account) => ({ id: account.id, name: account.name })))}`,
        { schema: categorizationResponse },
      ) : { transactions: [], accounts: [] };
      const transactionById = new Map(result.transactions.map((item) => [item.id, item]));
      const accountById = new Map(result.accounts.map((item) => [item.id, item]));
      const inferredInvestmentAccountIds = new Set(result.accounts.filter((item) => item.type === "investment" && item.confidence >= 0.65).map((item) => item.id));
      let categorizedCount = ruleMatchById.size;
      let reviewCount = 0;
      const now = new Date();
      for (const [id, rule] of ruleMatchById) {
        await db.update(schema.transactions).set({ category: rule.category, categorizationStatus: "auto", categoryConfidence: 100, reviewed: true, updatedAt: now }).where(eq(schema.transactions.id, id));
      }
      for (const row of transactionsForInference) {
        const classification = transactionById.get(row.id);
        const confidence = classification ? Math.round(classification.confidence * 100) : null;
        const isInvestmentActivity = row.accountId !== null && inferredInvestmentAccountIds.has(row.accountId);
        const isObvious = isInvestmentActivity || (classification !== undefined && classification.confidence >= 0.82);
        await db.update(schema.transactions).set({
          category: classification?.category ?? null,
          categorizationStatus: isObvious ? "auto" : "review",
          categoryConfidence: confidence,
          reviewed: isObvious,
          updatedAt: now,
        }).where(eq(schema.transactions.id, row.id));
        if (isInvestmentActivity) continue;
        if (isObvious) categorizedCount += 1;
        else reviewCount += 1;
      }
      let accountsOrganized = 0;
      for (const account of accountsToOrganize) {
        const classification = accountById.get(account.id);
        const accountType = classification && classification.confidence >= 0.65 ? classification.type : "other";
        await db.update(schema.accounts).set({ accountType, classificationVersion: 2, updatedAt: now }).where(eq(schema.accounts.id, account.id));
        await db.update(schema.accountBalanceSnapshots).set({ accountType }).where(and(eq(schema.accountBalanceSnapshots.accountId, account.id), eq(schema.accountBalanceSnapshots.capturedOn, now.toISOString().slice(0, 10))));
        accountsOrganized += 1;
      }
      ctx.invalidateQueries();
      return { categorized_count: categorizedCount, review_count: reviewCount, accounts_organized: accountsOrganized, has_more: pendingTransactions.length === args.limit };
    },
  }),

  listTransactionRules: defineAction({
    request: z.object({}),
    response: z.object({
      rules: z.array(z.object({
        id: z.number(),
        name: z.string(),
        merchant: z.string().nullable(),
        description_contains: z.string().nullable(),
        min_amount_cents: z.number().nullable(),
        max_amount_cents: z.number().nullable(),
        account_id: z.number().nullable(),
        account_name: z.string().nullable(),
        category: z.string(),
        matching_count: z.number(),
      })),
    }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const [rules, accounts, transactions] = await Promise.all([
        db.select().from(schema.transactionRules).orderBy(schema.transactionRules.createdAt),
        db.select({ id: schema.accounts.id, name: schema.accounts.name, accountType: schema.accounts.accountType }).from(schema.accounts),
        db.select({ description: schema.transactions.description, payee: schema.transactions.payee, amountCents: schema.transactions.amountCents, accountId: schema.transactions.accountId }).from(schema.transactions),
      ]);
      const accountNameById = new Map(accounts.map((account) => [account.id, account.name]));
      const investmentAccountIds = new Set(accounts.filter((account) => account.accountType === "investment").map((account) => account.id));
      return { rules: rules.map((rule) => ({ id: rule.id, name: rule.name, merchant: rule.merchantKey, description_contains: rule.descriptionContains, min_amount_cents: rule.minAmountCents, max_amount_cents: rule.maxAmountCents, account_id: rule.accountId, account_name: rule.accountId ? accountNameById.get(rule.accountId) ?? null : null, category: rule.category, matching_count: transactions.filter((transaction) => (transaction.accountId === null || !investmentAccountIds.has(transaction.accountId)) && transactionMatchesRule(transaction, rule)).length })) };
    },
  }),

  saveTransactionRule: defineAction({
    request: z.object({
      id: z.number().int().positive().nullable(),
      name: z.string().min(1).max(80),
      merchant: z.string().max(160).nullable(),
      description_contains: z.string().max(160).nullable(),
      min_amount_cents: z.number().int().min(0).nullable(),
      max_amount_cents: z.number().int().min(0).nullable(),
      account_id: z.number().int().positive().nullable(),
      category: z.enum(categoryNames),
      apply_existing: z.boolean(),
    }).refine((value) => Boolean(value.merchant?.trim() || value.description_contains?.trim() || value.min_amount_cents !== null || value.max_amount_cents !== null || value.account_id !== null), { message: "Add at least one condition." }).refine((value) => value.min_amount_cents === null || value.max_amount_cents === null || value.min_amount_cents <= value.max_amount_cents, { message: "Minimum amount cannot exceed maximum amount." }),
    response: z.object({ ok: z.literal(true), applied_count: z.number() }),
    async handler(ctx, args): Promise<{ ok: true; applied_count: number }> {
      const db = ctx.db<typeof schema>();
      const now = new Date();
      const merchantKey = args.merchant?.trim() ? normalizeRuleText(args.merchant) : null;
      const descriptionContains = args.description_contains?.trim() ? normalizeRuleText(args.description_contains) : null;
      const values = { name: args.name.trim(), merchantKey, descriptionContains, minAmountCents: args.min_amount_cents, maxAmountCents: args.max_amount_cents, accountId: args.account_id, category: args.category, updatedAt: now };
      if (args.id) await db.update(schema.transactionRules).set(values).where(eq(schema.transactionRules.id, args.id));
      else await db.insert(schema.transactionRules).values({ ...values, createdAt: now });
      const appliedCount = args.apply_existing ? await applyTransactionRule(ctx, { merchantKey, descriptionContains, minAmountCents: args.min_amount_cents, maxAmountCents: args.max_amount_cents, accountId: args.account_id, category: args.category }) : 0;
      ctx.invalidateQueries();
      return { ok: true, applied_count: appliedCount };
    },
  }),

  deleteTransactionRule: defineAction({
    request: z.object({ id: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      await ctx.db<typeof schema>().delete(schema.transactionRules).where(eq(schema.transactionRules.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  markAllReviewed: defineAction({
    request: z.object({}),
    response: z.object({ ok: z.literal(true), reviewed_count: z.number() }),
    async handler(ctx): Promise<{ ok: true; reviewed_count: number }> {
      const db = ctx.db<typeof schema>();
      const [rows, accounts] = await Promise.all([
        db.select({ id: schema.transactions.id, accountId: schema.transactions.accountId }).from(schema.transactions).where(eq(schema.transactions.reviewed, false)),
        db.select({ id: schema.accounts.id, accountType: schema.accounts.accountType }).from(schema.accounts),
      ]);
      const investmentAccountIds = new Set(accounts.filter((account) => account.accountType === "investment").map((account) => account.id));
      const visibleRows = rows.filter((row) => row.accountId === null || !investmentAccountIds.has(row.accountId));
      for (const row of visibleRows) await db.update(schema.transactions).set({ reviewed: true, categorizationStatus: "manual", updatedAt: new Date() }).where(eq(schema.transactions.id, row.id));
      ctx.invalidateQueries();
      return { ok: true, reviewed_count: visibleRows.length };
    },
  }),

  getInsights: defineAction({
    request: z.object({ now_ms: z.number().int(), month: z.string().regex(/^\d{4}-\d{2}$/) }),
    response: z.object({
      payday_day: z.number().nullable(),
      safe_to_spend_cents: z.number().nullable(),
      days_to_payday: z.number().nullable(),
      recurring_monthly_cents: z.number(),
      recurring: z.array(z.object({ merchant: z.string(), average_cents: z.number(), next_due: z.string().nullable(), frequency_days: z.number(), occurrences: z.number() })),
      anomalies: z.array(z.object({ id: z.number(), merchant: z.string(), amount_cents: z.number(), reason: z.string(), posted_at: z.string() })),
      comparisons: z.array(z.object({ category: z.string(), current_cents: z.number(), previous_cents: z.number(), year_ago_cents: z.number().nullable(), change_percent: z.number().nullable() })),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const [rows, accounts, stateRows] = await Promise.all([db.select().from(schema.transactions).orderBy(schema.transactions.postedAt), db.select().from(schema.accounts), db.select().from(schema.appState)]);
      const investmentAccountIds = new Set(accounts.filter((account) => account.accountType === "investment").map((account) => account.id));
      const cashFlowRows = rows.filter((row) => row.accountId === null || !investmentAccountIds.has(row.accountId));
      const merchantRows = new Map<string, typeof cashFlowRows>();
      for (const row of cashFlowRows) {
        if (row.amountCents >= 0 || row.category === "Transfer") continue;
        const merchant = (row.payee ?? row.description).trim();
        if (!merchant) continue;
        const list = merchantRows.get(merchant) ?? [];
        list.push(row);
        merchantRows.set(merchant, list);
      }
      const recurring = [...merchantRows.entries()].flatMap(([merchant, items]) => {
        if (items.length < 2) return [];
        const sorted = [...items].sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime());
        const gaps = sorted.slice(1).map((item, index) => Math.round((item.postedAt.getTime() - (sorted[index]?.postedAt.getTime() ?? item.postedAt.getTime())) / 86_400_000)).filter((gap) => gap > 0);
        if (!gaps.length) return [];
        const frequency = Math.round(gaps.reduce((sum, value) => sum + value, 0) / gaps.length);
        if (!((frequency >= 25 && frequency <= 35) || (frequency >= 6 && frequency <= 9))) return [];
        const amounts = sorted.map((item) => Math.abs(item.amountCents));
        const average = Math.round(amounts.reduce((sum, value) => sum + value, 0) / amounts.length);
        const last = sorted[sorted.length - 1];
        const nextDue = last ? new Date(last.postedAt.getTime() + frequency * 86_400_000).toISOString().slice(0, 10) : null;
        return [{ merchant, average_cents: average, next_due: nextDue, frequency_days: frequency, occurrences: items.length }];
      }).sort((a, b) => b.average_cents - a.average_cents).slice(0, 12);
      const anomalies = cashFlowRows.filter((row) => row.amountCents < 0).flatMap((row) => {
        const merchant = (row.payee ?? row.description).trim();
        const peers = (merchantRows.get(merchant) ?? []).filter((item) => item.id !== row.id);
        const average = peers.length ? peers.reduce((sum, item) => sum + Math.abs(item.amountCents), 0) / peers.length : 0;
        const amount = Math.abs(row.amountCents);
        if (amount < 10_000 || !average || amount < average * 1.75) return [];
        return [{ id: row.id, merchant, amount_cents: amount, reason: `${Math.round((amount / average - 1) * 100)}% above this merchant’s usual`, posted_at: row.postedAt.toISOString() }];
      }).sort((a, b) => b.amount_cents - a.amount_cents).slice(0, 8);
      const [year = 1970, monthNumber = 1] = args.month.split("-").map(Number);
      const currentStart = new Date(year, monthNumber - 1, 1);
      const nextStart = new Date(year, monthNumber, 1);
      const previousStart = new Date(year, monthNumber - 2, 1);
      const yearAgoStart = new Date(year - 1, monthNumber - 1, 1);
      const yearAgoEnd = new Date(year - 1, monthNumber, 1);
      const bucket = (start: Date, end: Date) => {
        const result = new Map<string, number>();
        for (const row of cashFlowRows) if (row.postedAt >= start && row.postedAt < end && row.amountCents < 0 && row.category && row.category !== "Transfer") result.set(row.category, (result.get(row.category) ?? 0) + Math.abs(row.amountCents));
        return result;
      };
      const current = bucket(currentStart, nextStart);
      const previous = bucket(previousStart, currentStart);
      const yearAgo = bucket(yearAgoStart, yearAgoEnd);
      const comparisons = [...new Set([...current.keys(), ...previous.keys()])].map((category) => {
        const currentCents = current.get(category) ?? 0;
        const previousCents = previous.get(category) ?? 0;
        return { category, current_cents: currentCents, previous_cents: previousCents, year_ago_cents: yearAgo.has(category) ? yearAgo.get(category) ?? 0 : null, change_percent: previousCents ? Math.round((currentCents / previousCents - 1) * 100) : null };
      }).sort((a, b) => b.current_cents - a.current_cents);
      const paydayRaw = stateRows.find((row) => row.key === "payday_day")?.value;
      const parsedPayday = paydayRaw ? Number(paydayRaw) : Number.NaN;
      const paydayDay = Number.isInteger(parsedPayday) && parsedPayday >= 1 && parsedPayday <= 31 ? parsedPayday : null;
      let daysToPayday: number | null = null;
      let safeToSpend: number | null = null;
      if (paydayDay) {
        const now = new Date(args.now_ms);
        let nextPayday = new Date(now.getFullYear(), now.getMonth(), Math.min(paydayDay, new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()));
        if (nextPayday.getTime() <= now.getTime()) nextPayday = new Date(now.getFullYear(), now.getMonth() + 1, Math.min(paydayDay, new Date(now.getFullYear(), now.getMonth() + 2, 0).getDate()));
        daysToPayday = Math.max(1, Math.ceil((nextPayday.getTime() - now.getTime()) / 86_400_000));
        const liquid = accounts.filter((account) => ["checking", "savings", "cash"].includes(account.accountType) && account.currency === "USD").reduce((sum, account) => sum + Math.max(0, account.balanceCents), 0);
        const upcoming = recurring.filter((item) => item.next_due && new Date(`${item.next_due}T12:00:00`).getTime() <= nextPayday.getTime()).reduce((sum, item) => sum + item.average_cents, 0);
        safeToSpend = Math.max(0, Math.round((liquid - upcoming) / daysToPayday));
      }
      return { payday_day: paydayDay, safe_to_spend_cents: safeToSpend, days_to_payday: daysToPayday, recurring_monthly_cents: recurring.reduce((sum, item) => sum + (item.frequency_days < 15 ? item.average_cents * 4 : item.average_cents), 0), recurring, anomalies, comparisons };
    },
  }),

  setPaydayDay: defineAction({
    request: z.object({ day: z.number().int().min(1).max(31) }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await db.insert(schema.appState).values({ key: "payday_day", value: String(args.day), updatedAt: new Date() }).onConflictDoUpdate({ target: schema.appState.key, set: { value: String(args.day), updatedAt: new Date() } });
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  listSavingsGoals: defineAction({
    request: z.object({}),
    response: z.object({ goals: z.array(z.object({ id: z.number(), name: z.string(), target_cents: z.number(), saved_cents: z.number(), target_date: z.string().nullable() })) }),
    async handler(ctx) {
      const rows = await ctx.db<typeof schema>().select().from(schema.savingsGoals).orderBy(schema.savingsGoals.createdAt);
      return { goals: rows.map((row) => ({ id: row.id, name: row.name, target_cents: row.targetCents, saved_cents: row.savedCents, target_date: row.targetDate })) };
    },
  }),

  saveSavingsGoal: defineAction({
    request: z.object({ id: z.number().int().positive().nullable(), name: z.string().min(1).max(80), target_cents: z.number().int().positive(), saved_cents: z.number().int().min(0), target_date: z.string().nullable() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      const values = { name: args.name.trim(), targetCents: args.target_cents, savedCents: args.saved_cents, targetDate: args.target_date, updatedAt: new Date() };
      if (args.id) await db.update(schema.savingsGoals).set(values).where(eq(schema.savingsGoals.id, args.id));
      else await db.insert(schema.savingsGoals).values({ ...values, createdAt: new Date() });
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  saveTransactionDetails: defineAction({
    request: z.object({ id: z.number().int().positive(), category: z.string().max(80).nullable(), reviewed: z.boolean(), tags: z.array(z.string().min(1).max(30)).max(8), splits: z.array(z.object({ category: z.string().min(1).max(80), amount_cents: z.number().int().positive() })).max(12), create_merchant_rule: z.boolean() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      const rows = await db.select({ amount: schema.transactions.amountCents, description: schema.transactions.description, payee: schema.transactions.payee }).from(schema.transactions).where(eq(schema.transactions.id, args.id)).limit(1);
      const transaction = rows[0];
      if (!transaction) throw new Error("Transaction not found.");
      const expected = Math.abs(transaction.amount);
      const splitTotal = args.splits.reduce((sum, item) => sum + item.amount_cents, 0);
      if (args.splits.length > 0 && splitTotal !== expected) throw new Error("Split amounts must equal the transaction total.");
      await db.batch([
        db.update(schema.transactions).set({ category: args.category, categorizationStatus: args.reviewed ? "manual" : "review", categoryConfidence: null, reviewed: args.reviewed, updatedAt: new Date() }).where(eq(schema.transactions.id, args.id)),
        db.delete(schema.transactionTags).where(eq(schema.transactionTags.transactionId, args.id)),
        db.delete(schema.transactionSplits).where(eq(schema.transactionSplits.transactionId, args.id)),
      ]);
      const cleanTags = [...new Set(args.tags.map((tag) => tag.trim()).filter(Boolean))];
      if (cleanTags.length) await db.insert(schema.transactionTags).values(cleanTags.map((tag) => ({ transactionId: args.id, tag, createdAt: new Date() })));
      if (args.splits.length) await db.insert(schema.transactionSplits).values(args.splits.map((split) => ({ transactionId: args.id, category: split.category, amountCents: split.amount_cents, createdAt: new Date() })));
      if (args.create_merchant_rule && args.category) {
        const merchantName = (transaction.payee ?? transaction.description).trim();
        const merchantKey = normalizeRuleText(merchantName);
        if (merchantKey) {
          const existing = await db.select({ id: schema.transactionRules.id }).from(schema.transactionRules).where(eq(schema.transactionRules.merchantKey, merchantKey)).limit(1);
          const ruleValues = { name: `${merchantName} transactions`, merchantKey, descriptionContains: null, minAmountCents: null, maxAmountCents: null, accountId: null, category: args.category, updatedAt: new Date() };
          const currentRule = existing[0];
          if (currentRule) await db.update(schema.transactionRules).set(ruleValues).where(eq(schema.transactionRules.id, currentRule.id));
          else await db.insert(schema.transactionRules).values({ ...ruleValues, createdAt: new Date() });
          await applyTransactionRule(ctx, ruleValues);
        }
      }
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  generateWeeklyRecap: defineAction({
    request: z.object({ now_ms: z.number().int() }),
    response: z.object({
      summary: z.string(),
      period_start: z.string(),
      period_end: z.string(),
      income_cents: z.number(),
      spent_cents: z.number(),
      net_cents: z.number(),
      transactions: z.array(z.object({
        id: z.number(),
        posted_at: z.string(),
        merchant: z.string(),
        amount_cents: z.number(),
        currency: z.string(),
        category: z.string(),
        flow: z.enum(["income", "spending"]),
      })),
      categories: z.array(z.object({ category: z.string(), spent_cents: z.number() })),
    }),
    async handler(ctx, args) {
      const end = new Date(args.now_ms);
      const start = new Date(args.now_ms - 7 * 86_400_000);
      const db = ctx.db<typeof schema>();
      const [allRows, accounts] = await Promise.all([
        db.select().from(schema.transactions).where(and(gte(schema.transactions.postedAt, start), lt(schema.transactions.postedAt, end))).orderBy(desc(schema.transactions.postedAt)),
        db.select({ id: schema.accounts.id, accountType: schema.accounts.accountType }).from(schema.accounts),
      ]);
      const investmentAccountIds = new Set(accounts.filter((account) => account.accountType === "investment").map((account) => account.id));
      const rows = allRows.filter((row) => row.accountId === null || !investmentAccountIds.has(row.accountId));
      const categoryTotals = new Map<string, number>();
      let income = 0;
      let spent = 0;
      const recapTransactions: Array<{ id: number; posted_at: string; merchant: string; amount_cents: number; currency: string; category: string; flow: "income" | "spending" }> = [];
      for (const row of rows) {
        if (row.category === "Transfer") continue;
        if (row.amountCents > 0) {
          income += row.amountCents;
          recapTransactions.push({ id: row.id, posted_at: row.postedAt.toISOString(), merchant: row.payee ?? row.description, amount_cents: row.amountCents, currency: row.currency, category: row.category ?? "Uncategorized", flow: "income" });
        }
        if (row.amountCents < 0) {
          spent += Math.abs(row.amountCents);
          const category = row.category ?? "Uncategorized";
          categoryTotals.set(category, (categoryTotals.get(category) ?? 0) + Math.abs(row.amountCents));
          recapTransactions.push({ id: row.id, posted_at: row.postedAt.toISOString(), merchant: row.payee ?? row.description, amount_cents: row.amountCents, currency: row.currency, category, flow: "spending" });
        }
      }
      const categories = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1]).map(([category, spent_cents]) => ({ category, spent_cents }));
      if (!recapTransactions.length) return { summary: "No income or spending posted in the last seven days.", period_start: start.toISOString(), period_end: end.toISOString(), income_cents: 0, spent_cents: 0, net_cents: 0, transactions: [], categories: [] };
      const summary = await ctx.inference.complete(`Write a concise, neutral weekly money recap in 2-3 sentences. Mention the biggest spending category, total spent, total income, and net cash flow. Avoid judgment, advice, or invented context. Amounts are in cents. Data: ${JSON.stringify({ income_cents: income, spent_cents: spent, net_cents: income - spent, categories: categories.slice(0, 4).map((item) => [item.category, item.spent_cents]) })}`, { schema: z.string() });
      return { summary, period_start: start.toISOString(), period_end: end.toISOString(), income_cents: income, spent_cents: spent, net_cents: income - spent, transactions: recapTransactions, categories };
    },
  }),

  getBudgetRecommendations: defineAction({
    request: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }),
    response: z.object({
      history_days: z.number(),
      currency: z.string(),
      recommendations: z.array(z.object({ category: z.string(), suggested_cents: z.number(), average_monthly_cents: z.number(), transaction_count: z.number(), current_budget_cents: z.number() })),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const cutoff = new Date(Date.now() - 90 * 86_400_000);
      const [rows, accounts, budgetRows] = await Promise.all([
        db.select().from(schema.transactions).where(gte(schema.transactions.postedAt, cutoff)),
        db.select({ id: schema.accounts.id, accountType: schema.accounts.accountType, currency: schema.accounts.currency }).from(schema.accounts),
        db.select().from(schema.budgets).where(eq(schema.budgets.month, args.month)),
      ]);
      const currencies = [...new Set(accounts.map((account) => account.currency))];
      const currency = currencies.includes("USD") ? "USD" : (currencies[0] ?? "USD");
      const investmentAccountIds = new Set(accounts.filter((account) => account.accountType === "investment").map((account) => account.id));
      const totals = new Map<string, { total: number; count: number }>();
      for (const row of rows) {
        if ((row.accountId !== null && investmentAccountIds.has(row.accountId)) || row.amountCents >= 0 || row.currency !== currency || !row.category || !row.reviewed || row.category === "Transfer" || row.category === "Income") continue;
        const current = totals.get(row.category) ?? { total: 0, count: 0 };
        current.total += Math.abs(row.amountCents);
        current.count += 1;
        totals.set(row.category, current);
      }
      const budgetByCategory = new Map(budgetRows.map((row) => [row.category, row.amountCents]));
      const suggestions = [...totals.entries()].map(([category, value]) => {
        const average = Math.round(value.total / 3);
        const suggested = Math.max(500, Math.round(average / 500) * 500);
        return { category, suggested_cents: suggested, average_monthly_cents: average, transaction_count: value.count, current_budget_cents: budgetByCategory.get(category) ?? 0 };
      }).sort((a, b) => b.suggested_cents - a.suggested_cents);
      return { history_days: 90, currency, recommendations: suggestions };
    },
  }),

  setBudget: defineAction({
    request: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), category: z.string().min(1).max(80), amount_cents: z.number().int().min(0).max(1_000_000_000) }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const now = new Date();
      await db.insert(schema.budgets).values({ month: args.month, category: args.category, amountCents: args.amount_cents, createdAt: now, updatedAt: now }).onConflictDoUpdate({ target: [schema.budgets.month, schema.budgets.category], set: { amountCents: args.amount_cents, updatedAt: now } });
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  addManualTransaction: defineAction({
    request: z.object({ posted_at: z.string(), description: z.string().min(1).max(200), amount_cents: z.number().int().min(-1_000_000_000).max(1_000_000_000), category: z.string().max(80).nullable(), account_id: z.number().int().positive().nullable() }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const postedAt = new Date(args.posted_at);
      if (!Number.isFinite(postedAt.getTime())) throw new Error("Choose a valid transaction date.");
      const db = ctx.db<typeof schema>();
      const now = new Date();
      const transactionRules = args.category ? [] : await db.select().from(schema.transactionRules).orderBy(schema.transactionRules.createdAt);
      const matchingRule = transactionRules.find((rule) => transactionMatchesRule({ accountId: args.account_id, description: args.description.trim(), payee: null, amountCents: args.amount_cents }, rule));
      const category = args.category ?? matchingRule?.category ?? null;
      const rows = await db.insert(schema.transactions).values({ accountId: args.account_id, postedAt, description: args.description.trim(), amountCents: args.amount_cents, category, categorizationStatus: args.category ? "manual" : matchingRule ? "auto" : "review", categoryConfidence: matchingRule ? 100 : null, reviewed: Boolean(category), source: "manual", createdAt: now, updatedAt: now }).returning({ id: schema.transactions.id });
      const created = rows[0];
      if (!created) throw new Error("The transaction could not be saved.");
      ctx.invalidateQueries();
      return { id: created.id };
    },
  }),

  updateTransaction: defineAction({
    request: z.object({ id: z.number().int().positive(), category: z.string().max(80).nullable(), reviewed: z.boolean() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await db.update(schema.transactions).set({ category: args.category, categorizationStatus: args.reviewed ? "manual" : "review", categoryConfidence: null, reviewed: args.reviewed, updatedAt: new Date() }).where(eq(schema.transactions.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  importFromSimpleFin: defineAction({
    request: z.object({ setup_token: z.string().min(20).max(4096) }),
    response: syncResponse,
    async handler(ctx, args): Promise<SyncResult> {
      try {
        const decoded = Buffer.from(args.setup_token.trim(), "base64").toString("utf8");
        const claimUrl = validSimpleFinUrl(decoded, false);
        if (!claimUrl || !claimUrl.pathname.startsWith("/simplefin/claim/")) return { ok: false, message: "This does not look like a valid SimpleFIN setup token.", account_count: 0, transaction_count: 0, provider_errors: [], needs_setup: true };
        const claimController = new AbortController();
        const claimTimer = setTimeout(() => claimController.abort(), 30_000);
        const claimResponse = await fetch(claimUrl, { method: "POST", body: "", redirect: "error", signal: claimController.signal });
        clearTimeout(claimTimer);
        if (!claimResponse.ok) return { ok: false, message: claimResponse.status === 401 || claimResponse.status === 403 ? "That setup token was rejected or already used. Generate a fresh token in SimpleFIN Bridge." : "SimpleFIN could not claim this setup token.", account_count: 0, transaction_count: 0, provider_errors: [], needs_setup: true };
        const accessText = (await claimResponse.text()).trim();
        const accessUrl = validSimpleFinUrl(accessText, true);
        if (!accessUrl) return { ok: false, message: "SimpleFIN returned an invalid access credential. No connection was saved.", account_count: 0, transaction_count: 0, provider_errors: [], needs_setup: true };
        const db = ctx.db<typeof schema>();
        const now = new Date();
        await db.insert(schema.appState).values({ key: "simplefin_access_url", value: accessText, updatedAt: now }).onConflictDoUpdate({ target: schema.appState.key, set: { value: accessText, updatedAt: now } });
        return await syncSimpleFin(ctx, accessText);
      } catch (error) {
        return { ok: false, message: safeError(error), account_count: 0, transaction_count: 0, provider_errors: [], needs_setup: true };
      }
    },
  }),

  refreshSimpleFin: defineAction({
    request: z.object({}),
    response: syncResponse,
    async handler(ctx): Promise<SyncResult> {
      const db = ctx.db<typeof schema>();
      const rows = await db.select({ value: schema.appState.value }).from(schema.appState).where(eq(schema.appState.key, "simplefin_access_url")).limit(1);
      const storedAccessUrl = rows[0]?.value;
      if (!storedAccessUrl) return { ok: false, message: "Connect SimpleFIN with a setup token first.", account_count: 0, transaction_count: 0, provider_errors: [], needs_setup: true };
      return await syncSimpleFin(ctx, storedAccessUrl);
    },
  }),

  dailyRefreshStatus: defineAction({
    request: z.object({}),
    response: z.object({ ok: z.boolean(), refresh_due: z.boolean() }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.appState).where(eq(schema.appState.key, "last_simplefin_sync_at")).limit(1);
      const last = rows[0]?.value;
      const refreshDue = !last || Date.now() - Date.parse(last) > 36 * 60 * 60 * 1000;
      const now = new Date();
      await db.insert(schema.appState).values({ key: "last_daily_check_at", value: now.toISOString(), updatedAt: now }).onConflictDoUpdate({ target: schema.appState.key, set: { value: now.toISOString(), updatedAt: now } });
      ctx.invalidateQueries();
      return { ok: true, refresh_due: refreshDue };
    },
  }),

  getCategories: defineAction({
    request: z.object({}),
    response: z.object({ categories: z.array(z.string()) }),
    async handler() {
      return { categories: [...categoryNames] };
    },
  }),
} satisfies ActionsModule;
