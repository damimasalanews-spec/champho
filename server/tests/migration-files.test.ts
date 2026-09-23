import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrations, stripTransactionWrapper } from "../migrations.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * The runner executes each migration inside a transaction of its own, so the
 * BEGIN/COMMIT a migration carries has to be stripped out. If BEGIN were left in
 * place the migration's own COMMIT would close the runner's transaction early,
 * and the ledger entry recording the migration would go with it.
 */
test("the transaction wrapper is stripped, including behind a comment header", () => {
  assert.equal(stripTransactionWrapper("BEGIN;\nSELECT 1;\nCOMMIT;\n"), "SELECT 1;");
  assert.equal(
    stripTransactionWrapper("-- why this migration exists\n\nBEGIN;\nSELECT 1;\nCOMMIT;\n"),
    "SELECT 1;"
  );
  assert.equal(
    stripTransactionWrapper("BEGIN;\n-- BEGIN; inside a comment is not a wrapper\nSELECT 1;\nCOMMIT;\n"),
    "-- BEGIN; inside a comment is not a wrapper\nSELECT 1;"
  );
});

/**
 * The convention is that a migration file opens with BEGIN; on its first line,
 * the way all six of the original ones do. Checking it here means a future
 * migration that breaks the convention fails loudly instead of quietly running
 * inside the runner's transaction.
 */
test("every migration file opens with BEGIN; and closes with COMMIT;", async () => {
  for (const migration of migrations) {
    const sql = await readFile(resolve(repoRoot, migration.filename), "utf8");

    assert.match(
      sql,
      /^BEGIN;/,
      `${migration.filename} must open with BEGIN; on its first line`
    );
    assert.match(
      sql,
      /COMMIT;\s*$/,
      `${migration.filename} must end with COMMIT;`
    );
    assert.equal(
      stripTransactionWrapper(sql).includes("BEGIN;"),
      false,
      `${migration.filename} still carries a BEGIN; after stripping`
    );
  }
});
