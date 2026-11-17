import fs from "node:fs";
import dotenv from "dotenv";
import pg from "pg";
import { fileURLToPath } from "node:url";
dotenv.config({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });
const { Pool } = pg;
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
if (!process.env.DATABASE_SSL_CERT_PATH) throw new Error("DATABASE_SSL_CERT_PATH is required.");
const url = new URL(process.env.DATABASE_URL);
url.searchParams.delete("sslmode");
export const pool = new Pool({
  connectionString: url.toString(),
  ssl: { ca: fs.readFileSync(process.env.DATABASE_SSL_CERT_PATH, "utf8"), rejectUnauthorized: true },
  max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, application_name: "stockroom-api"
});