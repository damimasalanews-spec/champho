BEGIN;

-- Migration 006: the idempotency key is an opaque client-supplied string.
--
-- `submissions.submission_id` was declared UUID back when the only caller was
-- the internal test harness, which used randomUUID(). The protocol specifies
-- `requestId` / actionId as an OPAQUE STRING, and both real callers send
-- non-UUID ids:
--
--   Classic client : "r1758441234567-1"
--   Bot engine     : "bot:<roomId>:<turnNumber>:<playerId>"
--
-- Postgres rejected the uuid cast and aborted the entire submit transaction, so
-- no successful submission could ever be recorded — for humans or bots. The
-- turn always fell through to timed_out.
--
-- `turn_actions.action_id` (migration 005) is already TEXT; this brings
-- `submissions` in line. Uniqueness semantics are unchanged.
--
-- The constraint is dropped first because it depends on the column being
-- retyped; it is recreated identically afterwards.

ALTER TABLE public.submissions
  DROP CONSTRAINT IF EXISTS submissions_unique_request;

ALTER TABLE public.submissions
  ALTER COLUMN submission_id TYPE TEXT USING submission_id::text;

ALTER TABLE public.submissions
  ADD CONSTRAINT submissions_unique_request
  UNIQUE (room_id, player_id, submission_id);

COMMIT;
