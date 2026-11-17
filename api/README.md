# Stockroom API

Node.js 20 or later is required. The API owns the PostgreSQL connection; never send `DATABASE_URL` or service credentials to the browser.

## Configure and start

1. Copy `api/.env.example` to the repository root `.env`. Set `DATABASE_URL` and `DATABASE_SSL_CERT_PATH` for PostgreSQL. Keep `.env` out of source control.
2. Set `APP_ORIGIN` to the exact frontend origin. In production, use HTTPS and set `NODE_ENV=production`.
3. Generate `AUTH_RATE_LIMIT_SECRET` and `OUTBOX_ENCRYPTION_KEY` as independent random secrets. The outbox key must be 32 bytes, base64 encoded. Store them in the deployment secret manager and back them up securely; losing the outbox key makes queued invitation/reset emails unreadable.
4. Set `RESEND_API_KEY` and a verified `EMAIL_FROM` address. Run `npm run email-worker --prefix api` as a separate supervised process to deliver encrypted outbox mail and clean expired auth rows.
5. Apply migrations with `npm run migrate --prefix api`, then start with `npm run dev --prefix api` locally or `npm start --prefix api` in production.

The API binds to `127.0.0.1` by default. Set `API_HOST=0.0.0.0` when the API runs in a container behind a private reverse proxy. If using a proxy, configure only its exact IPs in `TRUSTED_PROXY_IPS`; it must overwrite `X-Forwarded-For`.

## First tenant owner

There is no public signup route. Only run `npm run bootstrap-owner --prefix api` against a completely empty database, with one-time `BOOTSTRAP_*` values set in the environment. It creates the first tenant, owner, branch, and warehouse in one transaction. Remove the bootstrap values immediately afterward. The command refuses to run once any user or tenant exists.

## Authentication routes

- `GET /api/v1/auth/csrf`
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/session`
- `POST /api/v1/auth/logout`
- `POST /api/v1/auth/logout-all`
- `POST /api/v1/auth/password-resets`
- `POST /api/v1/auth/password-resets/confirm`
- Tenant-scoped invitation list/create/resend/revoke routes and `POST /api/v1/auth/invitations/accept`

The OpenAPI contract is in `api/openapi.yaml`.

The browser uses an HTTP-only server-side session cookie, never a token in local storage. All state-changing requests require the CSRF cookie/header and the configured same-origin `Origin`. Invitation and reset links require the email worker to be running. Do not treat a healthy database check as proof that email delivery or auth workflows are healthy.

## Checks

Run `npm run verify` from the repository root. It runs the API unit tests and frontend build. Database transaction/migration tests must use a disposable test database; never point tests or migration rehearsal at production.
