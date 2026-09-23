/**
 * Prove the PUBLIC tunnel URL can actually play the game, WebSocket included.
 *
 * The two checks that matter are the ones that can only come from the server:
 * a PRIVATE hand (§11 addresses a hand to exactly one socket) and a turn with a
 * server-issued deadline. A page can be served and still be unplayable, which is
 * the failure this script exists to catch.
 *
 * Both shapes of both checks are accepted, because the server starts whichever
 * round the room is for and they deliver the same facts differently:
 *
 *   card round    a seat's own view  -> round_view.view.you.hand (7) + .deadlineAt
 *   classic round the drawing game   -> hand_sync.hand (14) + turn_started.turnDeadlineAt
 *
 * hand_sync is still a live message — but only the classic drawing game sends it
 * (see sendHandTo in server/index.ts: "A card round needs no equivalent: there, a
 * hand arrives as part of the seat's own view"). Asserting on hand_sync alone is
 * what made this script report a playable server as unplayable: matchmaking now
 * starts a card round, so hand_sync never arrives and both checks failed while
 * the game was fine. The hand was there all along, inside round_view.
 */
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
let players = null;
let hand = null;
let mode = null;
let deadline = null;
let deadlineFrom = null;
let seatsExposeOwnHandOnly = true;

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

  // the classic drawing game
  if (m.type === "hand_sync" && Array.isArray(m.hand) && m.hand.length) { hand = m.hand; mode = "classic"; }
  if (m.type === "turn_started" && m.turnDeadlineAt) { deadline = m.turnDeadlineAt; deadlineFrom = "turn_started"; }

  // the card round
  if (m.type === "round_view") {
    const v = m.view || m;
    if (v.you && Array.isArray(v.you.hand) && v.you.hand.length) { hand = v.you.hand; mode = "card"; }
    if (v.deadlineAt) { deadline = v.deadlineAt; deadlineFrom = "round_view"; }
    // no seat but ours may carry a hand: the table sees counts, never cards
    if (Array.isArray(v.seats)) {
      for (const seat of v.seats) if (Array.isArray(seat.hand)) seatsExposeOwnHandOnly = false;
    }
  }
});

await new Promise((r) => setTimeout(r, 16000));
ws.close();

let fail = 0;
const check = (label, ok, detail) => {
  if (!ok) fail += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
};

const expected = mode === "classic" ? 14 : 7;

console.log("\n=== results over the public link ===");
check("WebSocket connected", seen.size > 0);
check("received a room (matchmaking worked)", !!room);
check("room has 4 seats, 3 of them bots", !!players && players.length === 4 && players.filter((p) => p.isBot).length === 3,
  players ? players.map((p) => p.displayName + (p.isBot ? "(bot)" : "")).join(", ") : "none");
check(`private hand arrived (${expected} cards, the ${mode ?? "?"} round)`,
  !!hand && hand.length === expected,
  hand ? `${hand.length} cards via ${mode === "card" ? "round_view.you.hand" : "hand_sync"}` : "no hand");
check("no other seat's cards were sent to us", seatsExposeOwnHandOnly, seatsExposeOwnHandOnly ? "" : "a seat carried a hand array");
check("a turn started with a server deadline", !!deadline, deadline ? `${deadlineFrom}: ${deadline}` : "no deadline");
console.log("\n  messages received: " + [...seen.entries()].map(([k, v]) => `${k}×${v}`).join(", "));
console.log(fail === 0 ? "\nPUBLIC LINK OK — playable\n" : `\n${fail} CHECK(S) FAILED\n`);
process.exit(fail === 0 ? 0 : 1);
