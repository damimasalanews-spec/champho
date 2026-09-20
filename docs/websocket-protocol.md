# CHAMP WORD WebSocket protocol

## Client -> server

join_room, resume_room, submit_word, request_resync.

## Server -> client

resume_started, room_snapshot, hand_sync, hand_sync_ack, word_submission_result, event, round_completed, resume_complete, error.

## Authentication

The server derives player identity from the authenticated connection/session. A client-supplied playerId is validated metadata, never an authority source.

## Ordering

For a room: sequence == local + 1 means apply; sequence <= local means stale/replay; sequence > local + 1 means RESYNC_REQUIRED.

For private hands compare roundNumber first, then handVersion. Equal is replay; lower is stale; higher replaces the authoritative hand.

## Resume

Client sends roomId, roundNumber, lastEventSequence and handVersion. Server sends resume_started, then retained events or a public snapshot, then private hand_sync, then resume_complete. Submission is disabled until resume_complete.

## Solve window

solveWindowEndsAt is an absolute server timestamp. Clients display it but never reset or extend the deadline.
