import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Pool, PoolClient } from "pg";

export type Migration = {
  version: number;
  name: string;
  filename: string;
};

export type MigrationHook = {
  beforeCommit?: (migration: Migration, client: PoolClient) => Promise<void>;
};

export const MIGRATION_LOCK_ID = 73421;
const MAX_MIGRATION_ATTEMPTS = 3;

export const migrations: Migration[] = [
  { version: 1, name: "game_rooms_and_submissions", filename: "db/001_game_rooms_and_submissions.sql" },
  { version: 2, name: "protocol_constraints", filename: "db/002_protocol_constraints.sql" },
  { version: 3, name: "protocol_indexes_and_immutability", filename: "db/003_protocol_indexes_and_immutability.sql" },
  { version: 4, name: "connection_version", filename: "db/004_connection_version.sql" }
];

function stripTransactionWrapper(sql: string): string {
  const withoutBegin = sql.replace(/^\s*BEGIN\s*;\s*/i, "");
  return withoutBegin.replace(/\s*COMMIT\s*;\s*$/i, "");
}

async function acquireMigrationLock(client: PoolClient): Promise<void> {
  await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
}

async function releaseMigrationLock(client: PoolClient): Promise<void> {
  const result = await client.query<{ released: boolean }>(
    "SELECT pg_advisory_unlock($1) AS released",
    [MIGRATION_LOCK_ID]
  );

  if (result.rows[0]?.released !== true) {
    throw new Error("migration advisory lock was not released");
  }
}

async function ensureMigrationTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      version integer PRIMARY KEY,
      name text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function validateOrGetApplied(
  client: PoolClient,
  migration: Migration
): Promise<boolean> {
  const result = await client.query<{ name: string }>(
    "SELECT name FROM public.schema_migrations WHERE version = $1",
    [migration.version]
  );

  const applied = result.rows[0];
  if (!applied) return false;

  if (applied.name !== migration.name) {
    throw new Error(
      `migration name mismatch for version ${migration.version}: database has "${applied.name}", expected "${migration.name}"`
    );
  }

  return true;
}

async function applyMigration(
  client: PoolClient,
  migration: Migration,
  sql: string,
  hook?: MigrationHook
): Promise<void> {
  await client.query("BEGIN");

  try {
    await client.query(stripTransactionWrapper(sql));

    if (hook?.beforeCommit) {
      await hook.beforeCommit(migration, client);
    }

    await client.query(
      "INSERT INTO public.schema_migrations (version, name) VALUES ($1, $2)",
      [migration.version, migration.name]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function applyMigrationWithRetry(
  client: PoolClient,
  migration: Migration,
  sql: string,
  hook?: MigrationHook
): Promise<void> {
  for (let attempt = 1; attempt <= MAX_MIGRATION_ATTEMPTS; attempt += 1) {
    try {
      await applyMigration(client, migration, sql, hook);
      return;
    } catch (error) {
      if (attempt === MAX_MIGRATION_ATTEMPTS) throw error;

      console.warn(
        `[startup] Migration ${migration.filename} failed on attempt ${attempt}; retrying`
      );
    }
  }
}

export async function runMigrations(
  pool: Pool,
  selectedMigrations: readonly Migration[] = migrations,
  hook?: MigrationHook
): Promise<void> {
  const client = await pool.connect();
  let lockHeld = false;

  try {
    await acquireMigrationLock(client);
    lockHeld = true;

    await ensureMigrationTable(client);

    for (const migration of selectedMigrations) {
      if (await validateOrGetApplied(client, migration)) {
        console.log(`[startup] Migration ${migration.filename} already applied`);
        continue;
      }

      console.log(`[startup] Applying migration ${migration.filename}`);
      const sql = await readFile(join(process.cwd(), migration.filename), "utf8");
      await applyMigrationWithRetry(client, migration, sql, hook);
    }

    console.log(`[startup] PostgreSQL migrations applied (${selectedMigrations.length})`);
  } finally {
    if (lockHeld) {
      try {
        await releaseMigrationLock(client);
      } finally {
        client.release();
      }
    } else {
      client.release();
    }
  }
}
