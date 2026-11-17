import http from "node:http";
import { pool } from "./db.mjs";
import { createHandler } from "./app.mjs";

const port = Number(process.env.API_PORT || 3001);
const handler = await createHandler(pool);
export default handler;

if (!process.env.VERCEL) {
  const server = http.createServer(handler);
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.listen(port, process.env.API_HOST || "127.0.0.1", () => console.log("Stockroom API listening on port " + port));
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => pool.end().finally(() => process.exit(0))));
}
