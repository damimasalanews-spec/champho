# CHAMP WORD PostgreSQL transaction rules

## Monotonic eventSequence

Every public-event transaction locks its room row with SELECT ... FOR UPDATE, increments event_sequence exactly once, inserts room_events using the returned value, and commits both changes together. The unique (room_id, event_sequence) constraint is the database backstop. Clients never supply event_sequence.

## Atomic handVersion

A successful submission locks the room and player rows, validates physical card IDs, consumes cards, draws replacements, updates private_hand and increments hand_version in the same transaction as the submission result and reward. A rejection does not increment hand_version.

## Solve-window expiry

Capture one server_now inside the transaction. The first correct answer in playing sets first_solver_id, solved_at, solve_window_ends_at = server_now + interval '3 seconds', and phase = solve_window. In solve_window, accept another correct answer only when server_now < solve_window_ends_at. At or after the deadline, set phase = round_end before returning the rejection. Client countdowns are never authoritative.

## Idempotent submissions

The application computes a canonical request_hash. The unique key is (room_id, player_id, submission_id). Same key plus same hash replays the stored result without mutation. Same key plus a different hash returns request_id_conflict without mutation. Accepted and permanent rejected outcomes are persisted. Broadcast only after COMMIT.

## Scope

These migrations establish persistent-state invariants. They do not create a WebSocket server or execute game logic.
