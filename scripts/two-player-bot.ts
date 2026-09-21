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
const roundBot1 = await waitFor(
  bot1,
  (m) => m.type === "room_snapshot" && m.roomId === activeRoomId && m.phase === "playing",
);
const roundBot2 = await waitFor(
  bot2,
  (m) => m.type === "room_snapshot" && m.roomId === activeRoomId && m.phase === "playing",
);
if (roundBot2.roundNumber !== roundBot1.roundNumber) {
  throw new Error(`bot-2 received round ${roundBot2.roundNumber}, expected ${roundBot1.roundNumber}`);
}
log("test", `ROUND START PASS round=${roundBot1.roundNumber}`);

await close(bot2);
log("test", "DISCONNECT COMPLETE");
await new Promise((resolve) => setTimeout(resolve, reconnectDelayMs));

bot2 = await connect("bot-2-reconnected", player2);
const resumeRequestId = randomUUID();
send(bot2, {
  type: "resume_room",
  requestId: resumeRequestId,
  roomId: activeRoomId,
  playerId: player2,
  roundNumber: roundBot1.roundNumber,
  lastEventSequence: roundBot1.eventSequence,
  handVersion: 1,
});

await waitFor(
  bot2,
  (m) => m.type === "resume_started" && m.requestId === resumeRequestId && m.roomId === activeRoomId,
);
const resumedSnapshot = await waitFor(
  bot2,
  (m) => m.type === "room_snapshot" && m.roomId === activeRoomId && m.phase === "playing",
);
const resumeComplete = await waitFor(
  bot2,
  (m) => m.type === "resume_complete" && m.requestId === resumeRequestId && m.roomId === activeRoomId,
);

if (resumedSnapshot.roundNumber !== roundBot1.roundNumber) {
  throw new Error(`resume snapshot returned round ${resumedSnapshot.roundNumber}, expected ${roundBot1.roundNumber}`);
}
if (resumeComplete.roundNumber !== roundBot1.roundNumber) {
  throw new Error(`resume_complete returned round ${resumeComplete.roundNumber}, expected ${roundBot1.roundNumber}`);
}
if (typeof resumeComplete.handVersion !== "number") {
  throw new Error("resume_complete did not include a numeric handVersion");
}

log(
  "test",
  `RECONNECT/STATE RESUME PASS round=${resumeComplete.roundNumber} handVersion=${resumeComplete.handVersion}`,
);

await close(bot1);
await close(bot2);
console.log("TWO-PLAYER BOT PROTOCOL PASS");
