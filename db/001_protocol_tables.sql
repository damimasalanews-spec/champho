BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.game_rooms
  ADD COLUMN IF NOT EXISTS event_sequence BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_solver_id UUID,
  ADD COLUMN IF NOT EXISTS solved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS solve_window_ends_at TIMESTAMPTZ;

ALTER TABLE public.room_players
  ADD COLUMN IF NOT EXISTS hand_version BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hand_round_number INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS public.room_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id UUID NOT NULL REFERENCES public.game_rooms(id) ON DELETE CASCADE,
  event_sequence BIGINT NOT NULL,
  round_number INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT room_events_sequence_chk CHECK (event_sequence >= 1),
  CONSTRAINT room_events_round_chk CHECK (round_number > 0),
  CONSTRAINT room_events_payload_object_chk CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT room_events_unique_sequence UNIQUE (room_id, event_sequence)
);

CREATE TABLE IF NOT EXISTS public.submissions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id UUID NOT NULL,
  player_id UUID NOT NULL,
  submission_id UUID NOT NULL,
  round_number INTEGER NOT NULL,
  turn_number BIGINT NOT NULL,
  submitted_cards JSONB NOT NULL,
  submitted_word TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  processed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT submissions_room_player_fk FOREIGN KEY (room_id, player_id) REFERENCES public.room_players(room_id, player_id) ON DELETE CASCADE,
  CONSTRAINT submissions_round_chk CHECK (round_number > 0),
  CONSTRAINT submissions_turn_chk CHECK (turn_number >= 0),
  CONSTRAINT submissions_cards_array_chk CHECK (jsonb_typeof(submitted_cards) = 'array'),
  CONSTRAINT submissions_word_chk CHECK (length(trim(submitted_word)) > 0),
  CONSTRAINT submissions_request_hash_chk CHECK (request_hash ~ '^sha256:[A-Fa-f0-9]{64}$'),
  CONSTRAINT submissions_status_chk CHECK (status IN ('accepted','rejected')),
  CONSTRAINT submissions_result_object_chk CHECK (jsonb_typeof(result) = 'object'),
  CONSTRAINT submissions_unique_request UNIQUE (room_id, player_id, submission_id)
);

COMMIT;
