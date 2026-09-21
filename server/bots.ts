import { pool } from "./db.js";
import type { BotPersonality, Card } from "./rooms.js";
import { canSpell, selectCardsForWord } from "./words.js";

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

  const plans: BotPlan[] = [];
  for (const bot of bots.rows) {
    const personality = (bot.bot_personality as BotPersonality | null) ?? "normal";
    const hand = asHand(bot.private_hand);
    const isActivePlayer = bot.player_id === roomRow.active_player_id;
    const cardIds = selectCardsForWord(hand, target);

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

    // No move available. §17: the active bot must not sit out the full window.
    // A non-active bot simply stays silent, which is indistinguishable from a
    // player who does not answer.
    const timing = BOT_TIMING[personality].noMove;
    plans.push({
      roomId,
      turnNumber,
      playerId: bot.player_id as string,
      personality,
      kind: isActivePlayer ? "no_valid_move" : "idle",
      decisionMs: randomDelayInRange(timing, random),
      cardIds: [],
      word: null,
      isActivePlayer
    });
  }

  return plans;
}

/**
 * §16: "Bots must never intentionally submit after the 3-second solve window
 * when they have a valid move." Nudge the decision inside the deadline if the
 * sampled delay would land outside it.
 */
export function clampToWindow(decisionMs: number, windowRemainingMs: number): number {
  if (windowRemainingMs <= 0) return 0;
  return Math.max(0, Math.min(decisionMs, windowRemainingMs - 50));
}

/** True when the bot genuinely cannot answer — used by tests and by §17. */
export function botHasValidMove(hand: Card[], targetWord: string): boolean {
  return canSpell(hand, targetWord) && selectCardsForWord(hand, targetWord) !== null;
}
