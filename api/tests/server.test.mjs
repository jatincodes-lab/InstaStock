import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { createHandler } from "../src/app.mjs";
import { hashToken, readCookie } from "../src/security.mjs";

const authOptions = {
  env: { AUTH_RATE_LIMIT_SECRET: "test-only-secret-that-is-at-least-32-bytes" },
  dummyHash: "test-hash",
  hashPassword: async () => "test-hash",
  verifyPassword: async () => false,
};

function response() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status, headers = {}) { this.status = status; Object.assign(this.headers, headers); },
    end(body) { this.body = body; },
  };
}

function request(method, url, headers = {}, body = "") {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  req.method = method;
  req.url = url;
  req.headers = headers;
  req.socket = { remoteAddress: "127.0.0.1" };
  return req;
}

function authPool(user, csrf) {
  const membership = { id: "member-1", tenant_id: "tenant-1", tenant_name: "Northstar", role: "tenant_owner" };
  const scopes = { rows: [], rowCount: 0 };
  return {
    async query(sql) {
      if (sql.includes("auth_rate_limits")) return { rows: [{ request_count: 1, retry_after: 900 }], rowCount: 1 };
      if (sql.includes("FROM stockroom.users WHERE email_normalized")) return { rows: user ? [user] : [], rowCount: user ? 1 : 0 };
      if (sql.includes("FROM stockroom.memberships m JOIN stockroom.tenants")) return { rows: user ? [{}] : [], rowCount: user ? 1 : 0 };
      if (sql.includes("FROM stockroom.sessions s JOIN stockroom.users")) return { rows: [{ session_id: "session-1", user_id: "user-1", csrf_token_hash: hashToken(csrf), expires_at: new Date(Date.now() + 60000), idle_expires_at: new Date(Date.now() + 60000), last_seen_at: new Date(), email: user.email, email_normalized: user.email_normalized, user_status: "active" }], rowCount: 1 };
      if (sql.includes("FROM stockroom.memberships m")) return { rows: [membership], rowCount: 1 };
      if (sql.includes("membership_branch_scopes") || sql.includes("membership_warehouse_scopes")) return scopes;
      assert.fail(`Unexpected pool query: ${sql}`);
    },
    async connect() {
      return {
        async query(sql) {
          if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [], rowCount: 0 };
          if (sql.includes("SELECT status FROM stockroom.users")) return { rows: [{ status: "active" }], rowCount: 1 };
          if (sql.includes("SELECT m.id, m.tenant_id")) return { rows: [membership], rowCount: 1 };
          if (sql.includes("membership_branch_scopes") || sql.includes("membership_warehouse_scopes")) return scopes;
          if (sql.includes("INSERT INTO stockroom.sessions") || sql.includes("INSERT INTO stockroom.security_events")) return { rows: [], rowCount: 1 };
          assert.fail(`Unexpected client query: ${sql}`);
        },
        release() {},
      };
    },
  };
}

test("health reports a connected database", async () => {
  let query;
  const handler = await createHandler({ query: async (sql) => { query = sql; } }, { auth: authOptions });
  const res = response();

  await handler({ method: "GET", url: "/api/v1/health" }, res);

  assert.equal(query, "SELECT 1");
  assert.equal(res.status, 200);
  assert.equal(res.headers["Content-Type"], "application/json; charset=utf-8");
  assert.deepEqual(JSON.parse(res.body), { status: "ok", database: "connected" });
});

test("health hides database errors and reports unavailable", async () => {
  const handler = await createHandler({ query: async () => { throw new Error("private database detail"); } }, { auth: authOptions });
  const res = response();

  await handler({ method: "GET", url: "/api/v1/health" }, res);

  assert.equal(res.status, 503);
  assert.deepEqual(JSON.parse(res.body), { status: "unavailable", database: "unavailable" });
  assert.equal(res.body.includes("private database detail"), false);
});

test("unknown routes return a JSON 404", async () => {
  const handler = await createHandler({ query: async () => assert.fail("unexpected database query") }, { auth: authOptions });
  const res = response();

  await handler({ method: "GET", url: "/api/v1/missing" }, res);

  assert.equal(res.status, 404);
  assert.deepEqual(JSON.parse(res.body), { error: "not_found" });
});

test("CSRF bootstrap sets a token cookie and disables caching", async () => {
  const handler = await createHandler({ query: async () => assert.fail("unexpected database query") }, { auth: authOptions });
  const res = response();

  await handler(request("GET", "/api/v1/auth/csrf"), res);

  const body = JSON.parse(res.body);
  assert.equal(res.status, 200);
  assert.equal(readCookie(res.headers["Set-Cookie"][0], "stockroom_csrf"), body.csrfToken);
  assert.equal(res.headers["Cache-Control"], "no-store");
});

test("login rejects cross-origin requests before database access", async () => {
  const handler = await createHandler({ query: async () => assert.fail("unexpected database query") }, { auth: authOptions });
  const res = response();

  await handler(request("POST", "/api/v1/auth/login", {
    origin: "https://evil.example",
    cookie: "stockroom_csrf=abc",
    "x-csrf-token": "abc",
    "content-type": "application/json",
  }, JSON.stringify({ email: "person@example.com", password: "not long enough" })), res);

  assert.equal(res.status, 403);
  assert.deepEqual(JSON.parse(res.body), { error: "csrf_rejected" });
});

test("login rejects malformed email before touching the database", async () => {
  const handler = await createHandler({ query: async () => assert.fail("unexpected database query") }, { auth: authOptions });
  const res = response();

  await handler(request("POST", "/api/v1/auth/login", {
    origin: "http://localhost:5173",
    cookie: "stockroom_csrf=abc",
    "x-csrf-token": "abc",
    "content-type": "application/json",
  }, JSON.stringify({ email: "bad", password: "not long enough" })), res);

  assert.equal(res.status, 400);
  assert.deepEqual(JSON.parse(res.body), { error: "validation_failed" });
});

test("login rejects non-JSON content types before touching the database", async () => {
  const handler = await createHandler({ query: async () => assert.fail("unexpected database query") }, { auth: authOptions });
  const res = response();

  await handler(request("POST", "/api/v1/auth/login", {
    origin: "http://localhost:5173", cookie: "stockroom_csrf=abc", "x-csrf-token": "abc", "content-type": "text/plain",
  }, "{}"), res);

  assert.equal(res.status, 415);
  assert.deepEqual(JSON.parse(res.body), { error: "content_type_must_be_json" });
});

test("login returns a retry delay when the shared IP limit is exceeded", async () => {
  const handler = await createHandler({
    query: async (sql) => {
      assert.match(sql, /auth_rate_limits/);
      return { rows: [{ request_count: 61, retry_after: 123 }], rowCount: 1 };
    },
  }, { auth: authOptions });
  const res = response();

  await handler(request("POST", "/api/v1/auth/login", {
    origin: "http://localhost:5173", cookie: "stockroom_csrf=abc", "x-csrf-token": "abc", "content-type": "application/json",
  }, JSON.stringify({ email: "person@example.com", password: "correct horse battery staple" })), res);

  assert.equal(res.status, 429);
  assert.equal(res.headers["Retry-After"], "123");
  assert.deepEqual(JSON.parse(res.body), { error: "rate_limited" });
});

test("password reset requests return the same response for known and unknown emails", async () => {
  const encryptionKey = Buffer.alloc(32, 7).toString("base64");
  const resetOptions = {
    ...authOptions,
    env: {
      ...authOptions.env,
      OUTBOX_ENCRYPTION_KEY: encryptionKey,
      RESEND_API_KEY: "test-key",
      EMAIL_FROM: "no-reply@example.com",
    },
  };
  const makePool = (user) => ({
    async query(sql) {
      if (sql.includes("auth_rate_limits")) return { rows: [{ request_count: 1, retry_after: 3600 }], rowCount: 1 };
      if (sql.includes("FROM stockroom.users WHERE email_normalized")) return { rows: user ? [user] : [], rowCount: user ? 1 : 0 };
      assert.fail(`Unexpected pool query: ${sql}`);
    },
    async connect() {
      return {
        async query(sql) {
          if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql) || sql.startsWith("UPDATE stockroom.password_reset_tokens") || sql.startsWith("INSERT INTO stockroom.password_reset_tokens") || sql.startsWith("INSERT INTO stockroom.email_outbox")) return { rows: [], rowCount: 1 };
          assert.fail(`Unexpected client query: ${sql}`);
        },
        release() {},
      };
    },
  });
  const responses = [];
  for (const user of [
    { id: "user-1", email: "person@example.com" },
    null,
  ]) {
    const handler = await createHandler(makePool(user), { auth: resetOptions });
    const res = response();
    await handler(request("POST", "/api/v1/auth/password-resets", {
      origin: "http://localhost:5173", cookie: "stockroom_csrf=abc", "x-csrf-token": "abc", "content-type": "application/json",
    }, JSON.stringify({ email: "person@example.com" })), res);
    responses.push({ status: res.status, body: res.body });
  }

  assert.deepEqual(responses[0], responses[1]);
  assert.equal(responses[0].status, 202);
  assert.deepEqual(JSON.parse(responses[0].body), { message: "If the account is eligible, password reset instructions will be sent." });
});

test("login creates an opaque cookie session and returns only active memberships", async () => {
  const csrf = "csrf-test-value";
  const user = { id: "user-1", email: "person@example.com", email_normalized: "person@example.com", password_hash: "stored-hash", status: "active" };
  const handler = await createHandler(authPool(user, csrf), { auth: { ...authOptions, verifyPassword: async (password) => password === "correct password" } });
  const res = response();

  await handler(request("POST", "/api/v1/auth/login", {
    origin: "http://localhost:5173", cookie: `stockroom_csrf=${csrf}`, "x-csrf-token": csrf, "content-type": "application/json",
  }, JSON.stringify({ email: " PERSON@example.com ", password: "correct password" })), res);

  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), {
    user: { id: "user-1", email: "person@example.com" },
    memberships: [{ tenantId: "tenant-1", name: "Northstar", role: "tenant_owner", tenantWide: true, branches: [], warehouses: [] }],
  });
  assert.match(res.headers["Set-Cookie"][0], /^stockroom_session=[A-Za-z0-9_-]{43}; Path=\//);
  assert.match(res.headers["Set-Cookie"][0], /HttpOnly/);
  assert.equal(res.headers["Set-Cookie"][0].includes("stored-hash"), false);
});

test("login gives unknown users the same generic credential error", async () => {
  const csrf = "csrf-test-value";
  const handler = await createHandler(authPool(null, csrf), { auth: { ...authOptions, verifyPassword: async () => false } });
  const res = response();

  await handler(request("POST", "/api/v1/auth/login", {
    origin: "http://localhost:5173", cookie: `stockroom_csrf=${csrf}`, "x-csrf-token": csrf, "content-type": "application/json",
  }, JSON.stringify({ email: "unknown@example.com", password: "wrong password" })), res);

  assert.equal(res.status, 401);
  assert.deepEqual(JSON.parse(res.body), { error: "invalid_credentials" });
});
