import WebSocket from "ws";
import { randomUUID } from "node:crypto";

const url = process.env.WS_URL ?? "wss://champword-backend.onrender.com";
const roomId = process.env.ROOM_ID;
const reconnectDelayMs = Number(process.env.RECONNECT_DELAY_MS ?? 1000);

if (roomId && !roomId.trim()) throw new Error("ROOM_ID cannot be empty");

type Message = Record<string, any>;

type Bot = {
  name: string;
  playerId: string;
  ws: WebSocket;
  queue: Message[];
};

function log(bot: string, message: string): void {
  console.log(`[${bot}] ${message}`);
}

function connect(name: string, playerId: string): Promise<Bot> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const bot: Bot = { name, playerId, ws, queue: [] };
    const timeout = setTimeout(() => reject(new Error(`${name}: connection timeout`)), 10000);

    ws.on("message", (raw) => {
      try {
        const message = JSON.parse(raw.toString()) as Message;
        bot.queue.push(message);
        if (message.type !== "server_ready") log(name, `<= ${message.type}`);
      } catch {
        log(name, "<= invalid JSON");
      }
    });
    ws.once("open", () => {
      clearTimeout(timeout);
      resolve(bot);
    });
    ws.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function waitFor(bot: Bot, predicate: (message: Message) => boolean, timeoutMs = 10000): Promise<Message> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const index = bot.queue.findIndex(predicate);
    if (index >= 0) return bot.queue.splice(index, 1)[0];
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`${bot.name}: timed out waiting for protocol message`);
}

function send(bot: Bot, message: Message): void {
  log(bot.name, `=> ${message.type}`);
  bot.ws.send(JSON.stringify(message));
}

async function close(bot: Bot): Promise<void> {
  await new Promise<void>((resolve) => {
    if (bot.ws.readyState === WebSocket.CLOSED) return resolve();
    bot.ws.once("close", () => resolve());
    bot.ws.close(1000, "two-player bot complete");
  });
}

const player1 = randomUUID();
const player2 = randomUUID();
let bot1 = await connect("bot-1", player1);
let bot2 = await connect("bot-2", player2);

let activeRoomId = roomId;

if (!activeRoomId) {
  send(bot1, { type: "create_room", requestId: randomUUID(), playerId: player1 });
  const created = await waitFor(bot1, (m) => m.type === "room_snapshot" && Boolean(m.roomId));
  activeRoomId = created.roomId;
  log("bot-1", `room=${activeRoomId}`);
} else {
  send(bot1, { type: "join_room", roomId: activeRoomId, playerId: player1 });
  await waitFor(bot1, (m) => m.type === "room_snapshot" && m.roomId === activeRoomId);
}

send(bot2, { type: "join_room", roomId: activeRoomId, playerId: player2 });
await waitFor(bot2, (m) => m.type === "room_snapshot" && m.roomId === activeRoomId);
await waitFor(bot1, (m) => m.type === "event" && m.eventType === "player_joined");
log("test", "ROOM JOIN PASS");

send(bot1, { type: "start_round", requestId: randomUUID() });
const round = await waitFor(bot1, (m) => m.type === "room_snapshot" && m.phase === "playing");
await waitFor(bot2, (m) => m.type === "room_snapshot" && m.phase === "playing");
const handSync = await waitFor(
  bot2,
  (m) => m.type === "hand_sync" && m.roomId === activeRoomId && m.roundNumber === round.roundNumber,
);
const hand = handSync.hand;
if (!Array.isArray(hand)) throw new Error("bot-2 hand_sync did not include a hand array");
if (hand.length !== 14) throw new Error(`bot-2 expected exactly 14 cards, got ${hand.length}`);
const handVersion = handSync.handVersion;
if (typeof handVersion !== "number") throw new Error("bot-2 hand_sync did not include a numeric handVersion");
log("test", `ROUND START PASS round=${round.roundNumber} hand=14 handVersion=${handVersion}`);

const cards = expectedHand.slice(0, 2).map((card) => card.cardId);
send(bot2, {
  type: "submit_word",
  requestId: randomUUID(),
  roomId: activeRoomId,
  roundNumber: round.roundNumber,
  turnNumber: round.turnNumber,
  cards,
  word: "ab"
});
const submission = await waitFor(bot2, (m) => m.type === "word_submission_result");
if (submission.status !== "accepted") throw new Error(`bot-2 submission rejected: ${submission.reason ?? "unknown"}`);
log("test", "WORD SUBMISSION PASS");

// Consuming cards draws replacements, so the authoritative hand changes and its
// version increments. Capture that hand to compare the resumed state against.
const postSubmissionHandSync = await waitFor(
  bot2,
  (m) => m.type === "hand_sync" && m.roomId === activeRoomId && m.roundNumber === round.roundNumber,
);
const expectedHand = postSubmissionHandSync.hand;
if (!Array.isArray(expectedHand)) throw new Error("post-submission hand_sync did not include a hand array");
if (expectedHand.length !== 14) throw new Error(`post-submission hand had ${expectedHand.length} cards, expected 14`);
const expectedHandVersion = postSubmissionHandSync.handVersion;
if (expectedHandVersion !== handVersion + 1) {
  throw new Error(`post-submission handVersion ${expectedHandVersion}, expected ${handVersion + 1}`);
}
log("test", `CARD REPLENISHMENT PASS hand=14 handVersion=${expectedHandVersion}`);

await close(bot2);
log("test", "DISCONNECT COMPLETE");
await new Promise((resolve) => setTimeout(resolve, reconnectDelayMs));

bot2 = await connect("bot-2-reconnected", player2);
send(bot2, {
  type: "resume_room",
  requestId: randomUUID(),
  roomId: activeRoomId,
  playerId: player2,
  roundNumber: round.roundNumber,
  lastEventSequence: round.eventSequence,
  handVersion
});
await waitFor(bot2, (m) => m.type === "resume_started");
await waitFor(bot2, (m) => m.type === "room_snapshot" && m.roomId === activeRoomId);
const resumedHandSync = await waitFor(
  bot2,
  (m) => m.type === "hand_sync" && m.roomId === activeRoomId && m.roundNumber === round.roundNumber,
);
const resumedHand = resumedHandSync.hand;
if (!Array.isArray(resumedHand)) throw new Error("resume hand_sync did not include a hand array");
if (resumedHand.length !== 14) throw new Error(`resume expected exactly 14 cards, got ${resumedHand.length}`);
const resumedHandVersion = resumedHandSync.handVersion;
if (resumedHandVersion !== expectedHandVersion) throw new Error(`resume returned handVersion ${resumedHandVersion}, expected ${expectedHandVersion}`);
if (JSON.stringify(resumedHand) !== JSON.stringify(expectedHand)) throw new Error("resume returned a different 14-card hand");
const complete = await waitFor(bot2, (m) => m.type === "resume_complete" && m.roomId === activeRoomId);
if (complete.roundNumber !== round.roundNumber) throw new Error("resume_complete returned the wrong round");
log("test", `RECONNECT/STATE RESUME PASS round=${complete.roundNumber} hand=14 handVersion=${resumedHandVersion}`);

await close(bot1);
await close(bot2);
console.log("TWO-PLAYER BOT PASS");
