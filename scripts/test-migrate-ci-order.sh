#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$BASH_SOURCE")/.." && pwd)"
migration_script="$repo_root/scripts/migrate-ci.sh"
temp_dir="$(mktemp -d)"
trap "rm -rf \"$temp_dir\"" EXIT

touch "$temp_dir/001_game_rooms_and_submissions.sql"
touch "$temp_dir/003_protocol_indexes_and_immutability.sql"
touch "$temp_dir/002_protocol_constraints.sql"

marker="$temp_dir/psql-was-called"
mkdir "$temp_dir/bin"
cat > "$temp_dir/bin/psql" <<EOF
#!/usr/bin/env bash
touch "$marker"
echo "TEST FAILED: psql was invoked for a misordered migration set" >&2
exit 99
EOF
chmod +x "$temp_dir/bin/psql"

set +e
PATH="$temp_dir/bin:$PATH" MIGRATION_DIR="$temp_dir" "$migration_script" >"$temp_dir/output.log" 2>&1
status=$?
set -e

if [ "$status" -eq 0 ]; then
  echo "TEST FAILED: misordered migrations unexpectedly succeeded"
  cat "$temp_dir/output.log"
  exit 1
fi

if [ -e "$marker" ]; then
  echo "TEST FAILED: migration script invoked psql before rejecting order"
  cat "$temp_dir/output.log"
  exit 1
fi

if ! grep -q "Migration order/file mismatch" "$temp_dir/output.log"; then
  echo "TEST FAILED: expected migration-order failure was not reported"
  cat "$temp_dir/output.log"
  exit 1
fi

echo "Misordered migration test passed: migration script failed before psql."
