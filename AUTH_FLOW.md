# Sign-in flow plan

Status: visual prototype created; backend authentication is not connected. Authentication API behavior is specified in [AUTH_API_PLAN.md](AUTH_API_PLAN.md). Access is invitation-only; public self-registration is disabled.

## Visual direction from the user's reference

- Use a bright, clean split-screen sign-in page: a broad left visual canvas (about 60–65% on desktop) and a quiet white form area on the right (about 35–40%, roughly 440 px maximum form width).
- Keep the reference's soft flowing bands, pale blue/cyan light, whitespace, and simple typography. Create an original abstract inventory-inspired visual; do not reuse Razorpay branding, logo, text, or exact artwork.
- Put the product mark at the upper left. The left-side message sits toward the lower left and explains a real product benefit (for example, “Your stock, in view.”). Do not invent customer counts, testimonials, trust claims, or payment-style promotional ribbons.
- Keep sign-in details on the right: small product mark, short welcome line, clear heading, one email field and one Continue button. After a valid email, reveal the password step in the same panel with Back and Sign in actions. This keeps the first step focused while retaining a minimal two-field login overall.
- Keep password recovery in the password step. Invitation-only onboarding remains the access path; omit social login until it is a confirmed product requirement.
- Suggested implementation for the moving canvas: lightweight CSS/SVG flowing bands or a small locally served decorative animation, with a static image/CSS still as fallback. Avoid a large third-party video or network request on initial load. If a video is later chosen, mute it, loop it, omit controls, provide a poster, pause it offscreen, and fall back to a static image.
- The visual is decorative: hide it from assistive technology and keep all sign-in text and actions outside the canvas. Respect `prefers-reduced-motion` by showing the still state; animation must never delay or block sign-in.
- On narrow screens, reduce or hide the visual area and let the form take priority. Keep it one-column, preserve contrast, and avoid cropping the form behind an overlay.

## Pages and sequence

1. **Sign-in form** - collect email and password, with password recovery available. The visual may reveal the password field after email entry, but must not call an account-existence endpoint.
2. **Sign in** - submit email and password together. Return the same generic failure for unknown email, wrong password, disabled user, or unusable membership. On success, open the only active tenant or let the user choose among authorized tenants.
3. **Uninvited email** - do not create an account or tenant and do not reveal whether the email exists. Explain how to request an invitation.
4. **Password recovery request** - email only; always return the same safe response without exposing account status.
5. **Set a new password** - open a short-lived, single-use email link; enter and confirm a new password; invalidate prior sessions after a successful reset.
6. **Invite acceptance** - validate a short-lived one-time invite and accept membership. A new invited user sets a password; an existing user must sign in and cannot have their password changed by accepting an invite.

Do not expose an account-existence lookup or public signup endpoint. Invitation acceptance is the only self-service path that can create a user. Provision the first tenant owner through a controlled, one-time operator bootstrap process.

## First-time workspace setup screen

After an invited tenant owner accepts their invitation and is authorized to complete setup, show a short setup flow inside the signed-in product's light, rounded inset shell. Reuse the curved panel framing from the user's first reference: visible neutral outer margin, one large white rounded workspace panel, and the form fully inside it. Keep the bright split-screen canvas for sign-in; setup uses the light product shell and calm form styling.

1. **Business** — ask only for the business/workspace name (required). Offer currency and timezone as optional-on-screen settings with sensible defaults and the ability to change them later. Do not ask for tax, address, logo, staff, or subscription details at this point.
2. **First branch** — branch name required; code and address optional. Explain that branches group operating locations.
3. **First warehouse** — warehouse name required; location/address optional. Associate it with the branch just created. Explain that stock is held in warehouses.
4. **Ready** — confirm workspace, branch, and warehouse, then enter the dashboard. The dashboard's first-use state guides users to add/import products and enter opening stock. Do not invent sample stock or silently create products.

Keep this as one short guided setup with a visible step indicator, Back/Continue, and a clear “finish later” path where safe. Save each completed step so refresh/re-entry resumes safely; prevent duplicate business/branch/warehouse creation on retry. Do not expose data until membership and setup ownership are validated by the backend.

Existing users skip setup when their workspace is complete. A user with one authorized workspace enters it directly; a user with multiple workspaces chooses one first. An invited user without setup permission goes to their assigned workspace or a clear access state rather than tenant creation. Only the controlled first-owner bootstrap can create the initial owner membership.

Show field-level validation and preserve entries after recoverable network errors. Use skeletons only while loading saved setup state; never replace active form input with a skeleton. Mobile layout is one column with the same framed panel and reduced outer gutter.

## Sign-in behavior

- Required inputs are email and password. Trim email around the edges; preserve password bytes exactly and never trim it. Browser validation is helpful feedback; the server validates again.
- Use `autocomplete="username"` and `autocomplete="current-password"`; allow password managers and paste. Do not impose arbitrary character filtering on passwords.
- Show a concise pending state and prevent duplicate requests. On network/server failure, restore the action and preserve the email. Never clear or log the password unless the user leaves the form.
- Use a generic invalid-credentials message for unknown email, wrong password, disabled account, or unavailable membership. Never show tenant or membership details before authentication.
- Apply server-side rate limiting and audit failed/successful authentication without recording secrets. Use established secure password hashing; never store passwords in MongoDB or browser storage.
- Use secure, HTTP-only, same-site session cookies. Protect state-changing requests against CSRF as appropriate. Revoke sessions on password reset and membership removal.
- After authentication, resolve tenant memberships and location permissions on the server. Client-selected tenant/location is context, not authorization.
- Return users to a requested page only after validating its tenant and access scope.

## Error and loading states

- Initial page: framed shell renders immediately; no dashboard or tenant data appears before authentication.
- Submitting: button says “Signing in…”, is busy, and cannot be submitted twice.
- Invalid credentials: generic inline alert; email retained; password cleared after an auth rejection.
- Network/server error: explain that sign-in could not complete and offer retry; do not claim the credentials were checked if the request never reached the service.
- Password recovery: generic success confirmation; do not confirm account existence.
- Uninvited address: do not create an account; show safe invitation guidance without confirming whether the address is registered.
- Expired/used invite or reset link: explain next action and provide a safe way to restart.
- Authenticated user with no active tenant: show a useful access/contact state, never an empty inventory dashboard.

## Prototype boundary

The React screen is currently a client-side prototype. Temporarily, submitting any syntactically valid email opens workspace setup so the flow can be previewed. It does not look up accounts, authenticate, send credentials, create a user/tenant, or save setup values. Replace this temporary routing with the server-backed email/password login and invitation-acceptance flow in [AUTH_API_PLAN.md](AUTH_API_PLAN.md). Never label the prototype as a successful sign-in or persist its data as real records.
