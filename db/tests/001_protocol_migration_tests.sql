\set ON_ERROR_STOP on

BEGIN;

-- This test intentionally runs against the real public schema created by the
-- migrations. CI applies db/001_*.sql first, so a migration regression is
-- visible here instead of being hidden by a duplicated test DDL.

SET CONSTRAINTS game_rooms_active_player_fk, game_rooms_first_solver_fk IMMEDIATE;

-- ---------- Helpers ----------

CREATE OR REPLACE FUNCTION pg_temp.assert_true(condition boolean, label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT condition THEN
    RAISE EXCEPTION 'TEST FAILED: %', label;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.expect_failure(sql_text text, label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE sql_text;
    RAISE EXCEPTION 'TEST FAILED: % (statement unexpectedly succeeded)', label;
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'TEST FAILED:%' THEN
      RAISE;
    END IF;
  END;
END;
$$;

-- ---------- Fixtures ----------

INSERT INTO public.game_rooms(id, state, phase, round_number)
VALUES ('00000000-0000-0000-0000-000000000001', 'active', 'playing', 1);

INSERT INTO public.room_players(room_id, player_id, seat_number)
VALUES
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000101',0),
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000102',1);

-- ---------- game_rooms ----------

SELECT pg_temp.assert_true(
  (SELECT state='active' AND phase='playing' AND round_number=1 AND event_sequence=0
   FROM public.game_rooms WHERE id='00000000-0000-0000-0000-000000000001'),
  'game_rooms defaults/state'
);

SELECT pg_temp.expect_failure($$UPDATE public.game_rooms SET round_number=0
 WHERE id='00000000-0000-0000-0000-000000000001'$$, 'round_number CHECK');

SELECT pg_temp.expect_failure($$UPDATE public.game_rooms SET event_sequence=-1
 WHERE id='00000000-0000-0000-0000-000000000001'$$, 'event_sequence CHECK');

SELECT pg_temp.expect_failure($$UPDATE public.game_rooms SET solved_at=now()
 WHERE id='00000000-0000-0000-0000-000000000001'$$, 'solve-window pair CHECK');

SELECT pg_temp.expect_failure($$UPDATE public.game_rooms
 SET state='waiting', phase='playing'
 WHERE id='00000000-0000-0000-0000-000000000001'$$, 'phase/state consistency CHECK');

-- ---------- active/first solver same-room FKs ----------

UPDATE public.game_rooms
SET active_player_id='00000000-0000-0000-0000-000000000101'
WHERE id='00000000-0000-0000-0000-000000000001';

SELECT pg_temp.expect_failure($$UPDATE public.game_rooms
 SET active_player_id='00000000-0000-0000-0000-000000000999'
 WHERE id='00000000-0000-0000-0000-000000000001'$$, 'active_player same-room FK');

SELECT pg_temp.expect_failure($$UPDATE public.game_rooms
 SET first_solver_id='00000000-0000-0000-0000-000000000999'
 WHERE id='00000000-0000-0000-0000-000000000001'$$, 'first_solver same-room FK');

-- ---------- solve-window constraints ----------

SELECT pg_temp.expect_failure($$UPDATE public.game_rooms
 SET solved_at=now(), solve_window_ends_at=now()-interval '1 second'
 WHERE id='00000000-0000-0000-0000-000000000001'$$, 'solveWindowEndsAt > solvedAt');

UPDATE public.game_rooms
SET first_solver_id='00000000-0000-0000-0000-000000000101',
    solved_at=clock_timestamp(),
    solve_window_ends_at=clock_timestamp()+interval '3 seconds',
    phase='solve_window'
WHERE id='00000000-0000-0000-0000-000000000001';

-- ---------- first-solver immutability ----------

SELECT pg_temp.expect_failure($$UPDATE public.game_rooms
 SET first_solver_id='00000000-0000-0000-0000-000000000102'
 WHERE id='00000000-0000-0000-0000-000000000001'$$, 'first_solver_id immutability');

SELECT pg_temp.expect_failure($$UPDATE public.game_rooms
 SET solved_at=solved_at-interval '1 second'
 WHERE id='00000000-0000-0000-0000-000000000001'$$, 'solved_at immutability');

SELECT pg_temp.expect_failure($$UPDATE public.game_rooms
 SET solve_window_ends_at=solve_window_ends_at+interval '1 second'
 WHERE id='00000000-0000-0000-0000-000000000001'$$, 'solve_window_ends_at immutability');

-- ---------- room_events / eventSequence ----------

INSERT INTO public.room_events(room_id,event_sequence,round_number,event_type,payload)
VALUES (
 '00000000-0000-0000-0000-000000000001',
 1,1,'player_solved',
 '{"playerId":"00000000-0000-0000-0000-000000000101"}'
);

UPDATE public.game_rooms SET event_sequence=1
WHERE id='00000000-0000-0000-0000-000000000001';

SELECT pg_temp.expect_failure($$INSERT INTO public.room_events(
 room_id,event_sequence,round_number,event_type,payload
) VALUES (
 '00000000-0000-0000-0000-000000000001',1,1,'duplicate','{}'
)$$, 'room_events unique sequence');

SELECT pg_temp.expect_failure($$INSERT INTO public.room_events(
 room_id,event_sequence,round_number,event_type,payload
) VALUES (
 '00000000-0000-0000-0000-000000000001',0,1,'bad','{}'
)$$, 'room_events positive sequence');

-- Atomic monotonic allocation pattern.
WITH next_event AS (
  UPDATE public.game_rooms
  SET event_sequence = event_sequence + 1
  WHERE id='00000000-0000-0000-0000-000000000001'
  RETURNING id, event_sequence, round_number
)
INSERT INTO public.room_events(room_id,event_sequence,round_number,event_type,payload)
SELECT id,event_sequence,round_number,'test_event','{}'::jsonb FROM next_event;

SELECT pg_temp.assert_true(
  (SELECT event_sequence=2 FROM public.game_rooms
   WHERE id='00000000-0000-0000-0000-000000000001'),
  'event_sequence increments atomically'
);

-- ---------- handVersion ----------

SELECT pg_temp.assert_true(
  (SELECT hand_version=0 FROM public.room_players
   WHERE player_id='00000000-0000-0000-0000-000000000101'),
  'initial hand_version'
);

UPDATE public.room_players
SET private_hand='[{"cardId":"card-a","value":"A"}]'::jsonb,
    hand_version=hand_version+1
WHERE room_id='00000000-0000-0000-0000-000000000001'
  AND player_id='00000000-0000-0000-0000-000000000101';

SELECT pg_temp.assert_true(
  (SELECT hand_version=1 FROM public.room_players
   WHERE player_id='00000000-0000-0000-0000-000000000101'),
  'hand_version increments with hand mutation'
);

SELECT pg_temp.expect_failure($$UPDATE public.room_players SET hand_version=-1
 WHERE player_id='00000000-0000-0000-0000-000000000101'$$,
 'hand_version CHECK');

-- ---------- submissions ----------

INSERT INTO public.submissions(
 room_id,player_id,submission_id,round_number,turn_number,
 submitted_cards,submitted_word,request_hash,status,reason,result
) VALUES (
 '00000000-0000-0000-0000-000000000001',
 '00000000-0000-0000-0000-000000000101',
 '00000000-0000-0000-0000-000000000201',
 1,0,'["card-a"]','A',
 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
 'rejected','wrong_answer','{"status":"rejected"}'
);

SELECT pg_temp.expect_failure($$INSERT INTO public.submissions(
 room_id,player_id,submission_id,round_number,turn_number,
 submitted_cards,submitted_word,request_hash,status,reason,result
) VALUES (
 '00000000-0000-0000-0000-000000000001',
 '00000000-0000-0000-0000-000000000101',
 '00000000-0000-0000-0000-000000000201',
 1,0,'["card-a"]','A',
 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
 'rejected','duplicate','{"status":"rejected"}'
)$$, 'submission idempotency unique constraint');

SELECT pg_temp.expect_failure($$INSERT INTO public.submissions(
 room_id,player_id,submission_id,round_number,turn_number,
 submitted_cards,submitted_word,request_hash,status,reason,result
) VALUES (
 '00000000-0000-0000-0000-000000000001',
 '00000000-0000-0000-0000-000000000101',
 '00000000-0000-0000-0000-000000000202',
 1,0,'["card-a"]','A',
 'bad-hash','rejected','wrong_answer','{"status":"rejected"}'
)$$, 'submission request hash format');

INSERT INTO public.submissions(
 room_id,player_id,submission_id,round_number,turn_number,
 submitted_cards,submitted_word,request_hash,status,reason,result
) VALUES (
 '00000000-0000-0000-0000-000000000001',
 '00000000-0000-0000-0000-000000000101',
 '00000000-0000-0000-0000-000000000204',
 1,0,'["card-a"]','A',
 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
 'accepted','correct','{"status":"accepted"}'
);

SELECT pg_temp.expect_failure($$INSERT INTO public.submissions(
 room_id,player_id,submission_id,round_number,turn_number,
 submitted_cards,submitted_word,request_hash,status,reason,result
) VALUES (
 '00000000-0000-0000-0000-000000000001',
 '00000000-0000-0000-0000-000000000101',
 '00000000-0000-0000-0000-000000000205',
 1,0,'["card-a"]','A',
 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
 'accepted','correct','{"status":"accepted"}'
)$$, 'one accepted submission per player/round');

-- ---------- index presence on the migrated schema ----------

SELECT pg_temp.assert_true(
  (SELECT count(*) FROM pg_indexes
   WHERE schemaname='public'
     AND indexname IN (
       'room_players_room_idx',
       'room_players_connected_idx',
       'room_players_hand_version_idx',
       'room_events_room_sequence_idx',
       'room_events_room_created_idx',
       'submissions_room_round_idx',
       'submissions_player_round_idx',
       'submissions_room_turn_idx',
       'game_rooms_expired_solve_window_idx',
       'room_players_one_active_idx',
       'submissions_one_accepted_per_player_round_idx'
     )) = 11,
  'all protocol indexes exist on migrated schema'
);

ROLLBACK;
