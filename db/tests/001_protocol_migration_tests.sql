\set ON_ERROR_STOP on

BEGIN;

CREATE SCHEMA IF NOT EXISTS champword_migration_test;
SET LOCAL search_path = champword_migration_test, public;

-- The migrations are tested by reproducing their DDL in an isolated schema.
-- This keeps the test script self-contained and safe for CI/test databases.

CREATE TABLE game_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state TEXT NOT NULL DEFAULT 'waiting',
  phase TEXT NOT NULL DEFAULT 'waiting',
  round_number INTEGER NOT NULL DEFAULT 1,
  turn_number BIGINT NOT NULL DEFAULT 0,
  active_player_id UUID,
  event_sequence BIGINT NOT NULL DEFAULT 0,
  first_solver_id UUID,
  solved_at TIMESTAMPTZ,
  solve_window_ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT game_rooms_state_chk CHECK (state IN ('waiting','active','finished')),
  CONSTRAINT game_rooms_phase_chk CHECK (phase IN ('waiting','playing','solve_window','round_end','finished')),
  CONSTRAINT game_rooms_round_chk CHECK (round_number > 0),
  CONSTRAINT game_rooms_turn_chk CHECK (turn_number >= 0),
  CONSTRAINT game_rooms_event_sequence_chk CHECK (event_sequence >= 0),
  CONSTRAINT game_rooms_solve_window_pair_chk CHECK (
    (solved_at IS NULL AND solve_window_ends_at IS NULL)
    OR (solved_at IS NOT NULL AND solve_window_ends_at IS NOT NULL)
  ),
  CONSTRAINT game_rooms_solve_window_order_chk CHECK (
    solved_at IS NULL OR solve_window_ends_at > solved_at
  ),
  CONSTRAINT game_rooms_phase_state_chk CHECK (
    (state = 'waiting' AND phase = 'waiting')
    OR (state = 'active' AND phase IN ('playing','solve_window','round_end'))
    OR (state = 'finished' AND phase = 'finished')
  )
);

CREATE TABLE room_players (
  room_id UUID NOT NULL REFERENCES game_rooms(id) ON DELETE CASCADE,
  player_id UUID NOT NULL,
  seat_number SMALLINT NOT NULL,
  connected BOOLEAN NOT NULL DEFAULT true,
  turn_state TEXT NOT NULL DEFAULT 'waiting',
  score INTEGER NOT NULL DEFAULT 0,
  private_hand JSONB NOT NULL DEFAULT '[]'::jsonb,
  hand_version BIGINT NOT NULL DEFAULT 0,
  hand_round_number INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (room_id, player_id),
  CONSTRAINT room_players_seat_chk CHECK (seat_number >= 0),
  CONSTRAINT room_players_turn_state_chk CHECK (turn_state IN ('waiting','active','complete')),
  CONSTRAINT room_players_score_chk CHECK (score >= 0),
  CONSTRAINT room_players_hand_array_chk CHECK (jsonb_typeof(private_hand) = 'array'),
  CONSTRAINT room_players_hand_version_chk CHECK (hand_version >= 0),
  CONSTRAINT room_players_hand_round_chk CHECK (hand_round_number > 0),
  CONSTRAINT room_players_seat_unique UNIQUE (room_id, seat_number)
);

ALTER TABLE game_rooms
  ADD CONSTRAINT game_rooms_active_player_fk
  FOREIGN KEY (id, active_player_id)
  REFERENCES room_players(room_id, player_id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE game_rooms
  ADD CONSTRAINT game_rooms_first_solver_fk
  FOREIGN KEY (id, first_solver_id)
  REFERENCES room_players(room_id, player_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE room_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id UUID NOT NULL REFERENCES game_rooms(id) ON DELETE CASCADE,
  event_sequence BIGINT NOT NULL,
  round_number INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  CONSTRAINT room_events_sequence_chk CHECK (event_sequence >= 1),
  CONSTRAINT room_events_round_chk CHECK (round_number > 0),
  CONSTRAINT room_events_type_chk CHECK (length(trim(event_type)) > 0),
  CONSTRAINT room_events_payload_object_chk CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT room_events_unique_sequence UNIQUE (room_id, event_sequence)
);

CREATE TABLE submissions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id UUID NOT NULL,
  player_id UUID NOT NULL,
  submission_id UUID NOT NULL,
  round_number INTEGER NOT NULL,
  turn_number BIGINT NOT NULL,
  submitted_cards JSONB NOT NULL,
  submitted_word TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  result JSONB NOT NULL,
  CONSTRAINT submissions_room_player_fk
    FOREIGN KEY (room_id, player_id) REFERENCES room_players(room_id, player_id) ON DELETE CASCADE,
  CONSTRAINT submissions_round_chk CHECK (round_number > 0),
  CONSTRAINT submissions_turn_chk CHECK (turn_number >= 0),
  CONSTRAINT submissions_cards_array_chk CHECK (jsonb_typeof(submitted_cards) = 'array'),
  CONSTRAINT submissions_word_chk CHECK (length(trim(submitted_word)) > 0),
  CONSTRAINT submissions_request_hash_chk CHECK (request_hash ~ '^sha256:[A-Fa-f0-9]{64}$'),
  CONSTRAINT submissions_status_chk CHECK (status IN ('accepted','rejected')),
  CONSTRAINT submissions_reason_chk CHECK (length(trim(reason)) > 0),
  CONSTRAINT submissions_result_object_chk CHECK (jsonb_typeof(result) = 'object'),
  CONSTRAINT submissions_unique_request UNIQUE (room_id, player_id, submission_id)
);

CREATE INDEX room_players_room_idx ON room_players(room_id);
CREATE INDEX room_players_connected_idx ON room_players(room_id, connected);
CREATE INDEX room_players_hand_version_idx ON room_players(room_id, player_id, hand_round_number, hand_version DESC);
CREATE INDEX room_events_room_sequence_idx ON room_events(room_id, event_sequence);
CREATE INDEX room_events_room_created_idx ON room_events(room_id);
CREATE INDEX submissions_room_round_idx ON submissions(room_id, round_number);
CREATE INDEX submissions_player_round_idx ON submissions(room_id, player_id, round_number);
CREATE INDEX submissions_room_turn_idx ON submissions(room_id, turn_number);
CREATE INDEX game_rooms_expired_solve_window_idx ON game_rooms(solve_window_ends_at) WHERE phase = 'solve_window';
CREATE UNIQUE INDEX room_players_one_active_idx ON room_players(room_id) WHERE turn_state = 'active';
CREATE UNIQUE INDEX submissions_one_accepted_per_player_round_idx
  ON submissions(room_id, player_id, round_number) WHERE status = 'accepted';

CREATE OR REPLACE FUNCTION prevent_first_solver_change()
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

CREATE TRIGGER game_rooms_first_solver_immutable
BEFORE UPDATE OF first_solver_id, solved_at, solve_window_ends_at
ON game_rooms
FOR EACH ROW EXECUTE FUNCTION prevent_first_solver_change();

-- ---------- Helpers ----------

CREATE OR REPLACE FUNCTION assert_true(condition boolean, label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT condition THEN
    RAISE EXCEPTION 'TEST FAILED: %', label;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION expect_failure(sql_text text, label text)
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

INSERT INTO game_rooms(id, state, phase, round_number)
VALUES ('00000000-0000-0000-0000-000000000001', 'active', 'playing', 1);

INSERT INTO room_players(room_id, player_id, seat_number)
VALUES
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000101',0),
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000102',1);

-- ---------- game_rooms ----------

SELECT assert_true(
  (SELECT state='active' AND phase='playing' AND round_number=1 AND event_sequence=0
   FROM game_rooms WHERE id='00000000-0000-0000-0000-000000000001'),
  'game_rooms defaults/state'
);

SELECT expect_failure($$UPDATE game_rooms SET round_number=0
 WHERE id='00000000-0000-0000-0000-000000000001'$$, 'round_number CHECK');

SELECT expect_failure($$UPDATE game_rooms SET event_sequence=-1
 WHERE id='00000000-0000-0000-0000-000000000001'$$, 'event_sequence CHECK');

SELECT expect_failure($$UPDATE game_rooms SET solved_at=now()
 WHERE id='00000000-0000-0000-0000-000000000001'$$, 'solve-window pair CHECK');

-- ---------- active/first solver same-room FKs ----------

UPDATE game_rooms
SET active_player_id='00000000-0000-0000-0000-000000000101'
WHERE id='00000000-0000-0000-0000-000000000001';

SELECT expect_failure($$UPDATE game_rooms
 SET active_player_id='00000000-0000-0000-0000-000000000999'
 WHERE id='00000000-0000-0000-0000-000000000001'$$, 'active_player same-room FK');

-- ---------- solve-window constraints ----------

SELECT expect_failure($$UPDATE game_rooms
 SET solved_at=now(), solve_window_ends_at=now()-interval '1 second'
 WHERE id='00000000-0000-0000-0000-000000000001'$$, 'solveWindowEndsAt > solvedAt');

UPDATE game_rooms
SET first_solver_id='00000000-0000-0000-0000-000000000101',
    solved_at=clock_timestamp(),
    solve_window_ends_at=clock_timestamp()+interval '3 seconds',
    phase='solve_window'
WHERE id='00000000-0000-0000-0000-000000000001';

-- ---------- first-solver immutability ----------

SELECT expect_failure($$UPDATE game_rooms
 SET first_solver_id='00000000-0000-0000-0000-000000000102'
 WHERE id='00000000-0000-0000-0000-000000000001'$$, 'first_solver_id immutability');

SELECT expect_failure($$UPDATE game_rooms
 SET solved_at=solved_at-interval '1 second'
 WHERE id='00000000-0000-0000-0000-000000000001'$$, 'solved_at immutability');

SELECT expect_failure($$UPDATE game_rooms
 SET solve_window_ends_at=solve_window_ends_at+interval '1 second'
 WHERE id='00000000-0000-0000-0000-000000000001'$$, 'solve_window_ends_at immutability');

-- ---------- room_events / eventSequence ----------

INSERT INTO room_events(room_id,event_sequence,round_number,event_type,payload)
VALUES ('00000000-0000-0000-0000-000000000001',1,1,'player_solved','{"playerId":"00000000-0000-0000-0000-000000000101"}');

UPDATE game_rooms SET event_sequence=1
WHERE id='00000000-0000-0000-0000-000000000001';

SELECT expect_failure($$INSERT INTO room_events(room_id,event_sequence,round_number,event_type,payload)
 VALUES ('00000000-0000-0000-0000-000000000001',1,1,'duplicate','{}')$$,
 'room_events unique sequence');

SELECT expect_failure($$INSERT INTO room_events(room_id,event_sequence,round_number,event_type,payload)
 VALUES ('00000000-0000-0000-0000-000000000001',0,1,'bad','{}')$$,
 'room_events positive sequence');

-- Atomic monotonic allocation pattern.
WITH next_event AS (
  UPDATE game_rooms
  SET event_sequence = event_sequence + 1
  WHERE id='00000000-0000-0000-0000-000000000001'
  RETURNING id, event_sequence, round_number
)
INSERT INTO room_events(room_id,event_sequence,round_number,event_type,payload)
SELECT id,event_sequence,round_number,'test_event','{}'::jsonb FROM next_event;

SELECT assert_true(
  (SELECT event_sequence=2 FROM game_rooms WHERE id='00000000-0000-0000-0000-000000000001'),
  'event_sequence increments atomically'
);

-- ---------- handVersion ----------

SELECT assert_true(
  (SELECT hand_version=0 FROM room_players
   WHERE player_id='00000000-0000-0000-0000-000000000101'),
  'initial hand_version'
);

UPDATE room_players
SET private_hand='[{"cardId":"card-a","value":"A"}]'::jsonb,
    hand_version=hand_version+1
WHERE room_id='00000000-0000-0000-0000-000000000001'
  AND player_id='00000000-0000-0000-0000-000000000101';

SELECT assert_true(
  (SELECT hand_version=1 FROM room_players
   WHERE player_id='00000000-0000-0000-0000-000000000101'),
  'hand_version increments with hand mutation'
);

SELECT expect_failure($$UPDATE room_players SET hand_version=-1
 WHERE player_id='00000000-0000-0000-0000-000000000101'$$,
 'hand_version CHECK');

-- ---------- submissions ----------

INSERT INTO submissions(
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

SELECT expect_failure($$INSERT INTO submissions(
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

SELECT expect_failure($$INSERT INTO submissions(
 room_id,player_id,submission_id,round_number,turn_number,
 submitted_cards,submitted_word,request_hash,status,reason,result
) VALUES (
 '00000000-0000-0000-0000-000000000001',
 '00000000-0000-0000-0000-000000000101',
 '00000000-0000-0000-0000-000000000202',
 1,0,'["card-a"]','A',
 'bad-hash','rejected','wrong_answer','{"status":"rejected"}'
)$$, 'submission request hash format');

SELECT expect_failure($$INSERT INTO submissions(
 room_id,player_id,submission_id,round_number,turn_number,
 submitted_cards,submitted_word,request_hash,status,reason,result
) VALUES (
 '00000000-0000-0000-0000-000000000001',
 '00000000-0000-0000-0000-000000000101',
 '00000000-0000-0000-0000-000000000203',
 1,0,'["card-a"]','A',
 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
 'accepted','correct','{"status":"accepted"}'
)$$, 'second accepted submission for same player/round');

-- ---------- index presence ----------

SELECT assert_true(
  (SELECT count(*) FROM pg_indexes
   WHERE schemaname='champword_migration_test'
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
  'all protocol indexes exist'
);

ROLLBACK;

DROP SCHEMA IF EXISTS champword_migration_test CASCADE;
