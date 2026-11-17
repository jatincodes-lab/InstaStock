# Inventory design contract

Status: planned design with sign-in prototype. Related: [Product plan](INVENTORY_PRODUCT_PLAN.md), [Authentication flow](AUTH_FLOW.md), [Validation](VALIDATIONS.md), [Edge cases](EDGE_CASES.md).

## Confirmed direction

Use a light theme throughout the product. The user rejected dark theme. Use an inset application shell: a visible soft neutral outer background frames one large white rounded panel. Navigation, header, and working content sit inside it. Keep tables practical and avoid repeated oversized cards. For sign-in, use the selected bright split-screen reference: broad animated visual canvas on the left and a simple white authentication panel on the right. See AUTH_FLOW.md for proportions, staged fields, animation fallback, and mobile behavior.

First-time business setup uses the same light theme and rounded inset workspace panel. Keep the business, first branch, and first warehouse steps visibly inside one large curved panel with a restrained step indicator and minimal forms. Use AUTH_FLOW.md for the required fields, resume behavior, and access rules.

## First dashboard and app navigation

- After setup, open the dashboard inside the same light, rounded inset workspace panel. Keep a quiet neutral outer gutter visible around the curved panel.
- Use a persistent left sidebar for primary sections and a compact top bar for current workspace/location context and account actions. On narrow screens, collapse the sidebar behind one accessible menu button; retain the top bar and current context.
- Sidebar order: Overview; Inventory; Purchases; Sales; Contacts; Reports; Team; Settings. Inventory expands to Products and Fill opening stock; mark the active child and keep the group open while either page is active.
- Top bar: workspace selector when the user has multiple tenants; branch/location selector filtered to their access; page title or breadcrumb; profile menu. Do not make notifications, global search, or extra controls permanent until they solve a proven task.
- Do not show selectors for inaccessible locations or imply that “all locations” bypasses permissions. Keep the active workspace visible while navigating.
- Dashboard first-use state: one concise welcome, current branch/warehouse scope, and two clear actions: add/import products and enter opening stock. Avoid fake metrics, charts, or sample activity. Let the user open other sidebar sections without completing setup tasks.
- Opening stock: show all products as expandable rows instead of a flat table. Keep product identity, unit, tracking mode, recording status, batch count, total quantity, and estimated value in the collapsed summary. Expanded batch-tracked products show editable lot rows with quantity, unit cost, MRP, manufacturing/expiry dates, row value, and Add batch. Untracked products show one compact quantity/cost/MRP row. Prefill saved values; keep empty quantities visibly blank. Flag unusual price ratios inline without blocking save.
- Once data exists, prioritize low-stock items and pending receipts, dispatches, or transfers. Each count opens its relevant filtered list. Keep summary numbers scoped to the visible authorized locations.
- Use a semantic sidebar navigation landmark, an accessible mobile drawer with focus handling, visible keyboard focus, and responsive tables. The main workspace should remain scrollable without clipping menus or overlays at the rounded shell edges.

Typography: Plus Jakarta Sans at weight 600 for headings and large KPI values; Inter at weights 400, 500, and 600 for interface text and tables; JetBrains Mono for SKUs, barcodes, and order IDs only. Use tabular numerals for quantities and prices, keep table text at 13–14 px (never below 12 px), and do not use mono for ordinary text. Load fonts locally. Add Noto Sans Devanagari as an Inter fallback only if Hindi interface text is introduced.

## UI technology

React with TypeScript is the confirmed frontend direction. PostgreSQL and MongoDB are the confirmed databases, with ownership defined in the product plan. Use **shadcn/ui** as the selected React UI component system. Bits UI requires Svelte and cannot be used directly in this React app.

Product core information and supplementary attributes have independent save/loading/error states. An attribute-service failure must not hide core stock information or imply attributes are empty. Show an explicit retry action and preserve unsaved attribute edits.

Use shadcn/ui components for matching controls such as buttons, labels, inputs, dialogs, alert dialogs, dropdowns, popovers, selects, checkboxes, switches, tabs, tooltips, and pagination. Style them to match this product's tokens and framed shell. Use semantic HTML for simple fields and tables where that is clearer. Build skeletons, empty states, and error states as small shared React components. For dense inventory tables, pair the UI with TanStack Table rather than adding a second full UI kit.

The choice is based on shadcn/ui's project-owned, customizable components and its documented React/Vite setup. Sources: [shadcn/ui installation](https://ui.shadcn.com/docs/installation/manual), [official component documentation](https://ui.shadcn.com/docs/components).

All layout, validation, accessibility, and loading contracts below remain applicable. Avoid a second competing UI kit and unnecessary wrappers.

## Layout and tokens

- Desktop shell gutter: 10–16 px; shell radius: 20–24 px. Smaller screens: 4–8 px gutters and 12–16 px radius.
- Sidebar: approximately 232 px on desktop; collapsible drawer on small screens. Header approximately 60 px; content padding 24 px desktop / 16 px mobile.
- Keep tenant identity, authorized branch context, and profile accessible in the header. Warehouse selection appears with stock-related views.
- Use semantic tokens for outer background, shell, inset surface, border, text, muted text, accent, success, warning, danger, and focus. No scattered hardcoded colors.
- Base text 14–16 px; clear page headings 24–28 px; tabular numerals for stock and monetary columns. Sans-serif UI; decorative serif headings are not required by the reference preference.
- Spacing scale: 4, 8, 12, 16, 24, 32 px. Controls approximately 40 px high; usable touch targets on mobile. Inner control radius 6–10 px, subordinate to the outer shell.
- Use subtle borders and restrained elevation. One primary action per page, clear secondary actions, text plus color for statuses.
- Avoid multiple competing page scrollbars. Give wide tables horizontal scrolling where necessary. Portal menus/dialogs safely so shell corner clipping does not hide them.
- Ensure readable contrast, visible keyboard focus, logical headings, semantic tables, and complete accessible labels. Verify final token combinations before release.

## Loading and skeleton requirements

Every data-dependent page/section must define initial loading, success, empty, error, and refresh states. Use skeletons for initial content loading; use inline progress for actions, never replace a typed form with a skeleton during save.

| Surface | Loading behavior |
| --- | --- |
| App startup | Stable framed shell; placeholder navigation/context only while identity and permissions resolve; no unauthorized content flash |
| Dashboard | Metric and activity-row placeholders matching final dimensions |
| List/table pages | Keep headings and table header; show 6–8 representative skeleton rows; no invented values |
| Detail pages | Heading, summary, and line-item placeholders in their final positions |
| Edit form data | Skeleton until current values arrive, then editable form; never overwrite user edits on background refresh |
| Searchable selector | Small loading status inside the menu; do not confuse loading with “No results” |
| Reports | Placeholder table/summary while initially calculating; progress/status for longer exports |
| Background refresh | Preserve correctly scoped data with a subtle updating indicator; identify stale data when necessary |
| Save/post/delete | Busy action label and small spinner; prevent duplicate submission; preserve form content |

- Skeletons are noninteractive and hidden from assistive technology. Mark the content region aria-busy and provide one concise loading announcement.
- Match final content sizes to minimize layout shifts. Use a subtle pulse or shimmer only when reduced motion is not requested.
- End loading when a request fails; show an error and retry action. Never leave an indefinite skeleton after a known failure.
- Cancel or ignore stale responses on navigation/filter changes. Clear old tenant content immediately during a tenant switch.
- Do not delay fast responses just to display an animation. No skeletons for already available static content.

## Forms and feedback

Ask only for the minimum information required to finish the current task. Mark every other field optional, place less common details in a clearly labeled optional section, and let users add them later. Do not put optional fields in the user's way or prevent saving a valid minimal record. Use useful defaults and remember safe choices within the current tenant/location context.

Persistent labels, clear required indicators, example formats, inline errors, and a focused error summary for long forms. Use VALIDATIONS.md for behavior. Confirm irreversible/consequential actions with specific text naming the document or location. Use toast feedback only as a supplement; critical errors and completion results must remain discoverable on the page.

Design pages to feel immediate: render the useful shell first, fetch only the data required for the current view, paginate long lists, and avoid making nonessential dashboard data block stock work. Match skeletons to final content and show progress for longer tasks. See the performance targets and indexing guidance in INVENTORY_PRODUCT_PLAN.md.

## Implementation order

1. Inspect repository/frontend compatibility; establish the React integration boundary and configure shadcn/ui using its current official instructions.
2. Build tokens and the framed shell, then shared controls, field errors, table styling, skeleton, empty and error states.
3. Build one representative product list and create/edit form, including loading and validation, to verify the design.
4. Apply those patterns to branches, warehouses, contacts, and stock documents.
5. Verify keyboard/assistive access, responsive layouts, loading/error behavior, and real operational data density before expanding.
