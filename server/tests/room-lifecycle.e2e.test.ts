import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { WebSocket } from "ws";
import { pool } from "../db.js";

type Message = Record<string, any>;

function waitForMessage(socket: WebSocket, predicate: (message: Message) => boolean): Promise<Message> {
  return new Promise((resolve, reject) => {
    const onMessage = (raw: WebSocket.RawData) => {
      try {
        const message = JSON.parse(raw.toString()) as Message;
        if (predicate(message)) {
          cleanup();
          resolve(message);
        }
      } catch (error) {
        cleanup();
        reject(error);
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      socket.off("message", onMessage);
      socket.off("error", onError);
    };

    socket.on("message", onMessage);
    socket.on("error", onError);
  });
}

async function connect(port: number): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  await waitForMessage(socket, (message) => message.type === "server_ready");
  return socket;
}

async function startServer(port: number): Promise<ChildProcess> {
  const child = spawn(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "server/index.ts"],
    {
      cwd: process.cwd(),
      env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  const started = new Promise<void>((resolve, reject) => {
    const onOutput = (chunk: Buffer) => {
      if (chunk.toString().includes("HTTP/WebSocket server listening")) {
        cleanup();
        resolve();
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`test server exited before startup (code ${code})`));
    };
    const cleanup = () => {
      child.stdout?.off("data", onOutput);
      child.off("error", onError);
      child.off("exit", onExit);
    };

    child.stdout?.on("data", onOutput);
    child.once("error", onError);
    child.once("exit", onExit);
  });

  await started;
  return child;
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    setTimeout(resolve, 2_000).unref();
  });
}

test("two WebSocket clients create and join a room with authoritative snapshots and events", async () => {
  const port = 3100 + Math.floor(Math.random() * 1000);
  const ownerId = randomUUID();
  const guestId = randomUUID();
  let server: ChildProcess | undefined;
  let owner: WebSocket | undefined;
  let guest: WebSocket | undefined;
  let roomId: string | undefined;

  try {
    server = await startServer(port);
    owner = await connect(port);

    owner.send(JSON.stringify({ type: "create_room", playerId: ownerId }));
    const createdSnapshot = await waitForMessage(
      owner,
      (message) => message.type === "room_snapshot"
    );
    roomId = createdSnapshot.roomId;

    assert.equal(createdSnapshot.state, "waiting");
    assert.equal(createdSnapshot.phase, "waiting");
    assert.equal(createdSnapshot.roundNumber, 1);
    assert.equal(createdSnapshot.eventSequence, 1);
    assert.deepEqual(createdSnapshot.players, [
      { playerId: ownerId, seatNumber: 0, connected: true, score: 0 }
    ]);

    const createdEvent = await waitForMessage(
      owner,
      (message) => message.type === "event" && message.eventType === "room_created"
    );
    assert.equal(createdEvent.roomId, roomId);
    assert.equal(createdEvent.eventSequence, 1);
    assert.deepEqual(createdEvent.payload, { playerId: ownerId });

    guest = await connect(port);

    const ownerJoinedEventPromise = waitForMessage(
      owner,
      (message) =>
        message.type === "event" &&
        message.eventType === "player_joined" &&
        message.payload?.playerId === guestId
    );

    guest.send(
      JSON.stringify({
        type: "join_room",
        roomId,
        playerId: guestId
      })
    );

    const joinedSnapshot = await waitForMessage(
      guest,
      (message) => message.type === "room_snapshot"
    );
    const ownerJoinedEvent = await ownerJoinedEventPromise;
    const guestJoinedEvent = await waitForMessage(
      guest,
      (message) =>
        message.type === "event" &&
        message.eventType === "player_joined" &&
        message.payload?.playerId === guestId
    );

    assert.equal(joinedSnapshot.roomId, roomId);
    assert.equal(joinedSnapshot.eventSequence, 2);
    assert.deepEqual(joinedSnapshot.players, [
      { playerId: ownerId, seatNumber: 0, connected: true, score: 0 },
      { playerId: guestId, seatNumber: 1, connected: true, score: 0 }
    ]);

    for (const event of [ownerJoinedEvent, guestJoinedEvent]) {
      assert.equal(event.roomId, roomId);
      assert.equal(event.eventSequence, 2);
      assert.equal(event.roundNumber, 1);
      assert.deepEqual(event.payload, {
        playerId: guestId,
        seatNumber: 1
      });
    }

    const persisted = await pool.query(
      `SELECT event_sequence, event_type, payload
       FROM public.room_events
       WHERE room_id = $1
       ORDER BY event_sequence`,
      [roomId]
    );
    assert.deepEqual(
      persisted.rows.map((row) => ({
        sequence: Number(row.event_sequence),
        type: row.event_type,
        payload: row.payload
      })),
      [
        { sequence: 1, type: "room_created", payload: { playerId: ownerId } },
        {
          sequence: 2,
          type: "player_joined",
          payload: { playerId: guestId, seatNumber: 1 }
        }
      ]
    );
  } finally {
    if (roomId) await pool.query("DELETE FROM public.game_rooms WHERE id = $1", [roomId]);
    owner?.close();
    guest?.close();
    if (server) await stopServer(server);
  }
});


test("invalid create_room messages return protocol errors and persist nothing", async () => {
  const port = 4100 + Math.floor(Math.random() * 1000);
  const server = await startServer(port);
  const socket = await connect(port);

  try {
    const before = await pool.query(
      "SELECT (SELECT count(*) FROM public.game_rooms) AS rooms, (SELECT count(*) FROM public.room_players) AS players, (SELECT count(*) FROM public.room_events) AS events"
    );

    socket.send(JSON.stringify({ type: "create_room" }));
    const missingPlayerError = await waitForMessage(
      socket,
      (message) => message.type === "error" && message.reason === "invalid_player_id"
    );

    assert.deepEqual(missingPlayerError, {
      type: "error",
      reason: "invalid_player_id"
    });

    socket.send(JSON.stringify({ type: "create_room", playerId: "" }));
    const emptyPlayerError = await waitForMessage(
      socket,
      (message) => message.type === "error" && message.reason === "invalid_player_id"
    );

    assert.deepEqual(emptyPlayerError, {
      type: "error",
      reason: "invalid_player_id"
    });

    const after = await pool.query(
      "SELECT (SELECT count(*) FROM public.game_rooms) AS rooms, (SELECT count(*) FROM public.room_players) AS players, (SELECT count(*) FROM public.room_events) AS events"
    );

    assert.deepEqual(after.rows[0], before.rows[0]);
  } finally {
    socket.close();
    await stopServer(server);
  }
});

test("invalid join_room messages return protocol errors and persist nothing", async () => {
  const port = 5100 + Math.floor(Math.random() * 1000);
  const server = await startServer(port);
  const socket = await connect(port);

  try {
    const before = await pool.query(
      "SELECT (SELECT count(*) FROM public.game_rooms) AS rooms, (SELECT count(*) FROM public.room_players) AS players, (SELECT count(*) FROM public.room_events) AS events"
    );

    socket.send(JSON.stringify({ type: "join_room", playerId: randomUUID() }));
    const missingRoomError = await waitForMessage(
      socket,
      (message) => message.type === "error" && message.reason === "invalid_room_id"
    );

    assert.deepEqual(missingRoomError, {
      type: "error",
      reason: "invalid_room_id"
    });

    socket.send(JSON.stringify({ type: "join_room", roomId: "", playerId: randomUUID() }));
    const emptyRoomError = await waitForMessage(
      socket,
      (message) => message.type === "error" && message.reason === "invalid_room_id"
    );

    assert.deepEqual(emptyRoomError, {
      type: "error",
      reason: "invalid_room_id"
    });

    socket.send(JSON.stringify({ type: "join_room", roomId: randomUUID() }));
    const missingPlayerError = await waitForMessage(
      socket,
      (message) => message.type === "error" && message.reason === "invalid_player_id"
    );

    assert.deepEqual(missingPlayerError, {
      type: "error",
      reason: "invalid_player_id"
    });

    const after = await pool.query(
      "SELECT (SELECT count(*) FROM public.game_rooms) AS rooms, (SELECT count(*) FROM public.room_players) AS players, (SELECT count(*) FROM public.room_events) AS events"
    );

    assert.deepEqual(after.rows[0], before.rows[0]);
  } finally {
    socket.close();
    await stopServer(server);
  }
});


test("duplicate join_room requests return a protocol error without duplicate players or events", async () => {
  const port = 6100 + Math.floor(Math.random() * 1000);
  const ownerId = randomUUID();
  const guestId = randomUUID();
  const server = await startServer(port);
  const owner = await connect(port);
  const guest = await connect(port);
  let roomId: string | undefined;

  try {
    owner.send(JSON.stringify({ type: "create_room", playerId: ownerId }));
    const createdSnapshot = await waitForMessage(
      owner,
      (message) => message.type === "room_snapshot"
    );
    roomId = createdSnapshot.roomId;
    await waitForMessage(
      owner,
      (message) => message.type === "event" && message.eventType === "room_created"
    );

    guest.send(JSON.stringify({ type: "join_room", roomId, playerId: guestId }));
    const firstJoinSnapshot = await waitForMessage(
      guest,
      (message) => message.type === "room_snapshot" && message.eventSequence === 2
    );
    assert.deepEqual(firstJoinSnapshot.players, [
      { playerId: ownerId, seatNumber: 0, connected: true, score: 0 },
      { playerId: guestId, seatNumber: 1, connected: true, score: 0 }
    ]);
    await waitForMessage(
      guest,
      (message) => message.type === "event" && message.eventType === "player_joined"
    );

    guest.send(JSON.stringify({ type: "join_room", roomId, playerId: guestId }));
    const duplicateError = await waitForMessage(
      guest,
      (message) =>
        message.type === "error" &&
        message.reason === "player_already_in_room"
    );

    assert.deepEqual(duplicateError, {
      type: "error",
      reason: "player_already_in_room"
    });

    const players = await pool.query(
      `SELECT player_id, seat_number
       FROM public.room_players
       WHERE room_id = $1
       ORDER BY seat_number`,
      [roomId]
    );
    assert.equal(players.rowCount, 2);
    assert.deepEqual(
      players.rows.map((row) => ({
        playerId: row.player_id,
        seatNumber: row.seat_number
      })),
      [
        { playerId: ownerId, seatNumber: 0 },
        { playerId: guestId, seatNumber: 1 }
      ]
    );

    const events = await pool.query(
      `SELECT event_sequence, event_type, payload
       FROM public.room_events
       WHERE room_id = $1
       ORDER BY event_sequence`,
      [roomId]
    );
    assert.equal(events.rowCount, 2);
    assert.deepEqual(
      events.rows.map((row) => ({
        sequence: Number(row.event_sequence),
        type: row.event_type,
        payload: row.payload
      })),
      [
        { sequence: 1, type: "room_created", payload: { playerId: ownerId } },
        {
          sequence: 2,
          type: "player_joined",
          payload: { playerId: guestId, seatNumber: 1 }
        }
      ]
    );
  } finally {
    if (roomId) await pool.query("DELETE FROM public.game_rooms WHERE id = $1", [roomId]);
    owner.close();
    guest.close();
    await stopServer(server);
  }
});


test("join_room with an unknown room returns a protocol error without persisting players or events", async () => {
  const port = 7100 + Math.floor(Math.random() * 1000);
  const playerId = randomUUID();
  const unknownRoomId = randomUUID();
  const server = await startServer(port);
  const socket = await connect(port);

  try {
    const before = await pool.query(
      `SELECT
         (SELECT count(*) FROM public.room_players) AS players,
         (SELECT count(*) FROM public.room_events) AS events`
    );

    socket.send(
      JSON.stringify({
        type: "join_room",
        roomId: unknownRoomId,
        playerId
      })
    );

    const error = await waitForMessage(
      socket,
      (message) =>
        message.type === "error" &&
        message.reason === "room_not_found"
    );

    assert.deepEqual(error, {
      type: "error",
      reason: "room_not_found"
    });

    const after = await pool.query(
      `SELECT
         (SELECT count(*) FROM public.room_players) AS players,
         (SELECT count(*) FROM public.room_events) AS events`
    );

    assert.deepEqual(after.rows[0], before.rows[0]);

    const roomPlayers = await pool.query(
      `SELECT count(*) AS count
       FROM public.room_players
       WHERE player_id = $1`,
      [playerId]
    );
    assert.equal(Number(roomPlayers.rows[0].count), 0);

    const roomEvents = await pool.query(
      `SELECT count(*) AS count
       FROM public.room_events
       WHERE room_id = $1
          OR payload->>'playerId' = $2`,
      [unknownRoomId, playerId]
    );
    assert.equal(Number(roomEvents.rows[0].count), 0);
  } finally {
    socket.close();
    await stopServer(server);
  }
});


test("join_room with an invalid or unauthorized player identity returns a protocol error without persisting state", async () => {
  const port = 7200 + Math.floor(Math.random() * 1000);
  const ownerId = randomUUID();
  const unauthorizedPlayerId = randomUUID();
  const server = await startServer(port);
  const owner = await connect(port);
  const unauthorized = await connect(port);
  let roomId: string | undefined;

  try {
    owner.send(JSON.stringify({ type: "create_room", playerId: ownerId }));
    const createdSnapshot = await waitForMessage(
      owner,
      (message) => message.type === "room_snapshot"
    );
    roomId = createdSnapshot.roomId;
    await waitForMessage(
      owner,
      (message) => message.type === "event" && message.eventType === "room_created"
    );

    const before = await pool.query(
      `SELECT
         (SELECT count(*) FROM public.room_players) AS players,
         (SELECT count(*) FROM public.room_events) AS events`
    );

    unauthorized.send(
      JSON.stringify({
        type: "join_room",
        roomId,
        playerId: unauthorizedPlayerId
      })
    );

    const error = await waitForMessage(
      unauthorized,
      (message) =>
        message.type === "error" &&
        (message.reason === "unauthorized_player" ||
          message.reason === "invalid_player_identity")
    );

    assert.ok(
      error.reason === "unauthorized_player" ||
      error.reason === "invalid_player_identity"
    );

    const after = await pool.query(
      `SELECT
         (SELECT count(*) FROM public.room_players) AS players,
         (SELECT count(*) FROM public.room_events) AS events`
    );

    assert.deepEqual(after.rows[0], before.rows[0]);

    const player = await pool.query(
      `SELECT count(*) AS count
       FROM public.room_players
       WHERE room_id = $1
         AND player_id = $2`,
      [roomId, unauthorizedPlayerId]
    );
    assert.equal(Number(player.rows[0].count), 0);

    const events = await pool.query(
      `SELECT count(*) AS count
       FROM public.room_events
       WHERE room_id = $1
         AND event_type = 'player_joined'
         AND payload->>'playerId' = $2`,
      [roomId, unauthorizedPlayerId]
    );
    assert.equal(Number(events.rows[0].count), 0);
  } finally {
    if (roomId) await pool.query("DELETE FROM public.game_rooms WHERE id = $1", [roomId]);
    owner.close();
    unauthorized.close();
    await stopServer(server);
  }
});


test("disconnect and resume_room restore authoritative state without duplicate players or events", async () => {
  const port = 8100 + Math.floor(Math.random() * 1000);
  const ownerId = randomUUID();
  const guestId = randomUUID();
  const server = await startServer(port);
  const owner = await connect(port);
  let guest: WebSocket | undefined;
  let resumed: WebSocket | undefined;
  let roomId: string | undefined;

  try {
    owner.send(JSON.stringify({ type: "create_room", playerId: ownerId }));
    const createdSnapshot = await waitForMessage(
      owner,
      (message) => message.type === "room_snapshot"
    );
    roomId = createdSnapshot.roomId;
    await waitForMessage(
      owner,
      (message) => message.type === "event" && message.eventType === "room_created"
    );

    guest = await connect(port);
    guest.send(JSON.stringify({ type: "join_room", roomId, playerId: guestId }));
    const joinedSnapshot = await waitForMessage(
      guest,
      (message) => message.type === "room_snapshot" && message.eventSequence === 2
    );
    await waitForMessage(
      guest,
      (message) => message.type === "event" && message.eventType === "player_joined"
    );

    assert.deepEqual(joinedSnapshot.players, [
      { playerId: ownerId, seatNumber: 0, connected: true, score: 0 },
      { playerId: guestId, seatNumber: 1, connected: true, score: 0 }
    ]);

    guest.close();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 500).unref();
      const check = async () => {
        try {
          const result = await pool.query(
            `SELECT connected
             FROM public.room_players
             WHERE room_id = $1 AND player_id = $2`,
            [roomId, guestId]
          );
          if (result.rowCount === 1 && result.rows[0].connected === false) {
            clearTimeout(timer);
            resolve();
            return;
          }
          setTimeout(() => void check(), 25).unref();
        } catch (error) {
          clearTimeout(timer);
          reject(error);
        }
      };
      void check();
    });

    resumed = await connect(port);
    resumed.send(JSON.stringify({
      type: "resume_room",
      roomId,
      playerId: guestId
    }));

    const resumeStarted = await waitForMessage(
      resumed,
      (message) => message.type === "resume_started"
    );
    assert.equal(resumeStarted.roomId, roomId);

    const resumedSnapshot = await waitForMessage(
      resumed,
      (message) => message.type === "room_snapshot"
    );
    assert.equal(resumedSnapshot.roomId, roomId);
    assert.equal(resumedSnapshot.eventSequence, 2);
    assert.deepEqual(resumedSnapshot.players, [
      { playerId: ownerId, seatNumber: 0, connected: true, score: 0 },
      { playerId: guestId, seatNumber: 1, connected: true, score: 0 }
    ]);

    const resumeComplete = await waitForMessage(
      resumed,
      (message) => message.type === "resume_complete"
    );
    assert.equal(resumeComplete.roomId, roomId);
    assert.equal(resumeComplete.eventSequence, 2);

    const players = await pool.query(
      `SELECT player_id, seat_number, connected
       FROM public.room_players
       WHERE room_id = $1
       ORDER BY seat_number`,
      [roomId]
    );
    assert.equal(players.rowCount, 2);
    assert.deepEqual(
      players.rows.map((row) => ({
        playerId: row.player_id,
        seatNumber: row.seat_number,
        connected: row.connected
      })),
      [
        { playerId: ownerId, seatNumber: 0, connected: true },
        { playerId: guestId, seatNumber: 1, connected: true }
      ]
    );

    const events = await pool.query(
      `SELECT event_sequence, event_type, payload
       FROM public.room_events
       WHERE room_id = $1
       ORDER BY event_sequence`,
      [roomId]
    );
    assert.equal(events.rowCount, 2);
    assert.deepEqual(
      events.rows.map((row) => ({
        sequence: Number(row.event_sequence),
        type: row.event_type,
        payload: row.payload
      })),
      [
        { sequence: 1, type: "room_created", payload: { playerId: ownerId } },
        {
          sequence: 2,
          type: "player_joined",
          payload: { playerId: guestId, seatNumber: 1 }
        }
      ]
    );
  } finally {
    if (roomId) await pool.query("DELETE FROM public.game_rooms WHERE id = $1", [roomId]);
    owner.close();
    guest?.close();
    resumed?.close();
    await stopServer(server);
  }
});


test("resume_room with an unauthorized player returns a protocol error without changing authoritative state", async () => {
  const port = 8200 + Math.floor(Math.random() * 1000);
  const ownerId = randomUUID();
  const unauthorizedPlayerId = randomUUID();
  const server = await startServer(port);
  const owner = await connect(port);
  const unauthorized = await connect(port);
  let roomId: string | undefined;

  try {
    owner.send(JSON.stringify({ type: "create_room", playerId: ownerId }));
    const createdSnapshot = await waitForMessage(
      owner,
      (message) => message.type === "room_snapshot"
    );
    roomId = createdSnapshot.roomId;
    await waitForMessage(
      owner,
      (message) => message.type === "event" && message.eventType === "room_created"
    );

    const before = await pool.query(
      `SELECT
         (SELECT count(*) FROM public.room_players) AS players,
         (SELECT count(*) FROM public.room_events) AS events,
         (SELECT connected FROM public.room_players
          WHERE room_id = $1 AND player_id = $2) AS owner_connected,
         (SELECT event_sequence FROM public.game_rooms
          WHERE id = $1) AS event_sequence`,
      [roomId, ownerId]
    );

    unauthorized.send(
      JSON.stringify({
        type: "resume_room",
        roomId,
        playerId: unauthorizedPlayerId
      })
    );

    const error = await waitForMessage(
      unauthorized,
      (message) =>
        message.type === "error" &&
        message.reason === "player_not_in_room"
    );

    assert.deepEqual(error, {
      type: "error",
      reason: "player_not_in_room"
    });

    const after = await pool.query(
      `SELECT
         (SELECT count(*) FROM public.room_players) AS players,
         (SELECT count(*) FROM public.room_events) AS events,
         (SELECT connected FROM public.room_players
          WHERE room_id = $1 AND player_id = $2) AS owner_connected,
         (SELECT event_sequence FROM public.game_rooms
          WHERE id = $1) AS event_sequence`,
      [roomId, ownerId]
    );

    assert.deepEqual(after.rows[0], before.rows[0]);

    const unauthorizedPlayer = await pool.query(
      `SELECT count(*) AS count
       FROM public.room_players
       WHERE room_id = $1 AND player_id = $2`,
      [roomId, unauthorizedPlayerId]
    );
    assert.equal(Number(unauthorizedPlayer.rows[0].count), 0);

    const unauthorizedEvents = await pool.query(
      `SELECT count(*) AS count
       FROM public.room_events
       WHERE room_id = $1
         AND event_type = 'player_joined'
         AND payload->>'playerId' = $2`,
      [roomId, unauthorizedPlayerId]
    );
    assert.equal(Number(unauthorizedEvents.rows[0].count), 0);

  } finally {
    if (roomId) await pool.query("DELETE FROM public.game_rooms WHERE id = $1", [roomId]);
    owner.close();
    unauthorized.close();
    await stopServer(server);
  }
});
