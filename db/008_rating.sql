BEGIN;

-- 008: a rating that outlives the match.
--
-- Every round until now ended with a settled pot and nothing else: the table
-- forgot you the moment the reveal closed. A rating is the smallest thing that
-- makes a match a stake in something, and it has to be written in the same
-- transaction as the pot, or a rolled-back round leaves a rating change behind.
--
-- One rating per mode. The card round and the word-grid round measure different
-- skills, and a single number would make both meaningless; the column is here
-- now so the word game can be rated without a second migration.
--
-- Bots are seated rows with is_bot set. They are deliberately NOT rated: they
-- have no history to converge and a table of them is the normal case, so their
-- only contribution is to the expected score of the humans at the table.

CREATE TABLE IF NOT EXISTS public.player_ratings (
  player_id   UUID NOT NULL,
  game_mode   TEXT NOT NULL DEFAULT 'classic',
  rating      NUMERIC(8,2) NOT NULL DEFAULT 1200,
  matches     INTEGER NOT NULL DEFAULT 0,
  wins        INTEGER NOT NULL DEFAULT 0,
  losses      INTEGER NOT NULL DEFAULT 0,
  peak_rating NUMERIC(8,2) NOT NULL DEFAULT 1200,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (player_id, game_mode),
  CONSTRAINT player_ratings_mode_chk CHECK (game_mode IN ('classic', 'gowild')),
  CONSTRAINT player_ratings_rating_chk CHECK (rating > 0 AND rating < 5000)
);

-- One row per player per settled room. The primary key IS the idempotency
-- guard: settling the same room twice collides here, and the second settlement
-- skips instead of applying the delta again. The round engine already replays a
-- duplicate action rather than applying it twice, so a rating without the same
-- protection would double-count on any retry.
CREATE TABLE IF NOT EXISTS public.rating_changes (
  room_id       UUID NOT NULL,
  player_id     UUID NOT NULL,
  game_mode     TEXT NOT NULL DEFAULT 'classic',
  rating_before NUMERIC(8,2) NOT NULL,
  rating_after  NUMERIC(8,2) NOT NULL,
  delta         NUMERIC(8,2) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (room_id, player_id)
);

CREATE INDEX IF NOT EXISTS rating_changes_player_idx
  ON public.rating_changes(player_id, created_at DESC);

COMMIT;
