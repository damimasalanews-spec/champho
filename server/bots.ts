import { pool } from "./db.js";
import type { BotPersonality, Card } from "./rooms.js";
import { canSpell, selectCardsForWord } from "./words.js";
import { COLORS, type CardColor } from "./cards.js";
import { legalCards } from "./round.js";
import type { LoadedRound } from "./room-cards.js";

/**
 * Server-side bot engine (§16–19).
 *
 * Bots decide and act on the server. Their hands are read from the database and
 * never transmitted, so there is no `bot1Hand` for a client to inspect (§11).
 * Decisions are validated by the same `transition()` the human path uses, so a
 * bot cannot consume cards it does not own or act out of turn.
 */

export type BotTiming = { thinking: [number, number]; noMove: [number, number] };

/** §16. Asserted by test — see server/tests/bots.test.ts. */
export const BOT_TIMING: Record<BotPersonality, BotTiming> = {
  easy: { thinking: [1500, 2700], noMove: [600, 1000] },
  normal: { thinking: [900, 2000], noMove: [450, 800] },
  aggressive: { thinking: [350, 1200], noMove: [250, 600] }
};

/** Seat order gives a visible difficulty ramp: left = easy, right = normal, top = aggressive. */
export const SEAT_PERSONALITIES: readonly BotPersonality[] = ["easy", "normal", "aggressive"];

export function randomDelayInRange(range: [number, number], random: () => number = Math.random): number {
  const [min, max] = range;
  return Math.floor(min + random() * (max - min + 1));
}

export type BotPlanKind = "submit" | "no_valid_move" | "idle";

export type BotPlan = {
  roomId: string;
  turnNumber: number;
  playerId: string;
  personality: BotPersonality;
  kind: BotPlanKind;
  decisionMs: number;
  cardIds: string[];
  word: string | null;
  isActivePlayer: boolean;
};

function asHand(value: unknown): Card[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (candidate): candidate is Card =>
      !!candidate &&
      typeof candidate === "object" &&
      typeof (candidate as Card).cardId === "string" &&
      typeof (candidate as Card).value === "string"
  );
}

/**
 * Decide, for every bot in the room, what it will do this turn and how long it
 * will "think" first. Pure with respect to game state: it reads, never writes.
 */
export async function planBotTurn(
  roomId: string,
  turnNumber: number,
  random: () => number = Math.random
): Promise<BotPlan[]> {
  const room = await pool.query<{ target_word: string | null; active_player_id: string | null; turn_number: string }>(
    `SELECT target_word, active_player_id, turn_number FROM public.game_rooms WHERE id=$1`,
    [roomId]
  );
  const roomRow = room.rows[0];
  if (!roomRow) return [];
  // If the turn already moved on, these plans are stale — drop them rather than
  // schedule action against a turn that no longer exists.
  if (Number(roomRow.turn_number) !== turnNumber) return [];

  const target = roomRow.target_word;
  if (!target) return [];

  const bots = await pool.query(
    `SELECT player_id, private_hand, bot_personality
       FROM public.room_players
      WHERE room_id=$1 AND is_bot=true
      ORDER BY seat_number`,
    [roomId]
  );

  // Is this turn winnable by anyone at all? Only the artist's side may declare
  // §17's no_valid_move, and only when no OTHER player can answer.
  const everyone = await pool.query(
    `SELECT player_id, private_hand FROM public.room_players WHERE room_id=$1`,
    [roomId]
  );
  const anyoneElseSolvable = everyone.rows.some(
    (row) => row.player_id !== roomRow.active_player_id && canSpell(asHand(row.private_hand), target)
  );

  const plans: BotPlan[] = [];
  for (const bot of bots.rows) {
    const personality = (bot.bot_personality as BotPersonality | null) ?? "normal";
    const hand = asHand(bot.private_hand);
    const isActivePlayer = bot.player_id === roomRow.active_player_id;
    const cardIds = selectCardsForWord(hand, target);

    // §13: the artist draws and never solves its own drawing, so an artist bot
    // never submits. It either waits for the others, or reports a dead turn
    // early (§17) instead of burning the whole window.
    if (isActivePlayer) {
      plans.push({
        roomId,
        turnNumber,
        playerId: bot.player_id as string,
        personality,
        kind: anyoneElseSolvable ? "idle" : "no_valid_move",
        decisionMs: randomDelayInRange(BOT_TIMING[personality].noMove, random),
        cardIds: [],
        word: null,
        isActivePlayer
      });
      continue;
    }

    if (cardIds && cardIds.length > 0) {
      plans.push({
        roomId,
        turnNumber,
        playerId: bot.player_id as string,
        personality,
        kind: "submit",
        decisionMs: randomDelayInRange(BOT_TIMING[personality].thinking, random),
        cardIds,
        word: target,
        isActivePlayer
      });
      continue;
    }

    // A solver with no move simply stays silent, which is indistinguishable
    // from a player who does not answer.
    plans.push({
      roomId,
      turnNumber,
      playerId: bot.player_id as string,
      personality,
      kind: "idle",
      decisionMs: randomDelayInRange(BOT_TIMING[personality].noMove, random),
      cardIds: [],
      word: null,
      isActivePlayer
    });
  }

  return plans;
}

/**
 * §16: "Bots must never intentionally submit after the solve window when they
 * have a valid move." Nudge the decision inside the deadline if the sampled
 * delay would land outside it.
 */
export function clampToWindow(decisionMs: number, windowRemainingMs: number): number {
  if (windowRemainingMs <= 0) return 0;
  return Math.max(0, Math.min(decisionMs, windowRemainingMs - 50));
}

/**
 * A SOLVER's answer time, expressed as a share of the round's window rather than
 * as fixed milliseconds.
 *
 * The whole window now belongs to the guessers (the house draws, see
 * ROUND_WINDOW_MS), so absolute timings no longer make sense: an aggressive bot
 * answering 350ms after the turn began would win every round before the human
 * had finished looking at the sketch. Answering as a share of the window keeps
 * the bots beatable, and the spread IS the difficulty ramp — an easy bot only
 * answers near the end (and often cannot answer at all), while an aggressive one
 * punishes a slow guess.
 *
 * Because these are shares, they stretch with the window: a minute-long round
 * means the quickest bot still waits about 27s, so the minute is time the player
 * actually gets to use rather than a longer wait for the same early loss.
 */
export const ANSWER_WINDOW_SHARE: Record<BotPersonality, [number, number]> = {
  easy: [0.75, 0.95],
  normal: [0.6, 0.82],
  aggressive: [0.45, 0.7]
};

export function botAnswerDelayMs(
  personality: BotPersonality,
  windowRemainingMs: number,
  random: () => number = Math.random
): number {
  const [low, high] = ANSWER_WINDOW_SHARE[personality];
  const share = low + random() * (high - low);
  return clampToWindow(Math.round(windowRemainingMs * share), windowRemainingMs);
}

/** True when the bot genuinely cannot answer — used by tests and by §17. */
export function botHasValidMove(hand: Card[], targetWord: string): boolean {
  return canSpell(hand, targetWord) && selectCardsForWord(hand, targetWord) !== null;
}

// ---------------------------------------------------------------------------
// The card round
// ---------------------------------------------------------------------------

export type CardPlanKind = "play" | "draw";

export type CardPlan = {
  kind: CardPlanKind;
  /** The card to throw, when the plan is to play. */
  cardId: string | null;
  /** The colour a Wild or Wild Draw Four names, when one is thrown. */
  color: CardColor | null;
};

/**
 * What a bot does on its turn. Pure: it reads the round and decides, it never
 * writes, so a decision can be tested without a database or a socket.
 *
 * It is deliberately beatable rather than clever — a bot throws the first card
 * the rules allow and draws when it has nothing, which is what a player who is
 * not trying to lose would do. A wild names the colour it holds most of: the one
 * heuristic that makes a wild worth throwing rather than dumping.
 */
export function planCardTurn(round: LoadedRound, seat: number): CardPlan {
  const options = legalCards(round, seat);
  if (options.length === 0) return { kind: "draw", cardId: null, color: null };

  const card = options[0] as { cardId: string; kind: string };
  if (card.kind !== "wild" && card.kind !== "wild4") {
    return { kind: "play", cardId: card.cardId, color: null };
  }

  const held = new Map<CardColor, number>();
  for (const color of COLORS) held.set(color, 0);
  for (const inHand of round.hands[seat] ?? []) {
    if (inHand.kind === "wild" || inHand.kind === "wild4") continue;
    const color = inHand.color;
    if (color) held.set(color, (held.get(color) ?? 0) + 1);
  }

  let best = COLORS[0] as CardColor;
  for (const color of COLORS) {
    if ((held.get(color) ?? 0) > (held.get(best) ?? 0)) best = color;
  }

  return { kind: "play", cardId: card.cardId, color: best };
}

/**
 * How long a bot takes over its turn, from the personality's thinking range.
 *
 * A seat with no personality recorded is treated as a normal bot rather than
 * throwing: this is called while arming a timer, so a throw here means no timer
 * is ever armed and the table silently plays every turn down to the clock.
 */
export function cardTurnDelayMs(personality: BotPersonality | null | undefined, random: () => number = Math.random): number {
  const timing = BOT_TIMING[personality as BotPersonality] ?? BOT_TIMING.normal;
  return randomDelayInRange(timing.thinking, random);
}
