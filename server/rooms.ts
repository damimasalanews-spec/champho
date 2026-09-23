import type { PoolClient } from "pg";
import { pool } from "./db.js";
import { randomUUID } from "node:crypto";

/**
 * Hard cap enforced by the generic join_room path. Left at 8 to preserve the
 * verified room-full behaviour in room-lifecycle.e2e.test.ts.
 */
export const MAX_ROOM_PLAYERS = 8;

/** Classic is a four-seat game (YOU + three opponents). Enforced by matchmaking. */
export const CLASSIC_SEAT_COUNT = 4;

/** Letter distribution for dealt cards. Deliberately generous with vowels. */
export const LETTERS = "AAAAAAAAABBCCCDDEEEEEEEEEEEFFGGGHHHHIIIIIJKLLLLMNNNNNOOOOOOOOPPQQRRRRRSSSSSTTTTTTUUUUVVWWXYYZ";

export type BotPersonality = "easy" | "normal" | "aggressive";

export type RoomPlayer = {
  playerId: string;
  seatNumber: number;
  connected: boolean;
  score: number;
  isBot: boolean;
  displayName: string | null;
};

export type RoomSnapshot = {
  type: "room_snapshot";
  roomId: string;
  eventSequence: number;
  state: "waiting" | "active" | "finished";
  phase: "waiting" | "playing" | "solve_window" | "round_end" | "finished";
  roundNumber: number;
  turnNumber: number;
  activePlayerId: string | null;
  firstSolverId: string | null;
  solvedAt: string | null;
  solveWindowEndsAt: string | null;
  turnStartedAt: string | null;
  turnDeadlineAt: string | null;
  targetWordLength: number | null;
  players: RoomPlayer[];
  serverTime: string;
};

export type DisconnectHooks = {
  beforeDisconnectUpdate?: () => Promise<void>;
  afterDisconnectUpdate?: (rowCount: number) => void;
};

export type RoomEvent = {
  type: "event";
  eventSequence: number;
  roomId: string;
  roundNumber: number;
  eventType:
    | "room_created"
    | "player_joined"
    | "word_submitted"
    | "round_completed"
    | "turn_started"
    | "turn_ended"
    | "bot_action"
    // The card round. The old word events stay in the union while the drawing
    // game's engine is still in the tree; they go when it does.
    | "card_thrown"
    | "card_drawn"
    | "uno_called"
    | "uno_caught"
    | "round_won";
  serverTime: string;
  payload: Record<string, unknown>;
};

export type Card = { cardId: string; value: string };

export function toSnapshot(room: Record<string, any>, players: Array<Record<string, any>>): RoomSnapshot {
  return {
    type: "room_snapshot",
    roomId: room.id,
    eventSequence: Number(room.event_sequence),
    state: room.state,
    phase: room.phase,
    roundNumber: Number(room.round_number),
    turnNumber: Number(room.turn_number),
    activePlayerId: room.active_player_id,
    firstSolverId: room.first_solver_id,
    solvedAt: room.solved_at ? new Date(room.solved_at).toISOString() : null,
    solveWindowEndsAt: room.solve_window_ends_at ? new Date(room.solve_window_ends_at).toISOString() : null,
    turnStartedAt: room.turn_started_at ? new Date(room.turn_started_at).toISOString() : null,
    turnDeadlineAt: room.turn_deadline_at ? new Date(room.turn_deadline_at).toISOString() : null,
    targetWordLength:
      typeof room.target_word === "string" && room.target_word.length > 0 ? room.target_word.length : null,
    players: players.map((p) => ({
      playerId: p.player_id,
      seatNumber: Number(p.seat_number),
      connected: p.connected,
      score: Number(p.score),
      isBot: Boolean(p.is_bot),
      displayName: p.display_name ?? null
    })),
    serverTime: new Date().toISOString()
  };
}

export async function readSnapshot(client: PoolClient, roomId: string): Promise<RoomSnapshot> {
  const room = await client.query(
    `SELECT id,state,phase,round_number,turn_number,active_player_id,event_sequence,
            first_solver_id,solved_at,solve_window_ends_at,turn_started_at,turn_deadline_at,target_word
     FROM public.game_rooms WHERE id=$1`,
    [roomId]
  );
  const players = await client.query(
    `SELECT player_id,seat_number,connected,score,is_bot,display_name
     FROM public.room_players WHERE room_id=$1 ORDER BY seat_number`,
    [roomId]
  );
  if (room.rowCount !== 1) throw new Error("room_not_found");
  return toSnapshot(room.rows[0], players.rows);
}

export async function appendEvent(
  client: PoolClient,
  roomId: string,
  roundNumber: number,
  eventType: RoomEvent["eventType"],
  payload: Record<string, unknown>
): Promise<RoomEvent> {
  const next = await client.query(
    `UPDATE public.game_rooms SET event_sequence=event_sequence+1,updated_at=clock_timestamp()
     WHERE id=$1 RETURNING event_sequence`,
    [roomId]
  );
  const sequence = Number(next.rows[0].event_sequence);
  const inserted = await client.query(
    `INSERT INTO public.room_events(room_id,event_sequence,round_number,event_type,payload)
     VALUES($1,$2,$3,$4,$5::jsonb) RETURNING created_at`,
    [roomId, sequence, roundNumber, eventType, JSON.stringify(payload)]
  );
  return {
    type: "event",
    eventSequence: sequence,
    roomId,
    roundNumber,
    eventType,
    serverTime: new Date(inserted.rows[0].created_at).toISOString(),
    payload
  };
}

/** Cards are stored lower-case; the client is what renders them upper-case. */
function pickLetter(poolLetters: string[]): string {
  const index = Math.floor(Math.random() * poolLetters.length);
  return (poolLetters.splice(index, 1)[0] as string).toLowerCase();
}

export function makeHand(): Card[] {
  const poolLetters = LETTERS.split("");
  const hand: Card[] = [];
  for (let i = 0; i < 14; i += 1) {
    hand.push({ cardId: randomUUID(), value: pickLetter(poolLetters) });
  }
  return hand;
}

export function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = items[i] as T;
    const b = items[j] as T;
    items[i] = b;
    items[j] = a;
  }
  return items;
}

/**
 * A hand guaranteed to contain every letter of `word`, padded with random
 * letters up to 14 and shuffled. Without the guarantee the active player can be
 * asked to solve a word their hand cannot spell.
 */
export function makeHandContaining(word: string): Card[] {
  const poolLetters = LETTERS.split("");
  const hand: Card[] = word.split("").map((letter) => ({ cardId: randomUUID(), value: letter }));
  const consumed = new Set(word.split(""));
  for (let i = hand.length; i < 14; i += 1) {
    let value = pickLetter(poolLetters);
    // Bias the padding away from the answer so the word is not trivially
    // pre-spelled across the whole hand. Not a guarantee, just a preference.
    if (consumed.size < 20 && hand.length < 14) {
      const retryable = poolLetters.filter((candidate) => !consumed.has(candidate));
      if (retryable.length > 0) value = pickLetter(retryable);
    }
    hand.push({ cardId: randomUUID(), value });
  }
  return shuffle(hand);
}

export async function createRoom(playerId: string): Promise<{ snapshot: RoomSnapshot; events: RoomEvent[] }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const room = await client.query(`INSERT INTO public.game_rooms(state,phase) VALUES('waiting','waiting') RETURNING id`);
    const roomId = room.rows[0].id as string;
    await client.query(
      `INSERT INTO public.room_players(room_id,player_id,seat_number,connected,turn_state)
       VALUES($1,$2,0,true,'waiting')`,
      [roomId, playerId]
    );
    const event = await appendEvent(client, roomId, 1, "room_created", { playerId });
    const snapshot = await readSnapshot(client, roomId);
    await client.query("COMMIT");
    return { snapshot, events: [event] };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function joinRoom(
  roomId: string,
  playerId: string
): Promise<{ snapshot: RoomSnapshot; events: RoomEvent[] }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const room = await client.query(`SELECT id,state,phase,round_number FROM public.game_rooms WHERE id=$1 FOR UPDATE`, [roomId]);
    if (room.rowCount !== 1) throw new Error("room_not_found");
    if (room.rows[0].state !== "waiting") throw new Error("room_not_joinable");
    const count = await client.query(`SELECT count(*) AS count FROM public.room_players WHERE room_id=$1`, [roomId]);
    if (Number(count.rows[0].count) >= MAX_ROOM_PLAYERS) throw new Error("room_full");
    const existing = await client.query(`SELECT player_id FROM public.room_players WHERE room_id=$1 AND player_id=$2`, [
      roomId,
      playerId
    ]);
    if (existing.rowCount) throw new Error("player_already_in_room");
    const seat = await client.query(
      `SELECT COALESCE(MAX(seat_number)+1,0) AS next_seat FROM public.room_players WHERE room_id=$1`,
      [roomId]
    );
    const seatNumber = Number(seat.rows[0].next_seat);
    await client.query(
      `INSERT INTO public.room_players(room_id,player_id,seat_number,connected,turn_state)
       VALUES($1,$2,$3,true,'waiting')`,
      [roomId, playerId, seatNumber]
    );
    const event = await appendEvent(client, roomId, Number(room.rows[0].round_number), "player_joined", {
      playerId,
      seatNumber
    });
    const snapshot = await readSnapshot(client, roomId);
    await client.query("COMMIT");
    return { snapshot, events: [event] };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function getPrivateHand(
  roomId: string,
  playerId: string
): Promise<{ hand: Card[]; handVersion: number; roundNumber: number }> {
  const result = await pool.query(
    `SELECT private_hand,hand_version,hand_round_number FROM public.room_players WHERE room_id=$1 AND player_id=$2`,
    [roomId, playerId]
  );
  if (result.rowCount !== 1) throw new Error("player_not_in_room");
  return {
    hand: Array.isArray(result.rows[0].private_hand) ? (result.rows[0].private_hand as Card[]) : [],
    handVersion: Number(result.rows[0].hand_version),
    roundNumber: Number(result.rows[0].hand_round_number)
  };
}

export async function resumeRoom(
  roomId: string,
  playerId: string
): Promise<{ snapshot: RoomSnapshot; connectionVersion: number; handVersion: number }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const room = await client.query(`SELECT id FROM public.game_rooms WHERE id=$1 FOR UPDATE`, [roomId]);
    if (room.rowCount !== 1) throw new Error("room_not_found");
    const player = await client.query(
      `SELECT player_id,hand_version FROM public.room_players WHERE room_id=$1 AND player_id=$2 FOR UPDATE`,
      [roomId, playerId]
    );
    if (player.rowCount !== 1) throw new Error("player_not_in_room");
    const resumed = await client.query(
      `UPDATE public.room_players SET connected=true,connection_version=connection_version+1,updated_at=clock_timestamp()
       WHERE room_id=$1 AND player_id=$2 RETURNING connection_version,hand_version`,
      [roomId, playerId]
    );
    const snapshot = await readSnapshot(client, roomId);
    await client.query("COMMIT");
    return {
      snapshot,
      connectionVersion: Number(resumed.rows[0].connection_version),
      handVersion: Number(resumed.rows[0].hand_version)
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function markPlayerDisconnected(
  roomId: string,
  playerId: string,
  connectionVersion: number,
  hooks: DisconnectHooks = {}
): Promise<number> {
  await hooks.beforeDisconnectUpdate?.();
  const result = await pool.query(
    `UPDATE public.room_players SET connected=false,updated_at=clock_timestamp()
     WHERE room_id=$1 AND player_id=$2 AND connection_version=$3`,
    [roomId, playerId, connectionVersion]
  );
  const rowCount = result.rowCount ?? 0;
  hooks.afterDisconnectUpdate?.(rowCount);
  return rowCount;
}
