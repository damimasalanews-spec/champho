BEGIN;

CREATE INDEX IF NOT EXISTS room_players_room_idx ON public.room_players(room_id);
CREATE INDEX IF NOT EXISTS room_players_connected_idx ON public.room_players(room_id, connected);
CREATE INDEX IF NOT EXISTS room_players_hand_version_idx ON public.room_players(room_id, player_id, hand_round_number, hand_version DESC);
CREATE INDEX IF NOT EXISTS room_events_room_sequence_idx ON public.room_events(room_id, event_sequence);
CREATE INDEX IF NOT EXISTS room_events_room_created_idx ON public.room_events(room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS submissions_room_round_idx ON public.submissions(room_id, round_number, created_at DESC);
CREATE INDEX IF NOT EXISTS submissions_player_round_idx ON public.submissions(room_id, player_id, round_number, created_at DESC);
CREATE INDEX IF NOT EXISTS submissions_room_turn_idx ON public.submissions(room_id, turn_number);
CREATE INDEX IF NOT EXISTS game_rooms_expired_solve_window_idx ON public.game_rooms(solve_window_ends_at) WHERE phase = 'solve_window';
CREATE UNIQUE INDEX IF NOT EXISTS room_players_one_active_idx ON public.room_players(room_id) WHERE turn_state = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS submissions_one_accepted_per_player_round_idx ON public.submissions(room_id, player_id, round_number) WHERE status = 'accepted';

CREATE OR REPLACE FUNCTION public.prevent_first_solver_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.first_solver_id IS NOT NULL
     AND NEW.first_solver_id IS DISTINCT FROM OLD.first_solver_id THEN
    RAISE EXCEPTION 'first_solver_id is immutable once assigned' USING ERRCODE = '23514';
  END IF;
  IF OLD.solved_at IS NOT NULL
     AND NEW.solved_at IS DISTINCT FROM OLD.solved_at THEN
    RAISE EXCEPTION 'solved_at is immutable once assigned' USING ERRCODE = '23514';
  END IF;
  IF OLD.solve_window_ends_at IS NOT NULL
     AND NEW.solve_window_ends_at IS DISTINCT FROM OLD.solve_window_ends_at THEN
    RAISE EXCEPTION 'solve_window_ends_at is immutable once assigned' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS game_rooms_first_solver_immutable ON public.game_rooms;

CREATE TRIGGER game_rooms_first_solver_immutable
BEFORE UPDATE OF first_solver_id, solved_at, solve_window_ends_at
ON public.game_rooms
FOR EACH ROW
EXECUTE FUNCTION public.prevent_first_solver_change();

COMMIT;
