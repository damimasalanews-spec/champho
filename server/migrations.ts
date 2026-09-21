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
  { version: 4, name: "connection_version", filename: "db/004_connection_version.sql" },
  { version: 5, name: "turn_engine", filename: "db/005_turn_engine.sql" },
  { version: 6, name: "submission_id_is_text", filename: "db/006_submission_id_is_text.sql" }
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

function isCanonicalMigrationSet(selectedMigrations: readonly Migration[]): boolean {
  return selectedMigrations.length === migrations.length
    && selectedMigrations.every(
      (migration, index) =>
        migration.version === migrations[index].version
        && migration.name === migrations[index].name
    );
}

async function hasLegacyProtocolSchema(client: PoolClient): Promise<boolean> {
  const requiredTables = await client.query<{ table_name: string }>(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ANY($1::text[])
  `, [["game_rooms", "room_players", "room_events", "submissions"]]);

  if (requiredTables.rowCount !== 4) return false;

  const requiredColumns = [
    ["game_rooms", "first_solver_id"],
    ["game_rooms", "solved_at"],
    ["game_rooms", "solve_window_ends_at"],
    ["room_players", "hand_version"],
    ["room_players", "hand_round_number"],
    ["room_players", "connection_version"],
    ["room_events", "event_sequence"],
    ["submissions", "request_hash"]
  ];

  const columnChecks = await Promise.all(
    requiredColumns.map(async ([tableName, columnName]) => {
      const result = await client.query(
        `
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = $1
            AND column_name = $2
        `,
        [tableName, columnName]
      );
      return result.rowCount === 1;
    })
  );

  if (columnChecks.some((present) => !present)) return false;

  const requiredConstraints = [
    "game_rooms_active_player_fk",
    "game_rooms_first_solver_fk",
    "game_rooms_phase_state_chk",
    "room_players_connection_version_chk"
  ];

  const constraints = await client.query<{ conname: string }>(`
    SELECT conname
    FROM pg_constraint
    WHERE connamespace = 'public'::regnamespace
      AND conname = ANY($1::text[])
  `, [requiredConstraints]);

  if (constraints.rowCount !== requiredConstraints.length) return false;

  const requiredIndexes = [
    "room_events_room_sequence_idx",
    "submissions_room_turn_idx",
    "room_players_connection_version_idx"
  ];

  const indexes = await client.query<{ indexname: string }>(`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = ANY($1::text[])
  `, [requiredIndexes]);

  if (indexes.rowCount !== requiredIndexes.length) return false;

  const trigger = await client.query(`
    SELECT 1
    FROM information_schema.triggers
    WHERE trigger_schema = 'public'
      AND event_object_table = 'game_rooms'
      AND trigger_name = 'game_rooms_first_solver_immutable'
  `);

  if (trigger.rowCount !== 1) return false;

  const functionResult = await client.query(`
    SELECT 1
    FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname = 'prevent_first_solver_change'
  `);

  return functionResult.rowCount === 1;
}

async function baselineLegacyMigrations(
  client: PoolClient,
  selectedMigrations: readonly Migration[]
): Promise<void> {
  if (!isCanonicalMigrationSet(selectedMigrations)) return;

  const result = await client.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM public.schema_migrations"
  );

  if (result.rows[0]?.count !== "0") return;
  if (!await hasLegacyProtocolSchema(client)) return;

  await client.query("BEGIN");

  try {
    for (const migration of selectedMigrations) {
      await client.query(
        "INSERT INTO public.schema_migrations (version, name) VALUES ($1, $2)",
        [migration.version, migration.name]
      );
    }

    await client.query("COMMIT");
    console.log("[startup] Baseline recorded for pre-existing PostgreSQL migrations");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
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
    await baselineLegacyMigrations(client, selectedMigrations);

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
