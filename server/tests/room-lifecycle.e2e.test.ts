import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { WebSocket } from "ws";
import { pool } from "../db.js";
import { createServerApp } from "../index.js";
import { joinRoom } from "../rooms.js";

after(async () => {
  await pool.end();
});

type Message = Record<string, any>;

function assertExactKeys(message: Message, keys: string[]): void {
  assert.deepEqual(Object.keys(message).sort(), [...keys].sort());
}

function assertTimestamp(value: unknown): void {
  assert.equal(typeof value, "string");
  assert.ok(!Number.isNaN(Date.parse(value as string)));
}

function assertResumeRoomMessage(message: Message): void {
  assertExactKeys(message, [
    "type", "requestId", "roomId", "playerId",
    "roundNumber", "lastEventSequence", "handVersion"
  ]);
  assert.equal(message.type, "resume_room");
  assert.equal(typeof message.requestId, "string");
  assert.equal(typeof message.roomId, "string");
  assert.equal(typeof message.playerId, "string");
  assert.equal(Number.isInteger(message.roundNumber), true);
  assert.ok(message.roundNumber >= 1);
  assert.equal(Number.isInteger(message.lastEventSequence), true);
  assert.ok(message.lastEventSequence >= 0);
  assert.equal(Number.isInteger(message.handVersion), true);
  assert.ok(message.handVersion >= 0);
}

function assertResumeStartedMessage(message: Message): void {
  assertExactKeys(message, ["type", "requestId", "roomId", "serverTime"]);
  assert.equal(message.type, "resume_started");
  assert.equal(typeof message.requestId, "string");
  assert.equal(typeof message.roomId, "string");
  assertTimestamp(message.serverTime);
}

function assertRoomSnapshotMessage(message: Message): void {
  assertExactKeys(message, [
    "type", "roomId", "eventSequence", "state", "phase", "roundNumber",
    "turnNumber", "activePlayerId", "firstSolverId", "solvedAt",
    "solveWindowEndsAt", "serverTime", "players"
  ]);
  assert.equal(message.type, "room_snapshot");
  assert.equal(typeof message.roomId, "string");
  assert.equal(Number.isInteger(message.eventSequence), true);
  assert.ok(message.eventSequence >= 0);
  assert.equal(typeof message.state, "string");
  assert.equal(typeof message.phase, "string");
  assert.equal(Number.isInteger(message.roundNumber), true);
  assert.ok(message.roundNumber >= 1);
  assert.equal(Number.isInteger(message.turnNumber), true);
  assert.ok(message.turnNumber >= 0);
  assert.ok(message.activePlayerId === null || typeof message.activePlayerId === "string");
  assert.ok(message.firstSolverId === null || typeof message.firstSolverId === "string");
  assert.ok(message.solvedAt === null || typeof message.solvedAt === "string");
  assert.ok(message.solveWindowEndsAt === null || typeof message.solveWindowEndsAt === "string");
  assertTimestamp(message.serverTime);
  assert.ok(Array.isArray(message.players));
}

function assertErrorMessage(message: Message, expectedCode: string, requestId?: string): void {
  const expectedKeys = ["type", "code", "message", "serverTime"];
  if (requestId !== undefined) expectedKeys.push("requestId");
  assertExactKeys(message, expectedKeys);
  assert.equal(message.type, "error");
  assert.equal(message.code, expectedCode);
  assert.equal(message.message, expectedCode);
  assertTimestamp(message.serverTime);
  if (requestId !== undefined) assert.equal(message.requestId, requestId);
}

function cleanupError(phase: string, error: unknown): Error {
  return new Error(
    `[stale disconnect cleanup] ${phase}: ${error instanceof Error ? error.message : String(error)}`
  );
}

type PendingMessageWaiter = {
  predicate: (message: Message) => boolean;
  resolve: (message: Message) => void;
  reject: (error: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
  label: string;
};

type SocketMessageState = {
  queue: Message[];
  waiters: PendingMessageWaiter[];
  onMessage: (raw: WebSocket.RawData) => void;
  onError: (error: Error) => void;
};

const socketMessageStates = new WeakMap<WebSocket, SocketMessageState>();

function getSocketMessageState(socket: WebSocket): SocketMessageState {
  const existing = socketMessageStates.get(socket);
  if (existing) return existing;

  const state = {
    queue: [],
    waiters: [],
    onMessage: () => {},
    onError: () => {}
  } as SocketMessageState;

  state.onMessage = (raw) => {
    try {
      const message = JSON.parse(raw.toString()) as Message;
      const waiterIndex = state.waiters.findIndex((waiter) => waiter.predicate(message));
      if (waiterIndex >= 0) {
        const [waiter] = state.waiters.splice(waiterIndex, 1);
        clearTimeout(waiter.timeoutHandle);
        waiter.resolve(message);
        return;
      }
      state.queue.push(message);
    } catch (error) {
      const parsedError = error instanceof Error ? error : new Error(String(error));
      const waiter = state.waiters.shift();
      if (waiter) {
        clearTimeout(waiter.timeoutHandle);
        waiter.reject(parsedError);
      }
    }
  };

  state.onError = (error) => {
    for (const waiter of state.waiters.splice(0)) {
      clearTimeout(waiter.timeoutHandle);
      waiter.reject(error);
    }
  };

  socketMessageStates.set(socket, state);
  socket.on("message", state.onMessage);
  socket.on("error", state.onError);
  return state;
}

function waitForMessage(
  socket: WebSocket,
  predicate: (message: Message) => boolean,
  timeoutMs = 5_000,
  label = "matching WebSocket message"
): Promise<Message> {
  const state = getSocketMessageState(socket);
  const queuedIndex = state.queue.findIndex(predicate);
  if (queuedIndex >= 0) {
    const [message] = state.queue.splice(queuedIndex, 1);
    return Promise.resolve(message);
  }

  return new Promise((resolve, reject) => {
    const waiter: PendingMessageWaiter = {
      predicate,
      resolve,
      reject,
      label,
      timeoutHandle: setTimeout(() => {
        const index = state.waiters.indexOf(waiter);
        if (index >= 0) state.waiters.splice(index, 1);
        reject(
          new Error(
            `[waitForMessage] timed out after ${timeoutMs}ms waiting for ${label}; queued types: ${state.queue.map((message) => message.type).join(",") || "none"}; pending waiters: ${state.waiters.length}`
          )
        );
      }, timeoutMs)
    };
    state.waiters.push(waiter);
  });
}

async function connect(port: number): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  // Install the message queue before the connection opens. The server sends
  // server_ready synchronously from its connection handler, which can race
  // the client's open event; attaching listeners only after open can lose it.
  getSocketMessageState(socket);
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
    ["node_modules/tsx/dist/cli.mjs", "server/main.ts"],
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
    child.stderr?.on("data", (chunk: Buffer) => {
      process.stdout.write(chunk);
    });
    child.once("error", onError);
    child.once("exit", onExit);
  });

  await started;
  return child;
}



function createDisconnectBarrier(timeoutMs = 2_000) {
  let blocked = false;
  let released = false;
  let completed = false;
  let timeoutCleared = false;
  let rowCount: number | undefined;

  let resolveBlocked!: () => void;
  let rejectBlocked!: (error: Error) => void;
  let resolveReleased!: () => void;
  let rejectReleased!: (error: Error) => void;
  let resolveCompleted!: (rowCount: number) => void;
  let rejectCompleted!: (error: Error) => void;

  const blockedPromise = new Promise<void>((resolve, reject) => {
    resolveBlocked = resolve;
    rejectBlocked = reject;
  });

  const releasedPromise = new Promise<void>((resolve, reject) => {
    resolveReleased = resolve;
    rejectReleased = reject;
  });

  const completedPromise = new Promise<number>((resolve, reject) => {
    resolveCompleted = resolve;
    rejectCompleted = reject;
  });

  const clearTimeoutOnce = () => {
    if (timeoutCleared) return;
    timeoutCleared = true;
    clearTimeout(timeoutHandle);
  };

  const timeoutHandle = setTimeout(() => {
    const error = new Error(
      `[disconnect barrier] timed out after ${timeoutMs}ms while waiting for the stale disconnect update to enter and complete the test barrier`
    );
    clearTimeoutOnce();
    rejectBlocked(error);
    rejectReleased(error);
    rejectCompleted(error);
  }, timeoutMs);

  return {
    async wait() {
      if (released || completed) return;
      if (blocked) {
        throw new Error(
          "[disconnect barrier] beforeDisconnectUpdate entered more than once"
        );
      }
      blocked = true;
      resolveBlocked();
      await releasedPromise;
    },

    async waitUntilBlocked() {
      if (blocked) return;
      await blockedPromise;
    },

    release() {
      if (released) return;
      released = true;
      resolveReleased();
    },

    async completed() {
      if (completed) return rowCount!;
      return completedPromise;
    },

    afterDisconnectUpdate(updatedRowCount: number) {
      if (completed) {
        throw new Error(
          "[disconnect barrier] afterDisconnectUpdate completed more than once"
        );
      }
      rowCount = updatedRowCount;
      completed = true;
      clearTimeoutOnce();
      resolveCompleted(updatedRowCount);
    }
  };
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

    assertRoomSnapshotMessage(createdSnapshot);
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
      (message) => message.type === "error" && message.code === "invalid_player_id"
    );

    assertErrorMessage(missingPlayerError, "invalid_player_id");

    socket.send(JSON.stringify({ type: "create_room", playerId: "" }));
    const emptyPlayerError = await waitForMessage(
      socket,
      (message) => message.type === "error" && message.code === "invalid_player_id"
    );

    assertErrorMessage(emptyPlayerError, "invalid_player_id");

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
      (message) => message.type === "error" && message.code === "invalid_room_id"
    );

    assertErrorMessage(missingRoomError, "invalid_room_id");

    socket.send(JSON.stringify({ type: "join_room", roomId: "", playerId: randomUUID() }));
    const emptyRoomError = await waitForMessage(
      socket,
      (message) => message.type === "error" && message.code === "invalid_room_id"
    );

    assertErrorMessage(emptyRoomError, "invalid_room_id");

    socket.send(JSON.stringify({ type: "join_room", roomId: randomUUID() }));
    const missingPlayerError = await waitForMessage(
      socket,
      (message) => message.type === "error" && message.code === "invalid_player_id"
    );

    assertErrorMessage(missingPlayerError, "invalid_player_id");

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
        message.code === "player_already_in_room"
    );

    assertErrorMessage(duplicateError, "player_already_in_room");

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
        message.code === "room_not_found"
    );

    assertErrorMessage(error, "room_not_found", "invalid-room-resume");

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


test("join_room with an invalid player identity returns a protocol error without persisting state", async () => {
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
        playerId: ""
      })
    );

    const error = await waitForMessage(
      unauthorized,
      (message) =>
        message.type === "error" &&
        message.code === "invalid_player_id"
    );

    assertErrorMessage(error, "invalid_player_id");

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
    const resumeRequest = {
      type: "resume_room",
      requestId: "guest-reconnect-resume",
      roomId,
      playerId: guestId,
      roundNumber: 1,
      lastEventSequence: 2,
      handVersion: 0
    };
    assertResumeRoomMessage(resumeRequest);
    resumed.send(JSON.stringify(resumeRequest));

    const resumeStarted = await waitForMessage(
      resumed,
      (message) => message.type === "resume_started",
      5_000,
      "resume_started after guest reconnect"
    );
    assertResumeStartedMessage(resumeStarted);
    assert.equal(resumeStarted.requestId, "guest-reconnect-resume");
    assert.equal(resumeStarted.roomId, roomId);

    const resumedSnapshot = await waitForMessage(
      resumed,
      (message) => message.type === "room_snapshot",
      5_000,
      "room_snapshot after guest reconnect"
    );
    assert.equal(resumedSnapshot.roomId, roomId);
    assert.equal(resumedSnapshot.eventSequence, 2);
    assert.deepEqual(resumedSnapshot.players, [
      { playerId: ownerId, seatNumber: 0, connected: true, score: 0 },
      { playerId: guestId, seatNumber: 1, connected: true, score: 0 }
    ]);

    const resumeComplete = await waitForMessage(
      resumed,
      (message) => message.type === "resume_complete",
      5_000,
      "resume_complete after guest reconnect"
    );
    assert.equal(resumeComplete.roomId, roomId);
    assert.equal(resumeComplete.lastEventSequence, 2);

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
        requestId: "unauthorized-resume",
        roomId,
        playerId: unauthorizedPlayerId,
        roundNumber: 1,
        lastEventSequence: 1,
        handVersion: 0
      })
    );

    const error = await waitForMessage(
      unauthorized,
      (message) =>
        message.type === "error" &&
        message.code === "player_not_in_room"
    );

    assertErrorMessage(error, "player_not_in_room", "unauthorized-resume");

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


test("join_room when the room is full returns a protocol error without persisting state", async () => {
  const port = 8300 + Math.floor(Math.random() * 1000);
  const ownerId = randomUUID();
  const playerIds = Array.from({ length: 7 }, () => randomUUID());
  const rejectedPlayerId = randomUUID();
  const server = await startServer(port);
  const owner = await connect(port);
  const rejected = await connect(port);
  let roomId: string | undefined;

  try {
    owner.send(JSON.stringify({ type: "create_room", playerId: ownerId }));
    const createdSnapshot = await waitForMessage(owner, (message) => message.type === "room_snapshot");
    roomId = createdSnapshot.roomId;
    await waitForMessage(owner, (message) => message.type === "event" && message.eventType === "room_created");

    assert.ok(roomId, "created room must have an id");
    const createdRoomId = roomId;
    for (const playerId of playerIds) {
      await joinRoom(createdRoomId, playerId);
    }

    const before = await pool.query(
      `SELECT
         (SELECT count(*) FROM public.room_players WHERE room_id = $1) AS players,
         (SELECT count(*) FROM public.room_events WHERE room_id = $1) AS events,
         (SELECT event_sequence FROM public.game_rooms WHERE id = $1) AS event_sequence`,
      [roomId]
    );

    assert.equal(Number(before.rows[0].players), 8);
    assert.equal(Number(before.rows[0].events), 8);
    assert.equal(Number(before.rows[0].event_sequence), 8);

    rejected.send(JSON.stringify({ type: "join_room", roomId, playerId: rejectedPlayerId }));

    const error = await waitForMessage(
      rejected,
      (message) => message.type === "error" && message.code === "room_full"
    );

    assert.deepEqual(error, { type: "error", reason: "room_full" });

    const after = await pool.query(
      `SELECT
         (SELECT count(*) FROM public.room_players WHERE room_id = $1) AS players,
         (SELECT count(*) FROM public.room_events WHERE room_id = $1) AS events,
         (SELECT event_sequence FROM public.game_rooms WHERE id = $1) AS event_sequence`,
      [roomId]
    );

    assert.deepEqual(after.rows[0], before.rows[0]);

    const rejectedPlayer = await pool.query(
      `SELECT count(*) AS count FROM public.room_players WHERE room_id = $1 AND player_id = $2`,
      [roomId, rejectedPlayerId]
    );
    assert.equal(Number(rejectedPlayer.rows[0].count), 0);

    const rejectedEvents = await pool.query(
      `SELECT count(*) AS count
       FROM public.room_events
       WHERE room_id = $1
         AND event_type = 'player_joined'
         AND payload->>'playerId' = $2`,
      [roomId, rejectedPlayerId]
    );
    assert.equal(Number(rejectedEvents.rows[0].count), 0);
  } finally {
    if (roomId) await pool.query("DELETE FROM public.game_rooms WHERE id = $1", [roomId]);
    owner.close();
    rejected.close();
    await stopServer(server);
  }
});


test("resume_room twice on the same connection returns a protocol error without duplicate state", async () => {
  const port = 8400 + Math.floor(Math.random() * 1000);
  const ownerId = randomUUID();
  const server = await startServer(port);
  const owner = await connect(port);
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

    owner.close();

    for (let attempt = 0; attempt < 50; attempt += 1) {
      const row = await pool.query(
        `SELECT connected
         FROM public.room_players
         WHERE room_id = $1 AND player_id = $2`,
        [roomId, ownerId]
      );
      if (row.rows[0]?.connected === false) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    const resumed = await connect(port);

    const requestId = randomUUID();
    resumed.send(JSON.stringify({
      type: "resume_room",
      requestId,
      roomId,
      playerId: ownerId,
      roundNumber: 1,
      lastEventSequence: 0,
      handVersion: 0
    }));
    const resumeStarted = await waitForMessage(
      resumed,
      (message) => message.type === "resume_started"
    );
    assertResumeStartedMessage(resumeStarted);
    const snapshot = await waitForMessage(
      resumed,
      (message) => message.type === "room_snapshot"
    );
    assertRoomSnapshotMessage(snapshot);
    assert.equal(snapshot.players.length, 1);
    await waitForMessage(
      resumed,
      (message) => message.type === "resume_complete"
    );

    const before = await pool.query(
      `SELECT
         (SELECT count(*) FROM public.room_players WHERE room_id = $1) AS players,
         (SELECT count(*) FROM public.room_events WHERE room_id = $1) AS events,
         (SELECT event_sequence FROM public.game_rooms WHERE id = $1) AS event_sequence`,
      [roomId]
    );

    assert.equal(Number(before.rows[0].players), 1);
    assert.equal(Number(before.rows[0].events), 1);
    assert.equal(Number(before.rows[0].event_sequence), 1);

    const secondRequestId = randomUUID();
    resumed.send(JSON.stringify({
      type: "resume_room",
      requestId,
      roomId,
      playerId: ownerId,
      roundNumber: 1,
      lastEventSequence: 0,
      handVersion: 0
    }));

    const error = await waitForMessage(
      resumed,
      (message) =>
        message.type === "error" &&
        message.code === "resume_already_active"
    );

    assertErrorMessage(error, "resume_already_active", secondRequestId);

    const after = await pool.query(
      `SELECT
         (SELECT count(*) FROM public.room_players WHERE room_id = $1) AS players,
         (SELECT count(*) FROM public.room_events WHERE room_id = $1) AS events,
         (SELECT event_sequence FROM public.game_rooms WHERE id = $1) AS event_sequence`,
      [roomId]
    );

    assert.deepEqual(after.rows[0], before.rows[0]);

    const duplicatePlayers = await pool.query(
      `SELECT count(*) AS count
       FROM public.room_players
       WHERE room_id = $1 AND player_id = $2`,
      [roomId, ownerId]
    );
    assert.equal(Number(duplicatePlayers.rows[0].count), 1);

    const duplicateEvents = await pool.query(
      `SELECT count(*) AS count
       FROM public.room_events
       WHERE room_id = $1
         AND event_type = 'player_joined'
         AND payload->>'playerId' = $2`,
      [roomId, ownerId]
    );
    assert.equal(Number(duplicateEvents.rows[0].count), 0);

    resumed.close();
  } finally {
    if (roomId) await pool.query("DELETE FROM public.game_rooms WHERE id = $1", [roomId]);
    owner.close();
    await stopServer(server);
  }
});


test("resume_room with an invalid room returns a protocol error without persisting state", async () => {
  const port = 8500 + Math.floor(Math.random() * 1000);
  const playerId = randomUUID();
  const invalidRoomId = randomUUID();
  const server = await startServer(port);
  const socket = await connect(port);

  try {
    const before = await pool.query(
      `SELECT
         (SELECT count(*) FROM public.room_players) AS players,
         (SELECT count(*) FROM public.room_events) AS events`
    );

    socket.send(JSON.stringify({
      type: "resume_room",
      requestId: "invalid-room-resume",
      roomId: invalidRoomId,
      playerId,
      roundNumber: 1,
      lastEventSequence: 0,
      handVersion: 0
    }));

    await waitForMessage(
      socket,
      (message) => message.type === "resume_started"
    );

    const error = await waitForMessage(
      socket,
      (message) =>
        message.type === "error" &&
        message.code === "room_not_found"
    );

    assertErrorMessage(error, "room_not_found", "invalid-room-resume");

    const after = await pool.query(
      `SELECT
         (SELECT count(*) FROM public.room_players) AS players,
         (SELECT count(*) FROM public.room_events) AS events`
    );
    assert.deepEqual(after.rows[0], before.rows[0]);
  } finally {
    socket.close();
    await stopServer(server);
  }
});

test("resume_room on a new WebSocket restores the existing player without duplicate state", async () => {
  const port = 8600 + Math.floor(Math.random() * 1000);
  const ownerId = randomUUID();
  const server = await startServer(port);
  const firstConnection = await connect(port);
  let roomId: string | undefined;
  let resumed: WebSocket | undefined;

  try {
    firstConnection.send(JSON.stringify({
      type: "create_room",
      playerId: ownerId
    }));
    const createdSnapshot = await waitForMessage(
      firstConnection,
      (message) => message.type === "room_snapshot"
    );
    roomId = createdSnapshot.roomId;
    await waitForMessage(
      firstConnection,
      (message) => message.type === "event" && message.eventType === "room_created"
    );

    firstConnection.close();

    for (let attempt = 0; attempt < 50; attempt += 1) {
      const row = await pool.query(
        `SELECT connected
         FROM public.room_players
         WHERE room_id = $1 AND player_id = $2`,
        [roomId, ownerId]
      );
      if (row.rows[0]?.connected === false) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    const before = await pool.query(
      `SELECT
         (SELECT count(*) FROM public.room_players WHERE room_id = $1) AS players,
         (SELECT count(*) FROM public.room_events WHERE room_id = $1) AS events,
         (SELECT event_sequence FROM public.game_rooms WHERE id = $1) AS event_sequence,
         (SELECT connected FROM public.room_players
          WHERE room_id = $1 AND player_id = $2) AS connected`,
      [roomId, ownerId]
    );

    assert.equal(Number(before.rows[0].players), 1);
    assert.equal(Number(before.rows[0].events), 1);
    assert.equal(Number(before.rows[0].event_sequence), 1);
    assert.equal(before.rows[0].connected, false);

    resumed = await connect(port);
    resumed.send(JSON.stringify({
      type: "resume_room",
      requestId: randomUUID(),
      roomId,
      playerId: ownerId,
      roundNumber: 1,
      lastEventSequence: 0,
      handVersion: 0
    }));

    await waitForMessage(
      resumed,
      (message) => message.type === "resume_started"
    );
    const snapshot = await waitForMessage(
      resumed,
      (message) => message.type === "room_snapshot"
    );
    assert.equal(snapshot.roomId, roomId);
    assert.equal(snapshot.players.length, 1);
    assert.deepEqual(snapshot.players[0], {
      playerId: ownerId,
      seatNumber: 0,
      connected: true,
      score: 0
    });

    const complete = await waitForMessage(
      resumed,
      (message) => message.type === "resume_complete"
    );
    assertExactKeys(complete, [
      "type", "requestId", "roomId", "roundNumber",
      "lastEventSequence", "handVersion", "serverTime"
    ]);
    assert.equal(complete.lastEventSequence, 1);

    const after = await pool.query(
      `SELECT
         (SELECT count(*) FROM public.room_players WHERE room_id = $1) AS players,
         (SELECT count(*) FROM public.room_events WHERE room_id = $1) AS events,
         (SELECT event_sequence FROM public.game_rooms WHERE id = $1) AS event_sequence,
         (SELECT count(*) FROM public.room_players
          WHERE room_id = $1 AND player_id = $2) AS player_count,
         (SELECT count(*) FROM public.room_events
          WHERE room_id = $1 AND event_type = 'player_joined') AS joined_events,
         (SELECT connected FROM public.room_players
          WHERE room_id = $1 AND player_id = $2) AS connected`,
      [roomId, ownerId]
    );

    assert.equal(Number(after.rows[0].players), 1);
    assert.equal(Number(after.rows[0].events), 1);
    assert.equal(Number(after.rows[0].event_sequence), 1);
    assert.equal(Number(after.rows[0].player_count), 1);
    assert.equal(Number(after.rows[0].joined_events), 0);
    assert.equal(after.rows[0].connected, true);
  } finally {
    if (roomId) await pool.query("DELETE FROM public.game_rooms WHERE id = $1", [roomId]);
    firstConnection.close();
    resumed?.close();
    await stopServer(server);
  }
});


test("resume_room request conforms to its JSON Schema", () => {
  const message = {
    type: "resume_room",
    requestId: randomUUID(),
    roomId: randomUUID(),
    playerId: randomUUID(),
    roundNumber: 1,
    lastEventSequence: 0,
    handVersion: 0
  };
  assertResumeRoomMessage(message);
});

test("resume_started response conforms to its JSON Schema", async () => {
  const port = 8700 + Math.floor(Math.random() * 1000);
  const playerId = randomUUID();
  const server = await startServer(port);
  const socket = await connect(port);
  let roomId: string | undefined;

  try {
    socket.send(JSON.stringify({ type: "create_room", playerId }));
    const snapshot = await waitForMessage(socket, (message) => message.type === "room_snapshot");
    roomId = snapshot.roomId;
    await waitForMessage(socket, (message) => message.type === "event" && message.eventType === "room_created");
    socket.close();

    for (let attempt = 0; attempt < 50; attempt += 1) {
      const row = await pool.query(
        "SELECT connected FROM public.room_players WHERE room_id = $1 AND player_id = $2",
        [roomId, playerId]
      );
      if (row.rows[0]?.connected === false) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    const resumed = await connect(port);
    const request = {
      type: "resume_room",
      requestId: "resume-started-schema-test",
      roomId,
      playerId,
      roundNumber: 1,
      lastEventSequence: 0,
      handVersion: 0
    };
    assertResumeRoomMessage(request);
    resumed.send(JSON.stringify(request));

    const started = await waitForMessage(resumed, (message) => message.type === "resume_started");
    assertResumeStartedMessage(started);
    assert.equal(started.requestId, request.requestId);
    resumed.close();
  } finally {
    if (roomId) await pool.query("DELETE FROM public.game_rooms WHERE id = $1", [roomId]);
    socket.close();
    await stopServer(server);
  }
});

test("room_snapshot response conforms to its JSON Schema", async () => {
  const port = 8800 + Math.floor(Math.random() * 1000);
  const playerId = randomUUID();
  const server = await startServer(port);
  const socket = await connect(port);
  let roomId: string | undefined;

  try {
    socket.send(JSON.stringify({ type: "create_room", playerId }));
    const snapshot = await waitForMessage(socket, (message) => message.type === "room_snapshot");
    roomId = snapshot.roomId;
    assertRoomSnapshotMessage(snapshot);
    assert.equal(snapshot.firstSolverId, null);
    assert.equal(snapshot.solvedAt, null);
    assert.equal(snapshot.solveWindowEndsAt, null);
  } finally {
    if (roomId) await pool.query("DELETE FROM public.game_rooms WHERE id = $1", [roomId]);
    socket.close();
    await stopServer(server);
  }
});

test("error response conforms to its JSON Schema", async () => {
  const port = 8900 + Math.floor(Math.random() * 1000);
  const server = await startServer(port);
  const socket = await connect(port);

  try {
    socket.send(JSON.stringify({
      type: "resume_room",
      requestId: "error-schema-test",
      roomId: "",
      playerId: randomUUID(),
      roundNumber: 1,
      lastEventSequence: 0,
      handVersion: 0
    }));

    const error = await waitForMessage(socket, (message) => message.type === "error");
    assertErrorMessage(error, "invalid_room_id", "error-schema-test");
  } finally {
    socket.close();
    await stopServer(server);
  }
});

test("stale disconnect cannot mark a newly resumed connection disconnected", async () => {
  const port = 9000 + Math.floor(Math.random() * 500);
  const ownerId = randomUUID();
  let barrier: ReturnType<typeof createDisconnectBarrier> | undefined;
  let serverSocketClosed = false;
  let serverSocketCloseCount = 0;
  let resolveServerSocketClose!: () => void;
  let resolveResumedServerSocketClose!: () => void;
  let owner: WebSocket | undefined;
  let resumed: WebSocket | undefined;
  let roomId: string | undefined;
  let released = false;
  let staleDisconnectBarrierEnabled = true;
  let staleDisconnectBarrierCompletionCount = 0;
  let disconnectUpdateHookEntered = false;
  let resolveDisconnectUpdateHookEntered!: () => void;
  let testError: unknown;

  const disconnectUpdateHookEnteredPromise = new Promise<void>((resolve) => {
    resolveDisconnectUpdateHookEntered = resolve;
  });

  const serverSocketClosePromise = new Promise<void>((resolve) => {
    resolveServerSocketClose = resolve;
  });
  const resumedServerSocketClosePromise = new Promise<void>((resolve) => {
    resolveResumedServerSocketClose = resolve;
  });

  const server = createServerApp({
    onSocketClose: () => {
      serverSocketCloseCount += 1;
      if (serverSocketCloseCount === 1) {
        serverSocketClosed = true;
        resolveServerSocketClose();
        return;
      }
      if (serverSocketCloseCount === 2) {
        resolveResumedServerSocketClose();
      }
    },
    disconnectHooks: {
      beforeDisconnectUpdate: () => {
        disconnectUpdateHookEntered = true;
        resolveDisconnectUpdateHookEntered();
        if (!staleDisconnectBarrierEnabled) return Promise.resolve();
        if (!barrier) {
          return Promise.reject(new Error("[stale disconnect] barrier not initialized before disconnect hook"));
        }
        return barrier.wait();
      },
      afterDisconnectUpdate: (rowCount) => {
        if (staleDisconnectBarrierEnabled) {
          staleDisconnectBarrierCompletionCount += 1;
          if (!barrier) {
            throw new Error("[stale disconnect] barrier not initialized before disconnect completion");
          }
          barrier.afterDisconnectUpdate(rowCount);
        }
      }
    }
  });

  try {
    await server.listen(port, "127.0.0.1");
    owner = await connect(port);

    owner.send(JSON.stringify({
      type: "create_room",
      playerId: ownerId
    }));

    const createdSnapshot = await waitForMessage(
      owner,
      (message) => message.type === "room_snapshot"
    );
    roomId = createdSnapshot.roomId;

    await waitForMessage(
      owner,
      (message) =>
        message.type === "event" &&
        message.eventType === "room_created"
    );

    const initial = await pool.query(
      `SELECT connected, connection_version
       FROM public.room_players
       WHERE room_id = $1 AND player_id = $2`,
      [roomId, ownerId]
    );

    assert.equal(initial.rows[0].connected, true);
    assert.equal(Number(initial.rows[0].connection_version), 0);

    barrier = createDisconnectBarrier(5_000);
    assert.ok(barrier, "disconnect barrier must be initialized before terminating the stale socket");

    const serverOwnerSocket = [...server.webSocketServer.clients][0];
    assert.ok(serverOwnerSocket, "server-side owner socket must exist before stale disconnect");
    serverOwnerSocket.terminate();

    await serverSocketClosePromise;

    assert.equal(
      serverSocketClosed,
      true,
      "server-side WebSocket close handler must observe the stale socket close"
    );
    assert.equal(
      serverSocketCloseCount,
      1,
      "only the stale socket should have closed before the resumed connection is established"
    );

    await disconnectUpdateHookEnteredPromise;
    assert.equal(
      disconnectUpdateHookEntered,
      true,
      "stale disconnect must enter the disconnect update hook after the server-side socket close"
    );
    await barrier.waitUntilBlocked();

    resumed = await connect(port);
    resumed.send(JSON.stringify({
      type: "resume_room",
      requestId: randomUUID(),
      roomId,
      playerId: ownerId,
      roundNumber: 1,
      lastEventSequence: 0,
      handVersion: 0
    }));

    await waitForMessage(
      resumed,
      (message) =>
        message.type === "resume_started" &&
        message.roomId === roomId,
      5_000,
      "resume_started for resumed socket"
    );

    const snapshot = await waitForMessage(
      resumed,
      (message) =>
        message.type === "room_snapshot" &&
        message.roomId === roomId,
      5_000,
      "room_snapshot for resumed socket"
    );

    assert.deepEqual(snapshot.players, [
      {
        playerId: ownerId,
        seatNumber: 0,
        connected: true,
        score: 0
      }
    ]);

    await waitForMessage(
      resumed,
      (message) =>
        message.type === "resume_complete" &&
        message.roomId === roomId,
      5_000,
      "resume_complete for resumed socket"
    );

    barrier.release();
    released = true;

    const staleDisconnectRowCount = await barrier.completed();

    assert.equal(
      staleDisconnectRowCount,
      0,
      "stale disconnect UPDATE must affect zero rows"
    );

    const final = await pool.query(
      `SELECT connected, connection_version
       FROM public.room_players
       WHERE room_id = $1 AND player_id = $2`,
      [roomId, ownerId]
    );

    assert.equal(final.rowCount, 1);
    assert.equal(
      final.rows[0].connected,
      true,
      "resumed connection must remain connected"
    );
    assert.equal(
      Number(final.rows[0].connection_version),
      1,
      "resumed connection must have connection_version 1"
    );
  } catch (error) {
    testError = error;
  } finally {
    const cleanupErrors: Error[] = [];

    if (!released && barrier) {
      barrier.release();
    }

    if (roomId) {
      try {
        await pool.query(
          "DELETE FROM public.game_rooms WHERE id = $1",
          [roomId]
        );
      } catch (error) {
        cleanupErrors.push(cleanupError("room cleanup", error));
      }
    }

    if (owner) {
      try {
        owner.close();
      } catch (error) {
        cleanupErrors.push(cleanupError("original WebSocket close", error));
      }
    }

    staleDisconnectBarrierEnabled = false;

    if (resumed && resumed.readyState === WebSocket.OPEN) {
      try {
        resumed.removeAllListeners("close");
        resumed.close();
        await resumedServerSocketClosePromise;
      } catch (error) {
        cleanupErrors.push(cleanupError("resumed WebSocket close", error));
      }
    }

    try {
      assert.equal(
        staleDisconnectBarrierCompletionCount,
        1,
        "stale-disconnect barrier must complete exactly once"
      );
    } catch (error) {
      cleanupErrors.push(cleanupError("stale-disconnect barrier exact-once assertion", error));
    }

    try {
      await server.close();
    } catch (error) {
      cleanupErrors.push(cleanupError("test server close", error));
    }

    if (testError && cleanupErrors.length > 0) {
      const aggregate = new AggregateError(
        [testError, ...cleanupErrors],
        "stale-disconnect test failed during execution and cleanup"
      );

      assert.equal(
        aggregate.errors[0],
        testError,
        "AggregateError must preserve the original test failure as its first error"
      );
      assert.deepEqual(
        aggregate.errors.slice(1),
        cleanupErrors,
        "AggregateError must preserve every cleanup and exact-once assertion failure in order"
      );

      throw aggregate;
    }

    if (testError) {
      throw testError;
    }

    if (cleanupErrors.length > 0) {
      const aggregate = new AggregateError(
        cleanupErrors,
        "stale-disconnect test cleanup failed"
      );

      assert.deepEqual(
        aggregate.errors,
        cleanupErrors,
        "AggregateError must preserve every cleanup and exact-once assertion failure"
      );

      throw aggregate;
    }
  }
});
