BEGIN;

ALTER TABLE public.room_players
  ADD COLUMN IF NOT EXISTS connection_version BIGINT NOT NULL DEFAULT 0;

ALTER TABLE public.room_players
  DROP CONSTRAINT IF EXISTS room_players_connection_version_chk;

ALTER TABLE public.room_players
  ADD CONSTRAINT room_players_connection_version_chk
  CHECK (connection_version >= 0);

CREATE INDEX IF NOT EXISTS room_players_connection_version_idx
  ON public.room_players(room_id, player_id, connection_version);

COMMIT;
