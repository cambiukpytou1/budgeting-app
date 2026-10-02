import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaTopScrim } from "@hatch/space-sdk/client";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, type ApiResponse } from "./api";

type Tab = "cashflow" | "accounts" | "investments" | "transactions" | "dashboard" | "categories" | "recurrings" | "goals";
type NetWorthRange = "1W" | "1M" | "3M" | "YTD" | "1Y" | "ALL";
type Transaction = ApiResponse<typeof api, "listTransactions">["transactions"][number];
type Dashboard = ApiResponse<typeof api, "getDashboard">;
type BudgetRecommendation = ApiResponse<typeof api, "getBudgetRecommendations">["recommendations"][number];
type Insights = ApiResponse<typeof api, "getInsights">;
type SavingsGoal = ApiResponse<typeof api, "listSavingsGoals">["goals"][number];
type TransactionRule = ApiResponse<typeof api, "listTransactionRules">["rules"][number];
type WeeklyRecap = ApiResponse<typeof api, "generateWeeklyRecap">;

const fallbackCategories = [
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
];

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
function monthBounds(month: string) {
  const [year = 1970, rawMonth = 1] = month.split("-").map(Number);
  const start = new Date(year, rawMonth - 1, 1);
  const end = new Date(year, rawMonth, 1);
  return { start_ms: start.getTime(), end_ms: end.getTime() };
}
function moveMonth(month: string, delta: number) {
  const [year = 1970, rawMonth = 1] = month.split("-").map(Number);
  return monthKey(new Date(year, rawMonth - 1 + delta, 1));
}
function monthLabel(month: string) {
  const [year = 1970, rawMonth = 1] = month.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(new Date(year, rawMonth - 1, 1));
}
function money(cents: number, currency = "USD", compact = false) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency, notation: compact ? "compact" : "standard", maximumFractionDigits: compact ? 1 : 2 }).format(cents / 100);
}
function shortDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));
}
function syncText(value: string | null) {
  if (!value) return "No bank import yet";
  return `Imported ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value))}`;
}
function visibleTag(value: string) {
  return value.replace(/^person:/i, "");
}
function categoryGlyph(category: string) {
  const value = category.toLowerCase();
  if (/food|grocery|restaurant|coffee/.test(value)) return "🍽️";
  if (/home|housing|mortgage|rent/.test(value)) return "🏠";
  if (/transport|gas|auto|parking|transit|rideshare/.test(value)) return "🚙";
  if (/travel|hotel|flight/.test(value)) return "✈️";
  if (/health|medical|pharmacy|fitness/.test(value)) return "♥";
  if (/bill|utilit|phone|internet/.test(value)) return "⚡";
  if (/entertainment|movie|subscription/.test(value)) return "▶";
  if (/shopping|clothing|electronic/.test(value)) return "🛍️";
  if (/gift|donation/.test(value)) return "🎁";
  if (/income/.test(value)) return "$";
  return category.slice(0, 1).toUpperCase();
}
function netWorthCutoff(range: NetWorthRange, latestDate: string) {
  const latest = new Date(`${latestDate}T12:00:00`);
  if (range === "ALL") return Number.NEGATIVE_INFINITY;
  if (range === "YTD") return new Date(latest.getFullYear(), 0, 1).getTime();
  const days = range === "1W" ? 7 : range === "1M" ? 31 : range === "3M" ? 92 : 366;
  return latest.getTime() - days * 86_400_000;
}

function Icon({ name }: { name: Tab | "plus" | "bank" }) {
  const paths: Record<string, ReactNode> = {
    cashflow: <><path d="M4 18V8M10 18V4M16 18v-7M22 18H2"/><path d="m3 7 5-4 5 5 7-6"/></>,
    accounts: <><path d="M3 9h18L12 3 3 9Z"/><path d="M5 9v8M9 9v8M15 9v8M19 9v8M3 21h18"/></>,
    investments: <><path d="M4 18 9 12l4 3 7-9"/><path d="M15 6h5v5"/><path d="M4 21h16"/></>,
    transactions: <><path d="M4 7h16M4 12h16M4 17h10"/><circle cx="18" cy="17" r="2"/></>,
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
    categories: <><circle cx="12" cy="12" r="9"/><path d="M12 3v9l7 4"/></>,
    recurrings: <><path d="M20 7h-5V2"/><path d="M19 7a8 8 0 1 0 1 8"/><path d="m8 12 3 3 5-6"/></>,
    goals: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    bank: <><path d="M3 9h18L12 3 3 9Z"/><path d="M6 9v8M12 9v8M18 9v8M3 21h18"/></>,
  };
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function MonthStepper({ month, onChange }: { month: string; onChange: (value: string) => void }) {
  return <div className="month-stepper"><button aria-label="Previous month" onClick={() => onChange(moveMonth(month, -1))}>‹</button><strong>{monthLabel(month)}</strong><button aria-label="Next month" onClick={() => onChange(moveMonth(month, 1))}>›</button></div>;
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-label={title}><div className="modal-head"><h2>{title}</h2><button className="icon-button" aria-label={`Close ${title}`} onClick={onClose}>×</button></div>{children}</section></div>;
}

function EmptyState({ onConnect, onManual }: { onConnect: () => void; onManual: () => void }) {
  return <section className="empty-state"><div className="empty-mark"><Icon name="bank" /></div><h2>Bring your money into view</h2><p>Import the latest 90 days from SimpleFIN, or add a transaction yourself to start planning.</p><div className="button-row"><button className="primary" onClick={onConnect}>Import from SimpleFIN</button><button className="secondary" onClick={onManual}>Add manually</button></div></section>;
}

function Overview({ data, month, onConnect, onManual, onReview }: { data: Dashboard; month: string; onConnect: () => void; onManual: () => void; onReview: () => void }) {
  const [netWorthRange, setNetWorthRange] = useState<NetWorthRange>("1M");
  const hasData = data.transaction_count > 0 || data.accounts.length > 0;
  const budgetRemaining = data.budget_cents - data.spent_cents;
  const [selectedYear = 1970, selectedMonth = 1] = month.split("-").map(Number);
  const daysInMonth = new Date(selectedYear, selectedMonth, 0).getDate();
  const today = new Date();
  const visibleDays = month === monthKey(today) ? Math.min(today.getDate(), daysInMonth) : daysInMonth;
  const dailyByDay = new Map(data.daily.map((row) => [Number(row.date.slice(8, 10)), row]));
  const previousDailyByDay = new Map(data.previous_daily.map((row) => [Number(row.date.slice(8, 10)), row]));
  let runningIncome = 0;
  let runningExpenses = 0;
  let previousRunningIncome = 0;
  let previousRunningExpenses = 0;
  const cashFlowHistory = Array.from({ length: visibleDays }, (_, index) => {
    const day = index + 1;
    const current = dailyByDay.get(day);
    const previous = previousDailyByDay.get(day);
    runningIncome += current?.income_cents ?? 0;
    runningExpenses += current?.spent_cents ?? 0;
    previousRunningIncome += previous?.income_cents ?? 0;
    previousRunningExpenses += previous?.spent_cents ?? 0;
    return { day, label: String(day), income: runningIncome / 100, expenses: runningExpenses / 100, previousIncome: previousRunningIncome / 100, previousExpenses: previousRunningExpenses / 100 };
  });
  const previousCashFlow = data.monthly_history.at(-2) ?? null;
  const incomeChange = previousCashFlow ? data.income_cents - previousCashFlow.income_cents : null;
  const expenseChange = previousCashFlow ? data.spent_cents - previousCashFlow.spent_cents : null;
  const latestWorthDate = data.net_worth_daily.at(-1)?.date;
  const filteredWorthRows = latestWorthDate ? data.net_worth_daily.filter((row) => new Date(`${row.date}T12:00:00`).getTime() >= netWorthCutoff(netWorthRange, latestWorthDate)) : [];
  const netWorthData = filteredWorthRows.map((row) => ({ ...row, label: shortDate(`${row.date}T12:00:00`), value: row.net_worth_cents / 100 }));
  const rangeStartWorth = filteredWorthRows[0]?.net_worth_cents;
  const worthChange = rangeStartWorth === undefined ? null : data.net_worth_cents - rangeStartWorth;
  const worthChangePercent = worthChange !== null && rangeStartWorth !== undefined && rangeStartWorth !== 0 ? worthChange / Math.abs(rangeStartWorth) * 100 : null;
  if (!hasData) return <EmptyState onConnect={onConnect} onManual={onManual} />;
  return <div className="overview-stack">
    <section className="balance-hero">
      <p className="eyebrow">Available this month</p>
      <div className={`hero-amount ${data.available_cents < 0 ? "negative" : ""}`}>{money(data.available_cents, data.summary_currency)}</div>
      <p className="hero-note">{money(data.income_cents, data.summary_currency)} in · {money(data.spent_cents, data.summary_currency)} out</p>
      {data.has_mixed_currency && <p className="currency-note">Overview uses {data.summary_currency}; other currencies stay separate in Accounts.</p>}
    </section>
    <div className="signal-grid">
      <button className="signal review-signal" onClick={onReview}><span>Needs review</span><strong>{data.needs_review}</strong><small>{data.needs_review === 1 ? "transaction" : "transactions"}</small></button>
      <section className="signal"><span>Plan remaining</span><strong className={budgetRemaining < 0 ? "negative" : ""}>{data.budget_cents ? money(budgetRemaining, data.summary_currency) : "Not set"}</strong><small>{data.budget_cents ? `${money(data.budget_cents, data.summary_currency)} planned` : "Build a monthly plan"}</small></section>
    </div>
    <section className="chart-panel cash-flow-panel">
      <div className="section-heading"><div><p className="eyebrow">Cash flow</p><h2 className={data.available_cents < 0 ? "negative" : "positive-flow"}>{data.available_cents >= 0 ? "+" : ""}{money(data.available_cents, data.summary_currency)}</h2><p className="flow-caption">{data.available_cents >= 0 ? "Positive" : "Negative"} for the selected month</p></div><button className="text-button" onClick={onManual}><Icon name="plus" /> Add</button></div>
      <div className="flow-comparison-grid" aria-label="Selected month compared with last month">
        <article><span>Income</span><strong>{money(data.income_cents, data.summary_currency)}</strong>{previousCashFlow && <><small>Last month {money(previousCashFlow.income_cents, data.summary_currency)}</small><em className={incomeChange === null || incomeChange === 0 ? "" : incomeChange > 0 ? "positive-flow" : "negative"}>{incomeChange === 0 ? "No change" : `${incomeChange !== null && incomeChange > 0 ? "+" : "−"}${money(Math.abs(incomeChange ?? 0), data.summary_currency)} vs last month`}</em></>}</article>
        <article><span>Expenses</span><strong>{money(data.spent_cents, data.summary_currency)}</strong>{previousCashFlow && <><small>Last month {money(previousCashFlow.spent_cents, data.summary_currency)}</small><em className={expenseChange === null || expenseChange === 0 ? "" : expenseChange > 0 ? "negative" : "positive-flow"}>{expenseChange === 0 ? "No change" : `${expenseChange !== null && expenseChange > 0 ? "+" : "−"}${money(Math.abs(expenseChange ?? 0), data.summary_currency)} vs last month`}</em></>}</article>
      </div>
      <div className="chart-legend"><span><i className="income-dot" />Income</span><span><i className="expense-dot" />Expenses</span><span className="previous-key"><i />Last month</span><b>Running total by day</b></div>
      {cashFlowHistory.some((row) => row.income !== 0 || row.expenses !== 0 || row.previousIncome !== 0 || row.previousExpenses !== 0) ? <div className="chart-wrap cash-flow-chart-wrap" role="img" aria-label="Running income and expense totals by day compared with last month"><ResponsiveContainer width="100%" height="100%"><LineChart accessibilityLayer data={cashFlowHistory} margin={{ top: 14, right: 8, left: 2, bottom: 0 }}><CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 5" /><XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--dim)" }} interval="preserveStartEnd" label={{ value: "Day of month", position: "insideBottom", offset: -2, fontSize: 10, fill: "var(--dim)" }} /><YAxis width={58} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "var(--dim)" }} tickCount={4} domain={[0, "auto"]} tickFormatter={(value) => money(Number(value) * 100, data.summary_currency, true)} /><Tooltip labelFormatter={(label) => `Day ${label}`} formatter={(value, name) => { const labels: Record<string, string> = { income: "Income", expenses: "Expenses", previousIncome: "Income last month", previousExpenses: "Expenses last month" }; return [money(Number(value) * 100, data.summary_currency), labels[String(name)] ?? String(name)]; }} /><Line type="monotone" dataKey="previousIncome" stroke="var(--teal)" strokeOpacity={0.42} strokeWidth={2} strokeDasharray="5 5" dot={false} activeDot={{ r: 4 }} /><Line type="monotone" dataKey="previousExpenses" stroke="var(--accent)" strokeOpacity={0.42} strokeWidth={2} strokeDasharray="5 5" dot={false} activeDot={{ r: 4 }} /><Line type="monotone" dataKey="income" stroke="var(--teal)" strokeWidth={3} dot={false} activeDot={{ r: 5 }} /><Line type="monotone" dataKey="expenses" stroke="var(--accent)" strokeWidth={3} dot={false} activeDot={{ r: 5 }} /></LineChart></ResponsiveContainer></div> : <p className="quiet-empty">No cash flow in this month or last month.</p>}
    </section>
    <section className="net-worth-panel net-worth-hero"><div className="net-worth-title"><p className="eyebrow">Net worth</p><h2 className={data.net_worth_cents < 0 ? "negative" : ""}>{money(data.net_worth_cents, data.summary_currency)}</h2>{worthChange !== null && filteredWorthRows.length > 1 ? <p className={worthChange < 0 ? "negative" : "positive-flow"}>{worthChange >= 0 ? "▲" : "▼"} {money(Math.abs(worthChange), data.summary_currency)}{worthChangePercent !== null ? ` (${Math.abs(worthChangePercent).toFixed(1)}%)` : ""} in this range</p> : <p className="worth-caption">Balance history updates with every bank sync.</p>}</div>{netWorthData.length > 1 ? <div className="worth-chart worth-chart-stage"><ResponsiveContainer width="100%" height="100%"><AreaChart data={netWorthData} margin={{ top: 10, right: 4, left: 4, bottom: 0 }}><defs><linearGradient id="worthFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--teal)" stopOpacity=".34"/><stop offset="100%" stopColor="var(--teal)" stopOpacity="0"/></linearGradient></defs><XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "var(--dim)" }} interval="preserveStartEnd"/><Tooltip formatter={(value) => money(Number(value) * 100, data.summary_currency)} /><Area type="monotone" dataKey="value" stroke="var(--teal)" fill="url(#worthFill)" strokeWidth={3} dot={false} activeDot={{ r: 5, fill: "var(--surface)", stroke: "var(--teal)", strokeWidth: 3 }} /></AreaChart></ResponsiveContainer></div> : <div className="worth-chart-placeholder"><span /> <p>Sync again on another day to begin the trend.</p></div>}<div className="worth-range" aria-label="Net worth time range">{(["1W", "1M", "3M", "YTD", "1Y", "ALL"] as const).map((range) => <button key={range} className={range === netWorthRange ? "active" : ""} onClick={() => setNetWorthRange(range)}>{range}</button>)}</div><div className="worth-split"><span>Assets <strong>{money(data.asset_cents, data.summary_currency)}</strong></span><span>Liabilities <strong>{money(data.liability_cents, data.summary_currency)}</strong></span></div></section>
    <section className="category-panel"><div className="section-heading"><div><p className="eyebrow">Category pulse</p><h2>Where it went</h2></div></div>{data.categories.length ? <div className="category-list">{data.categories.slice(0, 6).map((row) => { const max = Math.max(...data.categories.map((item) => item.spent_cents), 1); return <div className="category-row" key={row.category}><div className="category-copy"><strong>{row.category}</strong><span>{money(row.spent_cents, data.summary_currency)}{row.budget_cents ? ` of ${money(row.budget_cents, data.summary_currency)}` : ""}</span></div><div className="track"><span style={{ width: `${Math.min(100, row.spent_cents / max * 100)}%` }} /></div></div>; })}</div> : <p className="quiet-empty">Categorize spending to see the breakdown.</p>}</section>
  </div>;
}

function downloadText(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function exportCsv(rows: Transaction[]) {
  const cell = (value: string | number | null) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const lines = [["Date", "Merchant", "Description", "Amount", "Currency", "Category", "Account", "Tags", "Reviewed"].map(cell).join(",")];
  for (const row of rows) lines.push([row.posted_at.slice(0, 10), row.payee, row.description, (row.amount_cents / 100).toFixed(2), row.currency, row.category, row.account_name, row.tags.join("; "), row.reviewed ? "Yes" : "No"].map(cell).join(","));
  downloadText("transactions.csv", lines.join("\n"), "text/csv;charset=utf-8");
}

function escapePdf(value: string) { return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)").replace(/[^\x20-\x7E]/g, "-"); }
function exportMonthlyPdf(rows: Transaction[], month: string, currency: string) {
  const chosen = rows.filter((row) => row.posted_at.startsWith(month));
  const income = chosen.filter((row) => row.amount_cents > 0).reduce((sum, row) => sum + row.amount_cents, 0);
  const spent = chosen.filter((row) => row.amount_cents < 0 && row.category !== "Transfer").reduce((sum, row) => sum + Math.abs(row.amount_cents), 0);
  const lines = [`Monthly money report - ${monthLabel(month)}`, `Income: ${money(income, currency)}`, `Spending: ${money(spent, currency)}`, `Net cash flow: ${money(income - spent, currency)}`, "", "Recent transactions", ...chosen.slice(0, 22).map((row) => `${row.posted_at.slice(0, 10)}  ${(row.payee ?? row.description).slice(0, 38)}  ${money(row.amount_cents, row.currency)}`)];
  const content = lines.map((line, index) => `BT /F1 ${index === 0 ? 18 : 10} Tf 54 ${750 - index * 26} Td (${escapePdf(line)}) Tj ET`).join("\n");
  const objects = ["1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj", "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj", "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj", "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj", `5 0 obj << /Length ${content.length} >> stream\n${content}\nendstream endobj`];
  let pdf = "%PDF-1.4\n"; const offsets = [0];
  for (const obj of objects) { offsets.push(pdf.length); pdf += `${obj}\n`; }
  const xref = pdf.length; pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => String(offset).padStart(10, "0") + " 00000 n ").join("\n")}\ntrailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  downloadText(`money-report-${month}.pdf`, pdf, "application/pdf");
}

function TransactionsView({ rows, categories, month, currency, search, setSearch, reviewOnly, setReviewOnly, onEdit, onManual, onRules, onMarkAll, markingAll }: { rows: Transaction[]; categories: string[]; month: string; currency: string; search: string; setSearch: (value: string) => void; reviewOnly: boolean; setReviewOnly: (value: boolean) => void; onEdit: (row: Transaction) => void; onManual: () => void; onRules: () => void; onMarkAll: () => void; markingAll: boolean }) {
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [accountFilter, setAccountFilter] = useState("all");
  const [flowFilter, setFlowFilter] = useState<"all" | "income" | "expense">("all");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [includeInvestments, setIncludeInvestments] = useState(false);
  const investmentCount = rows.filter((row) => row.account_type === "investment").length;
  const visibleRows = includeInvestments ? rows : rows.filter((row) => row.account_type !== "investment");
  const reviewCount = visibleRows.filter((row) => !row.reviewed).length;
  const accounts = [...new Set(visibleRows.map((row) => row.account_name).filter((value): value is string => Boolean(value)))];
  const needle = search.toLowerCase();
  const minCents = minAmount.trim() && Number.isFinite(Number(minAmount)) ? Math.round(Number(minAmount) * 100) : null;
  const maxCents = maxAmount.trim() && Number.isFinite(Number(maxAmount)) ? Math.round(Number(maxAmount) * 100) : null;
  const filtered = visibleRows.filter((row) => {
    const absoluteAmount = Math.abs(row.amount_cents);
    const postedDate = row.posted_at.slice(0, 10);
    return (!reviewOnly || !row.reviewed)
      && (categoryFilter === "all" || (row.category ?? "Uncategorized") === categoryFilter)
      && (accountFilter === "all" || row.account_name === accountFilter)
      && (flowFilter === "all" || (flowFilter === "income" ? row.amount_cents > 0 : row.amount_cents < 0))
      && (minCents === null || absoluteAmount >= minCents)
      && (maxCents === null || absoluteAmount <= maxCents)
      && (!dateFrom || postedDate >= dateFrom)
      && (!dateTo || postedDate <= dateTo)
      && `${row.payee ?? ""} ${row.description} ${row.category ?? ""} ${row.account_name ?? ""} ${row.tags.join(" ")}`.toLowerCase().includes(needle);
  });
  const grouped = filtered.reduce<Record<string, Transaction[]>>((acc, row) => { const day = row.posted_at.slice(0, 10); (acc[day] ??= []).push(row); return acc; }, {});
  return <section className="page-section"><div className="section-heading page-title"><div><p className="eyebrow">Ledger</p><h1>Transactions</h1></div><div className="page-actions"><button className="secondary rules-button" onClick={onRules}>Rules</button><button className="round-action" aria-label="Add transaction" onClick={onManual}><Icon name="plus" /></button></div></div>
    <div className="filter-row" aria-label="Transaction review filters"><button className={!reviewOnly ? "active" : ""} onClick={() => setReviewOnly(false)}>All</button><button className={reviewOnly ? "active" : ""} onClick={() => setReviewOnly(true)}>Needs review <span>{reviewCount}</span></button>{reviewOnly && reviewCount > 0 && <button className="mark-all-button" onClick={onMarkAll} disabled={markingAll}>{markingAll ? "Reviewing…" : "Mark all reviewed"}</button>}</div>
    {investmentCount > 0 && <label className="investment-toggle"><input type="checkbox" checked={includeInvestments} onChange={(event) => setIncludeInvestments(event.target.checked)} /><span><strong>Show investment activity</strong><small>Hidden from spending, budgets, recaps, and insights by default</small></span><b>{investmentCount}</b></label>}
    <label className="search-box"><span className="sr-only">Search transactions</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search merchant, account, category or tag" /></label>
    <div className="smart-filters"><label><span>Category</span><select aria-label="Filter by category" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="all">All categories</option>{["Uncategorized", ...categories].map((item) => <option key={item}>{item}</option>)}</select></label><label><span>Account</span><select aria-label="Filter by account" value={accountFilter} onChange={(event) => setAccountFilter(event.target.value)}><option value="all">All accounts</option>{accounts.map((item) => <option key={item}>{item}</option>)}</select></label><label><span>Flow</span><select aria-label="Filter by cash flow" value={flowFilter} onChange={(event) => setFlowFilter(event.target.value as "all" | "income" | "expense")}><option value="all">Income & expenses</option><option value="income">Income</option><option value="expense">Expenses</option></select></label></div>
    <div className="range-filters"><label><span>Minimum amount</span><input aria-label="Minimum transaction amount" inputMode="decimal" value={minAmount} onChange={(event) => setMinAmount(event.target.value)} placeholder="0.00" /></label><label><span>Maximum amount</span><input aria-label="Maximum transaction amount" inputMode="decimal" value={maxAmount} onChange={(event) => setMaxAmount(event.target.value)} placeholder="Any" /></label><label><span>From</span><input aria-label="Transactions from date" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label><label><span>To</span><input aria-label="Transactions through date" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label></div>
    <div className="export-row"><button className="secondary" onClick={() => exportCsv(filtered)}>Download CSV</button><button className="secondary" onClick={() => exportMonthlyPdf(visibleRows, month, currency)}>Monthly PDF</button><span>{filtered.length} shown</span></div>
    {filtered.length ? <div className="transaction-groups">{Object.entries(grouped).map(([day, items]) => <section key={day}><h2 className="day-label">{shortDate(`${day}T12:00:00`)}</h2><div className="transaction-list">{items.map((row) => <button className={`transaction-row ${!row.reviewed ? "needs-review" : ""}`} key={row.id} onClick={() => onEdit(row)}><span className={`merchant-mark ${row.amount_cents > 0 ? "income" : ""}`}>{(row.payee ?? row.description).slice(0, 1).toUpperCase()}</span><span className="transaction-copy"><strong>{row.payee ?? row.description}</strong><small>{row.category ?? "Uncategorized"}{row.tags.length ? ` · ${row.tags.map(visibleTag).join(", ")}` : ""}{row.categorization_status === "auto" ? " · Auto-categorized" : !row.reviewed ? " · Review suggestion" : ""}{row.pending ? " · Pending" : ""}</small></span><span className={`transaction-amount ${row.amount_cents > 0 ? "positive" : ""}`}>{row.amount_cents > 0 ? "+" : ""}{money(row.amount_cents, row.currency)}</span></button>)}</div></section>)}</div> : <div className="quiet-empty roomy">{reviewOnly && reviewCount === 0 ? "Everything is categorized. No review needed." : visibleRows.length ? "No transactions match those filters." : investmentCount > 0 && !includeInvestments ? "Investment activity is hidden by default. Turn it on above to view it." : "No transactions yet."}</div>}
  </section>;
}
function PlanView({ data, month, recommendations, onBudget, onAccept }: { data: Dashboard; month: string; recommendations: BudgetRecommendation[]; onBudget: (category: string, cents: number) => void; onAccept: (category: string, cents: number) => void }) {
  const rows = data.categories.filter((row) => row.category !== "Uncategorized");
  const newRecommendations = recommendations.filter((item) => item.current_budget_cents === 0);
  return <section className="page-section"><div className="section-heading page-title"><div><p className="eyebrow">Spending plan</p><h1>Categories</h1></div><button className="round-action" aria-label="Add budget category" onClick={() => onBudget("Food & dining", 0)}><Icon name="plus" /></button></div><div className="budget-summary"><div><span>Planned</span><strong>{money(data.budget_cents, data.summary_currency)}</strong></div><div><span>Spent</span><strong>{money(data.spent_cents, data.summary_currency)}</strong></div></div>{newRecommendations.length > 0 && <section className="recommendations"><div className="recommendation-heading"><div><p className="eyebrow">Based on the last 90 days</p><h2>Suggested monthly budgets</h2></div></div><div className="recommendation-list">{newRecommendations.map((item) => <article className="recommendation-row" key={item.category}><div><strong>{item.category}</strong><span>{money(item.average_monthly_cents, data.summary_currency)} monthly average · {item.transaction_count} transactions</span></div><b>{money(item.suggested_cents, data.summary_currency)}</b><div className="recommendation-actions"><button className="secondary" onClick={() => onBudget(item.category, item.suggested_cents)}>Adjust</button><button className="primary" onClick={() => onAccept(item.category, item.suggested_cents)}>Accept</button></div></article>)}</div></section>}{rows.length ? <div className="budget-list">{rows.map((row) => { const pct = row.budget_cents > 0 ? Math.min(100, row.spent_cents / row.budget_cents * 100) : 0; return <button className="budget-row category-budget-row" key={row.category} onClick={() => onBudget(row.category, row.budget_cents)}><span className="category-glyph" aria-hidden="true">{categoryGlyph(row.category)}</span><div className="category-budget-copy"><div className="category-copy"><strong>{row.category}</strong><span>{row.budget_cents ? `${money(row.spent_cents, data.summary_currency)} of ${money(row.budget_cents, data.summary_currency)}` : `${money(row.spent_cents, data.summary_currency)} spent · Set budget`}</span></div><div className="track"><span className={row.budget_cents > 0 && row.spent_cents > row.budget_cents ? "over" : ""} style={{ width: `${pct}%` }} /></div></div><span className="category-ring" style={{ background: `conic-gradient(${row.budget_cents > 0 && row.spent_cents > row.budget_cents ? "var(--danger)" : "var(--accent)"} ${pct * 3.6}deg, var(--surface-2) 0deg)` }}><i>{Math.round(pct)}%</i></span></button>; })}</div> : newRecommendations.length === 0 ? <div className="empty-inline"><h2>Shape {monthLabel(month)}</h2><p>Once categorized spending is available, this page will suggest monthly limits from the last 90 days.</p><button className="primary" onClick={() => onBudget("Food & dining", 0)}>Set first budget</button></div> : null}</section>;
}

function InvestmentsView({ data }: { data: Dashboard }) {
  const rows = data.accounts.filter((account) => account.account_type === "investment");
  const total = rows.reduce((sum, account) => sum + account.balance_cents, 0);
  return <section className="page-section investments-page"><div className="section-heading page-title"><div><p className="eyebrow">Portfolio</p><h1>Investments</h1></div></div>
    <section className="portfolio-hero"><p>Investment balance</p><h2>{money(total, data.summary_currency)}</h2><span>Across {rows.length} linked account{rows.length === 1 ? "" : "s"}</span><div className="portfolio-line" aria-hidden="true"><i/><i/><i/><i/><i/><i/></div></section>
    {rows.length ? <div className="investment-list">{rows.map((account) => {
      const points = account.balance_history.length ? account.balance_history : [{ date: "", balance_cents: account.balance_cents }];
      const chartRows = points.map((point) => ({ value: point.balance_cents / 100 }));
      return <article className="investment-card" key={account.id}><div className="investment-card-head"><span className="institution-mark">{(account.institution ?? account.name).slice(0, 1).toUpperCase()}</span><div><strong>{account.name}</strong><small>{account.institution ?? "Institution unavailable"}</small></div><b>{money(account.balance_cents, account.currency)}</b></div><div className="sparkline"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartRows}><defs><linearGradient id={`spark-${account.id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--teal)" stopOpacity=".35"/><stop offset="100%" stopColor="var(--teal)" stopOpacity="0"/></linearGradient></defs><Area dataKey="value" type="monotone" stroke="var(--teal)" fill={`url(#spark-${account.id})`} strokeWidth={2.5} dot={false}/></AreaChart></ResponsiveContainer></div><footer><span>{points.length > 1 ? `${shortDate(`${points[0]?.date ?? ""}T12:00:00`)}–now` : "Trend begins after another sync day"}</span><span>Balance</span></footer></article>;
    })}</div> : <div className="quiet-empty roomy">No investment accounts are linked.</div>}
    <p className="source-note">Account balances come from your linked institutions. Security-level holdings are shown only when the feed provides them.</p>
  </section>;
}

function RecurringsView({ data, insights }: { data: Dashboard; insights: Insights | undefined }) {
  const rows = insights?.recurring ?? [];
  return <section className="page-section"><div className="section-heading page-title"><div><p className="eyebrow">Bills & subscriptions</p><h1>Recurrings</h1></div></div><section className="recurring-hero"><span>Expected monthly</span><h2>{money(insights?.recurring_monthly_cents ?? 0, data.summary_currency)}</h2><p>{rows.length} recurring charge{rows.length === 1 ? "" : "s"} detected from posted history</p></section>{rows.length ? <div className="recurring-cards">{rows.map((item, index) => <article key={item.merchant}><span className={`recurring-mark tone-${index % 4}`}>{item.merchant.slice(0, 1).toUpperCase()}</span><div><strong>{item.merchant}</strong><small>{item.next_due ? `Expected around ${shortDate(`${item.next_due}T12:00:00`)}` : "Next date unavailable"} · {item.occurrences} seen</small></div><b>{money(item.average_cents, data.summary_currency)}</b></article>)}</div> : <p className="quiet-empty roomy">Recurring charges appear after at least two consistent payments.</p>}</section>;
}

function GoalsView({ data, goals, onGoal }: { data: Dashboard; goals: SavingsGoal[]; onGoal: (goal: SavingsGoal | null) => void }) {
  const activeMonths = data.monthly_history.filter((row) => row.income_cents !== 0 || row.spent_cents !== 0);
  const averageCashFlow = activeMonths.length ? activeMonths.reduce((sum, row) => sum + row.net_cents, 0) / activeMonths.length : 0;
  return <section className="page-section"><div className="section-heading page-title"><div><p className="eyebrow">Future plans</p><h1>Goals</h1></div><button className="round-action" aria-label="Add savings goal" onClick={() => onGoal(null)}><Icon name="plus" /></button></div>{goals.length ? <div className="goal-gallery">{goals.map((goal, index) => { const pct = Math.min(100, Math.round(goal.saved_cents / goal.target_cents * 100)); const months = averageCashFlow > 0 ? Math.ceil(Math.max(0, goal.target_cents - goal.saved_cents) / averageCashFlow) : null; return <button className={`goal-hero-card tone-${index % 4}`} key={goal.id} onClick={() => onGoal(goal)}><span className="progress-ring jumbo" style={{ background: `conic-gradient(var(--teal) ${pct * 3.6}deg, var(--surface-2) 0deg)` }}><i>{pct}%</i></span><span><small>{goal.target_date ? `Target ${shortDate(`${goal.target_date}T12:00:00`)}` : "Savings goal"}</small><strong>{goal.name}</strong><b>{money(goal.saved_cents, data.summary_currency)} <em>of {money(goal.target_cents, data.summary_currency)}</em></b><u>{months ? `About ${months} month${months === 1 ? "" : "s"} at your recent pace` : "Add positive monthly cash flow for a projection"}</u></span></button>; })}</div> : <div className="goal-empty"><span className="progress-ring jumbo" style={{ background: "conic-gradient(var(--teal) 0deg, var(--surface-2) 0deg)" }}><i>0%</i></span><h2>Give your savings a destination</h2><p>Track progress toward an emergency fund, purchase, or any other target.</p><button className="primary" onClick={() => onGoal(null)}>Create a goal</button></div>}</section>;
}

function InsightsView({ data, insights, goals, transactions, recap, loadingRecap, onRecap, onPayday, onGoal, onOpenTransaction }: { data: Dashboard; insights: Insights | undefined; goals: SavingsGoal[]; transactions: Transaction[]; recap: WeeklyRecap | null; loadingRecap: boolean; onRecap: () => void; onPayday: (day: number) => void; onGoal: (goal: SavingsGoal | null) => void; onOpenTransaction: (id: number) => void }) {
  const [recapDetail, setRecapDetail] = useState<"income" | "spending" | null>(null);
  const history = data.monthly_history.map((row) => ({ ...row, label: new Intl.DateTimeFormat(undefined, { month: "short" }).format(new Date(`${row.month}-01T12:00:00`)), spent: row.spent_cents / 100, income: row.income_cents / 100 }));
  const activeMonths = history.filter((row) => row.income_cents !== 0 || row.spent_cents !== 0);
  const averageMonthlyCashFlow = activeMonths.length ? activeMonths.reduce((sum, row) => sum + row.net_cents, 0) / activeMonths.length : 0;
  const projectedMonthlyContribution = Math.max(0, averageMonthlyCashFlow);
  const selectedMonth = history.at(-1)?.month ?? monthKey(new Date());
  const spendingByPerson = new Map<string, number>();
  for (const row of transactions) {
    if (row.account_type === "investment" || !row.posted_at.startsWith(selectedMonth) || row.amount_cents >= 0 || row.category === "Transfer") continue;
    const personTag = row.tags.find((tag) => /^person:/i.test(tag));
    if (!personTag) continue;
    const person = visibleTag(personTag).trim();
    if (person) spendingByPerson.set(person, (spendingByPerson.get(person) ?? 0) + Math.abs(row.amount_cents));
  }
  const people = [...spendingByPerson.entries()].map(([name, spent_cents]) => ({ name, spent_cents })).sort((a, b) => b.spent_cents - a.spent_cents);
  const recapRows = recapDetail && recap ? recap.transactions.filter((row) => row.flow === recapDetail) : [];
  const previousMonth = data.monthly_history.at(-2) ?? null;
  const netIncome = data.income_cents - data.spent_cents;
  const previousNet = previousMonth ? previousMonth.income_cents - previousMonth.spent_cents : null;
  const reviewProgress = data.transaction_count > 0 ? Math.round((data.transaction_count - data.needs_review) / data.transaction_count * 100) : 100;
  return <section className="page-section dashboard-page"><div className="section-heading page-title"><div><p className="eyebrow">Your money</p><h1>Dashboard</h1></div></div>
    <section className="month-review-hero"><div><p className="eyebrow">{monthLabel(selectedMonth)} in review</p><h2 className={netIncome < 0 ? "negative" : "positive-flow"}>{netIncome >= 0 ? "+" : ""}{money(netIncome, data.summary_currency)}</h2><span>Net income</span>{previousNet !== null && <small className={netIncome - previousNet >= 0 ? "positive-flow" : "negative"}>{netIncome - previousNet >= 0 ? "▲" : "▼"} {money(Math.abs(netIncome - previousNet), data.summary_currency)} from last month</small>}</div><span className="progress-ring review-ring" style={{ background: `conic-gradient(var(--teal) ${reviewProgress * 3.6}deg, var(--surface-2) 0deg)` }}><i>{reviewProgress}%<small>reviewed</small></i></span></section>
    <div className="review-card-grid"><button className="review-card" onClick={() => { const first = transactions.find((row) => !row.reviewed && row.account_type !== "investment"); if (first) onOpenTransaction(first.id); }}><span>Transactions to review</span><strong>{data.needs_review}</strong><small>{data.needs_review ? "Open the next item" : "Everything is tidy"}</small></button><article className="review-card"><span>Net worth</span><strong>{money(data.net_worth_cents, data.summary_currency)}</strong><small>{money(data.asset_cents, data.summary_currency)} assets</small></article></div>
    <section className="spending-visual"><div><p className="eyebrow">Six-month spending</p><h2>{money(data.spent_cents, data.summary_currency)}</h2><span>Spent in {monthLabel(selectedMonth)}</span></div><div className="history-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={history}><XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--dim)", fontSize: 11 }} /><YAxis hide /><Tooltip formatter={(value, name) => [money(Number(value) * 100, data.summary_currency), name === "spent" ? "Spent" : "Income"]}/><Bar dataKey="spent" fill="var(--accent)" radius={[5,5,0,0]} /><Bar dataKey="income" fill="var(--teal)" radius={[5,5,0,0]} /></BarChart></ResponsiveContainer></div></section>
    <section className="feature-panel people-panel"><div className="section-heading"><div><p className="eyebrow">Household view</p><h2>Spending by person</h2></div></div>{people.length ? <div className="people-grid">{people.map((person) => <article className="person-card" key={person.name}><span className="person-mark">{person.name.slice(0, 1).toUpperCase()}</span><div><strong>{person.name}</strong><small>{money(person.spent_cents, data.summary_currency)} spent in {monthLabel(selectedMonth)}</small></div></article>)}</div> : <div className="people-empty"><p>Assign a person in transaction details to compare household spending here.</p></div>}</section>
    <div className="insight-grid"><section className="insight-card safe-card"><p className="eyebrow">Safe to spend</p>{insights?.safe_to_spend_cents !== null && insights?.safe_to_spend_cents !== undefined ? <><h2>{money(insights.safe_to_spend_cents, data.summary_currency)} <small>/ day</small></h2><p>After detected bills for the next {insights.days_to_payday} days.</p></> : <><h2>Set payday</h2><p>Add your usual payday to calculate a daily amount after upcoming bills.</p><label className="inline-field"><span>Day of month</span><input aria-label="Payday day of month" type="number" min="1" max="31" defaultValue="15" /><button className="primary" onClick={(event) => { const input = event.currentTarget.parentElement?.querySelector("input"); const day = Number(input?.value); if (day >= 1 && day <= 31) onPayday(day); }}>Save</button></label></>}</section><section className="insight-card"><p className="eyebrow">Recurring radar</p><h2>{money(insights?.recurring_monthly_cents ?? 0, data.summary_currency)}</h2><p>{insights?.recurring.length ?? 0} detected monthly charges</p></section></div>
    <section className="feature-panel"><div className="section-heading"><div><p className="eyebrow">Worth a look</p><h2>Anomaly alerts</h2></div><span className="count-badge">{insights?.anomalies.length ?? 0}</span></div>{insights?.anomalies.length ? <div className="alert-list">{insights.anomalies.map((item) => <button key={item.id} onClick={() => onOpenTransaction(item.id)}><span><strong>{item.merchant}</strong><small>{item.reason} · {shortDate(item.posted_at)}</small></span><b>{money(item.amount_cents, data.summary_currency)}</b></button>)}</div> : <p className="quiet-empty">No unusually large merchant charges detected.</p>}</section>
    <section className="feature-panel"><div className="section-heading"><div><p className="eyebrow">Subscriptions & bills</p><h2>Recurring charges</h2></div></div>{insights?.recurring.length ? <div className="recurring-list">{insights.recurring.map((item) => <article key={item.merchant}><div><strong>{item.merchant}</strong><small>{item.next_due ? `Expected around ${shortDate(`${item.next_due}T12:00:00`)}` : "Next date unavailable"} · {item.occurrences} seen</small></div><b>{money(item.average_cents, data.summary_currency)}</b></article>)}</div> : <p className="quiet-empty">Recurring charges appear after at least two consistent payments.</p>}</section>
    <section className="feature-panel"><div className="section-heading"><div><p className="eyebrow">Targets</p><h2>Savings goals</h2></div><button className="text-button" onClick={() => onGoal(null)}><Icon name="plus" /> Add goal</button></div>{goals.length ? <div className="goals-grid">{goals.map((goal) => { const pct = Math.min(100, Math.round(goal.saved_cents / goal.target_cents * 100)); const months = projectedMonthlyContribution > 0 ? Math.ceil(Math.max(0, goal.target_cents - goal.saved_cents) / projectedMonthlyContribution) : null; return <button className="goal-card" key={goal.id} onClick={() => onGoal(goal)}><span className="progress-ring" style={{ background: `conic-gradient(var(--teal) ${pct * 3.6}deg, var(--surface-2) 0deg)` }}><i>{pct}%</i></span><span><strong>{goal.name}</strong><small>{money(goal.saved_cents, data.summary_currency)} of {money(goal.target_cents, data.summary_currency)}</small><em>{goal.target_date ? `Target ${shortDate(`${goal.target_date}T12:00:00`)}` : months ? `Projected in about ${months} month${months === 1 ? "" : "s"} from average cash flow` : "No projection while average cash flow is negative"}</em></span></button>; })}</div> : <p className="quiet-empty">Add a goal to track progress and see a completion projection.</p>}</section>
    <section className="feature-panel"><div className="section-heading"><div><p className="eyebrow">Compared with last month</p><h2>Category movement</h2></div></div>{insights?.comparisons.length ? <div className="comparison-list">{insights.comparisons.slice(0, 8).map((item) => <div key={item.category}><span><strong>{item.category}</strong><small>{item.year_ago_cents === null ? "Year-over-year appears when that history is available" : `${money(item.year_ago_cents, data.summary_currency)} one year ago`}</small></span><b className={(item.change_percent ?? 0) > 0 ? "negative" : "positive-flow"}>{item.change_percent === null ? "New" : `${item.change_percent > 0 ? "+" : ""}${item.change_percent}%`}</b></div>)}</div> : <p className="quiet-empty">Comparison data appears after spending posts in consecutive months.</p>}</section>
    <section className="feature-panel recap-panel"><div className="section-heading"><div><p className="eyebrow">Last seven days</p><h2>Weekly recap</h2></div><button className="secondary" onClick={() => { setRecapDetail(null); onRecap(); }} disabled={loadingRecap}>{loadingRecap ? "Writing…" : recap ? "Refresh recap" : "Generate recap"}</button></div><p>{recap?.summary ?? "Generate a short recap from your latest posted transactions."}</p>{recap && <><div className="recap-period">{shortDate(recap.period_start)}–{shortDate(recap.period_end)} · Transfers excluded</div><div className="recap-metrics"><button className={recapDetail === "income" ? "active" : ""} aria-expanded={recapDetail === "income"} onClick={() => setRecapDetail((current) => current === "income" ? null : "income")}><span>Income</span><strong>{money(recap.income_cents, data.summary_currency)}</strong><small>{recap.transactions.filter((row) => row.flow === "income").length} transaction{recap.transactions.filter((row) => row.flow === "income").length === 1 ? "" : "s"} · View details</small></button><button className={recapDetail === "spending" ? "active" : ""} aria-expanded={recapDetail === "spending"} onClick={() => setRecapDetail((current) => current === "spending" ? null : "spending")}><span>Spending</span><strong>{money(recap.spent_cents, data.summary_currency)}</strong><small>{recap.transactions.filter((row) => row.flow === "spending").length} transaction{recap.transactions.filter((row) => row.flow === "spending").length === 1 ? "" : "s"} · View details</small></button></div>{recapDetail && <div className="recap-details"><div className="recap-details-head"><div><p className="eyebrow">Included transactions</p><h3>{recapDetail === "income" ? "Income details" : "Spending details"}</h3></div><strong>{money(recapDetail === "income" ? recap.income_cents : recap.spent_cents, data.summary_currency)}</strong></div>{recapDetail === "spending" && recap.categories.length > 0 && <div className="recap-category-breakdown">{recap.categories.map((item) => <span key={item.category}>{item.category}<b>{money(item.spent_cents, data.summary_currency)}</b></span>)}</div>}{recapRows.length ? <div className="recap-transaction-list">{recapRows.map((row) => <button key={row.id} onClick={() => onOpenTransaction(row.id)}><span><strong>{row.merchant}</strong><small>{shortDate(row.posted_at)} · {row.category}</small></span><b className={row.flow === "income" ? "positive-flow" : ""}>{row.flow === "income" ? "+" : "−"}{money(Math.abs(row.amount_cents), row.currency)}</b></button>)}</div> : <p className="quiet-empty">No {recapDetail} transactions were included.</p>}</div>}</>}</section>
  </section>;
}

function AccountsView({ data, refreshing, onConnect, onRefresh }: { data: Dashboard; refreshing: boolean; onConnect: () => void; onRefresh: () => void }) {
  const sections = [
    { key: "checking", label: "Checking", note: "Everyday cash accounts" },
    { key: "savings", label: "Savings", note: "Savings accounts" },
    { key: "cash", label: "Cash", note: "Money market & cash management" },
    { key: "credit", label: "Credit cards", note: "Cards & credit lines" },
    { key: "loan", label: "Loans", note: "Mortgages & installment loans" },
    { key: "other", label: "Other", note: "Unclassified accounts" },
  ];
  const grouped = sections.map((section) => ({ ...section, accounts: data.accounts.filter((account) => account.account_type === section.key || (section.key === "other" && !["checking", "savings", "cash", "credit", "investment", "loan"].includes(account.account_type))) })).filter((section) => section.accounts.length > 0);
  return <section className="page-section"><div className="section-heading page-title"><div><p className="eyebrow">Balances</p><h1>Accounts</h1></div>{!data.simplefin_connected && <button className="round-action" aria-label="Connect SimpleFIN" onClick={onConnect}><Icon name="plus" /></button>}</div><section className="connection-strip"><div><strong>SimpleFIN connection</strong><p>{syncText(data.last_sync_at)}{data.refresh_due && data.last_sync_at ? " · Refresh recommended" : ""}</p></div><button className="secondary" onClick={data.simplefin_connected ? onRefresh : onConnect} disabled={refreshing}>{refreshing ? "Syncing…" : data.simplefin_connected ? "Refresh" : "Connect"}</button></section>{grouped.length ? <div className="account-groups">{grouped.map((group) => <section className={`account-group account-group-${group.key}`} key={group.key}><div className="account-group-heading"><div><h2>{group.label}</h2><p>{group.note}</p></div><strong>{money(group.accounts.reduce((sum, account) => sum + account.balance_cents, 0), group.accounts[0]?.currency ?? data.summary_currency)}</strong></div><div className="account-list">{group.accounts.map((account) => <article className="account-row" key={account.id}><div className="account-icon"><Icon name="bank" /></div><div><strong>{account.name}</strong><span>{account.institution ?? (account.provider === "manual" ? "Manual account" : "Institution unavailable")}</span></div><b>{money(account.balance_cents, account.currency)}</b></article>)}</div></section>)}</div> : <div className="quiet-empty roomy">No accounts imported yet.</div>}<p className="source-note">SimpleFIN is read-only. The setup token is claimed once and never saved; its private access connection is reused for automatic refreshes.</p></section>;
}

export function App() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("dashboard");
  const [month, setMonth] = useState(monthKey(new Date()));
  const [search, setSearch] = useState("");
  const [reviewOnly, setReviewOnly] = useState(false);
  const [autoOrganizeStarted, setAutoOrganizeStarted] = useState(false);
  const [autoRefreshStarted, setAutoRefreshStarted] = useState(false);
  const [connectionPrompted, setConnectionPrompted] = useState(false);
  const [modal, setModal] = useState<"connect" | "manual" | "budget" | "edit" | "goal" | "rules" | null>(null);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [editingGoal, setEditingGoal] = useState<SavingsGoal | null>(null);
  const [budgetDraft, setBudgetDraft] = useState({ category: "Food & dining", cents: 0 });
  const [weeklyRecap, setWeeklyRecap] = useState<WeeklyRecap | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const bounds = useMemo(() => monthBounds(month), [month]);
  const dashboard = useQuery({ queryKey: ["dashboard", month, bounds.start_ms, bounds.end_ms], queryFn: () => api.getDashboard({ month, ...bounds }) });
  const transactions = useQuery({ queryKey: ["transactions"], queryFn: () => api.listTransactions({ limit: 1000 }) });
  const categoriesQuery = useQuery({ queryKey: ["categories"], queryFn: () => api.getCategories({}) });
  const recommendationsQuery = useQuery({ queryKey: ["budget-recommendations", month], queryFn: () => api.getBudgetRecommendations({ month }) });
  const insightsQuery = useQuery({ queryKey: ["insights", month], queryFn: () => api.getInsights({ now_ms: Date.now(), month }) });
  const goalsQuery = useQuery({ queryKey: ["savings-goals"], queryFn: () => api.listSavingsGoals({}) });
  const rulesQuery = useQuery({ queryKey: ["transaction-rules"], queryFn: () => api.listTransactionRules({}) });
  const categories = categoriesQuery.data?.categories ?? fallbackCategories;
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ["dashboard"] }), queryClient.invalidateQueries({ queryKey: ["transactions"] }), queryClient.invalidateQueries({ queryKey: ["budget-recommendations"] }), queryClient.invalidateQueries({ queryKey: ["insights"] }), queryClient.invalidateQueries({ queryKey: ["savings-goals"] }), queryClient.invalidateQueries({ queryKey: ["transaction-rules"] })]);

  const importMutation = useMutation({ mutationFn: (token: string) => api.importFromSimpleFin({ setup_token: token }), onSuccess: async (result) => { setNotice(result.message); if (result.ok) { setModal(null); setAutoOrganizeStarted(false); await refresh(); } } });
  const refreshSimpleFinMutation = useMutation({ mutationFn: (_options: { silent: boolean }) => api.refreshSimpleFin({}), onSuccess: async (result, options) => { if (result.needs_setup) setModal("connect"); if (!options.silent || !result.ok) setNotice(result.message); if (result.ok) { setAutoOrganizeStarted(false); await refresh(); } } });
  const organizeMutation = useMutation({ mutationFn: () => api.autoOrganizeFinancialData({ limit: 600 }), onSuccess: async (result) => { if (result.categorized_count || result.review_count || result.accounts_organized) setNotice(`Auto-categorized ${result.categorized_count} transaction${result.categorized_count === 1 ? "" : "s"}; ${result.review_count} need review.`); if (result.has_more) setAutoOrganizeStarted(false); await refresh(); } });
  const manualMutation = useMutation({ mutationFn: (payload: { posted_at: string; description: string; amount_cents: number; category: string | null; account_id: number | null }) => api.addManualTransaction(payload), onSuccess: async () => { setNotice("Transaction added."); setModal(null); await refresh(); } });
  const budgetMutation = useMutation({ mutationFn: (payload: { category: string; amount_cents: number }) => api.setBudget({ month, ...payload }), onSuccess: async () => { setNotice("Budget updated."); setModal(null); await refresh(); } });
  const updateMutation = useMutation({ mutationFn: (payload: { id: number; category: string | null; reviewed: boolean; tags: string[]; splits: Array<{ category: string; amount_cents: number }>; create_merchant_rule: boolean }) => api.saveTransactionDetails(payload), onSuccess: async (_result, payload) => { setNotice(payload.create_merchant_rule ? "Transaction saved and merchant rule created." : "Transaction details saved."); setModal(null); setEditing(null); await refresh(); } });
  const saveRuleMutation = useMutation({ mutationFn: (payload: Parameters<typeof api.saveTransactionRule>[0]) => api.saveTransactionRule(payload), onSuccess: async (result) => { setNotice(`Rule saved${result.applied_count ? ` and applied to ${result.applied_count} transaction${result.applied_count === 1 ? "" : "s"}` : ""}.`); await refresh(); } });
  const deleteRuleMutation = useMutation({ mutationFn: (id: number) => api.deleteTransactionRule({ id }), onSuccess: async () => { setNotice("Rule deleted."); await refresh(); } });
  const markAllMutation = useMutation({ mutationFn: () => api.markAllReviewed({}), onSuccess: async (result) => { setNotice(`${result.reviewed_count} transaction${result.reviewed_count === 1 ? "" : "s"} marked reviewed.`); await refresh(); } });
  const paydayMutation = useMutation({ mutationFn: (day: number) => api.setPaydayDay({ day }), onSuccess: async () => { setNotice("Payday saved."); await queryClient.invalidateQueries({ queryKey: ["insights"] }); } });
  const goalMutation = useMutation({ mutationFn: (payload: { id: number | null; name: string; target_cents: number; saved_cents: number; target_date: string | null }) => api.saveSavingsGoal(payload), onSuccess: async () => { setModal(null); setEditingGoal(null); setNotice("Savings goal saved."); await refresh(); } });
  const recapMutation = useMutation({ mutationFn: () => api.generateWeeklyRecap({ now_ms: Date.now() }), onSuccess: (result) => setWeeklyRecap(result) });

  const data = dashboard.data;
  useEffect(() => {
    if (!data?.simplefin_connected || autoRefreshStarted) return;
    setAutoRefreshStarted(true);
    refreshSimpleFinMutation.mutate({ silent: true });
  }, [data?.simplefin_connected, autoRefreshStarted]);
  useEffect(() => {
    if (!data?.last_sync_at || data.simplefin_connected || connectionPrompted) return;
    setConnectionPrompted(true);
    setNotice("The earlier app did not retain SimpleFIN’s reusable connection. Reconnect once to enable automatic refreshes.");
    setModal("connect");
  }, [connectionPrompted, data?.last_sync_at, data?.simplefin_connected]);
  useEffect(() => {
    if (autoOrganizeStarted || refreshSimpleFinMutation.isPending) return;
    const hasPendingTransactions = transactions.data?.transactions.some((row) => row.account_type !== "investment" && row.categorization_status === "pending") ?? false;
    const hasUngroupedAccounts = data?.accounts.some((account) => account.classification_version < 2) ?? false;
    if (!hasPendingTransactions && !hasUngroupedAccounts) return;
    setAutoOrganizeStarted(true);
    organizeMutation.mutate();
  }, [autoOrganizeStarted, data?.accounts, refreshSimpleFinMutation.isPending, transactions.data?.transactions]);

  const nav: Array<{ id: Tab; label: string }> = [{ id: "cashflow", label: "Cash flow" }, { id: "accounts", label: "Accounts" }, { id: "investments", label: "Investments" }, { id: "transactions", label: "Transactions" }, { id: "dashboard", label: "Dashboard" }, { id: "categories", label: "Categories" }, { id: "recurrings", label: "Recurrings" }, { id: "goals", label: "Goals" }];
  const openTransaction = (id: number) => { const row = transactions.data?.transactions.find((item) => item.id === id); if (row) { setEditing(row); setModal("edit"); } };
  const openGoal = (goal: SavingsGoal | null) => { setEditingGoal(goal); setModal("goal"); };
  return <div className="app-shell"><SafeAreaTopScrim backgroundColor="var(--bg)" /><aside className="side-nav" aria-label="Main navigation">{nav.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}><Icon name={item.id} /><span>{item.label}</span></button>)}</aside><main className="main-content"><header className="topbar"><MonthStepper month={month} onChange={setMonth} />{data && <div className="topbar-actions"><span className={`sync-chip ${data.refresh_due ? "due" : ""}`}>{syncText(data.last_sync_at)}</span>{data.simplefin_connected && <button className="refresh-button" onClick={() => refreshSimpleFinMutation.mutate({ silent: false })} disabled={refreshSimpleFinMutation.isPending}>{refreshSimpleFinMutation.isPending ? "Syncing…" : "Refresh"}</button>}</div>}</header><nav className="section-tabs" aria-label="Financial sections">{nav.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}><Icon name={item.id}/><span>{item.label}</span></button>)}</nav>{dashboard.isPending ? <div className="loading-state"><span /><p>Reading your ledger…</p></div> : dashboard.error || !data ? <div className="error-state"><h2>Couldn’t load your finances</h2><button className="secondary" onClick={() => dashboard.refetch()}>Try again</button></div> : tab === "cashflow" ? <Overview data={data} month={month} onConnect={() => setModal("connect")} onManual={() => setModal("manual")} onReview={() => { setReviewOnly(true); setTab("transactions"); }} /> : tab === "accounts" ? <AccountsView data={data} refreshing={refreshSimpleFinMutation.isPending} onConnect={() => setModal("connect")} onRefresh={() => refreshSimpleFinMutation.mutate({ silent: false })} /> : tab === "investments" ? <InvestmentsView data={data} /> : tab === "transactions" ? <TransactionsView rows={transactions.data?.transactions ?? []} categories={categories} month={month} currency={data.summary_currency} search={search} setSearch={setSearch} reviewOnly={reviewOnly} setReviewOnly={setReviewOnly} onManual={() => setModal("manual")} onRules={() => setModal("rules")} onMarkAll={() => markAllMutation.mutate()} markingAll={markAllMutation.isPending} onEdit={(row) => { setEditing(row); setModal("edit"); }} /> : tab === "dashboard" ? <InsightsView data={data} insights={insightsQuery.data} goals={goalsQuery.data?.goals ?? []} transactions={transactions.data?.transactions ?? []} recap={weeklyRecap} loadingRecap={recapMutation.isPending} onRecap={() => recapMutation.mutate()} onPayday={(day) => paydayMutation.mutate(day)} onGoal={openGoal} onOpenTransaction={openTransaction} /> : tab === "categories" ? <PlanView data={data} month={month} recommendations={recommendationsQuery.data?.recommendations ?? []} onBudget={(category, cents) => { setBudgetDraft({ category, cents }); setModal("budget"); }} onAccept={(category, cents) => budgetMutation.mutate({ category, amount_cents: cents })} /> : tab === "recurrings" ? <RecurringsView data={data} insights={insightsQuery.data} /> : <GoalsView data={data} goals={goalsQuery.data?.goals ?? []} onGoal={openGoal} />}</main>{notice && <button className="toast" onClick={() => setNotice(null)} aria-label="Dismiss notification">{notice}</button>}
    {modal === "connect" && <ConnectModal loading={importMutation.isPending} message={importMutation.data && !importMutation.data.ok ? importMutation.data.message : null} onClose={() => setModal(null)} onSubmit={(token) => importMutation.mutate(token)} />}
    {modal === "manual" && <ManualModal accounts={data?.accounts ?? []} categories={categories} loading={manualMutation.isPending} onClose={() => setModal(null)} onSubmit={(payload) => manualMutation.mutate(payload)} />}
    {modal === "budget" && <BudgetModal initial={budgetDraft} categories={categories} currency={data?.summary_currency ?? "USD"} loading={budgetMutation.isPending} onClose={() => setModal(null)} onSubmit={(payload) => budgetMutation.mutate(payload)} />}
    {modal === "edit" && editing && <EditModal transaction={editing} allTransactions={transactions.data?.transactions ?? []} categories={categories} loading={updateMutation.isPending} onClose={() => { setModal(null); setEditing(null); }} onSubmit={(payload) => updateMutation.mutate({ id: editing.id, ...payload })} />}
    {modal === "goal" && <GoalModal goal={editingGoal} currency={data?.summary_currency ?? "USD"} loading={goalMutation.isPending} onClose={() => { setModal(null); setEditingGoal(null); }} onSubmit={(payload) => goalMutation.mutate(payload)} />}
    {modal === "rules" && <RulesModal rules={rulesQuery.data?.rules ?? []} accounts={data?.accounts ?? []} categories={categories} loading={saveRuleMutation.isPending || deleteRuleMutation.isPending} onClose={() => setModal(null)} onSave={(payload) => saveRuleMutation.mutate(payload)} onDelete={(id) => deleteRuleMutation.mutate(id)} />}
  </div>;
}

function ConnectModal({ loading, message, onClose, onSubmit }: { loading: boolean; message: string | null; onClose: () => void; onSubmit: (token: string) => void }) {
  const [token, setToken] = useState("");
  return <Modal title="Connect SimpleFIN" onClose={onClose}><p className="modal-intro">Create a one-time setup token in SimpleFIN Bridge. The app claims it once, stores the private connection on the server, and refreshes automatically from then on.</p><ol className="steps"><li>Open SimpleFIN Bridge and connect an institution.</li><li>Create a new one-time setup token.</li><li>Paste it below once to establish the connection.</li></ol><a className="external-link" href="https://bridge.simplefin.org/simplefin/create" target="_blank" rel="noreferrer">Open SimpleFIN Bridge ↗</a><form onSubmit={(event) => { event.preventDefault(); if (token.trim()) onSubmit(token.trim()); }}><label className="field"><span>Setup token</span><input type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} aria-label="SimpleFIN setup token" /></label><p className="field-note">The one-time token is never saved. You’ll only need another if SimpleFIN revokes or expires the saved connection.</p>{message && <p className="form-error">{message}</p>}<button className="primary full" disabled={loading || token.trim().length < 20}>{loading ? "Connecting…" : "Connect and sync"}</button></form></Modal>;
}

function ManualModal({ accounts, categories, loading, onClose, onSubmit }: { accounts: Dashboard["accounts"]; categories: string[]; loading: boolean; onClose: () => void; onSubmit: (payload: { posted_at: string; description: string; amount_cents: number; category: string | null; account_id: number | null }) => void }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10)); const [description, setDescription] = useState(""); const [amount, setAmount] = useState(""); const [flow, setFlow] = useState<"expense" | "income">("expense"); const [category, setCategory] = useState(""); const [accountId, setAccountId] = useState("");
  const submit = (event: FormEvent) => { event.preventDefault(); const cents = Math.round(Number(amount) * 100) * (flow === "expense" ? -1 : 1); if (Number.isFinite(cents) && description.trim()) onSubmit({ posted_at: `${date}T12:00:00`, description: description.trim(), amount_cents: cents, category: category || null, account_id: accountId ? Number(accountId) : null }); };
  return <Modal title="Add transaction" onClose={onClose}><form className="form-grid" onSubmit={submit}><div className="segmented"><button type="button" className={flow === "expense" ? "active" : ""} onClick={() => setFlow("expense")}>Expense</button><button type="button" className={flow === "income" ? "active" : ""} onClick={() => setFlow("income")}>Income</button></div><label className="field"><span>Description</span><input value={description} onChange={(event) => setDescription(event.target.value)} required /></label><div className="two-fields"><label className="field"><span>Amount</span><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" required /></label><label className="field"><span>Date</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label></div><label className="field"><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">Uncategorized</option>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>{accounts.length > 0 && <label className="field"><span>Account</span><select value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">No account</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>}<button className="primary full" disabled={loading}>{loading ? "Saving…" : "Add transaction"}</button></form></Modal>;
}

function BudgetModal({ initial, categories, currency, loading, onClose, onSubmit }: { initial: { category: string; cents: number }; categories: string[]; currency: string; loading: boolean; onClose: () => void; onSubmit: (payload: { category: string; amount_cents: number }) => void }) {
  const [category, setCategory] = useState(initial.category); const [amount, setAmount] = useState(initial.cents ? String(initial.cents / 100) : "");
  return <Modal title="Set monthly budget" onClose={onClose}><form className="form-grid" onSubmit={(event) => { event.preventDefault(); const cents = Math.round(Number(amount) * 100); if (Number.isFinite(cents) && cents >= 0) onSubmit({ category, amount_cents: cents }); }}><label className="field"><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.filter((item) => item !== "Income" && item !== "Transfer").map((item) => <option key={item}>{item}</option>)}</select></label><label className="field"><span>Monthly limit ({currency})</span><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" required /></label><button className="primary full" disabled={loading}>{loading ? "Saving…" : "Save budget"}</button></form></Modal>;
}

function EditModal({ transaction, allTransactions, categories, loading, onClose, onSubmit }: { transaction: Transaction; allTransactions: Transaction[]; categories: string[]; loading: boolean; onClose: () => void; onSubmit: (payload: { category: string | null; reviewed: boolean; tags: string[]; splits: Array<{ category: string; amount_cents: number }>; create_merchant_rule: boolean }) => void }) {
  const [category, setCategory] = useState(transaction.category ?? "");
  const [createMerchantRule, setCreateMerchantRule] = useState(false);
  const [person, setPerson] = useState(visibleTag(transaction.tags.find((tag) => /^person:/i.test(tag)) ?? ""));
  const [tags, setTags] = useState(transaction.tags.filter((tag) => !/^person:/i.test(tag)).join(", "));
  const [splitEnabled, setSplitEnabled] = useState(transaction.splits.length > 0);
  const [splits, setSplits] = useState<Array<{ category: string; amount: string }>>(transaction.splits.length ? transaction.splits.map((item) => ({ category: item.category, amount: String(item.amount_cents / 100) })) : [{ category: transaction.category ?? categories[0] ?? "Other", amount: String(Math.abs(transaction.amount_cents) / 100) }]);
  const merchant = transaction.payee ?? transaction.description;
  const merchantRows = allTransactions.filter((row) => (row.payee ?? row.description) === merchant);
  const merchantSpent = merchantRows.filter((row) => row.amount_cents < 0).reduce((sum, row) => sum + Math.abs(row.amount_cents), 0);
  const average = merchantRows.length ? Math.round(merchantSpent / merchantRows.length) : 0;
  const monthly = new Map<string, number>();
  for (const row of merchantRows) if (row.amount_cents < 0) monthly.set(row.posted_at.slice(0, 7), (monthly.get(row.posted_at.slice(0, 7)) ?? 0) + Math.abs(row.amount_cents));
  const trend = [...monthly.entries()].sort().slice(-6).map(([key, value]) => ({ label: new Intl.DateTimeFormat(undefined, { month: "short" }).format(new Date(`${key}-01T12:00:00`)), value: value / 100 }));
  const addSplit = () => setSplits((current) => [...current, { category: categories[0] ?? "Other", amount: "" }]);
  return <Modal title="Transaction details" onClose={onClose}><div className="review-summary"><strong>{merchant}</strong><span>{money(transaction.amount_cents, transaction.currency)} · {shortDate(transaction.posted_at)}</span><div className="transaction-source"><Icon name="bank" /><span><b>{transaction.account_name ?? "No linked account"}</b><small>{transaction.account_institution ?? (transaction.account_name ? "Institution unavailable" : "Manual transaction")}</small></span></div></div>
    <section className="merchant-deep-dive"><div><span>Total</span><strong>{money(merchantSpent, transaction.currency)}</strong></div><div><span>Average</span><strong>{money(average, transaction.currency)}</strong></div><div><span>Frequency</span><strong>{merchantRows.length}×</strong></div>{trend.length > 1 && <div className="merchant-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={trend}><XAxis dataKey="label" hide/><Tooltip formatter={(value) => money(Number(value) * 100, transaction.currency)}/><Area dataKey="value" type="monotone" stroke="var(--blue)" fill="var(--soft-blue)" strokeWidth={2}/></AreaChart></ResponsiveContainer></div>}</section>
    <form className="form-grid" onSubmit={(event) => { event.preventDefault(); const splitPayload = splitEnabled ? splits.map((item) => ({ category: item.category, amount_cents: Math.round(Number(item.amount) * 100) })).filter((item) => item.amount_cents > 0) : []; onSubmit({ category: category || null, reviewed: true, tags: [...tags.split(",").map((tag) => tag.trim()).filter(Boolean), ...(person.trim() ? [`person:${person.trim()}`] : [])], splits: splitPayload, create_merchant_rule: createMerchantRule }); }}><label className="field"><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value)} disabled={splitEnabled}><option value="">Uncategorized</option>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>{!splitEnabled && category && <label className="check-field rule-check"><input type="checkbox" checked={createMerchantRule} onChange={(event) => setCreateMerchantRule(event.target.checked)} /><span>Always use this category for “{merchant}”</span></label>}<label className="field"><span>Person / household member (optional)</span><input value={person} onChange={(event) => setPerson(event.target.value)} placeholder="Name" /></label><label className="field"><span>Tags</span><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Shared, household, reimbursable" /></label><label className="check-field"><input type="checkbox" checked={splitEnabled} onChange={(event) => setSplitEnabled(event.target.checked)} /><span>Split across categories</span></label>{splitEnabled && <div className="split-list">{splits.map((item, index) => <div className="split-row" key={index}><select aria-label={`Split ${index + 1} category`} value={item.category} onChange={(event) => setSplits((current) => current.map((value, i) => i === index ? { ...value, category: event.target.value } : value))}>{categories.filter((value) => value !== "Income" && value !== "Transfer").map((value) => <option key={value}>{value}</option>)}</select><input aria-label={`Split ${index + 1} amount`} inputMode="decimal" value={item.amount} onChange={(event) => setSplits((current) => current.map((value, i) => i === index ? { ...value, amount: event.target.value } : value))}/><button type="button" aria-label={`Remove split ${index + 1}`} onClick={() => setSplits((current) => current.filter((_, i) => i !== index))}>×</button></div>)}<button type="button" className="text-button" onClick={addSplit}>+ Add split</button><small>Split total must equal {money(Math.abs(transaction.amount_cents), transaction.currency)}.</small></div>}<button className="primary full" disabled={loading}>{loading ? "Saving…" : "Save and mark reviewed"}</button></form></Modal>;
}

type RulePayload = Parameters<typeof api.saveTransactionRule>[0];

function RulesModal({ rules, accounts, categories, loading, onClose, onSave, onDelete }: { rules: TransactionRule[]; accounts: Dashboard["accounts"]; categories: string[]; loading: boolean; onClose: () => void; onSave: (payload: RulePayload) => void; onDelete: (id: number) => void }) {
  const [editingRule, setEditingRule] = useState<TransactionRule | null>(null);
  const [name, setName] = useState("");
  const [merchant, setMerchant] = useState("");
  const [description, setDescription] = useState("");
  const [minimum, setMinimum] = useState("");
  const [maximum, setMaximum] = useState("");
  const [accountId, setAccountId] = useState("");
  const [category, setCategory] = useState(categories[0] ?? "Other");
  const [applyExisting, setApplyExisting] = useState(true);
  const [error, setError] = useState("");
  const clear = () => { setEditingRule(null); setName(""); setMerchant(""); setDescription(""); setMinimum(""); setMaximum(""); setAccountId(""); setCategory(categories[0] ?? "Other"); setApplyExisting(true); setError(""); };
  const edit = (rule: TransactionRule) => { setEditingRule(rule); setName(rule.name); setMerchant(rule.merchant ?? ""); setDescription(rule.description_contains ?? ""); setMinimum(rule.min_amount_cents === null ? "" : String(rule.min_amount_cents / 100)); setMaximum(rule.max_amount_cents === null ? "" : String(rule.max_amount_cents / 100)); setAccountId(rule.account_id === null ? "" : String(rule.account_id)); setCategory(rule.category); setApplyExisting(true); setError(""); };
  const describe = (rule: TransactionRule) => [rule.merchant ? `Merchant is “${rule.merchant}”` : null, rule.description_contains ? `Description contains “${rule.description_contains}”` : null, rule.min_amount_cents !== null ? `At least ${money(rule.min_amount_cents)}` : null, rule.max_amount_cents !== null ? `At most ${money(rule.max_amount_cents)}` : null, rule.account_name ? `Account is ${rule.account_name}` : null].filter(Boolean).join(" · ");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const hasCondition = Boolean(merchant.trim() || description.trim() || minimum.trim() || maximum.trim() || accountId);
    const minCents = minimum.trim() ? Math.round(Number(minimum) * 100) : null;
    const maxCents = maximum.trim() ? Math.round(Number(maximum) * 100) : null;
    if (!hasCondition) { setError("Add at least one matching condition."); return; }
    if ((minCents !== null && (!Number.isFinite(minCents) || minCents < 0)) || (maxCents !== null && (!Number.isFinite(maxCents) || maxCents < 0))) { setError("Enter valid positive dollar amounts."); return; }
    if (minCents !== null && maxCents !== null && minCents > maxCents) { setError("Minimum amount cannot exceed maximum amount."); return; }
    onSave({ id: editingRule?.id ?? null, name: name.trim(), merchant: merchant.trim() || null, description_contains: description.trim() || null, min_amount_cents: minCents, max_amount_cents: maxCents, account_id: accountId ? Number(accountId) : null, category: category as RulePayload["category"], apply_existing: applyExisting });
  };
  return <Modal title="Transaction rules" onClose={onClose}><p className="modal-intro">Rules run before automatic categorization. Add one or more conditions; when every condition matches, the category is applied automatically.</p>
    {rules.length > 0 && <div className="rule-list">{rules.map((rule) => <article className="rule-row" key={rule.id}><button className="rule-main" type="button" onClick={() => edit(rule)}><span><strong>{rule.name}</strong><small>{describe(rule)}</small></span><b>{rule.category}</b><em>{rule.matching_count} matching</em></button><button className="rule-delete" type="button" aria-label={`Delete ${rule.name} rule`} onClick={() => onDelete(rule.id)} disabled={loading}>Delete</button></article>)}</div>}
    <form className="form-grid rule-form" onSubmit={submit}><div className="rule-form-heading"><h3>{editingRule ? "Edit rule" : "New rule"}</h3>{editingRule && <button className="text-button" type="button" onClick={clear}>New rule</button>}</div><label className="field"><span>Rule name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Coffee shops" required /></label><label className="field"><span>Merchant is exactly (optional)</span><input value={merchant} onChange={(event) => setMerchant(event.target.value)} placeholder="Starbucks" /></label><label className="field"><span>Description contains (optional)</span><input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="monthly membership" /></label><div className="two-fields"><label className="field"><span>Minimum amount</span><input inputMode="decimal" value={minimum} onChange={(event) => setMinimum(event.target.value)} placeholder="0.00" /></label><label className="field"><span>Maximum amount</span><input inputMode="decimal" value={maximum} onChange={(event) => setMaximum(event.target.value)} placeholder="No maximum" /></label></div><label className="field"><span>Account (optional)</span><select value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">Any account</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><label className="field"><span>Assign category</span><select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label><label className="check-field"><input type="checkbox" checked={applyExisting} onChange={(event) => setApplyExisting(event.target.checked)} /><span>Apply to existing matching transactions</span></label>{error && <p className="form-error">{error}</p>}<button className="primary full" disabled={loading}>{loading ? "Saving…" : editingRule ? "Update rule" : "Create rule"}</button></form>
  </Modal>;
}

function GoalModal({ goal, currency, loading, onClose, onSubmit }: { goal: SavingsGoal | null; currency: string; loading: boolean; onClose: () => void; onSubmit: (payload: { id: number | null; name: string; target_cents: number; saved_cents: number; target_date: string | null }) => void }) {
  const [name, setName] = useState(goal?.name ?? "");
  const [target, setTarget] = useState(goal ? String(goal.target_cents / 100) : "");
  const [saved, setSaved] = useState(goal ? String(goal.saved_cents / 100) : "0");
  const [date, setDate] = useState(goal?.target_date ?? "");
  return <Modal title={goal ? "Update savings goal" : "New savings goal"} onClose={onClose}><form className="form-grid" onSubmit={(event) => { event.preventDefault(); const targetCents = Math.round(Number(target) * 100); const savedCents = Math.round(Number(saved) * 100); if (name.trim() && targetCents > 0 && savedCents >= 0) onSubmit({ id: goal?.id ?? null, name: name.trim(), target_cents: targetCents, saved_cents: savedCents, target_date: date || null }); }}><label className="field"><span>Goal name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Emergency fund" required /></label><div className="two-fields"><label className="field"><span>Target ({currency})</span><input inputMode="decimal" value={target} onChange={(event) => setTarget(event.target.value)} required /></label><label className="field"><span>Saved ({currency})</span><input inputMode="decimal" value={saved} onChange={(event) => setSaved(event.target.value)} required /></label></div><label className="field"><span>Target date (optional)</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><button className="primary full" disabled={loading}>{loading ? "Saving…" : "Save goal"}</button></form></Modal>;
}
