/**
 * Live probe for the house-draws game.
 *
 * Joins a real matchmaking room as one player and checks what this mode
 * promises:
 *
 *   1. the GAME draws every round — no turn is ever owned by a player, and every
 *      turn puts strokes on the board;
 *   2. a player can GUESS — a wrong answer is refused as `wrong_answer`, never
 *      as `artist_cannot_solve` (§13 no longer shuts anybody out);
 *   3. a CORRECT answer starts the next round by itself, and so does an
 *      unanswered round — nothing has to be clicked for play to continue.
 *
 * The word is recovered from the hand plus the published word length: this is a
 * harness and may know the answer list. A real client sees only the drawing.
 *
 *   WS_URL=wss://champword-classic.onrender.com npx tsx scripts/house-probe.ts
 */
import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { DRAWABLE_WORDS } from "../server/doodles.js";

const url = process.env.WS_URL ?? "wss://champword-classic.onrender.com";
const rounds = Number(process.env.ROUNDS ?? 3);
/** Silence after the last stroke that counts as "the sketch is finished". */
const SKETCH_SETTLE_MS = 1300;

type Json = Record<string, any>;

const failures: string[] = [];
const inbox: Json[] = [];
let sessionToken: string | null = null;

const check = (ok: boolean, message: string): void => {
  if (ok) return;
  failures.push(message);
  console.error(`  FAIL  ${message}`);
};
const pass = (message: string): void => console.log(`  ok    ${message}`);

const ws = new WebSocket(url);
ws.on("message", (raw) => {
  try {
    inbox.push(JSON.parse(raw.toString()) as Json);
  } catch {
    /* ignore malformed frames */
  }
});

async function waitFor(predicate: (m: Json) => boolean, timeoutMs: number): Promise<Json> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const index = inbox.findIndex(predicate);
    if (index >= 0) return inbox.splice(index, 1)[0] as Json;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${predicate.toString().slice(0, 60)}`);
}

const send = (message: Json): void => ws.send(JSON.stringify(message));

/** Words of the announced length that this hand can spell. */
function candidates(hand: string[], length: number | null): string[] {
  return DRAWABLE_WORDS.filter((word) => length === null || word.length === length)
    .filter((word) => {
      const pool = [...hand];
      for (const letter of word) {
        const at = pool.indexOf(letter);
        if (at < 0) return false;
        pool.splice(at, 1);
      }
      return true;
    })
    .sort((a, b) => b.length - a.length);
}

function cardIdsFor(hand: Array<{ cardId: string; value: string }>, word: string): string[] | null {
  const used = new Set<string>();
  const cardIds: string[] = [];
  for (const letter of word) {
    const card = hand.find((candidate) => candidate.value === letter && !used.has(candidate.cardId));
    if (!card) return null;
    used.add(card.cardId);
    cardIds.push(card.cardId);
  }
  return cardIds;
}

/** Collect strokes for one turn until the house stops drawing. */
async function collectSketch(turnNumber: number): Promise<{ strokes: number; points: number }> {
  let strokes = 0;
  let points = 0;
  const hardStop = Date.now() + 6000;
  let quietSince = Date.now();
  while (Date.now() < hardStop) {
    const message = inbox.find((m) => m.type === "draw_op" || m.type === "draw_sync");
    if (message) {
      inbox.splice(inbox.indexOf(message), 1);
      if (message.type === "draw_sync") {
        strokes = 0;
        points = 0;
      }
      for (const stroke of (message.strokes ?? []) as Array<{ points?: unknown[] }>) {
        strokes += 1;
        points += stroke.points?.length ?? 0;
      }
      quietSince = Date.now();
      continue;
    }
    if (Date.now() - quietSince > SKETCH_SETTLE_MS) break;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  void turnNumber;
  return { strokes, points };
}

/** Submit candidate answers until the server accepts one. */
async function solve(round: Json, hand: Array<{ cardId: string; value: string }>, handWords: string[]): Promise<void> {
  const words = candidates(handWords, round.targetWordLength ?? null);
  console.log(`  guessing ${words.length} drawable words of ${round.targetWordLength} letters`);
  for (const word of words) {
    const cards = cardIdsFor(hand, word);
    if (!cards) continue;
    send({
      type: "submit_word",
      requestId: randomUUID(),
      sessionToken,
      roomId: round.roomId,
      roundNumber: round.roundNumber,
      turnNumber: round.turnNumber,
      cards,
      word
    });
    const answer = await waitFor((m) => m.type === "word_submission_result", 4000);
    if (answer.status === "accepted") {
      pass(`correct answer accepted: "${word.toUpperCase()}"`);
      return;
    }
    check(
      ["wrong_answer", "solve_window_expired", "stale_turn"].includes(answer.reason),
      `a guess was refused as "${answer.reason}" (unexpected reason)`
    );
    if (answer.reason === "solve_window_expired" || answer.reason === "stale_turn") return;
  }
  check(false, "no candidate answer was accepted");
}

async function main(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", (error) => reject(error));
  });

  const ready = await waitFor((m) => m.type === "server_ready", 20000);
  console.log(`server_ready (protocol ${ready.protocol}) at ${url}`);
  send({ type: "hello", requestId: randomUUID(), clientVersion: "house-probe" });
  const welcome = await waitFor((m) => m.type === "welcome", 20000);
  sessionToken = welcome.sessionToken;
  console.log(`welcome: playerId=${welcome.playerId}`);
  send({ type: "find_match", requestId: randomUUID(), sessionToken, displayName: "HouseProbe" });

  for (let round = 0; round < rounds; round += 1) {
    const started = await waitFor((m) => m.type === "turn_started", 45000);
    const handSync = await waitFor((m) => m.type === "hand_sync", 20000);
    const hand = (handSync.hand ?? []) as Array<{ cardId: string; value: string }>;

    console.log(
      `\nturn ${started.turnNumber}: artistry=${started.activePlayerId === null ? "THE HOUSE" : started.activePlayerId}` +
        ` word=${started.targetWordLength} letters hand=${hand.length} cards`
    );
    check(started.activePlayerId === null, `turn ${started.turnNumber} was owned by a player, not the house`);
    check(hand.length === 14, `turn ${started.turnNumber} dealt ${hand.length} cards, expected 14`);

    const sketch = await collectSketch(Number(started.turnNumber));
    console.log(`  the house drew ${sketch.strokes} strokes (${sketch.points} points)`);
    check(sketch.strokes > 0, `turn ${started.turnNumber} left the board empty`);
    if (sketch.strokes > 0) pass(`round ${started.turnNumber}: the board was drawn by the house`);

    // Round one is solved on purpose; the others are left alone, so both ways a
    // round can end are exercised.
    if (round === 0) {
      await solve(started, hand, hand.map((card) => card.value));
    } else {
      console.log("  not answering — the round must close on its own");
    }

    const ended = await waitFor(
      (m) => m.type === "turn_ended" && Number(m.turnNumber) === Number(started.turnNumber),
      25000
    );
    console.log(
      `  turn ${started.turnNumber} closed as ${ended.terminalState}` +
        (ended.word ? ` — the word was ${String(ended.word).toUpperCase()}` : "")
    );
    check(
      ended.terminalState === "solved" || ended.terminalState === "timed_out",
      `turn ${started.turnNumber} closed as "${ended.terminalState}"`
    );
    check(
      ended.nextTurnNumber === Number(started.turnNumber) + 1,
      `the close did not schedule a next round (nextTurnNumber=${ended.nextTurnNumber})`
    );

    // The point of the mode: the next round arrives with no client input at all.
    const next = await waitFor((m) => m.type === "turn_started", 15000);
    check(next.activePlayerId === null, `round ${next.turnNumber} was not a house round`);
    check(Number(next.turnNumber) === Number(started.turnNumber) + 1, "the next round skipped a turn");
    pass(`round ${next.turnNumber} started automatically after "${ended.terminalState}"`);
    inbox.push(next);
  }

  if (failures.length > 0) {
    console.error(`\nHOUSE PROBE FAIL (${failures.length}):\n - ${failures.join("\n - ")}`);
    process.exitCode = 1;
  } else {
    console.log(`\nHOUSE PROBE PASS (${rounds} rounds)`);
  }
}

try {
  await main();
} catch (error) {
  console.error(`HOUSE PROBE ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  ws.close();
}
