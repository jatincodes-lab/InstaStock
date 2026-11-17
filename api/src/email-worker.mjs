import { deliverOutboxBatch, pruneAuthData } from "./auth.mjs";
import { pool } from "./db.mjs";

let stopped = false;
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { stopped = true; });

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let lastPrune = 0;
while (!stopped) {
  try {
    const delivered = await deliverOutboxBatch(pool);
    if (Date.now() - lastPrune > 60 * 60 * 1000) {
      await pruneAuthData(pool);
      lastPrune = Date.now();
    }
    if (!delivered) await pause(2000);
  } catch (error) {
    console.error("Email worker failed:", error.code || "delivery_error");
    await pause(10000);
  }
}

await pool.end();
