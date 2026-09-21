import { Pool } from "pg";
import { config } from "./config.js";

/**
 * Managed providers (Render, Neon, Heroku) require TLS and terminate it with a
 * certificate chain that node's default trust store rejects. Rather than
 * hard-code SSL on — which would break a plain local PostgreSQL — this follows
 * the connection string: append `?sslmode=require` and TLS is used.
 *
 * A local `postgresql://.../champword` therefore keeps working unchanged, while
 * a managed URL opts in explicitly.
 */
function sslFor(connectionString: string): { rejectUnauthorized: boolean } | undefined {
  let mode: string | null = null;
  try {
    mode = new URL(connectionString).searchParams.get("sslmode");
  } catch {
    mode = null;
  }
  if (!mode) return undefined;
  if (mode === "disable") return undefined;
  return { rejectUnauthorized: false };
}

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: sslFor(config.databaseUrl)
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
