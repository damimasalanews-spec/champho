import { Pool } from "pg";
import { config } from "./config.js";

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
});

pool.on("error", (error) => {
  console.error("[db] Unexpected PostgreSQL pool error:", error);
});

export async function checkDatabase(): Promise<{ ok: true; latencyMs: number }> {
  const startedAt = performance.now();

  await pool.query("SELECT 1");

  return {
    ok: true,
    latencyMs: Math.round(performance.now() - startedAt)
  };
}
