-- 008_team_size.sql
-- 2v2 and 4v4 share one code path. The size a player picked has to survive the
-- queue, otherwise a 4v4 player is seated at whatever the oldest waiter asked
-- for, so it is recorded on the queue row and copied onto the room.

BEGIN;

ALTER TABLE public.match_queue  ADD COLUMN IF NOT EXISTS team_size int NOT NULL DEFAULT 2;
ALTER TABLE public.game_rooms  ADD COLUMN IF NOT EXISTS team_size int NOT NULL DEFAULT 2;

COMMIT;