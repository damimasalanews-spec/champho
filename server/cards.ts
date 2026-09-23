import { randomUUID } from "node:crypto";
import { SEVEN_LETTER_WORDS } from "./words7.js";

/**
 * The letter-card deck.
 *
 * Classic mode keeps the official UNO shape and swaps the numbers for letters:
 * four colours, nineteen cards of each colour that would have been 0-9, the same
 * action cards, the same wilds. The one thing that is not a plain shuffle is the
 * opening deal — every seat is dealt seven cards that spell a real seven-letter
 * word, which is what the board reveals once a hand empties.
 */

export const COLORS = ["red", "yellow", "green", "blue"] as const;
export type CardColor = (typeof COLORS)[number];

export type CardKind = "letter" | "skip" | "reverse" | "draw2" | "discardAll" | "wild" | "wild4";

export type Card = {
  cardId: string;
  /** The letter for a letter card, otherwise the symbol the client renders. */
  value: string;
  /** Wilds are colourless until they are played and name a colour. */
  color: CardColor | null;
  kind: CardKind;
};

/** Seven, matching the seven-letter word the hand spells. */
export const HAND_SIZE = 7;

/** UNO gives every colour nineteen number cards; here they are letters. */
export const LETTERS_PER_COLOR = 19;

/** Per colour, exactly the official counts. */
export const ACTION_COUNTS: Readonly<Record<"skip" | "reverse" | "draw2" | "discardAll", number>> = {
  skip: 2,
  reverse: 2,
  draw2: 2,
  discardAll: 1
};

/** Colourless, as in the official deck. */
export const WILD_COUNT = 4;
export const WILD4_COUNT = 4;

/** One table buys in at 500 coins for now; bigger tables come later. */
export const BUY_IN_COINS = 500;

export const DECK_SIZE =
  COLORS.length * LETTERS_PER_COLOR +
  COLORS.length * (ACTION_COUNTS.skip + ACTION_COUNTS.reverse + ACTION_COUNTS.draw2 + ACTION_COUNTS.discardAll) +
  WILD_COUNT +
  WILD4_COUNT;

/**
 * What a card is worth when a round is scored. Letter values follow rarity, so
 * common letters are cheap and awkward ones cost more — the same idea as
 * "number cards score face value".
 */
export const LETTER_VALUES: Readonly<Record<string, number>> = {
  e: 1, a: 1, i: 1, o: 1, t: 1, n: 1, s: 1, r: 1,
  l: 2, u: 2, d: 2, g: 2, b: 2, c: 2, m: 2, p: 2,
  f: 3, h: 3, v: 3, w: 3, y: 4, k: 4, j: 4,
  x: 5, q: 6, z: 6
};

export function letterValue(letter: string): number {
  return LETTER_VALUES[letter.toLowerCase()] ?? 5;
}

export type Deal = {
  /** One hand per seat, each spelling one word from `words`. */
  hands: Card[][];
  /** The word each seat's opening hand spells, in seat order. */
  words: string[];
  /** Cards left to draw from. Never contains a dealt card. */
  drawPile: Card[];
};

function makeLetter(letter: string, color: CardColor): Card {
  return { cardId: randomUUID(), value: letter.toLowerCase(), color, kind: "letter" };
}

function makeAction(kind: Exclude<CardKind, "letter">, color: CardColor | null): Card {
  const value =
    kind === "skip" ? "skip"
    : kind === "reverse" ? "reverse"
    : kind === "draw2" ? "+2"
    : kind === "discardAll" ? "all"
    : kind === "wild4" ? "+4"
    : "wild";
  return { cardId: randomUUID(), value, color, kind };
}

function shuffled<T>(items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = out[i] as T;
    const b = out[j] as T;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

/**
 * Deal a round.
 *
 * The words are chosen first and their letters become the opening hands, so the
 * deal is constructed rather than random. The remaining letter cards are filled
 * in from the words the deal did not use, spread across the colours so each
 * colour holds exactly nineteen — the same balance the official deck has between
 * its four colours.
 */
export function dealRound(seatCount: number): Deal {
  const pool = shuffled(SEVEN_LETTER_WORDS);
  const words = pool.slice(0, seatCount);
  if (words.length < seatCount) {
    throw new Error("word_pool_too_small");
  }

  const hands: Card[][] = words.map((word, seat) =>
    word.split("").map((letter, i) => makeLetter(letter, COLORS[(i + seat) % COLORS.length] as CardColor))
  );

  // A dealt card is out of the deck for good, so each colour only has to be
  // topped up by what the deal did not already take from it. Nineteen letters
  // per colour is the total in play, dealt plus drawable, exactly as the
  // official deck's nineteen numbers per colour are the total in play.
  const dealtPerColor = new Map<CardColor, number>();
  for (const color of COLORS) dealtPerColor.set(color, 0);
  for (const hand of hands) {
    for (const card of hand) {
      const color = card.color as CardColor;
      dealtPerColor.set(color, (dealtPerColor.get(color) ?? 0) + 1);
    }
  }

  // Filler comes from the words the deal did not use, so the draw pile still
  // reads like language rather than like alphabet soup.
  const fillerSource = pool.slice(seatCount).join("");
  let cursor = 0;

  const drawPile: Card[] = [];
  for (const color of COLORS) {
    const already = dealtPerColor.get(color) ?? 0;
    for (let i = already; i < LETTERS_PER_COLOR; i += 1) {
      const letter = fillerSource[cursor % fillerSource.length] as string;
      cursor += 1;
      drawPile.push(makeLetter(letter, color));
    }
    for (const [kind, count] of Object.entries(ACTION_COUNTS)) {
      for (let i = 0; i < count; i += 1) {
        drawPile.push(makeAction(kind as Exclude<CardKind, "letter">, color));
      }
    }
  }
  for (let i = 0; i < WILD_COUNT; i += 1) drawPile.push(makeAction("wild", null));
  for (let i = 0; i < WILD4_COUNT; i += 1) drawPile.push(makeAction("wild4", null));

  return { hands, words, drawPile: shuffled(drawPile) };
}

/**
 * Turn the top card over to start the board. Action cards are returned to the
 * bottom of the pile until a letter turns up, so the first player always has a
 * colour or a letter to match.
 */
export function openBoard(drawPile: Card[]): { board: Card[]; drawPile: Card[] } {
  const pile = drawPile.slice();
  const board: Card[] = [];
  while (pile.length > 0) {
    const card = pile.shift() as Card;
    if (card.kind === "letter") {
      board.push(card);
      return { board, drawPile: pile };
    }
    pile.push(card);
  }
  return { board, drawPile: pile };
}

/** The colour currently in force: the top card's, unless a wild named one. */
export function activeColor(board: Card[], named: CardColor | null): CardColor | null {
  if (named) return named;
  const top = board[board.length - 1];
  return top ? top.color : null;
}

/**
 * Official matching: colour, or the same letter, or the same symbol. A Wild goes
 * on anything; a Wild Draw Four may only be played when the hand holds no card
 * of the colour currently in force, which is what makes it challengeable.
 */
export function canPlay(card: Card, board: Card[], named: CardColor | null, hand: Card[]): boolean {
  if (card.kind === "wild") return true;
  if (card.kind === "wild4") {
    const color = activeColor(board, named);
    if (!color) return true;
    return !hand.some((c) => c.color === color);
  }
  const top = board[board.length - 1];
  if (!top) return true;
  const color = activeColor(board, named);
  if (card.color && color && card.color === color) return true;
  if (!card.color) return false;
  if (top.kind === "letter" && card.kind === "letter" && card.value === top.value) return true;
  return card.kind !== "letter" && card.kind === top.kind;
}

/** Any card the hand could legally throw right now. */
export function playableCards(hand: Card[], board: Card[], named: CardColor | null): Card[] {
  return hand.filter((card) => canPlay(card, board, named, hand));
}

/** What the cards left in a hand are worth when the round is scored. */
export function scoreHand(hand: Card[]): number {
  return hand.reduce((total, card) => {
    if (card.kind === "letter") return total + letterValue(card.value);
    if (card.kind === "skip" || card.kind === "reverse" || card.kind === "draw2") return total + 20;
    return total + 50;
  }, 0);
}

/** Every seat buys in, and the winner takes the table. */
export function potCoins(seatCount: number): number {
  return BUY_IN_COINS * seatCount;
}

export function winningsCoins(seatCount: number): number {
  return potCoins(seatCount) - BUY_IN_COINS;
}
