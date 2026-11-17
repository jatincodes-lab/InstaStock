# Tenant and location access plan (RBAC)

Status: implementation plan; authorization is not implemented yet.
Related: [Product plan](INVENTORY_PRODUCT_PLAN.md), [Authentication flow](AUTH_FLOW.md), [Design](DESIGN.md), [Edge cases](EDGE_CASES.md).

## Goal

Let each business give staff the least access they need while keeping tenants isolated and branch/warehouse visibility clear. A user's role belongs to their membership in a tenant, not to the user globally. One person can therefore be an administrator in one tenant and a warehouse operator in another.

## Authorization model

Use fixed, seeded roles and named permissions. Apply three checks to every protected operation:

1. **Identity:** authenticated, active user and session.
2. **Tenant membership:** active membership in the tenant derived from the validated session/request context.
3. **Permission and scope:** role grants the action and the target record is within the member's assigned tenant, branches, or warehouses.

Deny by default. The frontend may hide unavailable actions, but the backend enforces every read, create, update, post, reverse, export, search, file access, and background job. Never accept a submitted `tenant_id`, role, creator, or location assignment as proof of authority.

## Roles

| Role | Intended access |
| --- | --- |
| Tenant owner | All tenant data and settings, member/role assignment, ownership transfer, and cost visibility |
| Administrator | All tenant operations, settings, and member management; cannot transfer ownership |
| Branch manager | All operational work and reports within assigned branches; can review/post counts and adjustments there; no member/tenant administration by default |
| Warehouse operator | Receive, dispatch, count entry, and transfer work in assigned warehouses; read required product and stock data; cannot approve adjustments, administer members, or see cost by default |
| Sales staff | Customers and sales orders within assigned branch scope; reserve/dispatch only if explicitly enabled for that role policy; no purchasing, counts, adjustments, or administration |
| Purchasing staff | Suppliers, purchase orders, receipts, and supplier returns within assigned branch scope; no sales administration, adjustments, or member administration |
| Viewer | Read-only data in assigned scope; cost values are hidden by default |

No custom role editor in the first release. Keep seeded role definitions versioned in code/migrations. A future custom-role builder requires audit, permission-combination tests, and a clear support policy before it is added.

## Permission groups

Use a small permission catalog with action-specific names. Proposed groups:

- `catalog.read`, `catalog.manage`
- `contacts.read`, `contacts.manage`
- `purchases.read`, `purchases.create`, `purchases.confirm`, `receipts.post`, `supplier_returns.post`
- `sales.read`, `sales.create`, `sales.confirm`, `dispatches.post`, `customer_returns.post`
- `stock.read`, `transfers.create`, `transfers.ship`, `transfers.receive`, `counts.create`, `counts.enter`, `counts.approve`, `adjustments.post`
- `reports.read`, `reports.cost.read`, `exports.create`
- `locations.read`, `locations.manage`, `members.read`, `members.manage`, `settings.manage`, `audit.read`, `ownership.transfer`

Map roles to permissions centrally. Do not infer permissions from UI route names or request fields. Dangerous operations (posting, approving, reversing, ownership transfer, role change) get separate permissions; a general `write` flag is too broad.

## Location scope

- Tenant scope permits all records in one tenant.
- Branch scope permits records in the assigned branch and its warehouses.
- Warehouse scope permits records only in explicitly assigned warehouses.
- Each warehouse has one parent branch in the same tenant. Validate this relationship on every write.
- A transfer requires scope for both source and destination. Separate ship and receive actions require access to their respective warehouse; if one user performs both, they must have both permissions and both scopes.
- Branch selector values and URL filters only narrow authorized data; they never widen the permission scope. “All branches” means all branches already authorized to that member.
- If a record's scope changes, recheck permission at the moment of posting and invalidate relevant cached access decisions.

## Cost visibility

Cost and valuation are sensitive. Owner and administrator can see cost by default. Warehouse and sales/purchasing staff do not see cost by default. Branch managers and viewers may be granted the named `reports.cost.read` capability by an owner/admin for their existing location scope. This is a specific grant, not a broader role change. Enforce it for API fields, exports, dashboard totals, search, and documents.

## Tenant and platform boundary

- Tenant administration is always scoped to one tenant membership.
- Platform operations are a separate control plane with separate identities and permissions; a platform operator is not automatically a tenant member.
- Do not build platform support impersonation in the first release. If support access is later required, make it time-limited, tenant-approved, visibly disclosed, least-privilege, and fully audited.
- PostgreSQL is authoritative for users, sessions/memberships, role assignments, permissions, tenant and location relationships, and all authorization decisions. MongoDB attributes are returned only after PostgreSQL confirms tenant, product, and location authorization.

## Membership and invitation lifecycle

Invite a member to a specific tenant and role; accept invitation with a time-limited, single-use token. Assign branch/warehouse scope at invitation or before activation. Reject activation if the role has no valid scope where one is required. Membership states: invited, active, suspended, removed. Suspension/removal revokes sessions and prevents new reads/writes promptly. Role and scope changes are audited with actor and timestamp.

Use a session identity for user ID; resolve active membership/role/scope on the server per request (or via short-lived, invalidatable cache). Do not trust long-lived role claims in a browser token after membership changes. After sign-in, choose among authorized tenant memberships; revalidate a remembered tenant before showing data.

## Data and enforcement shape

PostgreSQL is the authorization source of truth. Proposed tables/entities: `users`, `sessions`, `tenants`, `memberships`, `roles` (seeded), `permissions` (seeded), `role_permissions`, `membership_locations` (branch/warehouse scope), and `audit_events`. Every tenant-owned business table has a non-null `tenant_id`; use tenant-scoped foreign keys/unique constraints where practical. A membership location reference must itself be tenant-consistent.

Centralize policy checks in backend guards/services and retain explicit object-level validation in document workflows. Consider PostgreSQL row-level security only as defense in depth after the application connection/session model is designed and tested; do not assume RLS replaces application checks. Never connect the browser directly with database credentials.

## Denial and error behavior

- Unauthenticated request: return authentication required.
- Authenticated but no tenant membership: deny without revealing whether a target tenant/record exists.
- Wrong tenant or out-of-scope location: same generic not-found/forbidden response policy so IDs cannot be enumerated.
- Missing action permission: explain in the UI which role/admin can grant access without disclosing hidden records.
- Stale membership/session: require reauthentication or refresh the authorization context; do not proceed with cached permissions.

## Acceptance scenarios

- User has different roles in two tenants; changing the active tenant changes effective permissions and clears old tenant data.
- Guessing another tenant's IDs fails for detail pages, mutations, search, attachments, exports, and totals.
- Branch manager cannot access a sibling branch or another tenant's warehouse.
- Warehouse operator can enter a count but cannot approve/post its variance unless policy grants the separate permission.
- Transfer shipping and receiving are checked against source and destination scope independently.
- Removing a role/location assignment prevents the next protected request and revokes the user's session as specified.
- Cost is absent from responses and exports for staff without `reports.cost.read`.
- Background jobs carry and validate tenant/actor/scope context; no unscoped jobs or cross-tenant batch updates.
- Membership invitation cannot assign owner/admin authority unless issued by an authorized tenant owner/admin and the inviter holds the corresponding permission.
- Platform operator permissions do not grant tenant data access.

Implement this after the sign-in/session foundation and before exposing tenant data or operational screens. Add focused authorization tests with two tenants and multiple branches/warehouses before any production release.
