# Inventory software — product and implementation context

Status: proposed plan, not implemented. Updated: 2026-10-29.

Companion implementation contracts:
- [DESIGN.md](DESIGN.md): inset rounded application shell, React with selected shadcn/ui components, shared components, skeleton/loading/error states.
- [AUTH_FLOW.md](AUTH_FLOW.md): minimal sign-in, password recovery, invitation, and tenant-selection behavior.
- [RBAC.md](RBAC.md): tenant memberships, fixed roles, permission groups, location scopes, and authorization rules.
- [VALIDATIONS.md](VALIDATIONS.md): common field rules, letters-only inputs where appropriate, strict 10-digit mobile input, server and stock validation.
- [EDGE_CASES.md](EDGE_CASES.md): input, tenant isolation, concurrency, stock, and UI acceptance scenarios.

These documents extend this plan. React, MongoDB, PostgreSQL, and shadcn/ui are confirmed choices. Bits UI requires Svelte, so shadcn/ui is used for the React interface. NestJS with TypeScript is the recommended backend, not yet a confirmed choice. Use one modular backend application initially; retain tenant isolation, transactional stock posting, and all existing acceptance criteria. Repository compatibility and any migration requirements must be checked before implementation.

## Technology and database ownership

- React with TypeScript: frontend. The browser accesses data through the backend, never directly through database credentials.
- PostgreSQL: authoritative tenants, memberships, permissions, branches, warehouses, core products/SKUs, contacts, orders, receipts, dispatches, returns, reservations, stock balances, stock ledger, valuation, and operational audit history.
- MongoDB: flexible, non-critical product attributes/specifications, such as material, dimensions, and category-specific descriptive properties. This ownership split is the proposed implementation approach for the user's confirmed two-database choice. Do not add a custom-field builder merely to populate MongoDB.
- NestJS with TypeScript remains the proposed single backend for both stores. Database separation does not require separate services.
- Keep all correctness-critical stock operations and their audit records inside PostgreSQL transactions. MongoDB must not store authoritative stock, prices, costs, permissions, or duplicate transactional records.
- Each MongoDB product document carries tenantId and the PostgreSQL productId, with a unique compound index on that pair. The backend verifies tenant access and product existence before reads/writes; there is no cross-database foreign key.
- Save core product data and supplementary attributes as explicit separate operations. Report partial failure accurately and allow attribute saves to retry safely; never claim a combined atomic save across both databases.
- If MongoDB is unavailable, show supplementary attributes as unavailable, preserve unsaved input, and allow authorized core stock operations to continue. Never interpret unavailable attributes as empty or overwrite them with blanks.
- Archive products in PostgreSQL and deny attribute edits for archived products. Any later hard-deletion workflow must include retryable MongoDB cleanup and orphan checks.
- Back up and monitor both databases. Restore checks must verify matching tenant/product references and identify orphaned attributes. Two databases add operating and recovery work; avoid additional synchronization infrastructure until a concrete workflow needs it.

## 1. Product goal

Build a clean, practical inventory application for multiple independent businesses (tenants), each with multiple branches and warehouses. Prioritize reliable stock, fast daily operations, clear permissions, and traceable changes. Avoid turning the first release into a full ERP.

Initial assumption: general trading and distribution of physical goods. Manufacturing, pharmaceutical compliance, and other specialized workflows require a separate scope review. This plan defines production-readiness targets; it does not certify the existing application.

### Product principle: fast, low-friction work

Optimize for completing routine work accurately with as few decisions, fields, clicks, and waits as possible. Ask only for information required to complete the current action. Make secondary information optional, clearly mark it, and allow it to be added later. Preserve sensible defaults and previously entered values. Do not make users configure the software before they can do basic work. Keep this principle in every page, workflow, error message, and performance decision.

Examples: creating a vendor requires its name; phone, email, address, tax details, and notes are optional. A branch needs a name and code; address/contact details can be added later. A basic product needs a name, SKU, and base unit; category, barcode, prices, and descriptive attributes are optional unless a specific workflow needs them. Receiving and dispatch screens request only the location, items, quantities, and references needed to post the movement.

## 2. Organization model

- Tenant: one independent business with isolated users, products, documents, stock, settings, and reports.
- Branch: an operating location within a tenant.
- Warehouse: a physical stock location belonging to exactly one branch. A branch can have multiple warehouses.
- Product catalog, suppliers, and customers belong to the tenant and are shared across its branches.
- Stock belongs to a warehouse. Branch totals aggregate its warehouses; tenant totals aggregate authorized branches.
- A user can belong to multiple tenants through explicit memberships. Each membership has its own role and branch/warehouse access.
- Begin with one currency and business timezone per tenant. Cross-tenant inventory transfers are excluded.
- Do not add bins, shelves, legal-entity consolidation, or configurable organization hierarchies initially.

## 3. Authentication flow

- Sign-in asks for email and password only. Tenant selection happens after authentication when a user belongs to multiple businesses; never add a tenant field to the sign-in form.
- Keep invitation-based onboarding initially: invited user follows a time-limited link, sets a password, then signs in. No public self-registration until product access/billing rules are defined.
- Provide password recovery by email with a short-lived single-use token. Do not reveal whether an email exists. Use generic sign-in errors, rate limits, secure password hashing, secure HTTP-only session cookies, and server-side session revocation.
- Successful sign-in opens the user's last authorized tenant and location when still permitted; otherwise show a tenant selector or the first authorized context. Never restore stale tenant data across sign-out or tenant switch.
- Include loading, invalid credentials, network failure, disabled membership, expired recovery link, and expired session states. Preserve the email field after safe failures; never persist the password.
- The login screen can be built before backend authentication, but it must clearly remain a frontend prototype until the server-side flow is connected.

## 3. Navigation and pages

Keep eight top-level navigation groups. Related actions belong on their parent page instead of becoming sidebar entries.

| Group | Pages | Required capabilities |
| --- | --- | --- |
| Overview | Dashboard | Low stock, pending receipts, pending dispatches, transfers in transit, recent activity; all scoped to accessible locations |
| Inventory | Products; Product detail; Stock on hand; Stock movements; Transfers; Transfer detail; Stock counts; Count detail; Adjustments | Maintain catalog, inspect available stock, trace movements, move stock between warehouses, reconcile physical counts |
| Purchases | Purchase orders; Order create/edit/detail; Goods receipts; Receipt detail; Supplier returns | Order goods, receive partially or fully, return received goods with original receipt references |
| Sales | Sales orders; Order create/edit/detail; Dispatches; Dispatch detail; Customer returns | Reserve stock, dispatch partially or fully, receive returns with original dispatch references |
| Contacts | Suppliers; Customers; Contact detail | Contact information, addresses, status, and related documents |
| Reports | Stock summary; Movement ledger; Stock valuation; Low stock; Purchase summary; Sales summary; Transfer discrepancies | Consistent filters, drill-down to source documents, CSV export |
| Team | Members; Invitations; Roles and access | Invite, deactivate, assign fixed roles and location scope |
| Settings | Business; Branches; Warehouses; Catalog settings; Document numbering; Audit log; Data import | Business defaults, organization setup, categories, units, opening stock, import errors |

The dashboard is the first screen after setup. Its first-use state is an operational guide with links to add/import products and enter opening stock; setup does not force users through product creation before they can see the workspace.

Shared screens: sign in, password recovery, tenant selection, onboarding, profile, access denied, and useful empty/error states. Product and contact creation can use a drawer; complex stock documents use full pages.

Separate restricted platform area: tenants, tenant status, platform operators, and operational audit. Do not mix platform administration with tenant navigation or grant platform operators automatic browsing of customer data.

## 4. Minimum data per record

| Record | Required information |
| --- | --- |
| Product | SKU unique within tenant, name, category, base unit, active status, default purchase/selling price, optional barcode, reorder threshold by warehouse |
| Branch | Name, code, address, active status |
| Warehouse | Name, code, parent branch, address, active status |
| Supplier/customer | Name, unique internal reference, contact details, addresses, active status |
| Order | Document number, date, contact, branch, warehouse, lines, quantities, prices, status, notes |
| Receipt/dispatch/return | Source document, warehouse, quantities, business date, posting timestamp, responsible user, reason where applicable |
| Transfer | Source and destination warehouse, requested/shipped/received quantities, dates, status, discrepancy resolution |
| Count/adjustment | Warehouse, products, expected/counted or adjustment quantities, reason, preparer, approver, posting reference |

Use fixed-precision decimal quantities and money. One base unit per SKU in the first release; variants can be separate SKUs. Do not silently mix boxes and pieces. Archive referenced records instead of deleting them.

## 5. Essential workflows

### Onboarding

Create tenant → set currency/timezone → create first branch and warehouse → invite team → import products → validate and post opening stock → begin operations. Imports need a preview, row-level validation, clear errors, and duplicate prevention. Opening stock is an audited movement, never a hidden balance edit.

### Batch-tracked products

- Batch tracking is opt-in per product. Products without batch tracking keep the quick quantity flow.
- A batch is identified under its product and remains traceable at each warehouse. Store batch/lot number, optional manufacture and expiry dates, optional batch MRP, and the available quantity.
- Record acquisition cost on each receipt/opening-stock layer, not as one mutable product price. The same batch may have multiple receipt cost layers; changing one must not rewrite another.
- The opening-stock page lists every product. For tracked products, enter one or more batches; for ordinary products, enter one quantity. Existing values are prefilled and can be corrected through a posted stock adjustment once stock operations are live.
- Receipts and transfers preserve batch identity and cost layers. Dispatches record the batch used. Suggest FEFO for batches with expiry dates; otherwise use the configured costing/picking policy.
- Do not turn batch tracking off while stock exists. Assign existing balances to batches through a controlled stock count/adjustment first. Serial-number tracking remains out of scope.

### Purchasing

Draft purchase order → confirm → partially receive or receive fully → close. Only a posted goods receipt increases stock. Each receipt records actual quantity and acquisition cost. Block over-receipt in the initial release. Cancel only unreceived quantities; reverse posted receipts through explicit linked corrections when stock permits.

### Sales

Draft sales order → confirm and reserve → partially dispatch or dispatch fully → close. Reserve only available stock. Posting dispatch reduces stock and releases the corresponding reservation. Cancellation releases remaining reservations. Orders and printed documents alone never change stock.

### Transfers

Draft → ready → partially shipped/shipped → partially received/received → closed. Shipment removes stock from the source and places it in transit. Receipt moves it from transit into destination stock at its carried cost. Allow different users to ship and receive according to their warehouse access. Block receipts exceeding shipped quantities. Resolve missing/damaged quantities with explicit approved adjustments; never silently erase them. Cancel only unshipped quantities.

### Counts and adjustments

Create count for selected products in a warehouse → temporarily lock stock-affecting activity for those products → enter physical quantities → review variance → manager posts variance → unlock. Show who owns the lock and provide audited cancellation/recovery. This intentionally simple first-release policy avoids incorrect variances caused by concurrent movements. Adjustments require a reason and manager authorization; do not allow direct balance editing.

### Returns

Supplier returns reference receipts and cannot exceed remaining returnable quantities or available stock. Customer returns reference dispatches and cannot exceed dispatched quantity minus previous returns. Restock only inspected sellable goods. Damaged returns go to a designated quarantine warehouse and require an authorized disposition. Preserve original movement references and costs.

## 6. Stock integrity rules

- Maintain an immutable stock movement ledger and transactionally updated balances. Every movement records tenant, warehouse, product, quantity, cost, source document, actor, and timestamps.
- On hand = posted physical warehouse stock. Available = on hand minus reservations. In-transit stock is shown separately and cannot be sold. Quarantine stock cannot be reserved or dispatched.
- Block negative available stock and prevent concurrent transactions from overselling through database transactions and concurrency controls.
- Posting is atomic and retry-safe: double clicks, retries, and concurrent requests must not create duplicate movements.
- Posted documents cannot be edited or deleted. Corrections create linked reversals/returns and preserve history.
- Use moving weighted-average costing per product and warehouse as the proposed first-release policy. Transfers carry source cost; customer returns use original dispatch cost. Define rounding and zero-stock behavior before implementation.
- Store business date and actual posting time separately. Initially disallow backdated postings before the latest stock posting for the affected product/location; period reopening and retrospective recosting are excluded.
- Reconcile ledger totals, balances, reservations, and in-transit stock. Surface mismatches for investigation rather than silently repairing them.
- Warehouse/branch deactivation requires no stock, reservations, in-transit balances, or open operational documents.

## 7. Roles and tenant isolation

| Role | Default access |
| --- | --- |
| Tenant owner | Full tenant access, ownership and administrator management |
| Administrator | Organization, members, settings, and all operations; cannot transfer ownership |
| Branch manager | Assigned locations, operational documents, counts, adjustments, reports |
| Warehouse operator | Assigned warehouses, receiving, picking/dispatch, transfers, count entry; no cost reports or user administration |
| Sales/purchase staff | Authorized orders and contacts; no stock adjustments or role management |
| Viewer | Read-only authorized operational data; valuation/cost access explicitly granted |

Enforce permissions on the server for every read, write, export, attachment, and background job. Tenant scope must come from authenticated membership, not an untrusted request field. Validate that all related records belong to the same tenant and permitted locations. Scope unique keys, caches, files, searches, jobs, and exports by tenant. Test attempted cross-tenant access using known record IDs. UI hiding alone is never authorization.

Use fixed roles initially, with location assignments and a small explicit cost-visibility permission. A visual permission builder and automatic customer impersonation are excluded. Record role changes, postings, reversals, imports, and configuration changes in the audit log.

## 8. UI/UX direction

- Confirmed user preference: an inset application shell inspired by the supplied reference. An outer background remains visible around one large panel with rounded corners; the entire inventory interface lives inside that panel. The framing and curved silhouette are the key preference, not necessarily the reference's dark theme or typography.
- Desktop starting point: 10–16 px outer gutter and 20–24 px shell corner radius. Use a contrasting outer background and panel surface so the frame remains visible. Place navigation, header, and page content within this shared shell; do not repeat oversized rounded panels around every section.
- Keep tables compact and readable inside the shell. At small screen sizes, reduce gutters and corner radius to preserve usable space. Scrolling content and menus must remain usable without being clipped by the shell corners. Final colors and light/dark theme remain to be decided.
- Calm neutral surfaces, one accent color, readable typography, clear spacing, subtle borders, and consistent status colors. Avoid decorative dashboards and oversized cards.
- Persistent tenant and branch context in the header. Warehouse filters appear where stock is relevant. Never default a write operation to an ambiguous all-branches scope.
- One obvious primary action per page. Put uncommon actions in an overflow menu and show advanced fields only when needed.
- Operational lists use searchable tables with useful defaults, status filters, date filters, pagination, and preserved filter state after returning from detail pages.
- Document pages show identity/status, contact and location, line items, totals where relevant, and history in a predictable order.
- Product picking supports SKU, name, and barcode scanner keyboard input. Display available stock beside dispatch quantities.
- Show inline field errors and preserve form input on failure. Explain why an action is unavailable. Warn about unsaved changes.
- Provide keyboard navigation, visible focus, labeled inputs, accessible contrast, and status text rather than color alone.
- Desktop first for dense operations; tablet-friendly warehouse actions and readable mobile summaries. Dedicated mobile apps and offline sync are excluded initially.
- Dashboard metrics must lead to an actionable filtered list. Avoid charts with no operational purpose.

## 9. Release scope and exclusions

First production release includes organization setup, tenant isolation, roles, products, contacts, opening stock, purchasing/receipts, sales/reservations/dispatch, returns, transfers, counts/adjustments, core reports, exports, audit, and recoverability.

Explicitly excluded: accounting/general ledger, payments and collections, statutory tax invoices/filings, payroll/HR, CRM pipelines, POS, e-commerce synchronization, manufacturing/BOM, demand forecasting, subscription billing automation, multi-currency, offline sync, custom workflow builders, and microservices.

Batch/lot tracking is an opt-in product capability in the first release for products needing traceability or batch-specific costs, MRP, or expiry. Serial numbers and warranty for serialized goods; unit conversions for mixed packaging; bins and scanning workflows for complex warehouses remain conditional on a real business need. If the chosen industry requires one, add it to first-release scope before implementation rather than as a later patch.

## 10. Delivery sequence

1. Foundation: confirm business assumptions; inspect the existing repository; choose reuse versus new implementation; establish tenant identity, roles, branches, warehouses, UI shell, and isolation tests.
2. Inventory core: products, units, contacts, movement ledger, balances, opening stock, imports, stock views, and audit.
3. Daily operations: purchasing, receipts, sales, reservations, dispatch, returns, transfer shipping/receiving, and printable operational documents.
4. Controls: counts, adjustments, valuation, low-stock reporting, exports, and reconciliation.
5. Production gate: concurrent posting tests, permission/isolation checks, representative-volume performance checks, backup restore rehearsal, error monitoring, operational documentation, and user acceptance testing.

These are delivery stages, not separate promises of production readiness. Do not launch live stock management before its required controls pass.

## 11. Speed and performance standards

- Set measurable service targets before production using expected tenant, product, warehouse, movement, and concurrent-user volumes. Proposed initial targets under normal expected load: common page data API p95 under 300 ms, stock posting API p95 under 500 ms, and interactive page content usable within 2 seconds on the agreed network/device profile. These are targets to validate, not guarantees.
- Keep common list endpoints scoped and paginated on the server. Use bounded page sizes, stable ordering, and cursor/keyset pagination for large movement histories. Never load an entire tenant's catalog or ledger into the browser.
- Define indexes from actual list filters, joins/lookups, sort orders, and uniqueness rules. PostgreSQL examples: unique `(tenant_id, sku)`; unique `(tenant_id, warehouse_id, product_id)` for balances; ledger indexes beginning with `(tenant_id, warehouse_id, product_id, posted_at)` for product history and `(tenant_id, posted_at)` for tenant activity; document indexes based on tenant, status, location, and date filters. Confirm with query plans and representative data before finalizing.
- Include tenant scope in relevant compound indexes and every query. Add indexes for foreign keys and measured high-use filters. Avoid indexing every field: each extra index increases storage and slows writes. Review slow-query logs and query plans after realistic load tests.
- Fetch only fields needed by the page. Avoid N+1 queries; batch related lookups. Compute dashboard summaries with bounded queries or maintained aggregates where measurements justify it. Do not calculate tenant-wide totals by scanning the ledger on every page load.
- Keep stock posting transactional and small. Do not perform report generation, external calls, or MongoDB writes inside stock transactions. Use bounded background jobs for imports/exports and show progress for long tasks.
- Use MongoDB indexes only for real attribute lookup paths, including unique `(tenantId, productId)` and tenant-scoped filters when queried. Flexible attributes are not a reason to scan every product document.
- Cache only where useful and always key cached data by tenant and authorization scope. Invalidate or version stock-sensitive data on posting. Never serve stale authorization decisions or show one tenant's data under another tenant.
- Frontend: split routes/features where useful, avoid loading large unused bundles, keep skeletons layout-matched, and avoid blocking initial display on nonessential attributes or analytics. Measure on representative devices and networks.
- Track API latency, database query latency, slow queries, error rates, posting conflicts, and queue age. Performance regressions should be visible before users report them.

## 12. Production acceptance criteria

## 11. Production acceptance criteria

- A member of tenant A cannot access tenant B through lists, IDs, exports, files, or jobs.
- Location-restricted users cannot post or inspect unauthorized warehouse data.
- Two concurrent dispatches cannot oversell the same stock; repeated posting creates one result.
- Partial receipts, dispatches, cancellations, and returns preserve correct remaining quantities and reservations.
- Transfers reconcile source, in-transit, and destination quantities and value, including discrepancies.
- Count locks, cancellation, and adjustments preserve a complete audit trail.
- Valuation and stock reports reconcile to posted ledger entries with documented rounding.
- Failed imports/postings cannot leave partial stock updates; retries are safe.
- Restore a backup in a non-production environment and verify stock/document integrity. Agree recovery targets before launch.
- Establish expected product count, warehouse count, concurrent users, and movement volume; measure page/report performance against those figures.
- Protect transport and stored credentials, use established authentication, enforce session expiration, and monitor failed jobs and posting failures without logging secrets.
- Business users complete receiving, dispatch, transfer, count, and correction workflows using realistic sample data before acceptance.

## 13. Decisions to confirm before coding

1. Industry and any mandatory batch, expiry, serial, or packaging requirements.
2. Extend the current application or build a separate product; existing stack and migration requirements remain unverified.
3. Whether sales/purchases are operational stock documents only, as assumed, or must include jurisdiction-specific invoicing and payments.
4. Expected tenants, locations, products, daily movements, concurrent users, and hosting model.
5. Acceptance of weighted-average costing, reservation behavior, and the count-lock policy.

## 14. Context for future implementation

Treat this file as the proposed scope baseline. Keep the tenant → branch → warehouse model consistent. Reuse existing project conventions after inspecting them. Do not add excluded modules or infrastructure without a concrete requirement. Each stock feature must include server authorization, atomic posting, audit history, and focused tests for its failure cases. Update this plan when a business decision changes scope.
