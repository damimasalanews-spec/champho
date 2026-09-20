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

void runMigrations(pool)
  .then(() => start())
  .then((started) => {
    app = started;
  })
  .catch((error) => {
    console.error("[startup] PostgreSQL migrations/startup failed:", error);
    process.exitCode = 1;
  });
