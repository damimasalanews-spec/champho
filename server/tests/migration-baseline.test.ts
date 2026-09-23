import test from "node:test";
import assert from "node:assert/strict";
import {
  LEGACY_BASELINE_VERSION,
  legacyBaselineSet,
  migrations,
  type Migration
} from "../migrations.js";

const newer: Migration = {
  version: LEGACY_BASELINE_VERSION + 1,
  name: "board_and_stake",
  filename: "db/007_board_and_stake.sql"
};

/**
 * The hazard this guards against is silent. A database built before the runner
 * existed gets its migrations recorded as applied rather than run; if that
 * baseline reached past the schema the database actually has, the new columns
 * would never be created and the failure would only surface later, at runtime.
 */
test("the legacy baseline never covers a migration above the bound", () => {
  const set = legacyBaselineSet([...migrations, newer]);

  assert.ok(set, "the canonical set should still be baselined");
  assert.ok(
    !set.some((migration) => migration.version > LEGACY_BASELINE_VERSION),
    "a migration above the bound must run, not be recorded as applied"
  );
  assert.ok(set.some((migration) => migration.version === LEGACY_BASELINE_VERSION));
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
