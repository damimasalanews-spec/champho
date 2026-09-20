import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { WebSocket } from "ws";
import { pool } from "../db.js";

after(async () => {
  await pool.end();
});

type Message = Record<string, any>;

type Waiter = {
  predicate: (message: Message) => boolean;
  resolve: (message: Message) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type SocketState = { queue: Message[]; waiters: Waiter[] };

const socketStates = new WeakMap<WebSocket, SocketState>();

function stateFor(socket: WebSocket): SocketState {
  const existing = socketStates.get(socket);
  if (existing) return existing;
  const state: SocketState = { queue: [], waiters: [] };
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString()) as Message;
    const index = state.waiters.findIndex((waiter) => waiter.predicate(message));
    if (index >= 0) {
      const [waiter] = state.waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
      return;
    }
    state.queue.push(message);
  });
  socket.on("error", (error) => {
    for (const waiter of state.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  });
  socketStates.set(socket, state);
  return state;
}

function waitForMessage(
  socket: WebSocket,
  predicate: (message: Message) => boolean,
  timeoutMs = 5_000
): Promise<Message> {
  const state = stateFor(socket);
  const queuedIndex = state.queue.findIndex(predicate);
  if (queuedIndex >= 0) {
    const [message] = state.queue.splice(queuedIndex, 1);
    return Promise.resolve(message);
  }
  return new Promise((resolve, reject) => {
    const waiter: Waiter = {
      predicate,
      resolve,
      reject,
      timer: setTimeout(() => {
        const index = state.waiters.indexOf(waiter);
        if (index >= 0) state.waiters.splice(index, 1);
        reject(new Error("timed out waiting for WebSocket message"));
      }, timeoutMs)
    };
    state.waiters.push(waiter);
  });
}

async function connect(port: number): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  stateFor(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  await waitForMessage(socket, (message) => message.type === "server_ready");
  return socket;
}

async function startServer(port: number): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "server/main.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await new Promise<void>((resolve, reject) => {
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
    child.stderr?.on("data", (chunk: Buffer) => process.stdout.write(chunk));
    child.once("error", onError);
    child.once("exit", onExit);
  });
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

function assertSubmissionResult(message: Message): void {
  const required = [
    "type", "requestId", "roomId", "roundNumber", "status", "reason",
    "serverTime", "cardsConsumed", "cardsDrawn", "handChanged",
    "scoreDelta", "coinDelta"
  ];
  for (const key of required) assert.ok(Object.hasOwn(message, key), `missing ${key}`);
  assert.equal(message.type, "word_submission_result");
  assert.equal(typeof message.requestId, "string");
  assert.equal(typeof message.roomId, "string");
  assert.equal(Number.isInteger(message.roundNumber), true);
  assert.ok(["accepted", "rejected", "duplicate"].includes(message.status));
  assert.equal(typeof message.reason, "string");
  assert.equal(!Number.isNaN(Date.parse(message.serverTime)), true);
}

async function seedActiveRoom(roomId: string, playerId: string, guestId: string): Promise<void> {
  await pool.query(
    `UPDATE public.game_rooms
     SET state = 'active',
         phase = 'playing',
         round_number = 1,
         turn_number = 0,
         active_player_id = $2,
         first_solver_id = NULL,
         solved_at = NULL,
         solve_window_ends_at = NULL
     WHERE id = $1`,
    [roomId, playerId]
  );
  await pool.query(
    `UPDATE public.room_players
     SET turn_state = CASE WHEN player_id = $2 THEN 'active' ELSE 'waiting' END,
         private_hand = CASE
           WHEN player_id = $2 THEN $3::jsonb
           WHEN player_id = $4 THEN $5::jsonb
           ELSE private_hand
         END,
         hand_version = 0
     WHERE room_id = $1`,
    [
      roomId,
      playerId,
      JSON.stringify([
        { cardId: "card-a", value: "a" },
        { cardId: "card-b", value: "b" }
      ]),
      guestId,
      JSON.stringify([
        { cardId: "card-c", value: "a" },
        { cardId: "card-d", value: "b" }
      ])
    ]
  );
}

test("submit_word authoritatively accepts a valid word, assigns the first solver, consumes cards, and opens the solve window", async () => {
  const port = 9200 + Math.floor(Math.random() * 300);
  const playerId = randomUUID();
  const server = await startServer(port);
  const socket = await connect(port);
  let roomId: string | undefined;

  try {
    socket.send(JSON.stringify({ type: "create_room", playerId }));
    const snapshot = await waitForMessage(socket, (m) => m.type === "room_snapshot");
    roomId = snapshot.roomId;
    await waitForMessage(socket, (m) => m.type === "event" && m.eventType === "room_created");

    await seedActiveRoom(roomId!, playerId, randomUUID());
    const requestId = randomUUID();
    socket.send(JSON.stringify({
      type: "submit_word",
      requestId,
      roomId,
      roundNumber: 1,
      turnNumber: 0,
      cards: ["card-a", "card-b"],
      word: "ab"
    }));

    const result = await waitForMessage(socket, (m) => m.type === "word_submission_result");
    assertSubmissionResult(result);
    assert.equal(result.requestId, requestId);
    assert.equal(result.status, "accepted");
    assert.equal(result.reason, "accepted");
    assert.equal(result.cardsConsumed, 2);
    assert.equal(result.cardsDrawn, 0);
    assert.equal(result.handChanged, true);
    assert.equal(result.handVersion, 1);
    assert.deepEqual(result.hand, []);
    assert.equal(result.scoreDelta, 1);
    assert.equal(result.roundState, "solve_window");

    const event = await waitForMessage(socket, (m) => m.type === "event" && m.eventType === "word_submitted");
    assert.equal(event.payload.playerId, playerId);
    assert.equal(event.payload.word, "ab");

    const persisted = await pool.query(
      `SELECT phase, first_solver_id, solved_at, solve_window_ends_at, event_sequence
       FROM public.game_rooms WHERE id = $1`,
      [roomId]
    );
    assert.equal(persisted.rows[0].phase, "solve_window");
    assert.equal(persisted.rows[0].first_solver_id, playerId);
    assert.ok(persisted.rows[0].solved_at);
    assert.ok(persisted.rows[0].solve_window_ends_at);
    assert.equal(Number(persisted.rows[0].event_sequence), 2);

    const submission = await pool.query(
      `SELECT status, reason, submitted_cards, submitted_word, hand_version
       FROM public.submissions s
       LEFT JOIN public.room_players p
         ON p.room_id = s.room_id AND p.player_id = s.player_id
       WHERE s.room_id = $1 AND s.player_id = $2`,
      [roomId, playerId]
    );
    assert.equal(submission.rows[0].status, "accepted");
    assert.equal(submission.rows[0].reason, "accepted");
    assert.deepEqual(submission.rows[0].submitted_cards, ["card-a", "card-b"]);
    assert.equal(submission.rows[0].submitted_word, "ab");
    assert.equal(Number(submission.rows[0].hand_version), 1);
  } finally {
    if (roomId) await pool.query("DELETE FROM public.game_rooms WHERE id = $1", [roomId]);
    socket.close();
    await stopServer(server);
  }
});

test("submit_word duplicate replays without a second score, hand mutation, or event", async () => {
  const port = 9500 + Math.floor(Math.random() * 200);
  const playerId = randomUUID();
  const guestId = randomUUID();
  const server = await startServer(port);
  const socket = await connect(port);
  let roomId: string | undefined;

  try {
    socket.send(JSON.stringify({ type: "create_room", playerId }));
    const snapshot = await waitForMessage(socket, (m) => m.type === "room_snapshot");
    roomId = snapshot.roomId;
    await waitForMessage(socket, (m) => m.type === "event" && m.eventType === "room_created");

    const guest = randomUUID();
    await pool.query(
      `INSERT INTO public.room_players
       (room_id, player_id, seat_number, connected, turn_state, private_hand)
       VALUES ($1,$2,1,true,'waiting',$3::jsonb)`,
      [roomId, guest, JSON.stringify([{ cardId: "guest-a", value: "a" }, { cardId: "guest-b", value: "b" }])]
    );
    await seedActiveRoom(roomId!, playerId, guestId);

    const request = {
      type: "submit_word",
      requestId: randomUUID(),
      roomId,
      roundNumber: 1,
      turnNumber: 0,
      cards: ["card-a", "card-b"],
      word: "ab"
    };
    socket.send(JSON.stringify(request));
    const first = await waitForMessage(socket, (m) => m.type === "word_submission_result");
    assert.equal(first.status, "accepted");
    await waitForMessage(socket, (m) => m.type === "event" && m.eventType === "word_submitted");

    socket.send(JSON.stringify(request));
    const duplicate = await waitForMessage(socket, (m) => m.type === "word_submission_result");
    assertSubmissionResult(duplicate);
    assert.equal(duplicate.status, "duplicate");
    assert.equal(duplicate.originalStatus, "accepted");
    assert.equal(duplicate.handVersion, 1);

    const counts = await pool.query(
      `SELECT
         (SELECT score FROM public.room_players WHERE room_id = $1 AND player_id = $2) AS score,
         (SELECT hand_version FROM public.room_players WHERE room_id = $1 AND player_id = $2) AS hand_version,
         (SELECT count(*) FROM public.submissions WHERE room_id = $1 AND player_id = $2) AS submissions,
         (SELECT event_sequence FROM public.game_rooms WHERE id = $1) AS event_sequence`,
      [roomId, playerId]
    );
    assert.equal(Number(counts.rows[0].score), 1);
    assert.equal(Number(counts.rows[0].hand_version), 1);
    assert.equal(Number(counts.rows[0].submissions), 1);
    assert.equal(Number(counts.rows[0].event_sequence), 2);
  } finally {
    if (roomId) await pool.query("DELETE FROM public.game_rooms WHERE id = $1", [roomId]);
    socket.close();
    await stopServer(server);
  }
});

test("solve window accepts a second solver before the deadline and then transitions to the next round after expiry", async () => {
  const port = 9800 + Math.floor(Math.random() * 150);
  const playerId = randomUUID();
  const guestId = randomUUID();
  const server = await startServer(port);
  const first = await connect(port);
  const second = await connect(port);
  let roomId: string | undefined;

  try {
    first.send(JSON.stringify({ type: "create_room", playerId }));
    const snapshot = await waitForMessage(first, (m) => m.type === "room_snapshot");
    roomId = snapshot.roomId;
    await waitForMessage(first, (m) => m.type === "event" && m.eventType === "room_created");

    await pool.query(
      `INSERT INTO public.room_players
       (room_id, player_id, seat_number, connected, turn_state, private_hand)
       VALUES ($1,$2,1,true,'waiting',$3::jsonb)`,
      [roomId, guestId, JSON.stringify([{ cardId: "card-c", value: "a" }, { cardId: "card-d", value: "b" }])]
    );
    await seedActiveRoom(roomId!, playerId, guestId);

    first.send(JSON.stringify({
      type: "submit_word",
      requestId: randomUUID(),
      roomId,
      roundNumber: 1,
      turnNumber: 0,
      cards: ["card-a", "card-b"],
      word: "ab"
    }));
    await waitForMessage(first, (m) => m.type === "word_submission_result" && m.status === "accepted");
    await waitForMessage(first, (m) => m.type === "event" && m.eventType === "word_submitted");

    await pool.query(
      `UPDATE public.room_players
       SET connected = false
       WHERE room_id = $1 AND player_id = $2`,
      [roomId, guestId]
    );
    second.send(JSON.stringify({
      type: "resume_room",
      requestId: randomUUID(),
      roomId,
      playerId: guestId,
      roundNumber: 1,
      lastEventSequence: 0,
      handVersion: 0
    }));
    await waitForMessage(second, (m) => m.type === "resume_started");
    await waitForMessage(second, (m) => m.type === "room_snapshot");

    second.send(JSON.stringify({
      type: "submit_word",
      requestId: randomUUID(),
      roomId,
      roundNumber: 1,
      turnNumber: 0,
      cards: ["card-c", "card-d"],
      word: "ab"
    }));
    const secondResult = await waitForMessage(second, (m) => m.type === "word_submission_result");
    assertSubmissionResult(secondResult);
    assert.equal(secondResult.status, "accepted");

    await new Promise((resolve) => setTimeout(resolve, 3_100));

    second.send(JSON.stringify({
      type: "submit_word",
      requestId: randomUUID(),
      roomId,
      roundNumber: 1,
      turnNumber: 0,
      cards: ["card-c", "card-d"],
      word: "ab"
    }));

    const expiredResult = await waitForMessage(second, (m) => m.type === "word_submission_result");
    assertSubmissionResult(expiredResult);
    assert.equal(expiredResult.status, "rejected");
    assert.equal(expiredResult.reason, "solve_window_expired");
    assert.equal(expiredResult.roundState, "round_end");

    const completed = await waitForMessage(second, (m) => m.type === "round_completed");
    assert.equal(completed.roundNumber, 1);
    assert.equal(completed.roundState, "round_end");
    assert.equal(completed.word, "ab");
    assert.deepEqual(completed.solvers, [
      { playerId, position: 1 },
      { playerId: guestId, position: 2 }
    ]);

    const nextSnapshot = await waitForMessage(second, (m) => m.type === "room_snapshot" && m.roundNumber === 2);
    assert.equal(nextSnapshot.phase, "playing");
    assert.equal(nextSnapshot.state, "active");
    assert.equal(nextSnapshot.roundNumber, 2);
    assert.equal(nextSnapshot.firstSolverId, null);
    assert.equal(nextSnapshot.solvedAt, null);
    assert.equal(nextSnapshot.solveWindowEndsAt, null);

    const room = await pool.query(
      `SELECT round_number, phase, active_player_id, first_solver_id, solved_at, solve_window_ends_at
       FROM public.game_rooms WHERE id = $1`,
      [roomId]
    );
    assert.equal(Number(room.rows[0].round_number), 2);
    assert.equal(room.rows[0].phase, "playing");
    assert.equal(room.rows[0].active_player_id, playerId);
    assert.equal(room.rows[0].first_solver_id, null);
  } finally {
    if (roomId) await pool.query("DELETE FROM public.game_rooms WHERE id = $1", [roomId]);
    first.close();
    second.close();
    await stopServer(server);
  }
});

test("submit_word rejects an incorrect word without mutating the hand or score", async () => {
  const port = 9950 + Math.floor(Math.random() * 40);
  const playerId = randomUUID();
  const server = await startServer(port);
  const socket = await connect(port);
  let roomId: string | undefined;

  try {
    socket.send(JSON.stringify({ type: "create_room", playerId }));
    const snapshot = await waitForMessage(socket, (m) => m.type === "room_snapshot");
    roomId = snapshot.roomId;
    await waitForMessage(socket, (m) => m.type === "event" && m.eventType === "room_created");
    await seedActiveRoom(roomId!, playerId, randomUUID());

    socket.send(JSON.stringify({
      type: "submit_word",
      requestId: randomUUID(),
      roomId,
      roundNumber: 1,
      turnNumber: 0,
      cards: ["card-a", "card-b"],
      word: "ba"
    }));

    const result = await waitForMessage(socket, (m) => m.type === "word_submission_result");
    assertSubmissionResult(result);
    assert.equal(result.status, "rejected");
    assert.equal(result.reason, "incorrect_word");

    const persisted = await pool.query(
      `SELECT score, hand_version, private_hand, phase, first_solver_id
       FROM public.room_players p
       JOIN public.game_rooms r ON r.id = p.room_id
       WHERE p.room_id = $1 AND p.player_id = $2`,
      [roomId, playerId]
    );
    assert.equal(Number(persisted.rows[0].score), 0);
    assert.equal(Number(persisted.rows[0].hand_version), 0);
    assert.deepEqual(persisted.rows[0].private_hand, [
      { cardId: "card-a", value: "a" },
      { cardId: "card-b", value: "b" }
    ]);
  } finally {
    if (roomId) await pool.query("DELETE FROM public.game_rooms WHERE id = $1", [roomId]);
    socket.close();
    await stopServer(server);
  }
});
