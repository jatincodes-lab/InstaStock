# Shared validation rules

Status: implementation contract for the planned inventory product, not implemented code.
Related: [Product plan](INVENTORY_PRODUCT_PLAN.md), [Design](DESIGN.md), [Edge cases](EDGE_CASES.md).

## Universal behavior

- Apply the same rules to create, edit, bulk import, and server-side writes. Browser restrictions improve usability; the server is authoritative.
- Validate required fields after trimming surrounding whitespace. Reject whitespace-only required values. Preserve internal spaces in names and descriptions.
- Show requirements before entry, inline errors after blur or submission, and focus the first invalid field on failed submission. Link error text to its field and set aria-invalid.
- Validate changed fields during correction without showing errors on untouched fields. Preserve all entered values when saving fails.
- Handle typing, paste, drag/drop, autofill, mobile keyboards, and composition input. Keydown filtering alone is insufficient. Preserve navigation, deletion, clipboard shortcuts, selection replacement, and undo.
- Reject an invalid insertion without changing the last valid value; explain the permitted format. Do not silently remove characters or truncate pasted identifiers, which could save a different phone number or code.
- Allow temporary empty values while editing. Final requiredness and completeness are checked on blur/submit. Do not block IME composition mid-character; validate its committed result.
- Enforce maximum lengths in the UI and server. Imports report row and field errors without silently coercing values.
- Escape text when rendering and use parameterized database access. Input restrictions are not a security boundary.
- The lengths and numeric precision below are proposed defaults. Align database constraints and all callers with the final rules before implementation.

## Field matrix

| Field type | Allowed content and limit | Final validation / example message |
| --- | --- | --- |
| Explicit letters-only field | Unicode letters and combining marks; spaces between words; maximum 100 characters | No digits, emoji, or punctuation. “Use letters and spaces only.” Assign only to genuinely alphabetic fields. |
| Person/contact name | Unicode letters/marks, spaces, apostrophes, hyphens, periods; maximum 100 | Required where specified; reject digits. Allow names such as O'Neil and Anne-Marie. |
| Business, branch, warehouse, product, category name | Unicode text including digits and ordinary punctuation; maximum 150 | Required; allow “Branch 2”, “Warehouse A-1”, “Vitamin B12”. Do not apply letters-only validation here. |
| Mobile number | ASCII digits 0–9 only; maximum 10 characters while editing; store as a string | Exactly 10 digits when supplied. Reject letters, signs, spaces, decimal points, and an 11th digit. “Enter a 10-digit mobile number.” |
| Email | Trim surrounding whitespace; maximum 254 characters | Validate using the platform's established email validator on client/server; avoid a restrictive handwritten regex. Verification, if needed, is separate from format validation. |
| SKU / location code | Letters, digits, hyphen, underscore; maximum 50 | Required, trim, normalize case consistently. Tenant-scoped uniqueness enforced by the database, including concurrent creation. |
| Barcode | String, maximum 100; format depends on selected barcode standard | Preserve leading zeroes. Do not apply mobile-number rules or convert to a number. |
| Address | Unicode letters, numbers, whitespace, punctuation; maximum 500 | Required only where the workflow needs an address. No letters-only restriction. |
| Postal code / tax identifier | String, maximum 30 | Country-specific rules only after the supported country is chosen; preserve leading zeroes. |
| Notes | Plain text, maximum 2000 | Optional; no HTML execution. |
| Quantity | Decimal with at most 3 fractional digits, proposed decimal(18,3) storage | Positive on order/receipt/dispatch/transfer lines; zero allowed for physical counts. Reject exponent notation, NaN, infinity, overflow, and excess precision. Integer-only for indivisible units. |
| Adjustment quantity | Same quantity precision; signed nonzero decimal | Reason and authorization required; resulting stock cannot violate stock rules. |
| Unit price / unit cost | Nonnegative decimal, at most 4 fractional digits, proposed decimal(18,4) | Zero permitted for free goods; negative values rejected. Compute using decimal arithmetic. |
| Document totals | Computed from validated lines | Server recomputes; never trust browser totals. Display/round to tenant currency precision consistently. |
| Reorder threshold | Nonnegative quantity | Zero valid; unique setting per product/warehouse. |
| Dates | Real calendar dates, displayed unambiguously | End date cannot precede start date. Stock posting cannot be future-dated or precede the permitted posting boundary. Future expected-delivery dates are valid. |
| Select / reference ID | Existing active record in current tenant and permitted location | Server verifies membership, access, and relationships, even if the browser offered the option. |

The 10-digit mobile rule is the user's requested product policy, not a universal international telephone rule. Country-code support requires an explicit later change. Optional phone fields may be empty; if supplied they must be complete. Requiredness belongs to each form schema, not the numeric input component.

## Stock and document validation

- Require at least one valid line before confirming/posting. Reject duplicate product lines within the same stock document in the initial release; ask the user to edit the existing line.
- Warehouse must belong to the selected branch and tenant. Transfer source and destination must differ.
- Receiving cannot exceed the remaining ordered quantity. Dispatch cannot exceed remaining ordered/reserved stock or usable on-hand stock. Recheck inside the posting transaction.
- Transfer receipt cannot exceed shipped-but-unreceived quantity. Returns cannot exceed remaining returnable quantity. Supplier returns must also have stock available.
- Count entry permits zero and disallows negatives. Count posting requires an active count lock and authorized review.
- Stock adjustments require reason and manager authorization; posted records require linked corrections instead of edits.
- Recheck current status/version at save time. Reject stale changes with a reload/review message rather than overwriting another user's work.
- Tenant and actor come from authenticated context. Never trust submitted tenant IDs or creator IDs.
- Deactivation is blocked when stock, reservations, in-transit quantities, or open documents remain. Preserve referenced history.

## Implementation boundary

Use one reusable set of field rules and shared form patterns; do not copy independent regexes into pages. Match server rules to these contracts and enforce tenant uniqueness/relations in the database. Do not create a generic validation framework beyond what the chosen stack needs. See EDGE_CASES.md for acceptance scenarios.
