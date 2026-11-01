-- Verify the rating ladder after ONE real round.
--
-- Run these against the database the game uses, in this order. Each check is
-- written so that a correct ladder returns the stated result; anything else is
-- a defect, not a judgement call.

-- ---------------------------------------------------------------------------
-- 1. What actually happened in the newest settled room.
--    Expect: one row per HUMAN seat, none for bots.
--    Read the delta: with three bots at 1200 a first-match human should see
--    about +32 for a win and -32 for a loss (K=64, provisional).
-- ---------------------------------------------------------------------------
SELECT rp.seat_number,
       rp.is_bot,
       rc.player_id,
       rc.rating_before,
       rc.delta,
       rc.rating_after,
       rc.game_mode
  FROM public.rating_changes rc
  JOIN public.room_players rp
    ON rp.room_id = rc.room_id
   AND rp.player_id = rc.player_id
 WHERE rc.room_id = (
         SELECT room_id
           FROM public.rating_changes
          ORDER BY created_at DESC
          LIMIT 1
       )
 ORDER BY rp.seat_number;

-- ---------------------------------------------------------------------------
-- 2. No bot may hold a rating. Expect: 0 rows.
-- ---------------------------------------------------------------------------
SELECT rc.room_id, rc.player_id
  FROM public.rating_changes rc
  JOIN public.room_players rp
    ON rp.room_id = rc.room_id
   AND rp.player_id = rc.player_id
 WHERE rp.is_bot;

-- ---------------------------------------------------------------------------
-- 3. Every change must be internally consistent. Expect: 0 rows.
--    (after = before + delta, and delta within the K ceiling of +/-64)
-- ---------------------------------------------------------------------------
SELECT room_id, player_id, rating_before, rating_after, delta
  FROM public.rating_changes
 WHERE ABS((rating_after - rating_before) - delta) > 0.01
    OR ABS(delta) > 64.001;

-- ---------------------------------------------------------------------------
-- 4. A player's record must agree with their change history. Expect: 0 rows.
-- ---------------------------------------------------------------------------
SELECT r.player_id,
       r.game_mode,
       r.matches,
       (SELECT count(*) FROM public.rating_changes c
         WHERE c.player_id = r.player_id AND c.game_mode = r.game_mode) AS changes,
       r.wins + r.losses AS counted,
       r.rating,
       r.peak_rating
  FROM public.player_ratings r
 WHERE r.matches <> r.wins + r.losses
    OR r.matches <> (SELECT count(*) FROM public.rating_changes c
                      WHERE c.player_id = r.player_id AND c.game_mode = r.game_mode)
    OR r.peak_rating < r.rating;

-- ---------------------------------------------------------------------------
-- 5. Idempotency — the one that matters most.
--    Settle the SAME room a second time (the scheduler re-deals after the
--    reveal, and a retried action replays), then re-run this. Expect the same
--    number as before: a settlement must never be banked twice.
--
--    Note the count first:
-- ---------------------------------------------------------------------------
SELECT count(*) AS rows_before FROM public.rating_changes;

--    ...settle / retry the room...

SELECT count(*) AS rows_after FROM public.rating_changes;
