import { pool } from "./db.js";
import { start, type ServerApp } from "./index.js";
import { runMigrations } from "./migrations.js";

let app: ServerApp | undefined;

async function shutdown(signal: string): Promise<void> {
  console.log(`[shutdown] Received ${signal}; closing server`);

  try {
    await app?.close();
  } finally {
    await pool.end();
    console.log("[shutdown] PostgreSQL pool closed");
  }
}

process.once("SIGINT", () => {
  void shutdown("SIGINT").finally(() => process.exit(0));
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM").finally(() => process.exit(0));
});

/* A hosted database is not always reachable on the first attempt. A pooled Neon
   endpoint in particular suspends its compute when idle, and the first connection
   after that can be refused or dropped mid-handshake. The old code treated any
   such blip as fatal: it logged once and exited, so a server that would have
   worked two seconds later stayed down until somebody restarted it by hand.
   Retry with a backoff instead, and only give up when the wait is long enough
   that the credentials or the network are genuinely wrong. */
const MIGRATION_ATTEMPTS = 6;
const MIGRATION_BACKOFF_MS = 2_000;

async function migrateWithRetry(): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await runMigrations(pool);
      return;
    } catch (error) {
      if (attempt >= MIGRATION_ATTEMPTS) throw error;
      const waitMs = MIGRATION_BACKOFF_MS * 2 ** (attempt - 1);
      const reason = error instanceof Error ? error.message : String(error);
      console.error(
        `[startup] database unavailable (attempt ${attempt}/${MIGRATION_ATTEMPTS}), retrying in ${waitMs}ms: ${reason}`
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

void migrateWithRetry()
  .then(() => start())
  .then((started) => {
    app = started;
  })
  .catch((error) => {
    console.error("[startup] PostgreSQL migrations/startup failed:", error);
    process.exitCode = 1;
  });
