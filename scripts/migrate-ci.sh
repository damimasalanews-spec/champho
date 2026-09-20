#!/usr/bin/env bash
set -euo pipefail

migration_dir="${MIGRATION_DIR:-db}"

expected=(
  "${migration_dir}/001_game_rooms_and_submissions.sql"
  "${migration_dir}/002_protocol_constraints.sql"
  "${migration_dir}/003_protocol_indexes_and_immutability.sql"
)

mapfile -t actual < <(find "$migration_dir" -maxdepth 1 -type f -name '[0-9][0-9][0-9]_*.sql' -print | sort)

if [ "${#actual[@]}" -ne "${#expected[@]}" ]; then
  echo "Migration file count mismatch."
  printf 'Expected:\n'; printf '  %s\n' "${expected[@]}"
  printf 'Found:\n'; printf '  %s\n' "${actual[@]}"
  exit 1
fi

for i in "${!expected[@]}"; do
  if [ "${actual[$i]}" != "${expected[$i]}" ]; then
    echo "Migration order/file mismatch at position $((i + 1))."
    echo "Expected: ${expected[$i]}"
    echo "Found:    ${actual[$i]}"
    exit 1
  fi
done

echo "Applying migrations in explicit order:"
printf '  %s\n' "${expected[@]}"

psql --set ON_ERROR_STOP=1 \
  --file="${expected[0]}" \
  --file="${expected[1]}" \
  --file="${expected[2]}"

echo "All migrations applied successfully in order."
