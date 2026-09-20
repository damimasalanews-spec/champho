import type { PoolClient } from "pg";
import { pool } from "./db.js";

const MAX_ROOM_PLAYERS = 8;

export type RoomPlayer = {
  playerId: string;
  seatNumber: number;
  connected: boolean;
  score: number;
};

export type RoomSnapshot = {
  type: "room_snapshot";
  roomId: string;
  state: "waiting" | "active" | "finished";
  phase: "waiting" | "playing" | "solve_window" | "round_end" | "finished";
  roundNumber: number;
  turnNumber: number;
  activePlayerId: string | null;
  eventSequence: number;
  players: RoomPlayer[];
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
  eventType: "room_created" | "player_joined";
  serverTime: string;
  payload: Record<string, unknown>;
};

function toSnapshot(room: Record<string, any>, players: Array<Record<string, any>>): RoomSnapshot {
  return {
    type: "room_snapshot",
    roomId: room.id,
    state: room.state,
    phase: room.phase,
    roundNumber: room.round_number,
    turnNumber: Number(room.turn_number),
    activePlayerId: room.active_player_id,
    eventSequence: Number(room.event_sequence),
    players: players.map((player) => ({
      playerId: player.player_id,
      seatNumber: player.seat_number,
      connected: player.connected,
      score: player.score
    }))
  };
}

async function readSnapshot(client: PoolClient, roomId: string): Promise<RoomSnapshot> {
  const room = await client.query(
    `SELECT id, state, phase, round_number, turn_number, active_player_id, event_sequence
     FROM public.game_rooms
     WHERE id = $1`,
    [roomId]
  );
  const players = await client.query(
    `SELECT player_id, seat_number, connected, score
     FROM public.room_players
     WHERE room_id = $1
     ORDER BY seat_number`,
    [roomId]
  );

  if (room.rowCount !== 1) throw new Error("room_not_found");
  return toSnapshot(room.rows[0], players.rows);
}

async function appendEvent(
  client: PoolClient,
  roomId: string,
  roundNumber: number,
  eventType: RoomEvent["eventType"],
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
    eventType,
    serverTime: new Date(inserted.rows[0].created_at).toISOString(),
    payload
  };
}

export async function createRoom(playerId: string): Promise<{
  snapshot: RoomSnapshot;
  events: RoomEvent[];
}> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const room = await client.query(
      `INSERT INTO public.game_rooms (state, phase)
       VALUES ('waiting', 'waiting')
       RETURNING id`
    );
    const roomId = room.rows[0].id as string;

    await client.query(
      `INSERT INTO public.room_players
       (room_id, player_id, seat_number, connected, turn_state)
       VALUES ($1, $2, 0, true, 'waiting')`,
      [roomId, playerId]
    );

    const event = await appendEvent(
      client,
      roomId,
      1,
      "room_created",
      { playerId }
    );
    const snapshot = await readSnapshot(client, roomId);
    await client.query("COMMIT");
    return { snapshot, events: [event] };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function resumeRoom(
  roomId: string,
  playerId: string
): Promise<{ snapshot: RoomSnapshot; connectionVersion: number }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const room = await client.query(
      `SELECT id
       FROM public.game_rooms
       WHERE id = $1
       FOR UPDATE`,
      [roomId]
    );
    if (room.rowCount !== 1) throw new Error("room_not_found");

    const player = await client.query(
      `SELECT player_id
       FROM public.room_players
       WHERE room_id = $1 AND player_id = $2
       FOR UPDATE`,
      [roomId, playerId]
    );
    if (player.rowCount !== 1) throw new Error("player_not_in_room");

    const resumed = await client.query(
      `UPDATE public.room_players
       SET connected = true,
           connection_version = connection_version + 1,
           updated_at = clock_timestamp()
       WHERE room_id = $1 AND player_id = $2
       RETURNING connection_version`,
      [roomId, playerId]
    );

    const snapshot = await readSnapshot(client, roomId);
    await client.query("COMMIT");
    return {
      snapshot,
      connectionVersion: Number(resumed.rows[0].connection_version)
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
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

  console.error(
    `[ws-disconnect] UPDATE start roomId=${roomId} playerId=${playerId} connectionVersion=${connectionVersion}`
  );

  const result = await pool.query(
    `UPDATE public.room_players
     SET connected = false, updated_at = clock_timestamp()
     WHERE room_id = $1
       AND player_id = $2
       AND connection_version = $3`,
    [roomId, playerId, connectionVersion]
  );

  const rowCount = result.rowCount ?? 0;
  console.error(
    `[ws-disconnect] UPDATE complete roomId=${roomId} playerId=${playerId} connectionVersion=${connectionVersion} matchedRowCount=${rowCount}`
  );
  hooks.afterDisconnectUpdate?.(rowCount);
  return rowCount;
}

export async function joinRoom(
  roomId: string,
  playerId: string
): Promise<{ snapshot: RoomSnapshot; events: RoomEvent[] }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const room = await client.query(
      `SELECT id, state, phase, round_number
       FROM public.game_rooms
       WHERE id = $1
       FOR UPDATE`,
      [roomId]
    );
    if (room.rowCount !== 1) throw new Error("room_not_found");
    if (room.rows[0].state !== "waiting") throw new Error("room_not_joinable");

    const playerCount = await client.query(
      `SELECT count(*) AS count
       FROM public.room_players
       WHERE room_id = $1`,
      [roomId]
    );
    if (Number(playerCount.rows[0].count) >= MAX_ROOM_PLAYERS) {
      throw new Error("room_full");
    }

    const existing = await client.query(
      `SELECT player_id FROM public.room_players
       WHERE room_id = $1 AND player_id = $2`,
      [roomId, playerId]
    );
    if (existing.rowCount) throw new Error("player_already_in_room");

    const seat = await client.query(
      `SELECT COALESCE(MAX(seat_number) + 1, 0) AS next_seat
       FROM public.room_players
       WHERE room_id = $1`,
      [roomId]
    );
    const seatNumber = Number(seat.rows[0].next_seat);

    await client.query(
      `INSERT INTO public.room_players
       (room_id, player_id, seat_number, connected, turn_state)
       VALUES ($1, $2, $3, true, 'waiting')`,
      [roomId, playerId, seatNumber]
    );

    const event = await appendEvent(
      client,
      roomId,
      Number(room.rows[0].round_number),
      "player_joined",
      { playerId, seatNumber }
    );
    const snapshot = await readSnapshot(client, roomId);
    await client.query("COMMIT");
    return { snapshot, events: [event] };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
