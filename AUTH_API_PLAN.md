# Authentication API plan

Status: implemented backend contract. Keep this file and `api/openapi.yaml` aligned with the API.

This contract resolves the authentication behavior in [AUTH_FLOW.md](AUTH_FLOW.md), [RBAC.md](RBAC.md), and [PRODUCTION_READINESS_PLAN.md](PRODUCTION_READINESS_PLAN.md). Use PostgreSQL as the source of truth for users, memberships, sessions, invitations, password resets, and audit events. The browser receives opaque cookies only; never store credentials or bearer session tokens in browser storage.

## Decisions

- **Access is invitation-only.** There is no public account or tenant signup endpoint. A valid invitation may create a user as part of acceptance. Provision the first tenant owner through a controlled operator-run bootstrap procedure; do not expose an unauthenticated “become owner” endpoint.
- **Sign-in is one request with email and password.** Do not provide an email-existence lookup endpoint. Return the same sign-in error for unknown email, wrong password, disabled user, and unusable membership state.
- **Use server-side opaque sessions.** Generate at least 256 bits of cryptographic randomness, send the value only in an HTTP-only cookie, and store only its SHA-256 hash in PostgreSQL. Revoke sessions on password reset, account disable, and membership removal as policy requires.
- **Hash passwords with Node's stable `scrypt` implementation** at minimum `N=2^17, r=8, p=1`, using a unique 16-byte salt and a bounded concurrency gate. OWASP prefers Argon2id, but its current Node core API is release-candidate and no maintained Argon2 dependency is installed here; use Argon2id after adopting a stable maintained implementation. Do not invent password cryptography. [OWASP password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
- **Keep authorization live.** A session authenticates a user; every tenant and location request rechecks current membership, role, permission, tenant status, and scope in PostgreSQL. Do not trust role or permission claims stored in the browser or a long-lived token.
- **No cross-origin cookie API.** Serve the browser app and API on one origin. Validate `Origin` on mutations, reject cross-site Fetch Metadata, require JSON/custom headers, and use a CSRF token for cookie-authenticated mutations. Do not enable wildcard credentialed CORS.
- **Do not lock an account permanently after failed logins.** Apply shared, bounded rate limits by source IP and a keyed hash of normalized email; return `429` with `Retry-After`. Configure thresholds for the deployed traffic and monitor false positives. Generic errors and throttling follow [OWASP authentication guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html).

## HTTP contract

All routes are under `/api/v1`. Request bodies have a small configured size limit. JSON responses use UTF-8. Email is trimmed and normalized consistently for comparison; password bytes are never trimmed or silently changed. Validation errors must not echo passwords or tokens.

| Method and path | Authentication | Purpose |
| --- | --- | --- |
| `GET /auth/csrf` | No | Issue/refresh the pre-auth CSRF token needed for login and recovery requests. |
| `POST /auth/login` | No, but CSRF and rate limits apply | Verify credentials and create a session. |
| `GET /auth/session` | Session cookie | Return the signed-in user and currently active memberships needed for tenant selection. |
| `POST /auth/logout` | Optional session; CSRF required | Revoke the current session and clear cookies. Safe to repeat. |
| `POST /auth/logout-all` | Session cookie; CSRF required | Revoke all sessions for the user after recent password confirmation. |
| `POST /auth/password-resets` | No, but CSRF and rate limits apply | Request a reset email; response never reveals whether the email exists. |
| `POST /auth/password-resets/confirm` | No, but CSRF and rate limits apply | Consume a one-time reset token, change password, revoke sessions. |
| `POST /tenants/{tenantId}/invitations` | Session + `members.manage` | Invite a person into the caller's authorized tenant with an allowed role and location scope. |
| `GET /tenants/{tenantId}/invitations` | Session + `members.read` | List invitations visible to the caller's tenant scope. |
| `POST /tenants/{tenantId}/invitations/{invitationId}/resend` | Session + `members.manage` | Rotate a still-pending invitation token and queue a new email. |
| `POST /tenants/{tenantId}/invitations/{invitationId}/revoke` | Session + `members.manage` | Revoke a pending invitation. |
| `POST /auth/invitations/accept` | No for a new user; existing user must sign in | Accept a valid invitation; create the user only when needed and establish membership atomically. |

No API may create an owner/admin membership through ordinary invitation input unless the caller has the explicit authority defined by RBAC. A tenant ID in a URL selects context; it does not grant access.

### Request and response shape

- `POST /auth/login`: `{ "email": "person@example.com", "password": "exact user input" }`. Success is `200` with `{ user, memberships }` and a new session cookie. A user with several memberships selects one in the client; a user with none receives a useful authenticated access state without tenant data. Failure is the same `401 { "error": "invalid_credentials" }` for unknown, disabled, or incorrect credentials.
- `GET /auth/session`: `200 { user, memberships }` for a live session, otherwise `401 { "error": "unauthenticated" }`. Memberships include only active tenant names, role display, and permitted branch/warehouse IDs needed by the UI. Sensitive cost data is never part of this response.
- `POST /auth/logout`: `204` whether the session is live or already expired. Clear session and CSRF cookies with the same Path/SameSite/Secure attributes used when setting them.
- `POST /auth/password-resets`: `{ "email": "person@example.com" }`; always return `202` with the same generic confirmation. Invalid syntax may return `400` before lookup. Do not send synchronously in the request path.
- `POST /auth/password-resets/confirm`: `{ "token": "...", "newPassword": "..." }`; valid token returns `204`; invalid, expired, revoked, or consumed token returns the same safe `400 { "error": "invalid_or_expired_token" }`.
- `POST /tenants/{tenantId}/invitations`: `{ "email": "...", "role": "...", "branches": ["..."], "warehouses": ["..."] }`; derive inviter and tenant membership from the session. Return `202` after the invitation and email-outbox item are committed. Do not return or log the raw invite token.
- `POST /auth/invitations/accept`: `{ "token": "...", "password": "..." }` for an invited address without an existing account. For an existing account, require an authenticated session and accept only when its normalized email matches the invitation. Return the new/current user and memberships, and set a session only after the transaction succeeds.

Use stable public error codes. Examples: `invalid_credentials`, `unauthenticated`, `validation_failed`, `forbidden`, `not_found`, `rate_limited`, and `invalid_or_expired_token`. Out-of-tenant and out-of-scope object IDs follow the same generic not-found policy. Include field errors only for safe fields such as email; never reflect secrets.

## Cookies, CSRF, and session rules

- Production session cookie: `__Host-stockroom_session`; `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, no `Domain`. Clear it on logout with matching attributes. Use HTTPS everywhere outside local development.
- CSRF token: separate `__Host-stockroom_csrf` cookie, readable by the same-origin frontend and bound to the server-side session hash after login. Send it in `X-CSRF-Token` for every state-changing cookie-authenticated request. Rotate on login and session rotation. Bootstrap it before login; check token, exact allowed `Origin`, and cross-site Fetch Metadata.
- Regenerate the session token on login and password change; never adopt a caller-supplied session identifier. Do not put session, invite, or reset tokens in URLs, analytics, logs, or referrer-bearing pages. Put invitation/reset tokens in the URL fragment and submit them in a POST body after the frontend loads.
- Set explicit idle and absolute session lifetimes, enforce both server-side, and test expiry. Do not extend absolute lifetime just because the user is active. Update `last_seen_at` on a throttled interval rather than writing on every request.
- Require recent authentication for logout-all and other sensitive account actions. Password reset revokes all sessions. Suspending/removing a membership blocks its tenant requests immediately; disabling a user revokes all sessions.
- Do not reveal tenant names, membership count, invitation status, or account existence before authentication. After authentication, show only the caller's active memberships.

## Invitation and recovery transaction rules

1. Generate a random one-time token with a cryptographic RNG. Store only its SHA-256 hash; send the raw value only in the email. Give it a configured short expiry and revoke/replace it on resend.
2. Commit the invitation/reset record and an email-outbox message in one PostgreSQL transaction. A worker sends email and retries transient provider failures without exposing tokens to logs. Persist delivery state and alert on stuck messages.
3. On acceptance/reset, lock the token row, then verify hash, expiry, unused/revoked state, and normalized email. Consume it, create/update the user and membership or password, add authorized location scope, write the audit event, and create/revoke sessions in the same transaction as applicable.
4. A retry after a lost response must not create a second user, membership, or reset. A consumed token is never reusable. Two simultaneous accepts/resets allow exactly one commit.
5. Existing invited users must authenticate to accept another tenant invitation; the flow must not change their password. A new user sets a password only for the address the valid invitation names.
6. Normalize invitation email, serialize concurrent invites for the same tenant/address, and replace/revoke the existing pending invite rather than allowing multiple valid links. A resend rotates the token so old links stop working.
7. The bootstrap process for the first tenant owner must be operator-controlled, one-time, logged, and documented. Its credentials/token must not be committed to source or printed in routine logs.

## Schema work required before routes

The initial migration already has `users`, `sessions`, `memberships`, `invitations`, `roles`, `permissions`, `role_permissions`, and `audit_events`. It is a starting point, not a completed auth implementation. Add a forward-only migration after reviewing the current schema that:

- stores normalized email consistently and maintains a database unique constraint for user identity;
- stores a CSRF token hash and explicit absolute/idle expiry fields or equivalent session state;
- adds one-time password reset tokens with hashed token, user, expiry, used/revoked timestamps, and lookup indexes;
- records invitation location scope before acceptance (or in a tenant-consistent join table), normalized invite email, and enough state to serialize/resend/revoke pending invites;
- enforces one pending invitation per tenant and normalized email through transactional logic plus a suitable constraint/index;
- adds a transactional email outbox with retry/lease state and no plaintext token columns;
- retains tenant-consistent foreign keys and indexes for user session revocation and invitation/reset lookup.

Never rewrite `001_initial_schema.sql` after it has been applied to shared environments. Use a new migration; test both a clean install and upgrade from the previous migration. The migration runner itself needs failure/rollback and concurrent-run coverage.

## Client behavior

- Replace the email-only prototype with email and password submission. Keep the email-first visual only if it does not call an account-existence endpoint; reveal the password without telling the user whether the email is registered. Prefer the single login request above.
- Preserve email after recoverable failures. Clear the password after rejection and when leaving the form. Never persist the password or session token in local/session storage.
- Prevent duplicate submits, show pending state, and distinguish rejected credentials from network failure without claiming credentials were checked when the request failed.
- After `GET /auth/session`, route a single-membership user into that tenant; show a tenant chooser for multiple memberships; show a useful contact/accept-invitation state for zero memberships. Clear tenant-scoped client data immediately on logout, expiry, or tenant switch.
- Password reset always shows the same completion message. Expired/reused links explain how to request another link. Invitation acceptance has separate expired/revoked/used UI but no account enumeration.
- Use accessible labels, field-linked errors, keyboard operation, password-manager autocomplete, paste support, and preserved form values on recoverable errors.

## Required edge cases and tests

Use the repository's `npm run verify` gate and extend it with database/API integration tests. Auth tests must use isolated users, tenants, roles, and locations; never production credentials or real email delivery.

### Sign-in/session

- email case/whitespace normalization; malformed/oversized bodies; password is not trimmed; empty password; Unicode and maximum supported length;
- unknown email, wrong password, disabled user, suspended/removed membership, closed tenant: same safe credential response where appropriate and no tenant data leak;
- known and unknown login attempts have bounded, comparable work (including dummy password-hash verification for an unknown account);
- rate limits aggregate across multiple API processes, include `Retry-After`, resist spoofed forwarded-IP headers, and do not permanently lock a victim account;
- session token is unguessable, stored only as a hash, regenerated after login, cookie flags are correct, no token appears in response JSON/logs;
- missing/expired/revoked session, idle expiry, absolute expiry, logout twice, logout-all, password reset, user disable, and membership removal;
- CSRF missing/mismatched token, wrong Origin, cross-site Fetch Metadata, same-origin success, token rotation, login CSRF, and no wildcard credentialed CORS;
- multi-tenant selection; membership/role/scope revoked between two requests; guessed IDs and cost fields remain inaccessible.

### Invitations/recovery

- valid, malformed, expired, revoked, consumed, and concurrently consumed invite/reset tokens;
- invite to a new user; invite to an existing user; email mismatch; existing user password is never changed by acceptance;
- no permission, wrong tenant, unauthorized role, unauthorized branch/warehouse scope, inactive location, duplicate/concurrent invitations, resend invalidates old link, revoke races with accept;
- mail provider failure/retry, outbox worker crash/lease expiry, request timeout after commit, retry without duplicate membership;
- reset request for known and unknown email returns the same response; reset token is single use; successful reset revokes every old session;
- first-owner bootstrap cannot be repeated or invoked by an ordinary tenant member.

### Migration, logging, and client

- migration from clean DB and previous schema; rollback on SQL failure; two migration processes serialize safely;
- audit records have actor/action/time but no passwords, raw tokens, session cookies, or sensitive request body;
- UI survives refresh with a valid cookie; shows expired-session state; preserves safe input after network failure; clears old tenant data on switch/sign-out; keyboard and screen-reader flows work.

## Implementation order and release gate

1. Resolve deployment values (public origin, trusted proxy, email provider, rate-limit storage, session lifetimes, token expiries, first-owner bootstrap, password max length). Add the schema migration and migration tests.
2. Implement shared request parsing, error mapping, trusted-proxy handling, rate limiting, CSRF/origin checks, audit, and email outbox.
3. Implement invitation administration/acceptance and password reset with transaction/concurrency tests.
4. Implement login/session/logout and tenant membership listing; prove generic errors, revocation, and tenant isolation.
5. Connect the React sign-in, invitation, reset, and tenant selection states. Add browser end-to-end tests for success, denial, retry, expiry, and tenant switch.
6. Run the full `npm run verify`, database integration suite, staging migration rehearsal, security review, and restore/session-revocation checks before enabling real accounts.

Do not create tenant/product/stock endpoints until the auth and authorization exit gate in the production readiness plan passes. Passing tests are required to merge; production also requires staging and operational sign-off.
