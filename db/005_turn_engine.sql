BEGIN;

-- Migration 005: the authoritative turn engine.
--
-- Adds what §17/§18/§54 require and the previous schema could not express:
--   * a server-owned turn deadline (the playing-phase clock)
--   * terminal turn states: solved / timed_out / no_valid_move
--   * an idempotency ledger covering EVERY terminal transition, not just submits
--   * server-side bots and a matchmaking queue
--
-- Everything is additive and IF NOT EXISTS so a re-run is safe.

-- ---------------------------------------------------------------------------
-- game_rooms: turn clock, artist, target word
-- ---------------------------------------------------------------------------

ALTER TABLE public.game_rooms
  ADD COLUMN IF NOT EXISTS turn_started_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS turn_deadline_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS artist_id        UUID,
  ADD COLUMN IF NOT EXISTS target_word      TEXT;

-- The playing-phase deadline is a separate column on purpose: the base schema
-- requires solved_at and solve_window_ends_at to be both-null or both-set, and
-- actively forbids solve_window_ends_at during 'playing'. The turn clock needs
-- to run during 'playing', so it needs its own field.

ALTER TABLE public.game_rooms
  DROP CONSTRAINT IF EXISTS game_rooms_artist_fk;

ALTER TABLE public.game_rooms
  ADD CONSTRAINT game_rooms_artist_fk
  FOREIGN KEY (id, artist_id)
  REFERENCES public.room_players(room_id, player_id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.game_rooms
  DROP CONSTRAINT IF EXISTS game_rooms_turn_deadline_order_chk;

ALTER TABLE public.game_rooms
  ADD CONSTRAINT game_rooms_turn_deadline_order_chk
  CHECK (turn_started_at IS NULL OR turn_deadline_at IS NULL OR turn_deadline_at > turn_started_at);

-- ---------------------------------------------------------------------------
-- room_players: bots, display names, wider terminal states
-- ---------------------------------------------------------------------------

ALTER TABLE public.room_players
  ADD COLUMN IF NOT EXISTS is_bot          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bot_personality TEXT,
  ADD COLUMN IF NOT EXISTS display_name    TEXT;

-- §17 names no_valid_move and §18 names timed_out; neither was representable.
ALTER TABLE public.room_players
  DROP CONSTRAINT IF EXISTS room_players_turn_state_chk;

ALTER TABLE public.room_players
  ADD CONSTRAINT room_players_turn_state_chk
  CHECK (turn_state IN ('waiting','active','complete','solved','timed_out','no_valid_move'));

ALTER TABLE public.room_players
  DROP CONSTRAINT IF EXISTS room_players_bot_personality_chk;

ALTER TABLE public.room_players
  ADD CONSTRAINT room_players_bot_personality_chk
  CHECK (bot_personality IS NULL OR bot_personality IN ('easy','normal','aggressive'));

ALTER TABLE public.room_players
  DROP CONSTRAINT IF EXISTS room_players_bot_shape_chk;

-- A bot must declare a personality; a human must not.
ALTER TABLE public.room_players
  ADD CONSTRAINT room_players_bot_shape_chk
  CHECK ((is_bot = false AND bot_personality IS NULL) OR (is_bot = true AND bot_personality IS NOT NULL));

-- ---------------------------------------------------------------------------
-- turn_actions: idempotency ledger for every terminal transition (§25)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.turn_actions (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id     UUID   NOT NULL,
  turn_number BIGINT NOT NULL,
  action_id   TEXT   NOT NULL,
  kind        TEXT   NOT NULL,
  player_id   UUID,
  status      TEXT   NOT NULL,
  reason      TEXT   NOT NULL,
  result      JSONB  NOT NULL,
  terminal    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT turn_actions_room_fk FOREIGN KEY (room_id)
    REFERENCES public.game_rooms(id) ON DELETE CASCADE,
  CONSTRAINT turn_actions_kind_chk CHECK (kind IN ('submit','timeout','no_valid_move')),
  CONSTRAINT turn_actions_status_chk CHECK (status IN ('accepted','rejected')),
  CONSTRAINT turn_actions_terminal_chk CHECK (terminal IS NULL OR terminal IN ('solved','timed_out','no_valid_move')),
  CONSTRAINT turn_actions_result_object_chk CHECK (jsonb_typeof(result) = 'object'),
  CONSTRAINT turn_actions_unique UNIQUE (room_id, action_id)
);

-- The uniqueness that actually protects the invariant: at most ONE accepted
-- terminal transition per room+turn, no matter how many writers race (§22, §54).
CREATE UNIQUE INDEX IF NOT EXISTS turn_actions_one_terminal_per_turn_idx
  ON public.turn_actions(room_id, turn_number)
  WHERE terminal IS NOT NULL;

CREATE INDEX IF NOT EXISTS turn_actions_room_turn_idx
  ON public.turn_actions(room_id, turn_number, created_at DESC);

-- ---------------------------------------------------------------------------
-- match_queue: UNO-style entry, no room codes (§4)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.match_queue (
  player_id    UUID PRIMARY KEY,
  display_name TEXT,
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  room_id      UUID,
  CONSTRAINT match_queue_room_fk FOREIGN KEY (room_id)
    REFERENCES public.game_rooms(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS match_queue_waiting_idx
  ON public.match_queue(joined_at)
  WHERE room_id IS NULL;

-- ---------------------------------------------------------------------------
-- Index for the timeout sweeper (§18)
-- ---------------------------------------------------------------------------

-- db/003 already created game_rooms_expired_solve_window_idx for solve_window.
-- The playing-phase clock needs its own. COALESCE picks whichever deadline is
-- live for the current phase, so one index serves the single sweeper query.
CREATE INDEX IF NOT EXISTS game_rooms_pending_turn_deadline_idx
  ON public.game_rooms (COALESCE(solve_window_ends_at, turn_deadline_at))
  WHERE phase IN ('playing','solve_window');

COMMIT;
