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

## Notes

- `app.db` (the live transaction database) is gitignored and never committed.
  Bank credentials are used transiently during SimpleFIN import/refresh and are
  not stored in the repo.
- Copy `.env.example` to `.env` if/when local secrets are needed (also
  gitignored).
