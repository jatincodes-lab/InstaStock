import { randomUUID } from "node:crypto";
import { createAuthApi } from "./auth.mjs";

export async function createHandler(pool, options = {}) {
  const auth = await createAuthApi(pool, options.auth);
  return async (req, res) => {
    req.requestId = randomUUID();
    res.setHeader("X-Request-Id", req.requestId);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    try {
      const url = new URL(req.url, "http://stockroom.local");
      if (req.method === "GET" && url.pathname === "/api/v1/health") {
        try {
          await pool.query("SELECT 1");
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ status: "ok", database: "connected" }));
        } catch {
          res.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ status: "unavailable", database: "unavailable" }));
        }
        return;
      }
      if (await auth.handle(req, res, url)) return;
      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "not_found" }));
    } catch (error) {
      await auth.onError(error, req, res);
    }
  };
}
