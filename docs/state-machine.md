# CHAMP WORD authoritative room state machine

## States and phases

Room states: waiting, active, finished.
Phases: waiting -> playing -> solve_window -> round_end -> playing, with round_end -> finished.

The server alone advances state.

## Invariants

- roundNumber never decreases and advances by exactly one for a new round.
- eventSequence is room-scoped and strictly increases for committed public events.
- handVersion changes only when the authoritative private hand changes.
- waiting: activePlayerId, firstSolverId, solvedAt, solveWindowEndsAt are null.
- playing: activePlayerId is a room member; firstSolverId, solvedAt, solveWindowEndsAt are null.
- solve_window: firstSolverId, solvedAt and solveWindowEndsAt are non-null; solveWindowEndsAt > solvedAt.
- firstSolverId, solvedAt and solveWindowEndsAt are immutable once assigned for a round.
- A solve-window submission is eligible only when serverNow < solveWindowEndsAt.

## Transaction rule

Every state-changing submission locks the room row first. Hand mutation, reward, submission result and event allocation commit together. Broadcast only after COMMIT.
