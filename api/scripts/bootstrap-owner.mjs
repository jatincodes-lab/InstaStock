import { randomBytes } from "node:crypto";
import { pool } from "../src/db.mjs";
import { hashPassword, normalizeEmail, validatePassword } from "../src/security.mjs";

const email = normalizeEmail(process.env.BOOTSTRAP_EMAIL);
const password = process.env.BOOTSTRAP_PASSWORD;
const tenantName = process.env.BOOTSTRAP_TENANT_NAME?.trim();
const branchName = process.env.BOOTSTRAP_BRANCH_NAME?.trim();
const warehouseName = process.env.BOOTSTRAP_WAREHOUSE_NAME?.trim();
if (!email || validatePassword(password) || !tenantName || !branchName || !warehouseName || [tenantName, branchName, warehouseName].some((value) => value.length > 150)) {
  console.error("Set valid BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD, BOOTSTRAP_TENANT_NAME, BOOTSTRAP_BRANCH_NAME, and BOOTSTRAP_WAREHOUSE_NAME.");
  process.exitCode = 1;
} else {
  const passwordHash = await hashPassword(password);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('stockroom-first-owner-bootstrap'))");
    const [{ rowCount: tenants }, { rowCount: users }] = await Promise.all([
      client.query("SELECT 1 FROM stockroom.tenants LIMIT 1"),
      client.query("SELECT 1 FROM stockroom.users LIMIT 1"),
    ]);
    if (tenants || users) throw new Error("Bootstrap is only allowed before any tenant or user exists");
    const { rows: [ownerRole] } = await client.query("SELECT id FROM stockroom.roles WHERE key='tenant_owner'");
    if (!ownerRole) throw new Error("Tenant owner role is missing; run database migrations first");
    const tenantId = (await client.query("INSERT INTO stockroom.tenants(name,slug) VALUES ($1,$2) RETURNING id", [tenantName, `workspace-${randomBytes(8).toString("hex")}`])).rows[0].id;
    const user = (await client.query("INSERT INTO stockroom.users(email,email_normalized,password_hash) VALUES ($1,$2,$3) RETURNING id", [email,email,passwordHash])).rows[0];
    const branchId = (await client.query("INSERT INTO stockroom.branches(tenant_id,name,status) VALUES ($1,$2,'active') RETURNING id", [tenantId,branchName])).rows[0].id;
    const warehouseId = (await client.query("INSERT INTO stockroom.warehouses(tenant_id,branch_id,name,status) VALUES ($1,$2,$3,'active') RETURNING id", [tenantId,branchId,warehouseName])).rows[0].id;
    const membershipId = (await client.query("INSERT INTO stockroom.memberships(tenant_id,user_id,role_id,status) VALUES ($1,$2,$3,'active') RETURNING id", [tenantId,user.id,ownerRole.id])).rows[0].id;
    await client.query("INSERT INTO stockroom.audit_events(tenant_id,actor_id,action,entity_type,entity_id,summary) VALUES ($1,$2,'bootstrap.completed','membership',$3,$4)", [tenantId,user.id,membershipId,JSON.stringify({ branchId, warehouseId })]);
    await client.query("INSERT INTO stockroom.security_events(user_id,action) VALUES ($1,'first_owner_bootstrapped')", [user.id]);
    await client.query("COMMIT");
    console.log(`Bootstrapped first owner ${email} for tenant ${tenantId}. Remove BOOTSTRAP_* values from the environment.`);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Owner bootstrap failed:", error.code || "database error");
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}
