import { BUY_IN_COINS, COLORS, type Card, type CardColor, type CardKind } from "./cards.js";
import type { RoundState } from "./round.js";

/**
 * The bridge between a room's rows in PostgreSQL and the round rules.
 *
 * server/round.ts deals in a RoundState and knows nothing about columns;
 * this module is the only place that knows both. It validates as it reads: a
 * jsonb column that has drifted out of shape is rejected loudly here rather than
 * turned into a mysterious gameplay bug three turns later.
 */

const CARD_KINDS: readonly CardKind[] = [
  "letter",
  "skip",
  "reverse",
  "draw2",
  "discardAll",
  "wild",
  "wild4"
];

/** The game_rooms columns that carry a round. */
export type RoomCardColumns = {
  board: unknown;
  draw_pile: unknown;
  named_color: unknown;
  direction: unknown;
  drawn_card_id: unknown;
  winner_seat: unknown;
  uno_said: unknown;
  active_player_id: unknown;
};

/** The room_players columns that carry a round. */
export type PlayerCardColumns = {
  player_id: string;
  seat_number: number | string;
  private_hand: unknown;
  word: unknown;
};

/** A round plus the seat-to-player mapping the rules deliberately do not hold. */
export type LoadedRound = RoundState & { seats: string[]; };

function corrupt(field: string, detail: string): never {
  throw new Error(`corrupt_round_row:${field}:${detail}`);
}

export function parseCard(value: unknown, field: string): Card {
  if (typeof value !== "object" || value === null) corrupt(field, "not_an_object");
  const row = value as Record<string, unknown>;

  const cardId = row.cardId;
  const cardValue = row.value;
  const kind = row.kind;
  const color = row.color;

  if (typeof cardId !== "string" || cardId.length === 0) corrupt(field, "bad_card_id");
  if (typeof cardValue !== "string" || cardValue.length === 0) corrupt(field, "bad_value");
  if (typeof kind !== "string" || !CARD_KINDS.includes(kind as CardKind)) corrupt(field, "bad_kind");
  if (color !== null && !COLORS.includes(color as CardColor)) corrupt(field, "bad_color");

  return { cardId, value: cardValue, color: color as CardColor | null, kind: kind as CardKind };
}

export function parseCards(value: unknown, field: string): Card[] {
  if (!Array.isArray(value)) corrupt(field, "not_an_array");
  return value.map((entry) => parseCard(entry, field));
}

function parseDirection(value: unknown): 1 | -1 {
  const asNumber = typeof value === "string" ? Number(value) : value;
  if (asNumber === 1) return 1;
  if (asNumber === -1) return -1;
  corrupt("direction", "not_a_direction");
}

function parseSaid(value: unknown, seats: number): boolean[] {
  if (value === null || value === undefined) return Array.from({ length: seats }, () => false);
  if (!Array.isArray(value)) corrupt("uno_said", "not_an_array");
  if (value.length !== seats) corrupt("uno_said", "seat_count_mismatch");
  return value.map((entry) => entry === true);
}

function parseWord(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[a-z]{7}$/.test(value)) corrupt(field, "not_a_seven_letter_word");
  return value;
}

/**
 * Read a round out of its rows.
 *
 * Seats are ordered by seat number, so the seat index the rules use and the one
 * the table displays agree. A room without an active seat has no round in play,
 * which is the caller's business to check before calling this.
 */
export function toLoadedRound(room: RoomCardColumns, players: readonly PlayerCardColumns[]): LoadedRound {
  const ordered = players
    .map((player) => ({ ...player, seat: Number(player.seat_number) }))
    .sort((a, b) => a.seat - b.seat);

  if (ordered.length === 0) corrupt("room_players", "no_seats");

  const seats = ordered.map((player) => player.player_id);
  if (ordered.some((player, index) => player.seat !== index)) {
    corrupt("room_players", "seats_not_contiguous");
  }

  const winnerSeat = room.winner_seat === null || room.winner_seat === undefined
    ? null
    : Number(room.winner_seat);
  if (winnerSeat !== null && (winnerSeat < 0 || winnerSeat >= seats.length)) {
    corrupt("winner_seat", "not_seated");
  }

  // A settled round has nobody on the clock: the winner emptied their hand, so
  // the seat is cleared while the board shows the reveal. Seat 0 is recorded as
  // a placeholder — safe because every rule that reads `activeSeat` refuses a
  // finished round before it looks at it (`playCard`, `drawCard`, `pass`) or
  // never reads it at all (`settle`). Reading a settled round as corrupt is what
  // would break a resume during the reveal.
  const activePlayerId = typeof room.active_player_id === "string" ? room.active_player_id : null;
  const seatedActive = activePlayerId ? seats.indexOf(activePlayerId) : -1;
  if (!activePlayerId && winnerSeat === null) corrupt("active_player_id", "missing");
  if (activePlayerId && seatedActive < 0) corrupt("active_player_id", "not_seated");
  const activeSeat = seatedActive < 0 ? 0 : seatedActive;

  const namedColor = room.named_color === null || room.named_color === undefined
    ? null
    : (COLORS.includes(room.named_color as CardColor)
        ? (room.named_color as CardColor)
        : corrupt("named_color", "bad_color"));

  return {
    seats,
    hands: ordered.map((player) => parseCards(player.private_hand, "private_hand")),
    words: ordered.map((player) => parseWord(player.word, "word")),
    board: parseCards(room.board, "board"),
    drawPile: parseCards(room.draw_pile, "draw_pile"),
    named: namedColor,
    direction: parseDirection(room.direction),
    activeSeat,
    drawnCardId: typeof room.drawn_card_id === "string" ? room.drawn_card_id : null,
    unoSaid: parseSaid(room.uno_said, seats.length),
    finished: winnerSeat !== null,
    winnerSeat
  };
}

/** The column values to write back for a round. */
export type RoundWrite = {
  board: Card[];
  draw_pile: Card[];
  named_color: CardColor | null;
  direction: 1 | -1;
  drawn_card_id: string | null;
  winner_seat: number | null;
  uno_said: boolean[];
  active_player_id: string;
};

export function toRoundWrite(round: LoadedRound): RoundWrite {
  const activePlayerId = round.seats[round.activeSeat];
  if (!activePlayerId) throw new Error("corrupt_round_state:active_seat_off_table");

  return {
    board: round.board,
    draw_pile: round.drawPile,
    named_color: round.named,
    direction: round.direction,
    drawn_card_id: round.drawnCardId,
    winner_seat: round.winnerSeat,
    uno_said: round.unoSaid,
    active_player_id: activePlayerId
  };
}

/** Hands per seat, in seat order, for writing room_players back. */
export function toHandWrites(round: LoadedRound): { player_id: string; private_hand: Card[]; word: string }[] {
  return round.seats.map((playerId, seat) => ({
    player_id: playerId,
    private_hand: round.hands[seat] as Card[],
    word: round.words[seat] as string
  }));
}

/**
 * A seat must be able to cover the stake before it sits down. The wallet is the
 * server's, so this is the check that decides it — never the client's copy of
 * the balance.
 */
export function canBuyIn(coins: number): boolean {
  return Number.isFinite(coins) && coins >= BUY_IN_COINS;
}

export const BUY_IN = BUY_IN_COINS;
