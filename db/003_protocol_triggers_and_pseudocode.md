# Protocol trigger and transaction rules

## First-solver immutability

Use a BEFORE UPDATE trigger on game_rooms that rejects changes when OLD.first_solver_id, OLD.solved_at or OLD.solve_window_ends_at is already non-null. The trigger is a defense-in-depth backstop; the transaction path must also never overwrite these fields.

## Submission transaction

BEGIN
1. Authenticate player.
2. Validate schema and compute canonical requestHash.
3. SELECT game_rooms FOR UPDATE.
4. Look up (room_id, player_id, submission_id).
5. Same hash => COMMIT and replay stored result. Different hash => COMMIT and return request_id_conflict.
6. Capture one serverNow.
7. Validate round and phase.
8. SELECT room_players FOR UPDATE.
9. Check already-solved state.
10. If solve_window and serverNow >= solve_window_ends_at, transition to round_end and reject.
11. Validate physical card IDs and answer.
12. Persist permanent rejection if invalid/wrong.
13. On correct answer, consume cards, draw replacements and increment handVersion in the same transaction.
14. If phase was playing, set firstSolverId, solvedAt, solveWindowEndsAt=serverNow+3s and phase=solve_window.
15. Apply reward.
16. Increment game_rooms.event_sequence while room row remains locked.
17. Insert room_events and submissions result.
18. COMMIT.
19. Broadcast only after commit.

## Duplicate race

The room lock normally serializes same-room submissions. UNIQUE(room_id, player_id, submission_id) remains the hard database backstop. If a unique violation occurs in another concurrent path, isolate the INSERT with a SAVEPOINT, roll back to the savepoint, read the committed winning row, compare requestHash and replay or return request_id_conflict. Never apply game mutation twice.
