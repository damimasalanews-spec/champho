# CHAMP WORD reconnect and resync

Client states: DISCONNECTED -> CONNECTING -> AUTHENTICATING -> RESUMING -> SYNCHRONIZING -> LIVE.

Submission controls are disabled until LIVE.

## Resume

The client sends its last room cursor and handVersion. The server returns resume_started, replays retained events when possible, otherwise sends room_snapshot, then private hand_sync, then resume_complete.

## Event gaps

If incoming eventSequence > local + 1, do not apply it. Enter RESYNC_REQUIRED and send request_resync.

## Round transitions

roundNumber is evaluated before event or hand version. A newer round replaces old-round state. An old-round event cannot reopen a previous round.

## Solve-window reconnect

solveWindowEndsAt is absolute server time. Reconnect does not restart the window: a round
runs for ROUND_WINDOW_MS (12s), shortened to POST_SOLVE_REVEAL_MS (1.2s) once somebody has
answered correctly. If expired, the room is round_end and THROW remains disabled.

## Dropped submission response

If processing never happened, retry the same requestId after resume. If processing happened but the response was lost, the same requestId returns the stored duplicate result. Never create a new requestId for a network retry.
