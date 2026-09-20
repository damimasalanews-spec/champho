BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'game_rooms_active_player_fk'
      AND conrelid = 'public.game_rooms'::regclass
  ) THEN
    ALTER TABLE public.game_rooms
      ADD CONSTRAINT game_rooms_active_player_fk
      FOREIGN KEY (id, active_player_id)
      REFERENCES public.room_players(room_id, player_id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'game_rooms_first_solver_fk'
      AND conrelid = 'public.game_rooms'::regclass
  ) THEN
    ALTER TABLE public.game_rooms
      ADD CONSTRAINT game_rooms_first_solver_fk
      FOREIGN KEY (id, first_solver_id)
      REFERENCES public.room_players(room_id, player_id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'game_rooms_phase_state_chk'
      AND conrelid = 'public.game_rooms'::regclass
  ) THEN
    ALTER TABLE public.game_rooms
      ADD CONSTRAINT game_rooms_phase_state_chk
      CHECK (
        (state = 'waiting' AND phase = 'waiting')
        OR (state = 'active' AND phase IN ('playing','solve_window','round_end'))
        OR (state = 'finished' AND phase = 'finished')
      );
  END IF;
END $$;

COMMIT;
