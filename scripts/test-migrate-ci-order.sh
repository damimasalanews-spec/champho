#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$BASH_SOURCE")/.." && pwd)"
migration_script="$repo_root/scripts/migrate-ci.sh"
temp_dir="$(mktemp -d)"
trap "rm -rf \"$temp_dir\"" EXIT

assert_runner_rejects_without_psql() {
  local label="$1"
  local expected_message="$2"

  local marker="$temp_dir/psql-was-called"
  rm -f "$marker"
  rm -rf "$temp_dir/bin"
  mkdir "$temp_dir/bin"

  cat > "$temp_dir/bin/psql" <<EOF
#!/usr/bin/env bash
touch "$marker"
echo "TEST FAILED: psql was invoked for $label" >&2
exit 99
EOF
  chmod +x "$temp_dir/bin/psql"

  set +e
  PATH="$temp_dir/bin:$PATH" MIGRATION_DIR="$temp_dir/migrations" "$migration_script"     >"$temp_dir/output.log" 2>&1
  local status=$?
  set -e

  if [ "$status" -eq 0 ]; then
    echo "TEST FAILED: $label unexpectedly succeeded"
    cat "$temp_dir/output.log"
    exit 1
  fi

  if [ -e "$marker" ]; then
    echo "TEST FAILED: migration script invoked psql before rejecting $label"
    cat "$temp_dir/output.log"
    exit 1
  fi

  if ! grep -q "$expected_message" "$temp_dir/output.log"; then
    echo "TEST FAILED: expected $label failure was not reported"
    cat "$temp_dir/output.log"
    exit 1
  fi
}

mkdir "$temp_dir/migrations"

# Case 1: deliberately misordered migration files.
touch "$temp_dir/migrations/001_game_rooms_and_submissions.sql"
touch "$temp_dir/migrations/003_protocol_indexes_and_immutability.sql"
touch "$temp_dir/migrations/002_protocol_constraints.sql"

assert_runner_rejects_without_psql   "misordered migration set"   "Migration order/file mismatch"

echo "Misordered migration test passed."

# Case 2: two migration files share the same numeric prefix.
rm -rf "$temp_dir/migrations"
mkdir "$temp_dir/migrations"

touch "$temp_dir/migrations/001_game_rooms_and_submissions.sql"
touch "$temp_dir/migrations/001_duplicate_game_rooms.sql"
touch "$temp_dir/migrations/002_protocol_constraints.sql"
touch "$temp_dir/migrations/003_protocol_indexes_and_immutability.sql"

assert_runner_rejects_without_psql   "duplicate migration numeric prefix"   "Migration file count mismatch"

echo "Duplicate migration prefix test passed: migration script failed before psql."

# Case 3: one expected migration prefix is missing.
rm -rf "$temp_dir/migrations"
mkdir "$temp_dir/migrations"

touch "$temp_dir/migrations/001_game_rooms_and_submissions.sql"
touch "$temp_dir/migrations/003_protocol_indexes_and_immutability.sql"

assert_runner_rejects_without_psql \
  "missing migration prefix" \
  "Migration file count mismatch"

echo "Missing migration prefix test passed: migration script failed before psql."
\nsummary_file="$temp_dir/summary.txt"\ncat > "$summary_file" <<EOF\nMigration validation summary\n- misordered migration set: PASSED (psql not invoked)\n- duplicate migration numeric prefix: PASSED (psql not invoked)\n- missing migration prefix: PASSED (psql not invoked)\nEOF\n\necho "Migration validation summary:"\ncat "$summary_file"\n