# CHAMP WORD submission idempotency

A submission is identified by (room_id, authenticated_player_id, requestId). PostgreSQL enforces UNIQUE(room_id, player_id, submission_id).

The server computes requestHash from canonical parsed fields: roomId, authenticated playerId, roundNumber, turnNumber, ordered card IDs and normalized submitted word.

- Existing requestId + identical hash: duplicate replay.
- Existing requestId + different hash: request_id_conflict.
- A duplicate never consumes cards, draws replacements, increments handVersion, awards score/coins or allocates an event.
- Accepted and permanent rejected outcomes are persisted so lost responses can be retried safely.

The transaction locks the room, checks idempotency before mutation, persists result/hand/reward/event together, commits, then broadcasts.
