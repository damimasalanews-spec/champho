import { BUY_IN_COINS, type Card, type CardColor } from "./cards.js";
import { legalCards, settle, type RoundResult } from "./round.js";
import type { LoadedRound } from "./room-cards.js";

/**
 * What a seat is allowed to see.
 *
 * The whole view is built per seat rather than once and trimmed, because the
 * cost of getting that wrong is another player's hand or a word that has not
 * been won yet. Nothing here reads the draw pile's contents or another seat's
 * cards, so there is nothing to leak by accident.
 */

export type SeatMeta = {
  playerId: string;
  displayName: string | null;
  connected: boolean;
  score: number;
  isBot: boolean;
};

export type SeatView = {
  playerId: string;
  seat: number;
  displayName: string | null;
  connected: boolean;
  isBot: boolean;
  /** How many cards the seat holds — never which ones. */
  handCount: number;
  saidUno: boolean;
  score: number;
  /** What the seat has in its wallet. The table is played for coins; they are public. */
  coins: number;
  isActive: boolean;
};

export type RoundView = {
  type: "round_view";
  roomId: string;
  roundNumber: number;
  turnNumber: number;
  phase: string;
  activePlayerId: string | null;
  /** 1 clockwise, -1 anticlockwise. */
  direction: 1 | -1;
  /** The colour a Wild named, which overrides the top card's own colour. */
  namedColor: CardColor | null;
  /** The pile of thrown cards, oldest first. Public. */
  board: Card[];
  /** Only ever a count: the draw pile's contents are nobody's business. */
  drawCount: number;
  deadlineAt: string | null;
  seats: SeatView[];
  you: {
    playerId: string;
    seat: number;
    hand: Card[];
    /** The cards this seat may legally throw right now, by id. */
    legal: string[];
    /** The card drawn this turn, which is the only one throwable if set. */
    drawnCardId: string | null;
    /** The word this seat's hand spells — only once it has been revealed. */
    word: string | null;
    /**
     * This seat's own wallet, so the table can show what it is playing for
     * without the client keeping a balance of its own — the server's number is
     * the only one that decides who may sit down.
     */
    coins: number;
  };
  /** Present only once the round is settled. */
  result: RoundResult | null;
};

export type BuildViewOptions = {
  roomId: string;
  roundNumber: number;
  turnNumber: number;
  phase: string;
  deadlineAt: Date | null;
  seats: SeatMeta[];
  /**
   * Wallet balances by player id. Omitted only by tests and fixtures; a dealt
   * seat always has a wallet, because it could not have bought in without one.
   */
  coins?: ReadonlyMap<string, number>;
};

export function buildRoundView(round: LoadedRound, seat: number, options: BuildViewOptions): RoundView {
  const playerId = round.seats[seat];
  if (!playerId) throw new Error("corrupt_round_state:seat_off_table");

  const isTurn = !round.finished && round.activeSeat === seat;
  const legal = isTurn ? legalCards(round, seat).map((card) => card.cardId) : [];
  const result = settle(round, round.seats.length);

  return {
    type: "round_view",
    roomId: options.roomId,
    roundNumber: options.roundNumber,
    turnNumber: options.turnNumber,
    phase: options.phase,
    activePlayerId: round.finished ? null : (round.seats[round.activeSeat] as string),
    direction: round.direction,
    namedColor: round.named,
    board: round.board.slice(),
    drawCount: round.drawPile.length,
    deadlineAt: options.deadlineAt ? options.deadlineAt.toISOString() : null,
    seats: round.seats.map((seatPlayerId, index) => {
      const meta = options.seats[index];
      return {
        playerId: seatPlayerId,
        seat: index,
        displayName: meta?.displayName ?? null,
        connected: meta?.connected ?? false,
        isBot: meta?.isBot ?? false,
        handCount: (round.hands[index] as Card[]).length,
        saidUno: round.unoSaid[index] === true,
        score: meta?.score ?? 0,
        coins: options.coins?.get(seatPlayerId) ?? BUY_IN_COINS,
        isActive: !round.finished && round.activeSeat === index
      };
    }),
    you: {
      playerId,
      seat,
      hand: (round.hands[seat] as Card[]).slice(),
      legal,
      drawnCardId: round.drawnCardId,
      // The word is the round's secret until it has been won: it is what the
      // board spells out at the end, and knowing it early would let a seat aim
      // for another player's hand.
      word: round.finished ? (round.words[seat] as string) : null,
      coins: options.coins?.get(playerId) ?? BUY_IN_COINS
    },
    result
  };
}

/** The result to broadcast when a round ends, or null while it is in play. */
export function settledResult(round: LoadedRound): RoundResult | null {
  return settle(round, round.seats.length);
}
