# CHAMP WORD — Authoritative Protocol v2 (frozen contract)

This is the interface contract between the authoritative server and the Classic client.
Both halves of the redesign implement exactly this. Frozen before implementation.

Transport: `ws(s)://<same-origin>/` — the server serves the client and the socket from one
origin so the client never has to know a second hostname.

Every client→server message carries a unique `requestId` (idempotency key, §25).
`actionId` is accepted as an alias and treated as the same thing.

---

## 1. Identity

Identity is issued by the server, never asserted by the client (§21 `invalid_identity`).

```
C→S  hello            { requestId, clientVersion? }
S→C  welcome          { type:"welcome", sessionToken, serverTime, serverVersion }
```

`sessionToken` is an HMAC-signed opaque token over `playerId`, issued on first contact and
reusable on reconnect. Every later message carries it. A message whose token is missing,
malformed, or signed with the wrong key is rejected with `invalid_identity` and mutates nothing.

A client-supplied `playerId` is **metadata only** and is never used as an authority source.

---

## 2. Matchmaking (§4 — no room codes)

```
C→S  find_match       { requestId, sessionToken, displayName? }
S→C  match_found      { type:"match_found", roomId, seatNumber }
S→C  room_snapshot    { ... }
S→C  hand_sync        { ... }   (private, to this socket only)
S→C  bot_action       { ... }   (as bots fill seats)
```

The server owns the queue. It fills the room to four seats with three bot personalities
(§16). Room ids remain an internal implementation detail and are never shown as a code the
player must copy. The player-facing entry is a single "Play" action.

When four seats are present the server auto-starts the first turn — the client never sends
`start_round` in the normal flow.

---

## 3. Public room state

```
S→C room_snapshot {
      type: "room_snapshot",
      roomId, eventSequence,
      state:  "waiting"|"active"|"finished",
      phase:  "waiting"|"playing"|"solve_window"|"turn_end"|"round_end"|"finished",
      roundNumber, turnNumber,
      activePlayerId: string|null,      // the artist for this turn; null = the house draws
      firstSolverId:  string|null,      // immutable once set (§22)
      solvedAt: string|null,
      solveWindowEndsAt: string|null,
      turnDeadlineAt: string|null,      // server-owned turn deadline (§18)
      targetWordLength: number|null,    // public hint; the word itself is not broadcast
      players: [{ playerId, seatNumber, connected, score, isBot, displayName }],
      serverTime: string
    }
```

`players[]` never contains a hand. `hand_sync` is the only carrier of card data and is
addressed to one socket.

---

## 4. Private hand (§11)

```
S→C hand_sync { type:"hand_sync", roomId, roundNumber, handVersion, hand:[{cardId, value}] }
```

- Sent on match, after every accepted submission, and on resume.
- Always exactly 14 cards (§10) outside a terminal turn.
- Never sent to any socket other than the owning player's.
- `handVersion` increases only when the authoritative hand changes.

---

## 5. Turn lifecycle

**The house draws (changed 2026-09-22).** Every turn belongs to the game, not to a seat:
`activePlayerId` and `artistId` are **null**, no `room_players` row holds
`turn_state='active'`, and the server publishes the sketch itself. Nobody is the artist, so
nobody is excluded from solving — `activePlayerId === playerId` is not a state a client can
be in any more, and the client renders every turn as "guess the drawing". The per-word
templates the house draws from live in `server/doodles.ts`; the target word is always one
of them.

Two timings follow from that:

- `turnDeadlineAt = serverNow + ROUND_WINDOW_MS` (12s) — how long the guessers get. The
  window is theirs, so a bot's answer is paced as a *share* of it (see
  `ANSWER_WINDOW_SHARE` in `server/bots.ts`) instead of the fixed §16 milliseconds, which
  would have let a bot answer before a human had looked at the sketch.
- a correct answer is what ends the round: the first solve sets
  `solveWindowEndsAt = min(turnDeadlineAt, now + POST_SOLVE_REVEAL_MS)` (1.2s). The
  server-owned sweeper closes the turn there and **writes the next turn in the same
  transaction**, so the next round starts on its own — no client action, no waiting for the
  clock. §13's "the turn stays open so others may also answer" therefore lasts that beat.

```
S→C turn_started {
      type:"turn_started", roomId, roundNumber, turnNumber,
      artistId,                       // = activePlayerId; null — the house draws
      targetWord,                     // ONLY to the artist's socket (nobody, in this mode)
      targetWordLength,               // public
      turnDeadlineAt,                 // server clock, absolute
      solveWindowEndsAt: null         // set when the first solve lands
    }
```

The client displays `turnDeadlineAt` and never extends it.

```
C→S  submit_word { requestId, sessionToken, roomId, roundNumber, turnNumber, cards:[cardId], word }
S→C  word_submission_result {
       type, requestId, roomId, roundNumber, status:"accepted"|"rejected"|"duplicate",
       reason, serverTime, cardsConsumed, cardsDrawn, handChanged,
       handVersion?, hand?, scoreDelta, coinDelta,
       phase, originalStatus?
     }
```

Terminal states — exactly one per turn (§54):

```
S→C turn_ended {
      type:"turn_ended", roomId, roundNumber, turnNumber,
      terminalState: "solved"|"timed_out"|"no_valid_move",
      firstSolverId: string|null,
      word: string|null,              // revealed after the turn closes
      nextActivePlayerId: null,       // no seat inherits a turn; the house draws the next
      nextTurnNumber: number|null,    // the turn already written, or null when the room is done
      nextTurnDeadlineAt: string|null
    }
```

The client may treat `turn_ended` as authoritative progress; it must not advance on its own.

---

## 6. Errors (§21)

```
S→C error { type:"error", code, message, serverTime, requestId? }
```

Codes: `invalid_identity`, `invalid_message`, `unknown_message_type`, `invalid_cards`,
`invalid_phase`, `not_your_turn`, `wrong_answer`, `already_solved`,
`solve_window_expired`, `stale_turn`, `stale_hand`, `duplicate_action`,
`invalid_request_id`, `room_not_found`, `room_full`, `request_id_conflict`,
`solve_window_closed`, `bot_actions_are_server_owned`, `not_joined`.

An error never mutates state.

---

## 7. Bots (§16–19)

Bots are server-side. Their hands never leave the server.

- The server emits `bot_action` as **observability to clients**:
  `{ type:"bot_action", roomId, turnNumber, playerId, kind:"thinking"|"submit"|"no_valid_move"|"timed_out", personality, decisionMs }`
- A `bot_action` message sent **from** a client is rejected with `bot_actions_are_server_owned`.
  Bot scheduling is owned by the server, so accepting a client's bot command would hand
  authority back to the browser.

Personality timings (§16), asserts enforced by test:

| Personality | thinking | no-valid-move |
|---|---|---|
| `easy` | 1500–2700 ms | 600–1000 ms |
| `normal` | 900–2000 ms | 450–800 ms |
| `aggressive` | 350–1200 ms | 250–600 ms |

A bot with a valid move never submits after `solveWindowEndsAt`/`turnDeadlineAt` (§16, §19).

---

## 8. Chat, reactions, drawing (§34–36)

```
C→S  chat_send      { requestId, sessionToken, text }          → S→C chat_message { playerId, text, at }
C→S  reaction_send  { requestId, sessionToken, emoji }         → S→C reaction     { playerId, emoji, at }
C→S  draw_op        { requestId, sessionToken, roomId, turnNumber, strokes:[{points:[[x,y]…], color, width}] }
                                                               → S→C draw_op (relayed to other sockets)
S→C  draw_sync      { roomId, turnNumber, strokes:[…] }        (on join/resume)
```

Drawing is accepted only from the current artist's socket and only for the current
`turnNumber`; anything else is a `stale_turn` / `not_your_turn` error with no mutation.
Coordinates are normalized to 0..1 against the board so the client can scale freely.

`chat_send` and `reaction_send` are rate-limited per connection and length-capped.

---

## 9. Reconnect

```
C→S  resume_room { requestId, sessionToken, roomId, roundNumber, lastEventSequence, handVersion }
S→C  resume_started → room_snapshot → hand_sync → resume_complete
```

`reconnect` is the client's reconnect path; `disconnect` is a graceful leave:

```
C→S  disconnect { requestId, sessionToken }
```

Submission remains disabled client-side until `resume_complete`.

---

## 10. Ordering

Per room: `sequence == local + 1` → apply; `<= local` → stale/replay, ignore;
`> local + 1` → `request_resync`. For hands, compare `roundNumber` first, then `handVersion`.

---

## 11. Telemetry (§47)

The server emits one structured JSON line per transition with
`roomId, turnNumber, playerId, actionId, handVersion, event, result, ts`.
Private hand contents are never logged.
