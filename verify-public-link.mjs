/** Prove the PUBLIC tunnel URL can actually play the game, WebSocket included. */
import { WebSocket } from "ws";

const url = process.argv[2];
if (!url) {
  console.error("usage: node verify-public-link.mjs wss://host");
  process.exit(2);
}

console.log(`connecting to ${url} …`);
const ws = new WebSocket(url, { handshakeTimeout: 25000 });
const seen = new Map();
let room = null;
let hand = null;
let players = null;
let turn = null;

ws.on("open", () => {
  console.log("  socket open");
  ws.send(JSON.stringify({ type: "hello", requestId: "h1" }));
});
ws.on("error", (e) => {
  console.log("  WS ERROR:", e.message);
  process.exit(1);
});
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  seen.set(m.type, (seen.get(m.type) || 0) + 1);
  if (m.type === "welcome") {
    console.log("  got welcome — session issued");
    ws.send(JSON.stringify({ type: "find_match", requestId: "f1", sessionToken: m.sessionToken, displayName: "LinkTest" }));
  }
  if (m.type === "room_snapshot") { room = m.roomId; players = m.players; }
  if (m.type === "hand_sync" && m.hand && m.hand.length) hand = m.hand;
  if (m.type === "turn_started") turn = m;
});

await new Promise((r) => setTimeout(r, 16000));
ws.close();

let fail = 0;
const check = (label, ok, detail) => {
  if (!ok) fail += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
};

console.log("\n=== results over the public link ===");
check("WebSocket connected", seen.size > 0);
check("received a room (matchmaking worked)", !!room);
check("room has 4 seats, 3 of them bots", !!players && players.length === 4 && players.filter((p) => p.isBot).length === 3,
  players ? players.map((p) => p.displayName + (p.isBot ? "(bot)" : "")).join(", ") : "none");
check("private hand has exactly 14 cards", !!hand && hand.length === 14, hand ? hand.length + " cards" : "no hand");
check("a turn started with a server deadline", !!turn && !!turn.turnDeadlineAt);
console.log("\n  messages received: " + [...seen.entries()].map(([k, v]) => `${k}×${v}`).join(", "));
console.log(fail === 0 ? "\nPUBLIC LINK OK — playable\n" : `\n${fail} CHECK(S) FAILED\n`);
process.exit(fail === 0 ? 0 : 1);
