# PostgreSQL migration tests

These tests are written for a temporary PostgreSQL database. They apply the protocol migrations in order and verify the database-level invariants.

Run with:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/tests/001_protocol_migration_tests.sql
```

The script creates an isolated `champword_migration_test` schema, so it does not modify application tables.

## Coverage

- game_rooms defaults and CHECK constraints
- submissions uniqueness, request hash, status and FK constraints
- room_events sequence uniqueness and payload constraints
- room_players hand_version constraints
- solve-window timestamp pair/order constraints
- active-player and first-solver same-room foreign keys
- required protocol indexes
- first-solver / solved_at / solve_window_ends_at immutability
- event-sequence and hand-version transaction examples
