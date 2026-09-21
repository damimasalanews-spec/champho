import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../db.js";
import { createRoom, joinRoom } from "../rooms.js";

after(async () => {
  await pool.end();
});

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for integration tests");

async function cleanup(roomId: string): Promise<void> {
  await pool.query("DELETE FROM public.game_rooms WHERE id = $1", [roomId]);
}

test("create_room persists an authoritative snapshot and room_created event", async () => {
  const playerId = randomUUID();
  const result = await createRoom(playerId);
  try {
    assert.equal(result.snapshot.type, "room_snapshot");
    assert.equal(result.snapshot.state, "waiting");
    assert.equal(result.snapshot.phase, "waiting");
    assert.equal(result.snapshot.roundNumber, 1);
    assert.equal(result.snapshot.turnNumber, 0);
    assert.equal(result.snapshot.eventSequence, 1);
    assert.deepEqual(result.snapshot.players, [
      { playerId, seatNumber: 0, connected: true, score: 0, isBot: false, displayName: null }
    ]);

    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].eventType, "room_created");
    assert.equal(result.events[0].eventSequence, 1);
    assert.deepEqual(result.events[0].payload, { playerId });

    const dbEvent = await pool.query(
      `SELECT event_sequence, round_number, event_type, payload
       FROM public.room_events WHERE room_id = $1`,
      [result.snapshot.roomId]
    );
    assert.equal(dbEvent.rowCount, 1);
    assert.equal(Number(dbEvent.rows[0].event_sequence), 1);
    assert.equal(dbEvent.rows[0].event_type, "room_created");
    assert.deepEqual(dbEvent.rows[0].payload, { playerId });
  } finally {
    await cleanup(result.snapshot.roomId);
  }
});

test("join_room persists the new player and authoritative player_joined event", async () => {
  const ownerId = randomUUID();
  const guestId = randomUUID();
  const created = await createRoom(ownerId);
  try {
    const joined = await joinRoom(created.snapshot.roomId, guestId);

    assert.equal(joined.snapshot.type, "room_snapshot");
    assert.equal(joined.snapshot.roomId, created.snapshot.roomId);
    assert.equal(joined.snapshot.eventSequence, 2);
    assert.deepEqual(joined.snapshot.players, [
      { playerId: ownerId, seatNumber: 0, connected: true, score: 0, isBot: false, displayName: null },
      { playerId: guestId, seatNumber: 1, connected: true, score: 0, isBot: false, displayName: null }
    ]);

    assert.equal(joined.events.length, 1);
    assert.equal(joined.events[0].eventType, "player_joined");
    assert.equal(joined.events[0].eventSequence, 2);
    assert.deepEqual(joined.events[0].payload, {
      playerId: guestId,
      seatNumber: 1
    });

    const dbRows = await pool.query(
      `SELECT event_sequence, round_number, event_type, payload
       FROM public.room_events WHERE room_id = $1 ORDER BY event_sequence`,
      [created.snapshot.roomId]
    );
    assert.equal(dbRows.rowCount, 2);
    assert.deepEqual(
      dbRows.rows.map((row) => ({
        sequence: Number(row.event_sequence),
        round: row.round_number,
        type: row.event_type,
        payload: row.payload
      })),
      [
        { sequence: 1, round: 1, type: "room_created", payload: { playerId: ownerId } },
        {
          sequence: 2,
          round: 1,
          type: "player_joined",
          payload: { playerId: guestId, seatNumber: 1 }
        }
      ]
    );
  } finally {
    await cleanup(created.snapshot.roomId);
  }
});
