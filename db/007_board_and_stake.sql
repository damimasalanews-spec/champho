BEGIN;

-- 007: Classic mode is played by throwing cards onto the board.
--
-- Until now a room held a target word the house drew for, and players spelled it
-- from a hand of fourteen letters. The round is now a pile of thrown cards:
-- every seat is dealt seven letters that spell one real seven-letter word, the
-- table plays in a direction, and the first seat to empty its hand wins the
-- pot. See server/round.ts for the rules these columns record.

ALTER TABLE public.game_rooms
  ADD COLUMN IF NOT EXISTS board          JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS draw_pile      JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS named_color    TEXT,
  ADD COLUMN IF NOT EXISTS direction      SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS drawn_card_id  TEXT,
  ADD COLUMN IF NOT EXISTS buy_in         INTEGER NOT NULL DEFAULT 500,
  ADD COLUMN IF NOT EXISTS winner_seat    SMALLINT,
  ADD COLUMN IF NOT EXISTS result         JSONB,
  -- Which seats have said UNO on their current one-card hand, in seat order.
  -- Short-lived by design: it only matters between a throw and the next seat's
  -- turn, but it has to survive a reconnect to be catchable at all.
  ADD COLUMN IF NOT EXISTS uno_said       JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.room_players
  ADD COLUMN IF NOT EXISTS word        TEXT,
  ADD COLUMN IF NOT EXISTS stake_paid  BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'game_rooms_board_array_chk'
      AND conrelid = 'public.game_rooms'::regclass
  ) THEN
    ALTER TABLE public.game_rooms
      ADD CONSTRAINT game_rooms_board_array_chk
      CHECK (jsonb_typeof(board) = 'array' AND jsonb_typeof(draw_pile) = 'array');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'game_rooms_direction_chk'
      AND conrelid = 'public.game_rooms'::regclass
  ) THEN
    -- 1 is clockwise, -1 is anticlockwise: Reverse flips it.
    ALTER TABLE public.game_rooms
      ADD CONSTRAINT game_rooms_direction_chk CHECK (direction IN (1, -1));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'game_rooms_named_color_chk'
      AND conrelid = 'public.game_rooms'::regclass
  ) THEN
    -- The colour a Wild named. Null while the top card's own colour stands.
    ALTER TABLE public.game_rooms
      ADD CONSTRAINT game_rooms_named_color_chk
      CHECK (named_color IS NULL OR named_color IN ('red','yellow','green','blue'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'game_rooms_buy_in_chk'
      AND conrelid = 'public.game_rooms'::regclass
  ) THEN
    ALTER TABLE public.game_rooms
      ADD CONSTRAINT game_rooms_buy_in_chk CHECK (buy_in > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'game_rooms_winner_seat_chk'
      AND conrelid = 'public.game_rooms'::regclass
  ) THEN
    ALTER TABLE public.game_rooms
      ADD CONSTRAINT game_rooms_winner_seat_chk CHECK (winner_seat IS NULL OR winner_seat >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'game_rooms_uno_said_array_chk'
      AND conrelid = 'public.game_rooms'::regclass
  ) THEN
    ALTER TABLE public.game_rooms
      ADD CONSTRAINT game_rooms_uno_said_array_chk CHECK (jsonb_typeof(uno_said) = 'array');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'room_players_word_chk'
      AND conrelid = 'public.room_players'::regclass
  ) THEN
    -- The word the seat's opening hand spells, held only to be revealed on the
    -- board once the round is won. Never sent to a client while it is in play.
    ALTER TABLE public.room_players
      ADD CONSTRAINT room_players_word_chk
      CHECK (word IS NULL OR word ~ '^[a-z]{7}$');
  END IF;
END $$;

-- One wallet per player, not per room: a seat buys into every table it joins.
-- A new player starts with exactly one table's stake so they can sit down.
-- Leave the coins >= 0 check in place: a seat must never go into debt.
CREATE TABLE IF NOT EXISTS public.player_wallets (
  player_id UUID PRIMARY KEY,
  coins INTEGER NOT NULL DEFAULT 500,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT player_wallets_coins_chk CHECK (coins >= 0)
);

COMMIT;
