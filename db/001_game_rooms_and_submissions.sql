BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.game_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state TEXT NOT NULL DEFAULT 'waiting',
  phase TEXT NOT NULL DEFAULT 'waiting',
  round_number INTEGER NOT NULL DEFAULT 1,
  turn_number BIGINT NOT NULL DEFAULT 0,
  active_player_id UUID,
  event_sequence BIGINT NOT NULL DEFAULT 0,
  first_solver_id UUID,
  solved_at TIMESTAMPTZ,
  solve_window_ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT game_rooms_state_chk CHECK (state IN ('waiting','active','finished')),
  CONSTRAINT game_rooms_phase_chk CHECK (phase IN ('waiting','playing','solve_window','round_end','finished')),
  CONSTRAINT game_rooms_round_chk CHECK (round_number > 0),
  CONSTRAINT game_rooms_turn_chk CHECK (turn_number >= 0),
  CONSTRAINT game_rooms_event_sequence_chk CHECK (event_sequence >= 0),
  CONSTRAINT game_rooms_solve_window_pair_chk CHECK (
    (solved_at IS NULL AND solve_window_ends_at IS NULL)
    OR (solved_at IS NOT NULL AND solve_window_ends_at IS NOT NULL)
  ),
  CONSTRAINT game_rooms_solve_window_order_chk CHECK (
    solved_at IS NULL OR solve_window_ends_at > solved_at
  )
);

CREATE TABLE IF NOT EXISTS public.room_players (
  room_id UUID NOT NULL,
  player_id UUID NOT NULL,
  seat_number SMALLINT NOT NULL,
  connected BOOLEAN NOT NULL DEFAULT true,
  turn_state TEXT NOT NULL DEFAULT 'waiting',
  score INTEGER NOT NULL DEFAULT 0,
  private_hand JSONB NOT NULL DEFAULT '[]'::jsonb,
  hand_version BIGINT NOT NULL DEFAULT 0,
  hand_round_number INTEGER NOT NULL DEFAULT 1,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, player_id),
  CONSTRAINT room_players_room_fk FOREIGN KEY (room_id) REFERENCES public.game_rooms(id) ON DELETE CASCADE,
  CONSTRAINT room_players_seat_chk CHECK (seat_number >= 0),
  CONSTRAINT room_players_turn_state_chk CHECK (turn_state IN ('waiting','active','complete')),
  CONSTRAINT room_players_score_chk CHECK (score >= 0),
  CONSTRAINT room_players_hand_array_chk CHECK (jsonb_typeof(private_hand) = 'array'),
  CONSTRAINT room_players_hand_version_chk CHECK (hand_version >= 0),
  CONSTRAINT room_players_hand_round_chk CHECK (hand_round_number > 0),
  CONSTRAINT room_players_seat_unique UNIQUE (room_id, seat_number)
);

CREATE TABLE IF NOT EXISTS public.room_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id UUID NOT NULL,
  event_sequence BIGINT NOT NULL,
  round_number INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT room_events_room_fk FOREIGN KEY (room_id) REFERENCES public.game_rooms(id) ON DELETE CASCADE,
  CONSTRAINT room_events_sequence_chk CHECK (event_sequence >= 1),
  CONSTRAINT room_events_round_chk CHECK (round_number > 0),
  CONSTRAINT room_events_type_chk CHECK (length(trim(event_type)) > 0),
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
  CONSTRAINT submissions_reason_chk CHECK (length(trim(reason)) > 0),
  CONSTRAINT submissions_result_object_chk CHECK (jsonb_typeof(result) = 'object'),
  CONSTRAINT submissions_unique_request UNIQUE (room_id, player_id, submission_id)
);

COMMIT;
