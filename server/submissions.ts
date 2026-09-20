import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "./db.js";
import type { RoomEvent, RoomSnapshot } from "./rooms.js";

const SOLVE_WINDOW_MS = 3_000;

type SubmissionCard = { cardId: string; value: string };

export type WordSubmissionResult = {
  type: "word_submission_result";
  requestId: string;
  roomId: string;
  roundNumber: number;
  status: "accepted" | "rejected" | "duplicate";
  reason: string;
  serverTime: string;
  roundState?: "waiting" | "playing" | "solve_window" | "round_end" | "finished";
  cardsConsumed: number;
  cardsDrawn: number;
  handChanged: boolean;
  handVersion?: number;
  hand?: SubmissionCard[];
  handHash?: string;
  originalStatus?: "accepted" | "rejected";
  scoreDelta: number;
  coinDelta: number;
};

export type RoundCompleted = {
  type: "round_completed";
  roomId: string;
  roundNumber: number;
  roundState: "round_end";
  word: string;
  completedAt: string;
  solvers: Array<{ playerId: string; position: number }>;
};

export type SubmitWordInput = {
  requestId: string;
  roomId: string;
  playerId: string;
  roundNumber: number;
  turnNumber: number;
  cards: string[];
  word: string;
};

export type SubmitWordOutcome = {
  result: WordSubmissionResult;
  events: RoomEvent[];
  roundCompleted?: RoundCompleted;
  snapshot?: RoomSnapshot;
};

function canonicalHash(input: SubmitWordInput): string {
  const canonical = JSON.stringify([
    input.roomId,
    input.playerId,
    input.roundNumber,
    input.turnNumber,
    input.cards,
    input.word.trim().toLowerCase()
  ]);
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

function handHash(hand: SubmissionCard[]): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(hand)).digest("hex")}`;
}

function asHand(value: unknown): SubmissionCard[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (card): card is SubmissionCard =>
      !!card &&
      typeof card === "object" &&
      typeof (card as Record<string, unknown>).cardId === "string" &&
      typeof (card as Record<string, unknown>).value === "string"
  );
}

async function appendEvent(
  client: PoolClient,
  roomId: string,
  roundNumber: number,
  eventType: string,
  payload: Record<string, unknown>
): Promise<RoomEvent> {
  const next = await client.query(
    `UPDATE public.game_rooms
     SET event_sequence = event_sequence + 1, updated_at = clock_timestamp()
     WHERE id = $1
     RETURNING event_sequence`,
    [roomId]
  );
  const sequence = Number(next.rows[0].event_sequence);
  const inserted = await client.query(
    `INSERT INTO public.room_events
       (room_id, event_sequence, round_number, event_type, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING created_at`,
    [roomId, sequence, roundNumber, eventType, JSON.stringify(payload)]
  );
  return {
    type: "event",
    eventSequence: sequence,
    roomId,
    roundNumber,
    eventType: eventType as RoomEvent["eventType"],
    serverTime: new Date(inserted.rows[0].created_at).toISOString(),
    payload
  };
}

async function readSnapshot(client: PoolClient, roomId: string): Promise<RoomSnapshot> {
  const room = await client.query(
    `SELECT id, state, phase, round_number, turn_number, active_player_id, event_sequence,
            first_solver_id, solved_at, solve_window_ends_at
     FROM public.game_rooms WHERE id = $1`,
    [roomId]
  );
  const players = await client.query(
    `SELECT player_id, seat_number, connected, score
     FROM public.room_players WHERE room_id = $1 ORDER BY seat_number`,
    [roomId]
  );
  if (room.rowCount !== 1) throw new Error("room_not_found");
  const row = room.rows[0];
  return {
    type: "room_snapshot",
    roomId: row.id,
    eventSequence: Number(row.event_sequence),
    state: row.state,
    phase: row.phase,
    roundNumber: Number(row.round_number),
    turnNumber: Number(row.turn_number),
    activePlayerId: row.active_player_id,
    firstSolverId: row.first_solver_id,
    solvedAt: row.solved_at ? new Date(row.solved_at).toISOString() : null,
    solveWindowEndsAt: row.solve_window_ends_at ? new Date(row.solve_window_ends_at).toISOString() : null,
    serverTime: new Date().toISOString(),
    players: players.rows.map((player) => ({
      playerId: player.player_id,
      seatNumber: Number(player.seat_number),
      connected: player.connected,
      score: Number(player.score)
    }))
  };
}

function resultBase(input: SubmitWordInput, status: WordSubmissionResult["status"], reason: string): WordSubmissionResult {
  return {
    type: "word_submission_result",
    requestId: input.requestId,
    roomId: input.roomId,
    roundNumber: input.roundNumber,
    status,
    reason,
    serverTime: new Date().toISOString(),
    cardsConsumed: 0,
    cardsDrawn: 0,
    handChanged: false,
    scoreDelta: 0,
    coinDelta: 0
  };
}

async function completeExpiredRound(client: PoolClient, roomId: string, roundNumber: number): Promise<{ roundCompleted: RoundCompleted; events: RoomEvent[] }> {
  const accepted = await client.query(
    `SELECT player_id, submitted_word
     FROM public.submissions
     WHERE room_id = $1 AND round_number = $2 AND status = 'accepted'
     ORDER BY processed_at, id`,
    [roomId, roundNumber]
  );
  const solvers = accepted.rows.map((row, index) => ({
    playerId: row.player_id as string,
    position: index + 1
  }));
  const word = accepted.rows[0]?.submitted_word as string | undefined;
  if (!word) throw new Error("round_word_missing");

  const completedAt = new Date().toISOString();
  const roundCompleted: RoundCompleted = {
    type: "round_completed",
    roomId,
    roundNumber,
    roundState: "round_end",
    word,
    completedAt,
    solvers
  };

  const event = await appendEvent(client, roomId, roundNumber, "round_completed", {
    word,
    solvers
  });

  const nextRound = roundNumber + 1;
  const nextPlayer = await client.query(
    `SELECT player_id
     FROM public.room_players
     WHERE room_id = $1 AND connected = true
     ORDER BY seat_number
     LIMIT 1`,
    [roomId]
  );
  const activePlayerId = nextPlayer.rows[0]?.player_id ?? null;

  await client.query(
    `UPDATE public.game_rooms
     SET round_number = $2,
         turn_number = turn_number + 1,
         active_player_id = $3::uuid,
         phase = CASE WHEN $3::uuid IS NULL THEN 'round_end' ELSE 'playing' END,
         state = CASE WHEN $3 IS NULL THEN 'active' ELSE 'active' END,
         first_solver_id = NULL,
         solved_at = NULL,
         solve_window_ends_at = NULL,
         updated_at = clock_timestamp()
     WHERE id = $1`,
    [roomId, nextRound, activePlayerId]
  );

  return { roundCompleted, events: [event] };
}

export async function submitWord(input: SubmitWordInput): Promise<SubmitWordOutcome> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const requestHash = canonicalHash(input);
    const room = await client.query(
      `SELECT id, state, phase, round_number, turn_number, active_player_id, solve_window_ends_at
       FROM public.game_rooms WHERE id = $1 FOR UPDATE`,
      [input.roomId]
    );
    if (room.rowCount !== 1) throw new Error("room_not_found");

    const existing = await client.query(
      `SELECT status, reason, result
       FROM public.submissions
       WHERE room_id = $1 AND player_id = $2 AND submission_id = $3`,
      [input.roomId, input.playerId, input.requestId]
    );
    if (existing.rowCount === 1) {
      const stored = existing.rows[0];
      const storedHash = stored.result?.requestHash;
      if (storedHash !== requestHash) throw new Error("request_id_conflict");
      const { requestHash: _requestHash, ...storedResult } = stored.result as WordSubmissionResult & { requestHash: string };
      const duplicate: WordSubmissionResult = {
        ...storedResult,
        status: "duplicate",
        originalStatus: stored.status
      };
      await client.query("COMMIT");
      return { result: duplicate, events: [] };
    }

    const serverNow = new Date();
    const roomRow = room.rows[0];
    if (Number(roomRow.round_number) !== input.roundNumber) throw new Error("round_mismatch");
    if (Number(roomRow.turn_number) !== input.turnNumber) throw new Error("turn_mismatch");
    if (!["playing", "solve_window"].includes(roomRow.phase)) throw new Error("room_not_playing");

    const player = await client.query(
      `SELECT player_id, private_hand, hand_version, score
       FROM public.room_players
       WHERE room_id = $1 AND player_id = $2
       FOR UPDATE`,
      [input.roomId, input.playerId]
    );
    if (player.rowCount !== 1) throw new Error("player_not_in_room");

    if (roomRow.phase === "playing" && roomRow.active_player_id && roomRow.active_player_id !== input.playerId) {
      throw new Error("not_active_player");
    }

    if (roomRow.phase === "solve_window" && new Date(roomRow.solve_window_ends_at).getTime() <= serverNow.getTime()) {
      const completed = await completeExpiredRound(client, input.roomId, input.roundNumber);
      const snapshot = await readSnapshot(client, input.roomId);
      await client.query("COMMIT");
      return {
        result: {
          ...resultBase(input, "rejected", "solve_window_expired"),
          roundState: "round_end"
        },
        events: completed.events,
        roundCompleted: completed.roundCompleted,
        snapshot
      };
    }

    const hand = asHand(player.rows[0].private_hand);
    const uniqueCards = new Set(input.cards);
    if (input.cards.length === 0 || uniqueCards.size !== input.cards.length) {
      throw new Error("invalid_cards");
    }
    const selected = input.cards.map((cardId) => hand.find((card) => card.cardId === cardId));
    if (selected.some((card) => !card)) throw new Error("invalid_cards");

    const normalizedWord = input.word.trim().toLowerCase();
    const expectedWord = selected.map((card) => card!.value.trim().toLowerCase()).join("");
    if (!normalizedWord || normalizedWord !== expectedWord) {
      const rejected = resultBase(input, "rejected", "incorrect_word");
      rejected.roundState = roomRow.phase;
      await client.query(
        `INSERT INTO public.submissions
           (room_id, player_id, submission_id, round_number, turn_number, submitted_cards,
            submitted_word, request_hash, status, reason, result)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,'rejected',$9,$10::jsonb)`,
        [input.roomId, input.playerId, input.requestId, input.roundNumber, input.turnNumber,
          JSON.stringify(input.cards), input.word, requestHash, "incorrect_word",
          JSON.stringify({ ...rejected, requestHash })]
      );
      await client.query("COMMIT");
      return { result: rejected, events: [] };
    }

    const remaining = hand.filter((card) => !uniqueCards.has(card.cardId));
    const nextHandVersion = Number(player.rows[0].hand_version) + 1;
    const scoreDelta = roomRow.phase === "playing" ? 1 : 1;

    let roundState: WordSubmissionResult["roundState"] = "solve_window";
    await client.query(
      `UPDATE public.room_players
       SET private_hand = $3::jsonb,
           hand_version = $4,
           hand_round_number = $5,
           score = score + $6,
           updated_at = clock_timestamp()
       WHERE room_id = $1 AND player_id = $2`,
      [input.roomId, input.playerId, JSON.stringify(remaining), nextHandVersion, input.roundNumber, scoreDelta]
    );

    if (roomRow.phase === "playing") {
      const solveEnds = new Date(serverNow.getTime() + SOLVE_WINDOW_MS);
      await client.query(
        `UPDATE public.game_rooms
         SET first_solver_id = $2,
             solved_at = $3,
             solve_window_ends_at = $4,
             phase = 'solve_window',
             state = 'active',
             updated_at = clock_timestamp()
         WHERE id = $1`,
        [input.roomId, input.playerId, serverNow, solveEnds]
      );
    }

    const result: WordSubmissionResult = {
      ...resultBase(input, "accepted", "accepted"),
      roundState,
      cardsConsumed: input.cards.length,
      cardsDrawn: 0,
      handChanged: true,
      handVersion: nextHandVersion,
      hand: remaining,
      handHash: handHash(remaining),
      scoreDelta,
      coinDelta: 0
    };

    await client.query(
      `INSERT INTO public.submissions
         (room_id, player_id, submission_id, round_number, turn_number, submitted_cards,
          submitted_word, request_hash, status, reason, result)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,'accepted',$9,$10::jsonb)`,
      [input.roomId, input.playerId, input.requestId, input.roundNumber, input.turnNumber,
        JSON.stringify(input.cards), input.word, requestHash, "accepted",
        JSON.stringify({ ...result, requestHash })]
    );

    const event = await appendEvent(client, input.roomId, input.roundNumber, "word_submitted", {
      playerId: input.playerId,
      word: normalizedWord,
      status: "accepted",
      scoreDelta
    });

    const snapshot = await readSnapshot(client, input.roomId);
    await client.query("COMMIT");
    return { result, events: [event], snapshot };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
