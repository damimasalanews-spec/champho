#!/usr/bin/env bash
#
# One-command verification for CHAMP WORD.
#
# Runs every gate that has actually caught a bug in this project:
#   typecheck -> migrations -> engine tests -> UI layout -> end-to-end game loop
#
# Usage:
#   DATABASE_URL=postgresql://user:pass@host:5432/db ./scripts/verify.sh
#
# The database named in DATABASE_URL IS WIPED of this project's schema first, so
# point it at a scratch database. Never at production.
#
set -uo pipefail

DATABASE_URL="${DATABASE_URL:-}"
if [ -z "$DATABASE_URL" ]; then
  echo "DATABASE_URL is required, e.g." >&2
  echo "  DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/champword ./scripts/verify.sh" >&2
  exit 2
fi

case "$DATABASE_URL" in
  *prod*|*production*)
    echo "Refusing to run: DATABASE_URL looks like production." >&2
    exit 2 ;;
esac

cd "$(dirname "$0")/.." || exit 2
export DATABASE_URL

PASS=0
FAIL=0
SKIP=0

step() {
  local name="$1"; shift
  printf '\n\033[1m== %s ==\033[0m\n' "$name"
  if "$@"; then
    echo "   -> PASS"
    PASS=$((PASS + 1))
  else
    echo "   -> FAIL"
    FAIL=$((FAIL + 1))
  fi
}

# ---------------------------------------------------------------- dependencies
if [ ! -d node_modules ]; then
  echo "[setup] installing dependencies"
  npm install || { echo "npm install failed"; exit 1; }
fi

# ------------------------------------------------------------------- typecheck
step "typecheck (tsc --noEmit)" npx tsc --noEmit

# ------------------------------------------------------------------ migrations
if command -v psql >/dev/null 2>&1; then
  step "migrations (db/*.sql)" bash -c '
    set -e
    for m in db/0*.sql; do
      case "$m" in db/tests/*) continue;; esac
      psql "$DATABASE_URL" --set ON_ERROR_STOP=1 -q --file="$m" >/dev/null
    done
    echo "   applied: $(ls db/0*.sql | wc -l) migration files"
  '
else
  echo "   -> SKIP migrations (psql not on PATH; the server also migrates on boot)"
  SKIP=$((SKIP + 1))
fi

# ------------------------------------------------------------------ unit + e2e
# ORDER MATTERS. The migration-runner suite asserts on the state of the
# migration ledger, so it must run BEFORE any other suite calls runMigrations()
# and populates that ledger. Running it after turn-engine leaves the ledger
# filled and the "baselines pre-existing migrations" case fails — which is
# test-order dependence, not a product bug.
step "migration runner tests" npx tsx --test --test-timeout=45000 server/tests/migration-runner.test.ts
step "turn engine tests" npx tsx --test --test-timeout=45000 server/tests/turn-engine.test.ts
step "room lifecycle tests" npx tsx --test --test-timeout=45000 server/tests/room-lifecycle.test.ts

step "room lifecycle e2e" npx tsx --test --test-timeout=45000 server/tests/room-lifecycle.e2e.test.ts
step "submit word e2e" npx tsx --test --test-timeout=45000 server/tests/submit-word.e2e.test.ts

# ------------------------------------------------------------------- UI layout
if [ -d node_modules/puppeteer ]; then
  step "UI layout at 5 viewports" node verify-ui.mjs
else
  echo
  echo "== UI layout: installing puppeteer (not a project dependency) =="
  if npm install --no-save puppeteer >/dev/null 2>&1 && [ -d node_modules/puppeteer ]; then
    step "UI layout at 5 viewports" node verify-ui.mjs
  else
    echo "   -> SKIP UI layout (puppeteer unavailable)"
    SKIP=$((SKIP + 1))
  fi
fi

# ------------------------------------------------------------------ game loop
if [ -f verify-e2e.mjs ] && [ -d node_modules/puppeteer ]; then
  step "end-to-end game loop (client <-> server)" node verify-e2e.mjs
fi

# --------------------------------------------------------------------- summary
printf '\n\033[1m== summary ==\033[0m\n'
echo "   passed : $PASS"
echo "   failed : $FAIL"
echo "   skipped: $SKIP"
[ "$FAIL" -eq 0 ] && echo "   RESULT : OK" || echo "   RESULT : FAILURES PRESENT"
exit "$([ "$FAIL" -eq 0 ] && echo 0 || echo 1)"
