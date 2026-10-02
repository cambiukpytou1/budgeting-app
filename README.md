# Budgeting App

Personal finance dashboard with live bank sync via
[SimpleFIN](https://simplefin.org): auto-categorized transactions with a manual
review queue, custom categorization rules, 90-day budget recommendations,
cumulative cash-flow and net-worth charts, savings goals, recurring-charge
tracking, and CSV/PDF export.

## Stack

- Client: React + TypeScript (`client/`)
- Server: TypeScript actions + SQLite via Drizzle (`server/`, `drizzle/`)
- Runtime: Bun

## Quick start

```bash
bun install
# run the client and server per space.json
```

## Database

- The full schema is defined by the versioned SQL migrations in `drizzle/`
  (applied in order via `drizzle/meta/_journal.json`). A fresh database is
  created from these migrations at runtime — no seed or placeholder database
  is needed.
- `app.db` (the live database with real transactions and connection state)
  is gitignored and never committed.

## Notes

- No live SimpleFIN credentials or financial data are committed to this
  repository. The app stores its SimpleFIN connection in its own runtime
  database (also gitignored) so sync can refresh automatically.
