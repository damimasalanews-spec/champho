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
      child.once("error", onError);
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

    await waitForMessage(owner, (message) => message.type === "server_ready");

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
    await waitForMessage(guest, (message) => message.type === "server_ready");

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
