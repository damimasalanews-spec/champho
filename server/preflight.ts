import type { Pool } from "pg";

export async function runProductionPreflight(pool: Pool): Promise<Record<string, unknown>> {
  const identity = await pool.query(`
    SELECT current_database() AS database_name,
           current_user AS database_user,
           version() AS postgres_version
  `);

  const tables = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema='public'
      AND table_name IN ('game_rooms','room_players','room_events','submissions','schema_migrations')
    ORDER BY table_name
  `);

  const columns = await pool.query(`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema='public'
      AND ((table_name='game_rooms' AND column_name IN ('first_solver_id','solved_at','solve_window_ends_at'))
        OR (table_name='room_players' AND column_name IN ('hand_version','hand_round_number','connection_version'))
        OR (table_name='room_events' AND column_name='event_sequence')
        OR (table_name='submissions' AND column_name='request_hash'))
    ORDER BY table_name, column_name
  `);

  const constraints = await pool.query(`
    SELECT c.conname, pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c
    JOIN pg_class t ON t.oid=c.conrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public'
      AND t.relname IN ('game_rooms','room_players','room_events','submissions')
    ORDER BY c.conname
  `);

  const indexes = await pool.query(`
    SELECT indexname, tablename, indexdef
    FROM pg_indexes
    WHERE schemaname='public'
      AND tablename IN ('game_rooms','room_players','room_events','submissions')
    ORDER BY tablename, indexname
  `);

  const triggers = await pool.query(`
    SELECT n.nspname AS schema_name, c.relname AS table_name, t.tgname AS trigger_name,
           pg_get_triggerdef(t.oid) AS trigger_definition
    FROM pg_trigger t
    JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE NOT t.tgisinternal
      AND n.nspname='public'
    ORDER BY c.relname, t.tgname
  `);

  const functions = await pool.query(`
    SELECT n.nspname AS schema_name, p.proname AS function_name,
           pg_get_functiondef(p.oid) AS function_definition
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname='prevent_first_solver_change'
  `);

  const ledgerExists = await pool.query(`
    SELECT to_regclass('public.schema_migrations') AS schema_migrations
  `);

  const ledger = await pool.query(`
    SELECT version, name, applied_at
    FROM public.schema_migrations
    ORDER BY version
  `);

  const counts = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM game_rooms) AS game_rooms,
      (SELECT COUNT(*)::int FROM room_players) AS room_players,
      (SELECT COUNT(*)::int FROM room_events) AS room_events,
      (SELECT COUNT(*)::int FROM submissions) AS submissions
  `);

  const invalidPlayerVersions = await pool.query(`
    SELECT COUNT(*)::int AS invalid_player_versions
    FROM room_players
    WHERE connection_version < 0
       OR hand_version < 0
       OR hand_round_number <= 0
  `);

  const multipleActivePlayers = await pool.query(`
    SELECT room_id, COUNT(*)::int AS active_players
    FROM room_players
    WHERE connected=true AND turn_state='active'
    GROUP BY room_id
    HAVING COUNT(*) > 1
    ORDER BY room_id
  `);

  const invalidSolveWindows = await pool.query(`
    SELECT COUNT(*)::int AS invalid_solve_windows
    FROM game_rooms
    WHERE (solve_window_ends_at IS NOT NULL AND solved_at IS NULL)
       OR (solve_window_ends_at IS NOT NULL AND solved_at IS NOT NULL AND solve_window_ends_at < solved_at)
  `);

  const advisoryLocks = await pool.query(`
    SELECT pid, locktype, mode, granted
    FROM pg_locks
    WHERE locktype='advisory'
    ORDER BY pid, mode
  `);

  return {
    identity: identity.rows,
    tables: tables.rows,
    columns: columns.rows,
    constraints: constraints.rows,
    indexes: indexes.rows,
    triggers: triggers.rows,
    functions: functions.rows,
    ledgerExists: ledgerExists.rows,
    ledger: ledger.rows,
    counts: counts.rows,
    invalidPlayerVersions: invalidPlayerVersions.rows,
    multipleActivePlayers: multipleActivePlayers.rows,
    invalidSolveWindows: invalidSolveWindows.rows,
    advisoryLocks: advisoryLocks.rows
  };
}
