# Data Plan

## Context provenance
- “Can you build a budgeting app or financial management app like the images I shared with you? Use fincity or simplefin as a method for being able to actually pull bank transaction data.” (current request; establishes budgeting/financial-management scope, supplied visual references, and a real bank-feed requirement)
- Six supplied screenshots show a Monarch/SharkFin-like product language: a compact home summary, transaction list, spending breakdown, net worth view, accounts, and phone-first bottom navigation. They shape layout and hierarchy only; none of their displayed balances or transactions become user data.
- Provider choice: SimpleFIN is selected from the requested “finicity or simplefin” alternatives because its user-carried setup-token flow does not require this artifact developer to hold Finicity partner credentials.

## Tested sources
### SimpleFIN Bridge developer guide
**Used by**: `importFromSimpleFin` onboarding/action and the in-product setup explanation.
**Test command**: `browser_open` on `https://beta-bridge.simplefin.org/info/developers`.
**Sample output**: The guide states that a user provides a one-time Setup Token; the app base64-decodes it to a claim URL, POSTs that URL, then uses the returned Access URL with Basic Auth to call `/accounts?version=2`. It documents a maximum 90-day request window, an expected ceiling of 24 requests/day, structured errors, and daily-update intent.
**Processing**: Accept setup tokens only when they decode to HTTPS URLs on `simplefin.org` or a subdomain. Strip embedded Basic credentials into an Authorization header, request the latest 90 days, upsert accounts and transactions by provider IDs, surface provider errors verbatim in a bounded user-facing area, and never log or return the access URL.

### Live SimpleFIN demo endpoint
**Used by**: validation of the network route expected by `importFromSimpleFin`.
**Test command**: a Python probe fetched the developer page, extracted its public demo token, claimed it, and requested `/accounts?version=2` while printing only redacted counts; a second probe used the token shown by the browser-read guide.
**Sample output**: First attempt failed with HTTP 403 while fetching the developer page directly; second attempt reached the claim URL but timed out before an access URL was returned. No credential or financial row was retained.
**Processing**: Marked credential-gated/unverified in the builder environment after two distinct attempts. The shipped action returns a clear retry/setup error and writes nothing unless the claim and account payload both validate. No demo transactions ship.

### SimpleFIN integration reference
**Used by**: deduplication and review-flow design.
**Test command**: `browser_open` on `https://github.com/finlynq/finlynq/blob/HEAD/docs/import-connectors.md`.
**Sample output**: The reference describes a one-time token exchange, `GET {base}/accounts?start-date=<epoch>`, signed transaction amounts, per-account transaction identifiers, pending-row handling, and an explicit review stage rather than silently posting imported activity.
**Processing**: Preserve signed amounts; categorize none by inference; store pending status; deduplicate on `(provider account id, provider transaction id)`; put uncategorized imported rows in review.

## Long-term data behavior
- **Refresh policy**: The build request carries a daily trigger. A silent daily `dailyRefreshStatus` action updates only the freshness/attention state of already imported data. Because the artifact does not have an approved secret vault, the long-lived SimpleFIN Access URL is not persisted; a user initiates each real bank import with a fresh one-time setup token, which is used only within that action and discarded after the response.
- **Growth**: Accounts and transactions grow by explicit SimpleFIN imports or user-created manual entries; provider IDs make repeated imports idempotent. Budgets grow only through explicit user creation.
- **Ordering**: Transactions newest first by posted date, then creation time; accounts by user-visible name; budgets by category name; overview insights are computed from the same filtered rows they summarize.
- **Time semantics**: Provider `posted` epochs are stored as event instants; imported and edited timestamps are stored as instants and rendered viewer-local. Budget periods are calendar months derived in the viewer’s locale.

## Imagery
Imagery not needed: the requested references are data-dense financial-management interfaces, and the meaningful visual subjects are live user balances, category breakdowns, and cash-flow marks rendered deterministically from transaction rows—not illustrative or photographic content.

## Rejected approaches
- **Tried**: Direct Finicity integration.
  **Why rejected**: Production use requires developer Partner ID, Partner Secret, App Key, customer creation, and hosted Connect onboarding; none of those credentials or account relationships were supplied, while SimpleFIN was explicitly offered as an alternative.
- **Tried**: Persisting the SimpleFIN Access URL in the artifact database to enable unattended pulls.
  **Why rejected**: The URL contains long-lived Basic credentials, and this runtime exposes no approved secure credential vault to this artifact. The design uses transient one-time imports and does not store or reveal the secret.
- **Tried**: Shipping sample financial history so the dashboard looked populated.
  **Why rejected**: The user did not ask for demo data. The first-load experience is a polished, useful empty state with bank import and manual-entry paths.
