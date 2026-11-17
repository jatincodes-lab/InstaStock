import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { createHashGate, cookie, hashPassword, hashToken, keyedHash, normalizeEmail, readCookie, safeEqual, validatePassword, verifyPassword, BusyError, createToken } from "./security.mjs";

const API = "/api/v1";
const SESSION_ABSOLUTE_SECONDS = 12 * 60 * 60;
const SESSION_IDLE_SECONDS = 30 * 60;
const INVITATION_SECONDS = 7 * 24 * 60 * 60;
const RESET_SECONDS = 30 * 60;
const BODY_LIMIT = 16 * 1024;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

class HttpError extends Error {
  constructor(status, code, fields) { super(code); this.status = status; this.code = code; this.fields = fields; }
}

function parseConfig(env) {
  const production = env.NODE_ENV === "production";
  const appOrigin = env.APP_ORIGIN || (!production ? "http://localhost:5173" : "");
  let origin;
  try { origin = new URL(appOrigin).origin; } catch { throw new Error("APP_ORIGIN must be a valid origin"); }
  if (production && (!origin.startsWith("https://") || origin !== appOrigin.replace(/\/$/, ""))) throw new Error("Production APP_ORIGIN must be an HTTPS origin without a path");
  const secret = env.AUTH_RATE_LIMIT_SECRET || (!production ? randomBytes(32).toString("base64url") : "");
  if (Buffer.byteLength(secret) < 32) throw new Error("AUTH_RATE_LIMIT_SECRET must contain at least 32 bytes");
  const hashConcurrency = Number(env.AUTH_HASH_CONCURRENCY || 1);
  if (!Number.isInteger(hashConcurrency) || hashConcurrency < 1 || hashConcurrency > 8) throw new Error("AUTH_HASH_CONCURRENCY must be an integer from 1 to 8");
  const outboxKey = env.OUTBOX_ENCRYPTION_KEY ? Buffer.from(env.OUTBOX_ENCRYPTION_KEY, "base64") : null;
  if (outboxKey && outboxKey.length !== 32) throw new Error("OUTBOX_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  const emailEnabled = Boolean(env.RESEND_API_KEY && env.EMAIL_FROM && outboxKey);
  if (production && !emailEnabled) throw new Error("RESEND_API_KEY, EMAIL_FROM, and OUTBOX_ENCRYPTION_KEY are required in production");
  return {
    production, origin, rateSecret: secret, outboxKey, emailEnabled, hashConcurrency,
    resendKey: env.RESEND_API_KEY, emailFrom: env.EMAIL_FROM,
    trustedProxies: new Set((env.TRUSTED_PROXY_IPS || "").split(",").map((ip) => ip.trim()).filter((ip) => isIP(ip))),
  };
}

function json(res, status, value, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(status === 204 ? undefined : JSON.stringify(value));
}

function setCookies(res, values) {
  res.setHeader("Set-Cookie", values);
}

function clearCookies(config, secure) {
  const names = secure ? ["__Host-stockroom_session", "__Host-stockroom_csrf"] : ["stockroom_session", "stockroom_csrf"];
  return names.map((name, index) => cookie(name, "", { secure, httpOnly: index === 0, sameSite: index === 1 ? "Strict" : "Lax", maxAge: 0, clear: true }));
}

async function readJson(req, allowEmpty = false) {
  const length = req.headers["content-length"];
  if (length && (!/^\d+$/.test(length) || Number(length) > BODY_LIMIT)) throw new HttpError(413, "request_too_large");
  const type = (req.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
  if (type !== "application/json") throw new HttpError(415, "content_type_must_be_json");
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw new HttpError(413, "request_too_large");
    chunks.push(chunk);
  }
  if (!size && allowEmpty) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value;
  } catch { throw new HttpError(400, "invalid_json"); }
}

function requireKeys(body, required, optional = []) {
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !(key in body)) || Object.keys(body).some((key) => !allowed.has(key))) throw new HttpError(400, "validation_failed");
}

function publicToken(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

function clientIp(req, config) {
  const remote = req.socket?.remoteAddress || "unknown";
  if (!config.trustedProxies.has(remote)) return remote;
  const forwarded = req.headers["x-forwarded-for"];
  const candidate = typeof forwarded === "string" ? forwarded.split(",")[0].trim() : "";
  return isIP(candidate) ? candidate : remote;
}

function encryptPayload(key, payload) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return { encrypted, iv, tag: cipher.getAuthTag() };
}

function membershipsFor(pool, userId) {
  return pool.query(
    `SELECT m.id, m.tenant_id, t.name AS tenant_name, r.key AS role
       FROM stockroom.memberships m
       JOIN stockroom.tenants t ON t.id = m.tenant_id
       JOIN stockroom.roles r ON r.id = m.role_id
      WHERE m.user_id = $1 AND m.status = 'active' AND t.status = 'active'
      ORDER BY t.name, m.id`, [userId]
  ).then(async ({ rows }) => {
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    const [branches, warehouses] = await Promise.all([
      pool.query("SELECT membership_id, branch_id FROM stockroom.membership_branch_scopes WHERE membership_id = ANY($1::uuid[])", [ids]),
      pool.query("SELECT membership_id, warehouse_id FROM stockroom.membership_warehouse_scopes WHERE membership_id = ANY($1::uuid[])", [ids]),
    ]);
    return rows.map((row) => ({
      tenantId: row.tenant_id,
      name: row.tenant_name,
      role: row.role,
      tenantWide: ["tenant_owner", "administrator"].includes(row.role),
      branches: branches.rows.filter((scope) => scope.membership_id === row.id).map((scope) => scope.branch_id),
      warehouses: warehouses.rows.filter((scope) => scope.membership_id === row.id).map((scope) => scope.warehouse_id),
    }));
  });
}

export async function createAuthApi(pool, options = {}) {
  const config = parseConfig(options.env || process.env);
  const gate = options.hashGate || createHashGate(config.hashConcurrency);
  const doHash = options.hashPassword || ((password) => hashPassword(password, gate));
  const doVerify = options.verifyPassword || ((password, encoded) => verifyPassword(password, encoded, gate));
  const dummyHash = options.dummyHash || await doHash(randomBytes(32).toString("base64url"));
  const secure = config.production;
  const sessionCookie = secure ? "__Host-stockroom_session" : "stockroom_session";
  const csrfCookie = secure ? "__Host-stockroom_csrf" : "stockroom_csrf";

  async function rateLimit(req, key, max, windowSeconds, { includeIp = true } = {}) {
    const ip = clientIp(req, config);
    const hashes = [...(includeIp ? [keyedHash(config.rateSecret, `ip:${ip}`)] : []), ...(key ? [keyedHash(config.rateSecret, `key:${key}`)] : [])];
    let exceeded = false;
    for (const bucket of hashes) {
      const { rows: [row] } = await pool.query(
        `INSERT INTO stockroom.auth_rate_limits(bucket_hash, window_started_at, request_count, expires_at)
         VALUES ($1, now(), 1, now() + ($2 * interval '1 second'))
         ON CONFLICT (bucket_hash) DO UPDATE SET
           request_count = CASE WHEN stockroom.auth_rate_limits.expires_at <= now() THEN 1 ELSE stockroom.auth_rate_limits.request_count + 1 END,
           window_started_at = CASE WHEN stockroom.auth_rate_limits.expires_at <= now() THEN now() ELSE stockroom.auth_rate_limits.window_started_at END,
           expires_at = CASE WHEN stockroom.auth_rate_limits.expires_at <= now() THEN now() + ($2 * interval '1 second') ELSE stockroom.auth_rate_limits.expires_at END
         RETURNING request_count, greatest(1, ceil(extract(epoch FROM (expires_at - now())))::integer) AS retry_after`,
        [bucket, windowSeconds]
      );
      if (row.request_count > max) exceeded = true;
      if (exceeded) req.retryAfter = Math.max(req.retryAfter || 0, row.retry_after);
    }
    return !exceeded;
  }

  async function requireCsrf(req, session = null) {
    const origin = req.headers.origin;
    const site = req.headers["sec-fetch-site"];
    if (origin !== config.origin || site === "cross-site") throw new HttpError(403, "csrf_rejected");
    const cookies = req.headers.cookie;
    const token = readCookie(cookies, csrfCookie);
    const header = req.headers["x-csrf-token"];
    if (!token || !header || !safeEqual(token, header)) throw new HttpError(403, "csrf_rejected");
    if (session && (!session.csrf_token_hash || !safeEqual(session.csrf_token_hash, hashToken(token)))) throw new HttpError(403, "csrf_rejected");
    return token;
  }

  async function currentSession(req, refresh = true) {
    const token = readCookie(req.headers.cookie, sessionCookie);
    if (!publicToken(token)) return null;
    const { rows: [session] } = await pool.query(
      `SELECT s.id AS session_id, s.user_id, s.csrf_token_hash, s.expires_at, s.idle_expires_at, s.last_seen_at,
              u.email, u.email_normalized, u.status AS user_status
         FROM stockroom.sessions s JOIN stockroom.users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
          AND s.idle_expires_at > now() AND u.status = 'active'`, [hashToken(token)]
    );
    if (!session) return null;
    if (refresh && (!session.last_seen_at || Date.now() - new Date(session.last_seen_at).getTime() > 5 * 60 * 1000)) {
      await pool.query("UPDATE stockroom.sessions SET last_seen_at = now(), idle_expires_at = least(expires_at, now() + ($2 * interval '1 second')) WHERE id = $1", [session.session_id, SESSION_IDLE_SECONDS]);
    }
    return session;
  }

  async function saveSecurityEvent(req, action, userId = null) {
    try {
      const ipHash = keyedHash(config.rateSecret, `ip:${clientIp(req, config)}`);
      await pool.query("INSERT INTO stockroom.security_events(user_id, action, ip_hash, request_id) VALUES ($1,$2,$3,$4)", [userId, action, ipHash, req.requestId || null]);
    } catch { /* Authentication remains available if secondary telemetry storage is briefly down. */ }
  }

  async function queueEmail(client, message) {
    if (!config.emailEnabled) throw new HttpError(503, "email_delivery_unavailable");
    const payload = encryptPayload(config.outboxKey, message);
    await client.query("INSERT INTO stockroom.email_outbox(encrypted_payload,payload_iv,payload_tag) VALUES ($1,$2,$3)", [payload.encrypted, payload.iv, payload.tag]);
  }

  async function transaction(work) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async function createSession(client, userId, token, csrf) {
    await client.query(
      `INSERT INTO stockroom.sessions(user_id, token_hash, csrf_token_hash, expires_at, idle_expires_at, last_seen_at)
       VALUES ($1,$2,$3, now() + ($4 * interval '1 second'), now() + ($5 * interval '1 second'), now())`,
      [userId, hashToken(token), hashToken(csrf), SESSION_ABSOLUTE_SECONDS, SESSION_IDLE_SECONDS]
    );
  }

  function authCookies(token, csrf) {
    return [
      cookie(sessionCookie, token, { secure, httpOnly: true, maxAge: SESSION_ABSOLUTE_SECONDS }),
      cookie(csrfCookie, csrf, { secure, sameSite: "Strict", maxAge: SESSION_ABSOLUTE_SECONDS }),
    ];
  }

  async function tenantAccess(client, session, tenantId, permissionKey) {
    const { rows: [row] } = await client.query(
      `SELECT m.id AS membership_id, r.key AS role
         FROM stockroom.memberships m
         JOIN stockroom.roles r ON r.id = m.role_id
         JOIN stockroom.tenants t ON t.id = m.tenant_id
        WHERE m.tenant_id = $1 AND m.user_id = $2 AND m.status = 'active' AND t.status = 'active'`,
      [tenantId, session.user_id]
    );
    if (!row) throw new HttpError(404, "not_found");
    const { rows: permissions } = await client.query(
      `SELECT p.key FROM stockroom.role_permissions rp JOIN stockroom.permissions p ON p.id=rp.permission_id
        JOIN stockroom.memberships m ON m.role_id=rp.role_id WHERE m.id=$1`, [row.membership_id]
    );
    if (!permissions.some((item) => item.key === permissionKey)) throw new HttpError(404, "not_found");
    return { ...row, permissions: new Set(permissions.map((item) => item.key)) };
  }

  const getUserPermissions = (client, session, tenantId) => tenantAccess(client, session, tenantId, "members.manage");

  async function validateInviteScopes(client, tenantId, actor, role, branches, warehouses) {
    if (!Array.isArray(branches) || !Array.isArray(warehouses) || branches.length > 100 || warehouses.length > 100 || branches.length !== new Set(branches).size || warehouses.length !== new Set(warehouses).size) throw new HttpError(400, "validation_failed");
    const validUuid = new RegExp(`^${UUID}$`, "i");
    for (const id of [...branches, ...warehouses]) if (typeof id !== "string" || !validUuid.test(id)) throw new HttpError(400, "validation_failed");
    if (["tenant_owner", "administrator"].includes(role.key)) {
      if (!actor.permissions.has("ownership.transfer")) throw new HttpError(403, "forbidden");
      if (branches.length || warehouses.length) throw new HttpError(400, "validation_failed");
      return;
    }
    if (!branches.length && !warehouses.length) throw new HttpError(400, "location_scope_required");
    let branchAccess = null;
    let warehouseAccess = null;
    if (actor.role !== "tenant_owner" && actor.role !== "administrator") {
      const [{ rows: branchScopes }, { rows: warehouseScopes }] = await Promise.all([
        client.query("SELECT branch_id FROM stockroom.membership_branch_scopes WHERE membership_id=$1", [actor.membership_id]),
        client.query("SELECT warehouse_id FROM stockroom.membership_warehouse_scopes WHERE membership_id=$1", [actor.membership_id]),
      ]);
      branchAccess = new Set(branchScopes.map((item) => item.branch_id));
      warehouseAccess = new Set(warehouseScopes.map((item) => item.warehouse_id));
      if (branches.some((id) => !branchAccess.has(id))) throw new HttpError(404, "not_found");
    }
    if (branches.length) {
      const { rowCount } = await client.query("SELECT id FROM stockroom.branches WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND status='active'", [tenantId, branches]);
      if (rowCount !== new Set(branches).size) throw new HttpError(400, "invalid_location_scope");
    }
    if (warehouses.length) {
      const { rows } = await client.query("SELECT id,branch_id FROM stockroom.warehouses WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND status='active'", [tenantId, warehouses]);
      if (rows.length !== new Set(warehouses).size) throw new HttpError(400, "invalid_location_scope");
      if (warehouseAccess && rows.some((row) => !warehouseAccess.has(row.id) && !branchAccess.has(row.branch_id))) throw new HttpError(404, "not_found");
    }
  }

  async function handle(req, res, url) {
    const path = url.pathname;
    const method = req.method;
    if (method === "GET" && path === `${API}/auth/csrf`) {
      const token = createToken();
      setCookies(res, [cookie(csrfCookie, token, { secure, sameSite: "Strict", maxAge: SESSION_IDLE_SECONDS })]);
      json(res, 200, { csrfToken: token });
      return true;
    }

    if (method === "POST" && path === `${API}/auth/login`) {
      await requireCsrf(req);
      const body = await readJson(req);
      requireKeys(body, ["email", "password"]);
      const email = normalizeEmail(body.email);
      if (!email || typeof body.password !== "string" || Buffer.byteLength(body.password) > 1024) throw new HttpError(400, "validation_failed");
      if (!await rateLimit(req, null, 60, 15 * 60)) throw new HttpError(429, "rate_limited");
      const allowed = await rateLimit(req, keyedHash(config.rateSecret, `email:${email}`), 10, 15 * 60, { includeIp: false });
      if (!allowed) throw new HttpError(429, "rate_limited");
      const { rows: [user] } = await pool.query("SELECT id,email,email_normalized,password_hash,status FROM stockroom.users WHERE email_normalized=$1", [email]);
      let valid = false;
      try { valid = await doVerify(body.password, user?.password_hash || dummyHash); }
      catch (error) { if (error instanceof BusyError) throw new HttpError(503, "authentication_busy"); throw error; }
      const membershipCheck = await pool.query(
        `SELECT 1 FROM stockroom.memberships m JOIN stockroom.tenants t ON t.id=m.tenant_id
          WHERE m.user_id=$1 AND m.status='active' AND t.status='active' LIMIT 1`, [user?.id || "00000000-0000-0000-0000-000000000000"]
      );
      const activeMembership = membershipCheck.rowCount > 0;
      if (!user || !valid || user.status !== "active" || !activeMembership) {
        await saveSecurityEvent(req, "login_failed", user?.id || null);
        throw new HttpError(401, "invalid_credentials");
      }
      const sessionToken = createToken();
      const newCsrf = createToken();
      const memberships = await transaction(async (client) => {
        const { rows: [current] } = await client.query("SELECT status FROM stockroom.users WHERE id=$1 FOR UPDATE", [user.id]);
        if (current?.status !== "active") throw new HttpError(401, "invalid_credentials");
        const result = await membershipsFor(client, user.id);
        if (!result.length) throw new HttpError(401, "invalid_credentials");
        await createSession(client, user.id, sessionToken, newCsrf);
        await client.query("INSERT INTO stockroom.security_events(user_id,action,ip_hash,request_id) VALUES ($1,'login_succeeded',$2,$3)", [user.id, keyedHash(config.rateSecret, `ip:${clientIp(req, config)}`), req.requestId || null]);
        return result;
      });
      setCookies(res, authCookies(sessionToken, newCsrf));
      json(res, 200, { user: { id: user.id, email: user.email }, memberships });
      return true;
    }

    if (method === "GET" && path === `${API}/auth/session`) {
      const session = await currentSession(req);
      if (!session) { setCookies(res, clearCookies(config, secure)); json(res, 401, { error: "unauthenticated" }); return true; }
      json(res, 200, { user: { id: session.user_id, email: session.email }, memberships: await membershipsFor(pool, session.user_id) });
      return true;
    }

    if (method === "POST" && path === `${API}/auth/logout`) {
      const session = await currentSession(req, false);
      await requireCsrf(req, session);
      if (session) await pool.query("UPDATE stockroom.sessions SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL", [session.session_id]);
      setCookies(res, clearCookies(config, secure));
      json(res, 204, null);
      return true;
    }

    if (method === "POST" && path === `${API}/auth/logout-all`) {
      const session = await currentSession(req, false);
      if (!session) throw new HttpError(401, "unauthenticated");
      await requireCsrf(req, session);
      if (!await rateLimit(req, keyedHash(config.rateSecret, `logout-all:${session.user_id}`), 5, 15 * 60)) throw new HttpError(429, "rate_limited");
      const body = await readJson(req);
      requireKeys(body, ["password"]);
      if (typeof body.password !== "string" || Buffer.byteLength(body.password) > 1024) throw new HttpError(400, "validation_failed");
      if (!await doVerify(body.password, (await pool.query("SELECT password_hash FROM stockroom.users WHERE id=$1", [session.user_id])).rows[0]?.password_hash)) throw new HttpError(401, "invalid_credentials");
      await pool.query("UPDATE stockroom.sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [session.user_id]);
      setCookies(res, clearCookies(config, secure));
      json(res, 204, null);
      return true;
    }

    if (method === "POST" && path === `${API}/auth/password-resets`) {
      await requireCsrf(req);
      if (!await rateLimit(req, null, 60, 60 * 60)) throw new HttpError(429, "rate_limited");
      const body = await readJson(req);
      requireKeys(body, ["email"]);
      const email = normalizeEmail(body.email);
      if (!email) throw new HttpError(400, "validation_failed");
      if (!await rateLimit(req, keyedHash(config.rateSecret, `reset:${email}`), 5, 60 * 60, { includeIp: false })) throw new HttpError(429, "rate_limited");
      if (!config.emailEnabled) throw new HttpError(503, "email_delivery_unavailable");
      const { rows: [user] } = await pool.query("SELECT id,email FROM stockroom.users WHERE email_normalized=$1 AND status='active'", [email]);
      if (user) {
        const token = createToken();
        const resetUrl = `${config.origin}/reset-password#${token}`;
        await transaction(async (client) => {
          await client.query("UPDATE stockroom.password_reset_tokens SET revoked_at=now() WHERE user_id=$1 AND used_at IS NULL AND revoked_at IS NULL", [user.id]);
          await client.query("INSERT INTO stockroom.password_reset_tokens(user_id,token_hash,expires_at) VALUES ($1,$2,now()+($3*interval '1 second'))", [user.id, hashToken(token), RESET_SECONDS]);
          await queueEmail(client, { to: user.email, subject: "Reset your Stockroom password", text: `Use this one-time link within 30 minutes: ${resetUrl}` });
        });
      }
      json(res, 202, { message: "If the account is eligible, password reset instructions will be sent." });
      return true;
    }

    if (method === "POST" && path === `${API}/auth/password-resets/confirm`) {
      await requireCsrf(req);
      if (!await rateLimit(req, null, 20, 60 * 60)) throw new HttpError(429, "rate_limited");
      const body = await readJson(req);
      requireKeys(body, ["token", "newPassword"]);
      if (!publicToken(body.token)) throw new HttpError(400, "invalid_or_expired_token");
      const passwordError = validatePassword(body.newPassword);
      if (passwordError) throw new HttpError(400, "validation_failed", { password: passwordError });
      const { rowCount: validToken } = await pool.query("SELECT 1 FROM stockroom.password_reset_tokens WHERE token_hash=$1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at>now()", [hashToken(body.token)]);
      if (!validToken) throw new HttpError(400, "invalid_or_expired_token");
      let passwordHash;
      try { passwordHash = await doHash(body.newPassword); }
      catch (error) { if (error instanceof BusyError) throw new HttpError(503, "authentication_busy"); throw error; }
      const result = await transaction(async (client) => {
        const { rows: [reset] } = await client.query(
          `SELECT id,user_id FROM stockroom.password_reset_tokens
            WHERE token_hash=$1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at>now() FOR UPDATE`, [hashToken(body.token)]
        );
        if (!reset) throw new HttpError(400, "invalid_or_expired_token");
        await client.query("UPDATE stockroom.users SET password_hash=$2,updated_at=now() WHERE id=$1", [reset.user_id, passwordHash]);
        await client.query("UPDATE stockroom.password_reset_tokens SET used_at=now() WHERE id=$1", [reset.id]);
        await client.query("UPDATE stockroom.password_reset_tokens SET revoked_at=now() WHERE user_id=$1 AND id<>$2 AND used_at IS NULL AND revoked_at IS NULL", [reset.user_id, reset.id]);
        await client.query("UPDATE stockroom.sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [reset.user_id]);
        await client.query("INSERT INTO stockroom.security_events(user_id,action,request_id) VALUES ($1,'password_reset',$2)", [reset.user_id, req.requestId || null]);
        return reset.user_id;
      });
      setCookies(res, clearCookies(config, secure));
      json(res, 204, null);
      await saveSecurityEvent(req, "password_reset_completed", result);
      return true;
    }

    const invitationMatch = new RegExp(`^${API}/tenants/(${UUID})/invitations$`, "i").exec(path);
    if (method === "GET" && invitationMatch) {
      const session = await currentSession(req, false);
      if (!session) throw new HttpError(401, "unauthenticated");
      const tenantId = invitationMatch[1];
      const result = await transaction(async (client) => {
        const actor = await tenantAccess(client, session, tenantId, "members.read");
        const scopeFilter = ["tenant_owner", "administrator"].includes(actor.role) ? "" : `AND (
          EXISTS (SELECT 1 FROM stockroom.invitation_branch_scopes i JOIN stockroom.membership_branch_scopes m ON m.tenant_id=i.tenant_id AND m.branch_id=i.branch_id WHERE i.invitation_id=v.id AND m.membership_id=$2)
          OR EXISTS (SELECT 1 FROM stockroom.invitation_warehouse_scopes i JOIN stockroom.warehouses w ON w.tenant_id=i.tenant_id AND w.id=i.warehouse_id JOIN stockroom.membership_warehouse_scopes m ON m.tenant_id=i.tenant_id AND m.warehouse_id=i.warehouse_id WHERE i.invitation_id=v.id AND m.membership_id=$2)
          OR EXISTS (SELECT 1 FROM stockroom.invitation_warehouse_scopes i JOIN stockroom.warehouses w ON w.tenant_id=i.tenant_id AND w.id=i.warehouse_id JOIN stockroom.membership_branch_scopes m ON m.tenant_id=i.tenant_id AND m.branch_id=w.branch_id WHERE i.invitation_id=v.id AND m.membership_id=$2)
        )
        AND NOT EXISTS (
          SELECT 1 FROM stockroom.invitation_branch_scopes i
           WHERE i.invitation_id=v.id AND NOT EXISTS (SELECT 1 FROM stockroom.membership_branch_scopes m WHERE m.membership_id=$2 AND m.branch_id=i.branch_id)
        )
        AND NOT EXISTS (
          SELECT 1 FROM stockroom.invitation_warehouse_scopes i JOIN stockroom.warehouses w ON w.tenant_id=i.tenant_id AND w.id=i.warehouse_id
           WHERE i.invitation_id=v.id AND NOT (
             EXISTS (SELECT 1 FROM stockroom.membership_warehouse_scopes m WHERE m.membership_id=$2 AND m.warehouse_id=i.warehouse_id)
             OR EXISTS (SELECT 1 FROM stockroom.membership_branch_scopes m WHERE m.membership_id=$2 AND m.branch_id=w.branch_id)
           )
        )`;
        const params = scopeFilter ? [tenantId, actor.membership_id] : [tenantId];
        const { rows } = await client.query(
          `SELECT v.id,v.email,v.created_at,v.expires_at,v.accepted_at,v.revoked_at,r.key AS role
             FROM stockroom.invitations v JOIN stockroom.roles r ON r.id=v.role_id
            WHERE v.tenant_id=$1 ${scopeFilter} ORDER BY v.created_at DESC LIMIT 200`,
          params
        );
        return rows.map((invite) => ({ id: invite.id, email: invite.email, role: invite.role, createdAt: invite.created_at, expiresAt: invite.expires_at, status: invite.accepted_at ? "accepted" : invite.revoked_at ? "revoked" : new Date(invite.expires_at) <= new Date() ? "expired" : "pending" }));
      });
      json(res, 200, { invitations: result });
      return true;
    }
    if (method === "POST" && invitationMatch) {
      const session = await currentSession(req, false);
      if (!session) throw new HttpError(401, "unauthenticated");
      await requireCsrf(req, session);
      if (!await rateLimit(req, keyedHash(config.rateSecret, `invite:${session.user_id}`), 30, 60 * 60)) throw new HttpError(429, "rate_limited");
      if (!config.emailEnabled) throw new HttpError(503, "email_delivery_unavailable");
      const body = await readJson(req);
      requireKeys(body, ["email", "role", "branches", "warehouses"]);
      const email = normalizeEmail(body.email);
      if (!email || typeof body.role !== "string" || body.role.length > 50) throw new HttpError(400, "validation_failed");
      const tenantId = invitationMatch[1];
      const token = createToken();
      const inviteUrl = `${config.origin}/accept-invitation#${token}`;
      await transaction(async (client) => {
        const actor = await getUserPermissions(client, session, tenantId);
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${tenantId}:${email}`]);
        const { rows: [role] } = await client.query("SELECT id,key FROM stockroom.roles WHERE key=$1", [body.role]);
        if (!role) throw new HttpError(400, "invalid_role");
        const allowedRoles = actor.role === "tenant_owner" || actor.role === "administrator"
          ? new Set(["tenant_owner", "administrator", "branch_manager", "warehouse_operator", "sales_staff", "purchasing_staff", "viewer"])
          : new Set(["warehouse_operator", "sales_staff", "purchasing_staff", "viewer"]);
        if (!allowedRoles.has(role.key)) throw new HttpError(403, "forbidden");
        await validateInviteScopes(client, tenantId, actor, role, body.branches, body.warehouses);
        const { rowCount: existingMember } = await client.query(
          "SELECT 1 FROM stockroom.memberships WHERE tenant_id=$1 AND user_id=(SELECT id FROM stockroom.users WHERE email_normalized=$2)",
          [tenantId, email]
        );
        if (existingMember) throw new HttpError(409, "membership_exists");
        const { rows: [pending] } = await client.query("SELECT id FROM stockroom.invitations WHERE tenant_id=$1 AND email_normalized=$2 AND accepted_at IS NULL AND revoked_at IS NULL FOR UPDATE", [tenantId, email]);
        let inviteId;
        if (pending) {
          inviteId = pending.id;
          await client.query("UPDATE stockroom.invitations SET role_id=$2,token_hash=$3,invited_by=$4,expires_at=now()+($5*interval '1 second'),created_at=now() WHERE id=$1", [inviteId, role.id, hashToken(token), session.user_id, INVITATION_SECONDS]);
          await client.query("DELETE FROM stockroom.invitation_branch_scopes WHERE invitation_id=$1", [inviteId]);
          await client.query("DELETE FROM stockroom.invitation_warehouse_scopes WHERE invitation_id=$1", [inviteId]);
        } else {
          const { rows: [created] } = await client.query("INSERT INTO stockroom.invitations(tenant_id,email,email_normalized,role_id,token_hash,invited_by,expires_at) VALUES ($1,$2,$3,$4,$5,$6,now()+($7*interval '1 second')) RETURNING id", [tenantId,email,email,role.id,hashToken(token),session.user_id,INVITATION_SECONDS]);
          inviteId = created.id;
        }
        for (const branchId of body.branches) await client.query("INSERT INTO stockroom.invitation_branch_scopes(tenant_id,invitation_id,branch_id) VALUES ($1,$2,$3)", [tenantId,inviteId,branchId]);
        for (const warehouseId of body.warehouses) await client.query("INSERT INTO stockroom.invitation_warehouse_scopes(tenant_id,invitation_id,warehouse_id) VALUES ($1,$2,$3)", [tenantId,inviteId,warehouseId]);
        await client.query("INSERT INTO stockroom.audit_events(tenant_id,actor_id,action,entity_type,entity_id,request_id,summary) VALUES ($1,$2,'invitation.created','invitation',$3,$4,$5)", [tenantId,session.user_id,inviteId,req.requestId || null,JSON.stringify({ role: role.key })]);
        await queueEmail(client, { to: email, subject: "You are invited to Stockroom", text: `Accept this invitation within 7 days: ${inviteUrl}` });
      });
      json(res, 202, { status: "invitation_queued" });
      return true;
    }

    if (method === "POST" && path === `${API}/auth/invitations/accept`) {
      await requireCsrf(req);
      if (!await rateLimit(req, null, 20, 60 * 60)) throw new HttpError(429, "rate_limited");
      const body = await readJson(req, true);
      requireKeys(body, ["token"], ["password"]);
      if (!publicToken(body.token)) throw new HttpError(400, "invalid_or_expired_token");
      const { rows: [preview] } = await pool.query(
        `SELECT i.email_normalized,i.tenant_id FROM stockroom.invitations i JOIN stockroom.tenants t ON t.id=i.tenant_id
          WHERE i.token_hash=$1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>now() AND t.status='active'`, [hashToken(body.token)]
      );
      if (!preview) throw new HttpError(400, "invalid_or_expired_token");
      const session = await currentSession(req, false);
      if (session) await requireCsrf(req, session);
      const { rows: [existing] } = await pool.query("SELECT id,email,status FROM stockroom.users WHERE email_normalized=$1", [preview.email_normalized]);
      if (existing && (!session || session.email_normalized !== preview.email_normalized)) throw new HttpError(409, "sign_in_to_accept");
      let passwordHash = null;
      if (!existing) {
        const passwordError = validatePassword(body.password);
        if (passwordError) throw new HttpError(400, "validation_failed", { password: passwordError });
        try { passwordHash = await doHash(body.password); }
        catch (error) { if (error instanceof BusyError) throw new HttpError(503, "authentication_busy"); throw error; }
      }
      const sessionToken = existing ? null : createToken();
      const csrf = existing ? null : createToken();
      const accepted = await transaction(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${preview.tenant_id}:${preview.email_normalized}`]);
        const { rows: [invite] } = await client.query(
          `SELECT i.*,t.status AS tenant_status FROM stockroom.invitations i
            JOIN stockroom.tenants t ON t.id=i.tenant_id
           WHERE i.token_hash=$1 FOR UPDATE`, [hashToken(body.token)]
        );
        if (!invite || invite.accepted_at || invite.revoked_at || new Date(invite.expires_at) <= new Date() || invite.tenant_status !== "active") throw new HttpError(400, "invalid_or_expired_token");
        const { rows: [user] } = await client.query("SELECT id,email,status FROM stockroom.users WHERE email_normalized=$1 FOR UPDATE", [invite.email_normalized]);
        if (user && (!session || session.email_normalized !== invite.email_normalized || user.status !== "active")) throw new HttpError(409, "sign_in_to_accept");
        const userId = user?.id || (await client.query("INSERT INTO stockroom.users(email,email_normalized,password_hash) VALUES ($1,$2,$3) RETURNING id,email,status", [invite.email,invite.email_normalized,passwordHash])).rows[0].id;
        const { rowCount: priorMembership } = await client.query("SELECT 1 FROM stockroom.memberships WHERE tenant_id=$1 AND user_id=$2 FOR UPDATE", [invite.tenant_id,userId]);
        if (priorMembership) throw new HttpError(409, "membership_exists");
        const { rows: [scopeCounts] } = await client.query(
          `SELECT
             (SELECT count(*) FROM stockroom.invitation_branch_scopes s JOIN stockroom.branches b ON b.tenant_id=s.tenant_id AND b.id=s.branch_id WHERE s.invitation_id=$1 AND b.status='active') AS active_branches,
             (SELECT count(*) FROM stockroom.invitation_warehouse_scopes s JOIN stockroom.warehouses w ON w.tenant_id=s.tenant_id AND w.id=s.warehouse_id JOIN stockroom.branches b ON b.tenant_id=w.tenant_id AND b.id=w.branch_id WHERE s.invitation_id=$1 AND w.status='active' AND b.status='active') AS active_warehouses`, [invite.id]
        );
        const [{ rowCount: branchScopes }, { rowCount: warehouseScopes }] = await Promise.all([
          client.query("SELECT 1 FROM stockroom.invitation_branch_scopes WHERE invitation_id=$1", [invite.id]),
          client.query("SELECT 1 FROM stockroom.invitation_warehouse_scopes WHERE invitation_id=$1", [invite.id]),
        ]);
        if (Number(scopeCounts.active_branches) !== branchScopes || Number(scopeCounts.active_warehouses) !== warehouseScopes) throw new HttpError(409, "invitation_scope_unavailable");
        const member = await client.query("INSERT INTO stockroom.memberships(tenant_id,user_id,role_id,status) VALUES ($1,$2,$3,'active') RETURNING id", [invite.tenant_id,userId,invite.role_id]);
        await client.query("INSERT INTO stockroom.membership_branch_scopes(tenant_id,membership_id,branch_id) SELECT tenant_id,$2,branch_id FROM stockroom.invitation_branch_scopes WHERE tenant_id=$1 AND invitation_id=$3 ON CONFLICT DO NOTHING", [invite.tenant_id,member.rows[0].id,invite.id]);
        await client.query("INSERT INTO stockroom.membership_warehouse_scopes(tenant_id,membership_id,warehouse_id) SELECT tenant_id,$2,warehouse_id FROM stockroom.invitation_warehouse_scopes WHERE tenant_id=$1 AND invitation_id=$3 ON CONFLICT DO NOTHING", [invite.tenant_id,member.rows[0].id,invite.id]);
        await client.query("UPDATE stockroom.invitations SET accepted_at=now() WHERE id=$1", [invite.id]);
        await client.query("INSERT INTO stockroom.audit_events(tenant_id,actor_id,action,entity_type,entity_id,request_id) VALUES ($1,$2,'invitation.accepted','membership',$3,$4)", [invite.tenant_id,userId,member.rows[0].id,req.requestId || null]);
        if (!user) await createSession(client,userId,sessionToken,csrf);
        return { userId, email: user?.email || invite.email, tenantId: invite.tenant_id };
      });
      if (sessionToken) setCookies(res, authCookies(sessionToken, csrf));
      json(res, 200, { status: "accepted", user: { id: accepted.userId, email: accepted.email }, memberships: await membershipsFor(pool, accepted.userId) });
      await saveSecurityEvent(req, "invitation_accepted", accepted.userId);
      return true;
    }

    const invitationAction = new RegExp(`^${API}/tenants/(${UUID})/invitations/(${UUID})/(resend|revoke)$`, "i").exec(path);
    if (method === "POST" && invitationAction) {
      const session = await currentSession(req, false);
      if (!session) throw new HttpError(401, "unauthenticated");
      await requireCsrf(req, session);
      if (!await rateLimit(req, keyedHash(config.rateSecret, `invite:${session.user_id}`), 30, 60 * 60)) throw new HttpError(429, "rate_limited");
      if (!config.emailEnabled) throw new HttpError(503, "email_delivery_unavailable");
      const [, tenantId, invitationId, action] = invitationAction;
      await transaction(async (client) => {
        const actor = await getUserPermissions(client, session, tenantId);
        const { rows: [invite] } = await client.query("SELECT i.*,r.key AS role FROM stockroom.invitations i JOIN stockroom.roles r ON r.id=i.role_id WHERE i.tenant_id=$1 AND i.id=$2 FOR UPDATE", [tenantId,invitationId]);
        if (!invite) throw new HttpError(404, "not_found");
        if (!["tenant_owner", "administrator"].includes(actor.role)) {
          if (!["warehouse_operator", "sales_staff", "purchasing_staff", "viewer"].includes(invite.role)) throw new HttpError(404, "not_found");
          const { rows: [scope] } = await client.query(
            `SELECT
               (EXISTS (SELECT 1 FROM stockroom.invitation_branch_scopes i JOIN stockroom.membership_branch_scopes m ON m.tenant_id=i.tenant_id AND m.branch_id=i.branch_id WHERE i.invitation_id=$1 AND m.membership_id=$2)
                OR EXISTS (SELECT 1 FROM stockroom.invitation_warehouse_scopes i JOIN stockroom.warehouses w ON w.tenant_id=i.tenant_id AND w.id=i.warehouse_id JOIN stockroom.membership_warehouse_scopes m ON m.tenant_id=i.tenant_id AND m.warehouse_id=i.warehouse_id WHERE i.invitation_id=$1 AND m.membership_id=$2)
                OR EXISTS (SELECT 1 FROM stockroom.invitation_warehouse_scopes i JOIN stockroom.warehouses w ON w.tenant_id=i.tenant_id AND w.id=i.warehouse_id JOIN stockroom.membership_branch_scopes m ON m.tenant_id=i.tenant_id AND m.branch_id=w.branch_id WHERE i.invitation_id=$1 AND m.membership_id=$2)) AS visible,
               NOT EXISTS (SELECT 1 FROM stockroom.invitation_branch_scopes i WHERE i.invitation_id=$1 AND NOT EXISTS (SELECT 1 FROM stockroom.membership_branch_scopes m WHERE m.membership_id=$2 AND m.branch_id=i.branch_id))
               AND NOT EXISTS (SELECT 1 FROM stockroom.invitation_warehouse_scopes i JOIN stockroom.warehouses w ON w.tenant_id=i.tenant_id AND w.id=i.warehouse_id WHERE i.invitation_id=$1 AND NOT (EXISTS (SELECT 1 FROM stockroom.membership_warehouse_scopes m WHERE m.membership_id=$2 AND m.warehouse_id=i.warehouse_id) OR EXISTS (SELECT 1 FROM stockroom.membership_branch_scopes m WHERE m.membership_id=$2 AND m.branch_id=w.branch_id))) AS fully_authorized`,
            [invite.id,actor.membership_id]
          );
          if (!scope?.visible || !scope.fully_authorized) throw new HttpError(404, "not_found");
        }
        if (action === "revoke") {
          if (!invite.accepted_at && !invite.revoked_at) {
            await client.query("UPDATE stockroom.invitations SET revoked_at=now() WHERE id=$1", [invite.id]);
            await client.query("INSERT INTO stockroom.audit_events(tenant_id,actor_id,action,entity_type,entity_id,request_id) VALUES ($1,$2,'invitation.revoked','invitation',$3,$4)", [tenantId,session.user_id,invite.id,req.requestId || null]);
          }
          return;
        }
        if (invite.accepted_at || invite.revoked_at) throw new HttpError(409, "invitation_not_pending");
        const token = createToken();
        await client.query("UPDATE stockroom.invitations SET token_hash=$2,expires_at=now()+($3*interval '1 second'),invited_by=$4,created_at=now() WHERE id=$1", [invite.id,hashToken(token),INVITATION_SECONDS,session.user_id]);
        await queueEmail(client, { to: invite.email, subject: "You are invited to Stockroom", text: `Accept this invitation within 7 days: ${config.origin}/accept-invitation#${token}` });
        await client.query("INSERT INTO stockroom.audit_events(tenant_id,actor_id,action,entity_type,entity_id,request_id) VALUES ($1,$2,'invitation.resent','invitation',$3,$4)", [tenantId,session.user_id,invite.id,req.requestId || null]);
      });
      json(res, 204, null);
      return true;
    }
    return false;
  }

  return {
    handle,
    async onError(error, req, res) {
      if (error instanceof HttpError) {
        const headers = error.status === 429 ? { "Retry-After": String(req.retryAfter || 60) } : {};
        json(res, error.status, { error: error.code, ...(error.fields ? { fields: error.fields } : {}) }, headers);
        return;
      }
      if (error.code === "23505") { json(res, 409, { error: "conflict" }); return; }
      if (error.code === "23503" || error.code === "23514") { json(res, 400, { error: "validation_failed" }); return; }
      json(res, 503, { error: "service_unavailable" });
    },
  };
}

export async function deliverOutboxBatch(pool, env = process.env) {
  const key = Buffer.from(env.OUTBOX_ENCRYPTION_KEY || "", "base64");
  if (key.length !== 32 || !env.RESEND_API_KEY || !env.EMAIL_FROM) throw new Error("Email worker configuration is incomplete");
  const client = await pool.connect();
  let messages;
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT id,encrypted_payload,payload_iv,payload_tag,attempts FROM stockroom.email_outbox
        WHERE delivered_at IS NULL AND failed_at IS NULL AND available_at<=now() AND (locked_until IS NULL OR locked_until<now())
        ORDER BY created_at LIMIT 10 FOR UPDATE SKIP LOCKED`
    );
    messages = rows;
    if (rows.length) await client.query("UPDATE stockroom.email_outbox SET locked_until=now()+interval '60 seconds',attempts=attempts+1 WHERE id=ANY($1::uuid[])", [rows.map((row) => row.id)]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }

  for (const row of messages) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, row.payload_iv);
      decipher.setAuthTag(row.payload_tag);
      const payload = JSON.parse(Buffer.concat([decipher.update(row.encrypted_payload), decipher.final()]).toString("utf8"));
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST", signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: env.EMAIL_FROM, to: [payload.to], subject: payload.subject, text: payload.text }),
      });
      if (!response.ok) throw new Error(`mail_provider_${response.status}`);
      await pool.query("UPDATE stockroom.email_outbox SET delivered_at=now(),locked_until=NULL,last_error_code=NULL WHERE id=$1", [row.id]);
    } catch (error) {
      const failed = row.attempts + 1 >= 10;
      const delay = Math.min(60 * 60, 30 * (2 ** Math.min(row.attempts, 7)));
      await pool.query("UPDATE stockroom.email_outbox SET locked_until=NULL,failed_at=CASE WHEN $2 THEN now() ELSE NULL END,available_at=now()+($3*interval '1 second'),last_error_code=$4 WHERE id=$1", [row.id,failed,delay,String(error.message || "delivery_failed").slice(0,80)]);
    }
  }
  return messages.length;
}

export async function pruneAuthData(pool) {
  await pool.query("DELETE FROM stockroom.auth_rate_limits WHERE expires_at < now() - interval '1 day'");
  await pool.query("DELETE FROM stockroom.password_reset_tokens WHERE expires_at < now() - interval '30 days' OR (revoked_at < now() - interval '30 days')");
  await pool.query("DELETE FROM stockroom.sessions WHERE (expires_at < now() - interval '30 days') OR (revoked_at < now() - interval '30 days')");
  await pool.query("DELETE FROM stockroom.email_outbox WHERE (delivered_at < now() - interval '30 days') OR (failed_at < now() - interval '90 days')");
  await pool.query("DELETE FROM stockroom.security_events WHERE occurred_at < now() - interval '90 days'");
}
