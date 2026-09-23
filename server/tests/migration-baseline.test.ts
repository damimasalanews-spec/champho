import test from "node:test";
import assert from "node:assert/strict";
import {
  LEGACY_BASELINE_VERSION,
  legacyBaselineSet,
  migrations,
  type Migration
} from "../migrations.js";

/**
 * The hazard this guards against is silent. A database built before the runner
 * existed gets its migrations recorded as applied rather than run; if that
 * baseline reached past the schema the database actually has, the new columns
 * would never be created and the failure would only surface later, at runtime.
 *
 * There is now a real migration above the bound, so this asserts against the
 * shipping list rather than against a stand-in.
 */
test("the legacy baseline never covers a migration above the bound", () => {
  const set = legacyBaselineSet(migrations);

  assert.ok(
    migrations.some((migration) => migration.version > LEGACY_BASELINE_VERSION),
    "this test only means something while a migration sits above the bound"
  );
  assert.ok(set, "the canonical set should still be baselined");
  assert.ok(
    !set.some((migration) => migration.version > LEGACY_BASELINE_VERSION),
    "a migration above the bound must run, not be recorded as applied"
  );
  assert.ok(set.some((migration) => migration.version === LEGACY_BASELINE_VERSION));

  const above = migrations.filter((migration) => migration.version > LEGACY_BASELINE_VERSION);
  for (const migration of above) {
    assert.ok(
      !set.some((covered) => covered.version === migration.version),
      `${migration.name} would be recorded as applied on a database that never ran it`
    );
  }
});

test("a set that is not the canonical migrations is never baselined", () => {
  assert.equal(legacyBaselineSet([]), null);
  assert.equal(
    legacyBaselineSet([{ version: 1, name: "something_else", filename: "db/x.sql" }]),
    null,
    "a renamed migration must not be waved through"
  );
});

test("the bound stays in step with the versions the baseline covers", () => {
  const covered = migrations.filter((migration) => migration.version <= LEGACY_BASELINE_VERSION);

  assert.equal(
    covered.length,
    LEGACY_BASELINE_VERSION,
    "the canonical migrations should be contiguous from 1, or the bound means something else"
  );
  assert.equal(covered[covered.length - 1]?.version, LEGACY_BASELINE_VERSION);
});
