import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pool } from "./db.js";
import { start, type ServerApp } from "./index.js";

const migrations = [
  "db/001_game_rooms_and_submissions.sql",
  "db/002_protocol_constraints.sql",
  "db/003_protocol_indexes_and_immutability.sql",
  "db/004_connection_version.sql"
];

let app: ServerApp | undefined;

async function runMigrations(): Promise<void> {
  for (const migration of migrations) {
    console.log(`[startup] Applying migration ${migration}`);
    const sql = await readFile(join(process.cwd(), migration), "utf8");
    await pool.query(sql);
  }

  console.log(`[startup] PostgreSQL migrations applied (${migrations.length})`);
}

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

void runMigrations()
  .then(() => start())
  .then((started) => {
    app = started;
  })
  .catch((error) => {
    console.error("[startup] PostgreSQL migrations/startup failed:", error);
    process.exitCode = 1;
  });
