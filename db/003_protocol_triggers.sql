BEGIN;

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
