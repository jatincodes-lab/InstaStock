# Stockroom production readiness plan

Status: implementation roadmap, based on the repository audit on 2026-11-16.

This plan turns the existing product and security contracts into an incremental release. The detailed authentication API is in [AUTH_API_PLAN.md](AUTH_API_PLAN.md); field rules, RBAC, workflows, and edge cases remain in [INVENTORY_PRODUCT_PLAN.md](INVENTORY_PRODUCT_PLAN.md), [AUTH_FLOW.md](AUTH_FLOW.md), [RBAC.md](RBAC.md), [VALIDATIONS.md](VALIDATIONS.md), [EDGE_CASES.md](EDGE_CASES.md), and [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md). Those files are acceptance requirements, not evidence that the behavior is implemented.

## Current audit

- `web/src/App.tsx` accepts an email and routes into setup without authenticating. The workspace is held in React state, so refresh/sign-out loses it.
- `web/src/App.tsx` changes browser history but does not subscribe to `popstate`; using Back/Forward can change the URL without changing the displayed screen.
- `web/src/SetupWizard.tsx` renders currency and timezone selectors but does not read or include their values in the workspace. A user can select USD/UTC and still finish with only a business name and locations.
- `web/src/Dashboard.tsx` currently shows placeholder values for low stock, receipts, and dispatches. These must not be presented as live operational metrics.
- Product, location, and opening-stock screens currently communicate through frontend state. A save is not durable or authoritative.
- `api/src/server.mjs` exposes only a database health route; there are no auth, tenant, product, location, or stock endpoints.
- `api/migrations/001_initial_schema.sql` contains a broad initial schema, but the schema has not been proven through application workflows, concurrency tests, tenant-isolation tests, or restore testing. Review it before relying on it; migrations must be additive and forward-only after production data exists.
- There is no repository-level test script or established test suite. `api/package.json` has dev/start/migrate scripts only; `web/package.json` has build/preview scripts only.
- `web/src/OpeningStock.tsx` permits editing quantities already marked recorded. The prototype updates local state, but carrying this behavior into persistence would rewrite history; opening stock must be a one-time posted movement, with later corrections through the authorized adjustment/count workflow.
- The written plan confirms PostgreSQL for authoritative business data and MongoDB only for optional descriptive product attributes. MongoDB must never become a source for balances, cost, access control, or transactional history.

No production release is safe until authentication, authorization, persistence, stock posting, and recovery are implemented and verified. Do not expose the current demo path as a real sign-in.

## Delivery order and exit gates

Each phase is a small reviewable vertical slice. Do not start the next phase until its exit gate and automated checks pass. Existing in-memory screens can remain a clearly labeled prototype until replaced by the corresponding persisted workflow.

### 0. Establish repeatable checks and deployment assumptions

**Progress:** the API test command, root `npm run verify`, and CI workflow are in place. The deployment assumptions and required branch protection setting still need to be completed in the repository/hosting setup.

1. Record supported Node/PostgreSQL versions, environments, migration procedure, hosting topology, TLS termination, email provider, file/import limits, backup ownership, and production support owner.
2. Add a single documented local/CI verification command. Start with Node's built-in `node:test` for API/domain code; add browser automation when the first persisted user journey exists. Keep test and production databases separate.
3. Add CI gates for frontend typecheck/build, API tests, migration checks, and later browser/integration suites. A change that fails any required gate cannot merge.
4. Add safe test fixtures and deterministic cleanup. Tests must never point at production or use real email/payment side effects.

**Exit gate:** a clean checkout can install dependencies and run the documented checks; CI blocks a failing check; branch protection requires the CI check; secrets and production data are not required.

### 1. Authentication, sessions, invitations, and tenant authorization

Implement the flow in `AUTH_FLOW.md` and `RBAC.md` before adding tenant data endpoints:

1. Sign in with normalized email and password; secure password hashing; generic failure messages; rate limits; HTTP-only, Secure, SameSite cookies; CSRF protection for state-changing cookie-authenticated requests; session expiry, rotation, revocation, and sign-out.
2. Invitation issue, resend/revoke, expiry, single-use acceptance, password setup, duplicate user handling, and suspended/removed membership handling. Use a real email adapter with a test sink.
3. Resolve user, active membership, role, permissions, and location scope server-side on every protected request. Tenant IDs, actor IDs, roles, and scope from request bodies are never trusted.
4. Add tenant selection and switching. Clear old tenant data in client caches immediately and re-fetch only after the server confirms the new membership.
5. Seed fixed roles and permissions idempotently; test privilege boundaries and dangerous actions separately.

**Must handle:** unknown email vs wrong password without account enumeration; disabled user; no membership; invited but inactive membership; multiple tenants; expired/revoked session; simultaneous sign-in/sign-out; role/scope changes during an active session; invitation to an existing user; duplicate/concurrent invitation; reused token; expired token; link opened twice; CSRF; brute force; cookie/cross-site behavior; stale client state; unauthorized cost fields; guessed IDs from another tenant.

**Exit gate:** two-tenant and multi-location tests prove cross-tenant and out-of-scope reads/writes fail for routes, search, aggregates, exports, and nested records. Membership removal or role/scope change takes effect on the next protected request. No business endpoint is enabled before this gate.

### 2. Persist onboarding, branches, warehouses, and catalog

1. Persist tenant defaults, first branch, and first warehouse. Enforce tenant-consistent relationships and unique normalized codes in PostgreSQL.
2. Add server-authoritative CRUD/archive operations for products, units, branches, and warehouses. Referenced records are archived; they are not hard-deleted.
3. Validate the same constraints on client and server. The database remains the final guard for uniqueness and relationships.
4. Connect existing screens to API loading, empty, retry, conflict, and permission-denied states. Preserve entered values after network or validation errors.
5. Add optional product descriptive attributes in MongoDB only after the PostgreSQL core product save works. Make the two writes explicit, retry-safe, and report partial failure without claiming cross-database atomicity.

**Must handle:** duplicate names/codes/SKUs under case/whitespace normalization; concurrent duplicate creation; branch/warehouse from another tenant; warehouse reassignment with stock/open documents; archive while referenced; stale edits; double submit; lost response after successful write; network retry; Mongo unavailable; Mongo write succeeds/fails while PostgreSQL succeeds/fails; orphan attributes; preserving unsaved attribute input; permission changes during editing.

**Exit gate:** refresh and a second authorized session see persisted values; invalid and cross-tenant references are rejected server-side; duplicate requests do not create duplicate entities; Mongo failure cannot corrupt core product or stock data.

### 3. Stock ledger and opening stock

Treat this as the highest-risk domain phase. Implement one transaction-safe posting service and use it for every stock-changing workflow:

1. Define decimal precision, rounding, valuation, zero-stock behavior, batch identity, posting date rules, and immutable document state in the API/database contract.
2. Post opening stock as a ledger movement and update balances/valuation atomically. Add idempotency keys and immutable actor/source references.
3. Reconcile balances against the ledger; expose discrepancies as errors/alerts, never silently repair them.
4. Replace editable recorded opening quantities with read-only posted values and an authorized adjustment path.
5. Use database transactions, row locks or an equivalent concurrency strategy, tenant-scoped constraints, and consistent lock ordering for stock operations.

**Must handle:** zero and fractional quantities; integer-only units; negative, exponent, NaN/infinite, overflow, and excess precision input; missing/zero cost; duplicate product/batch rows; empty batch number; duplicate batch identity; invalid/manufacture/expiry date order; concurrent opening posts; duplicate request/retry after timeout; partial transaction failure; balance/ledger mismatch; inactive warehouse/product; inaccessible location; posting date before latest movement or in the future; precision and rounding at currency boundaries.

**Exit gate:** transaction tests prove balance and ledger either both commit or neither does; retry creates one movement; concurrent operations cannot oversell or double-post; independently recomputed ledger balances match stored balances and valuation.

### 4. Purchasing and receiving

Implement draft purchase orders, confirmation, partial/full receipts, cancellation of unreceived quantity, supplier returns, and document history. Only a posted receipt changes stock. Recheck the current order state and remaining quantity inside the posting transaction.

**Must handle:** empty/duplicate lines; invalid prices/quantities; inactive supplier/product; over-receipt; partial receipt and repeated receipt; concurrent receipt; stale order; cancel after partial receipt; receipt retry; receipt date boundary; batch/cost layers; return quantity exceeding received-minus-returned; return without available stock; damaged/quarantine disposition; correction/reversal links; archived source records.

**Exit gate:** all receipt/return totals reconcile to source lines and stock ledger; duplicate and concurrent requests cannot exceed ordered or returnable quantities.

### 5. Sales, reservations, dispatch, and customer returns

Implement draft/confirm/cancel orders, transactional reservations, partial dispatch, and customer returns. A reservation reduces available stock; a posted dispatch reduces on-hand stock and fulfills/releases the corresponding reservation.

**Must handle:** insufficient available stock; simultaneous orders for the last units; reservation expiry/cancel; partial fulfillment; repeated/concurrent dispatch; quantity greater than reserved or on hand; changing warehouse after reservation; inactive customer/product; stale order version; return quantity greater than dispatched-minus-returned; original cost preservation; sellable vs damaged/quarantine returns; retry after lost response; cost visibility in API and client.

**Exit gate:** concurrency tests prove available stock never goes negative; order, reservation, dispatch, return, balances, and valuation reconcile exactly.

### 6. Transfers, stock counts, and adjustments

Transfers require source and destination access independently. Ship moves stock from source to in-transit; receive moves only shipped quantity into destination. Counts use the documented product/location lock, review, approval, and recovery behavior. Adjustments require reason and permission.

**Must handle:** same source/destination; cross-tenant locations; different shipper/receiver; partial shipment/receipt; over-receipt; cancellation after shipment; lost/damaged quantity; transit discrepancy and resolution; batch/cost preservation; access revoked between ship and receive; two simultaneous counts; stock activity during a count lock; abandoned lock/recovery; stale count; zero count; duplicate count posting; unauthorized approval; adjustment producing negative stock; reversal after subsequent movements.

**Exit gate:** transit and warehouse totals reconcile; count locks cannot be bypassed; every discrepancy and correction has an actor, reason, source, and audit trail.

### 7. Dashboard, reports, audit, and import/export

1. Replace placeholder dashboard numbers with permission-filtered queries; show loading, empty, unavailable, and partial-data states accurately.
2. Add stock summary, ledger, valuation, low stock, purchase/sales summary, and transfer discrepancy reports with consistent date/location filters and drill-down.
3. Enforce cost permissions in query selection and response shape, not only in the UI. Apply the same scope to CSV exports and totals.
4. Add CSV import preview, row-level validation, duplicate detection, safe chunking, and a clear partial-failure/retry model. Add export size/rate limits.
5. Add tenant audit history for sensitive changes and postings; exclude credentials, session tokens, invitation tokens, and unnecessary personal data.

**Must handle:** timezone/date boundaries and DST; empty and large result sets; pagination; filter tampering; CSV formula injection; delimiter/newline/encoding issues; duplicate rows; partial imports; cost leaks through aggregates/search/export; inaccessible locations; query timeout; stale dashboard; audit failure behavior; export retry and expiration.

**Exit gate:** report totals reconcile to source ledgers/documents; two-role tests prove no cost or cross-location leakage; imports can be retried without duplicate records; exports are bounded and safe to open.

### 8. Production hardening and launch

1. Add structured request IDs, redacted logs, health/readiness probes, error monitoring, latency/DB-pool metrics, and alerts for failed jobs and reconciliation mismatches.
2. Verify TLS, security headers, allowed origins, CSRF controls, body/file limits, rate limits, dependency patching, secret rotation, and least-privilege DB accounts.
3. Establish encrypted backups for PostgreSQL and MongoDB, retention, restore rehearsal, orphan/reference reconciliation, and a written recovery time/point objective.
4. Use expand/migrate/contract database changes, migration lock/backup checks, rollback or forward-fix procedures, and staging rehearsal on production-like data volume.
5. Run accessibility, browser/device, performance, security, and disaster-recovery acceptance before enabling production traffic.

**Exit gate:** all automated gates pass; staging migration and restore drills pass; no unresolved critical/high security or data-integrity issues; named owner signs off operational alerts, support, backups, and rollback/forward-fix procedure.

## Test policy for every change

Every code or migration change must include or update the smallest test that proves its behavior. Before considering a change ready:

1. Run formatting/lint checks if configured, frontend typecheck/build, and all API unit tests.
2. Run database integration tests for changed queries/migrations and concurrency/transaction behavior where relevant.
3. Run browser end-to-end tests for changed user journeys and at least one permission-denied path.
4. Run the full required CI suite before merge; never waive a failing gate by relying on a local visual check.
5. For release candidates, additionally run staging smoke tests, migration rehearsal, backup restore/reconciliation, and manual workflow/accessibility checks.

Test layers and minimum coverage:

- **Unit:** validators, permission decisions, monetary/quantity arithmetic, state transitions, document numbering, date boundaries.
- **Database integration:** tenant-consistent constraints, uniqueness under concurrency, transaction rollback, idempotency, locks, ledger/balance/valuation reconciliation, migration from the previous schema.
- **API integration:** authentication, cookies/CSRF, invitations, permission and location scope, validation/error mapping, pagination, rate limits, audit events, cost redaction.
- **Browser end-to-end:** sign-in/recovery/invitation, tenant switch, setup, product, opening stock, receive, dispatch, transfer, count, returns, permission denied, stale session, network retry, and preserved input on failed save.
- **Operational:** health/readiness, logs with request IDs and no secrets, backup restore, migration rehearsal, and monitoring alert checks.

Use isolated databases and deterministic fixtures with at least two tenants, multiple branches/warehouses, roles with different scope, tracked/untracked products, fractional/integer units, and concurrent actors. A passing test suite is required to merge; it is not by itself a production go-live decision. Production also requires staging and recovery gates above.

## Definition of done for each feature

- Client and server enforce the documented rule; server and database remain authoritative.
- Success, validation failure, permission denial, stale conflict, timeout/retry, empty/loading, and partial dependency failure have defined behavior.
- No tenant or location data leaks through IDs, totals, errors, search, logs, or exports.
- Writes are atomic or explicitly report partial success; retry behavior is idempotent where appropriate.
- Audit history captures actor, action, source, and time without secrets.
- Automated tests cover normal flow, boundary cases, adversarial input, authorization, failure/retry, and relevant concurrency.
- Existing records survive migration and recovery; no posted stock/document is silently edited or deleted.
- UI remains accessible by keyboard/screen reader and preserves safe user input after failures.

## Scope intentionally deferred

Do not add public self-registration, custom role builders, cross-tenant transfers, manufacturing, serial tracking, bins/shelves, multi-currency, retroactive recosting, support impersonation, or a separate microservice architecture in the first release. Revisit only when a concrete business requirement justifies the added data and operational risk.
