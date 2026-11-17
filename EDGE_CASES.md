# Edge cases and acceptance checklist

Status: planned checks, not executed tests. Related: [Validation rules](VALIDATIONS.md), [Design](DESIGN.md), [Product plan](INVENTORY_PRODUCT_PLAN.md).

## Inputs

| Scenario | Expected outcome |
| --- | --- |
| Type a digit into a letters-only field | Insertion rejected; existing value and caret interaction remain usable; requirement explained |
| Paste mixed letters/digits into a letters-only field | Whole invalid insertion rejected, never silently altered |
| Enter accented or non-Latin letters using IME | Valid committed Unicode letters accepted without interrupting composition |
| Enter O'Neil / Anne-Marie as a person name | Accepted; strict letters-only policy is a separate field type |
| Enter Branch 2 / Product B12 | Accepted in entity/product names |
| Enter letters, +, space, minus, decimal point, or exponent in mobile field | Rejected; no invalid saved value |
| Type 10 mobile digits, then an 11th | First 10 remain; additional insertion rejected |
| Replace selected mobile digits at maximum length | Valid replacement succeeds; maxlength does not block correction |
| Paste 11 digits or a formatted phone number | Rejected with the 10-digit format hint; no silent truncation |
| Submit 9 digits / optional blank / required blank | Incomplete rejected / optional blank accepted / required blank rejected |
| Mobile or barcode starts with zero | Leading zero preserved through save, export, and reload |
| Use autofill, drag/drop, undo, screen reader, keyboard shortcuts | Same validation outcome; editing and assistive interaction remain usable |
| Whitespace-only name or notes at limit | Required name rejected; permitted text length handled consistently by client/server |
| Enter zero, negative, too many decimals, huge value, NaN, exponent | Field-specific rules applied; no overflow, silent rounding, or floating-point corruption |
| Direct request/import bypasses browser restrictions | Server rejects invalid values with useful field/row errors |
| HTML/script-like content in notes | Rendered as inert text, never executed |

## Tenant and access boundaries

- Try another tenant's known product, order, warehouse, file, or export ID: deny without exposing its data.
- Switch tenants while an old request is in flight: cancel/ignore the response and clear prior-tenant data and caches.
- Remove a user's permission during an open session: subsequent protected reads/writes are denied; unsaved work is handled without revealing unauthorized data.
- Supply a warehouse from another branch/tenant: reject on the server.
- Test exports, totals, search suggestions, jobs, cost columns, and audit records with location/cost restrictions.
- Disable a tenant or member: reject subsequent authenticated operations according to the session revocation policy.

## Stock and document behavior

| Scenario | Expected outcome |
| --- | --- |
| Two users dispatch the last stock simultaneously | At most the available amount posts; loser receives a recoverable conflict |
| Double-click Post or retry after a timeout | Exactly one document posting and one set of movements |
| Connection drops after server commits | Reload/retry finds committed result; no duplicate or false reversal |
| Failure midway through ledger/balance update | Entire posting rolls back |
| Partial receipt/dispatch followed by cancellation | Only remaining quantities cancel; previous movements remain |
| Transfer partially received, damaged, or missing | Remaining stock stays in transit until explicit resolution; quantity and value reconcile |
| Return exceeds original quantity or is repeated | Reject excess based on current remaining returnable quantity |
| Return damaged goods | Quarantine stock cannot be reserved or sold |
| Count in progress while stock operation arrives | Operation for locked products/location is blocked with a clear explanation |
| Count owner disconnects | Authorized cancellation/recovery releases locks with audit history |
| Stock/cost is zero, stock returns to zero, or goods are free | No division-by-zero; documented valuation and rounding remain consistent |
| Stale draft edited in two tabs | Version conflict; no silent lost update |
| Deactivate warehouse with stock/open work | Block with actionable references |
| Backdate across latest posting, timezone midnight, leap day | Enforce business-date policy and valid tenant-local dates |
| Duplicate SKU imported or created concurrently | Tenant-scoped uniqueness enforced; row/field error reported |

## Loading, failure, and navigation

- Initial load: skeleton matches final layout; no false zero stock or empty-state flash.
- Refetch/filter: retain suitable existing content with a loading indicator; do not show old results as belonging to a new filter. Ignore out-of-order responses.
- Tenant switch: never retain previous tenant content under the new tenant header.
- Loading failure/offline: end skeleton state, show retry and preserve safe user input; do not claim a save succeeded.
- Empty dataset and zero search results: distinct explanations and relevant actions; hide unauthorized create actions.
- Save pending: prevent repeat submission, announce progress, restore controls on failure.
- Session expires with an unsaved form: request sign-in without submitting into a different tenant; revalidate before resuming.
- Narrow viewport, zoom, long names, many lines: shell does not clip menus, focused fields, errors, or actions; wide tables can scroll.
- Dialogs support Escape where safe, focus trapping, and return focus. Unsaved-change protection is explicit.
- Reduced-motion preference: static skeletons; no mandatory shimmer. Loading region announces status once, not each placeholder.

## Verification plan

### Two-database checks

- MongoDB unavailable: core stock posting still works; product attributes show unavailable with retry, not an empty saved value.
- PostgreSQL product save succeeds but attribute save fails: report the two outcomes accurately; retry attributes without duplicating the product.
- Repeated attribute save: unique tenant/product document remains; concurrent edits use conflict detection rather than silent overwrites.
- Forged tenant/product references: backend rejects inaccessible, nonexistent, or archived products before attribute mutation.
- Product archived during an attribute edit: reject stale save; core archive remains authoritative.
- Restore databases from different recovery points: detect orphaned attribute references; never create stock or products from MongoDB metadata.

When implemented, add focused unit tests for field rules, transaction/integration tests for concurrency and isolation, and end-to-end checks for key operational flows and loading/error states. Run checks with realistic tenant/location fixtures. Record results against the production acceptance criteria in the product plan; this checklist alone is not evidence of production readiness.
