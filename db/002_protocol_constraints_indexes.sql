BEGIN;

ALTER TABLE public.game_rooms
  ADD CONSTRAINT game_rooms_event_sequence_chk CHECK (event_sequence >= 0),
  ADD CONSTRAINT game_rooms_solve_window_pair_chk CHECK (
    (solved_at IS NULL AND solve_window_ends_at IS NULL)
    OR (solved_at IS NOT NULL AND solve_window_ends_at IS NOT NULL)
  ),
  ADD CONSTRAINT game_rooms_solve_window_order_chk CHECK (
    solved_at IS NULL OR solve_window_ends_at > solved_at
  );

ALTER TABLE public.room_players
  ADD CONSTRAINT room_players_hand_version_chk CHECK (hand_version >= 0),
  ADD CONSTRAINT room_players_hand_round_chk CHECK (hand_round_number > 0);

ALTER TABLE public.game_rooms
  ADD CONSTRAINT game_rooms_active_player_fk FOREIGN KEY (id, active_player_id)
    REFERENCES public.room_players(room_id, player_id) DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT game_rooms_first_solver_fk FOREIGN KEY (id, first_solver_id)
    REFERENCES public.room_players(room_id, player_id) DEFERRABLE INITIALLY DEFERRED;

CREATE UNIQUE INDEX IF NOT EXISTS submissions_one_accepted_per_round_idx
  ON public.submissions(room_id, player_id, round_number)
  WHERE status = 'accepted';

CREATE INDEX IF NOT EXISTS room_events_room_sequence_idx ON public.room_events(room_id, event_sequence);
CREATE INDEX IF NOT EXISTS room_events_room_created_idx ON public.room_events(room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS submissions_room_round_idx ON public.submissions(room_id, round_number, created_at DESC);
CREATE INDEX IF NOT EXISTS submissions_player_round_idx ON public.submissions(room_id, player_id, round_number, created_at DESC);
CREATE INDEX IF NOT EXISTS submissions_room_turn_idx ON public.submissions(room_id, turn_number);
CREATE INDEX IF NOT EXISTS game_rooms_expired_solve_window_idx ON public.game_rooms(solve_window_ends_at) WHERE phase = 'solve_window';
CREATE INDEX IF NOT EXISTS room_players_hand_version_idx ON public.room_players(room_id, player_id, hand_round_number, hand_version DESC);

COMMIT;
