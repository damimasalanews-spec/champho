import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { MIGRATION_LOCK_ID, runMigrations, type Migration } from "../migrations.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const migration: Migration = {
  version: 9001,
  name: "migration_runner_test",
  filename: "db/tests/001_migration_runner_test.sql"
};

const pool = new Pool({ connectionString });

async function resetFixture() {
  await pool.query("DROP TABLE IF EXISTS public.migration_runner_test_state");
  await pool.query("CREATE TABLE IF NOT EXISTS public.schema_migrations (version integer PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
  await pool.query("DELETE FROM public.schema_migrations WHERE version = $1", [migration.version]);
}

beforeEach(resetFixture);

after(async () => {
  await pool.query("DROP TABLE IF EXISTS public.migration_runner_test_state");
  await pool.query("DELETE FROM public.schema_migrations WHERE version = $1", [migration.version]);
  await pool.end();
});

test("serializes concurrent startup and applies a migration once", async () => {
  const poolA = new Pool({ connectionString });
  const poolB = new Pool({ connectionString });

  try {
    await Promise.all([
      runMigrations(poolA, [migration]),
      runMigrations(poolB, [migration])
    ]);

    const state = await pool.query("SELECT value FROM public.migration_runner_test_state WHERE id = 1");
    assert.deepEqual(state.rows, [{ value: 1 }]);

    const ledger = await pool.query("SELECT version, name FROM public.schema_migrations WHERE version = $1", [migration.version]);
    assert.deepEqual(ledger.rows, [{ version: migration.version, name: migration.name }]);
  } finally {
    await poolA.end();
    await poolB.end();
  }
});

test("fails on the first attempt, rolls back, then succeeds on retry", async () => {
  let attempts = 0;

  await runMigrations(pool, [migration], {
    beforeCommit: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("intentional_test_failure");
    }
  });

  assert.equal(attempts, 2);

  const state = await pool.query("SELECT value FROM public.migration_runner_test_state WHERE id = 1");
  assert.deepEqual(state.rows, [{ value: 1 }]);

  const ledger = await pool.query("SELECT version, name FROM public.schema_migrations WHERE version = $1", [migration.version]);
  assert.deepEqual(ledger.rows, [{ version: migration.version, name: migration.name }]);
});

test("rejects a stored migration with a different name", async () => {
  await pool.query("INSERT INTO public.schema_migrations (version, name) VALUES ($1, $2)", [migration.version, "wrong_name"]);

  await assert.rejects(runMigrations(pool, [migration]), /migration name mismatch/);
});

test("releases the advisory lock after migration errors", async () => {
  await assert.rejects(
    runMigrations(pool, [migration], {
      beforeCommit: async () => {
        throw new Error("intentional_persistent_failure");
      }
    }),
    /intentional_persistent_failure/
  );

  const verifier = new Pool({ connectionString });

  try {
    const lockFunction = "pg_try_" + "advisory_lock";
    const result = await verifier.query(`SELECT ${lockFunction}($1) AS acquired`, [MIGRATION_LOCK_ID]);
    assert.equal(result.rows[0].acquired, true);
    await verifier.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]);
  } finally {
    await verifier.end();
  }
});
