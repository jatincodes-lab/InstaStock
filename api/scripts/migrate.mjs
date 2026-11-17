import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { pool } from "../src/db.mjs";

const migrationDir = fileURLToPath(new URL("../migrations/", import.meta.url));
const files = fs.readdirSync(migrationDir).filter((name) => /^\d+_[a-z0-9_]+\.sql$/i.test(name)).sort();
const client = await pool.connect();

try {
  await client.query("CREATE SCHEMA IF NOT EXISTS stockroom");
  await client.query("CREATE TABLE IF NOT EXISTS stockroom.schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");

  for (const file of files) {
    const version = file.replace(/\.sql$/i, "");
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('stockroom-schema-migrations'))");
      const done = await client.query("SELECT 1 FROM stockroom.schema_migrations WHERE version=$1", [version]);
      if (done.rowCount) {
        await client.query("COMMIT");
        continue;
      }
      await client.query(fs.readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
      await client.query("INSERT INTO stockroom.schema_migrations(version) VALUES ($1)", [version]);
      await client.query("COMMIT");
      console.log(`Applied ${version}.`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} catch (error) {
  console.error("Migration failed:", error.code || "database error");
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
