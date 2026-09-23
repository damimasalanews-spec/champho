import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTION_COUNTS,
  BUY_IN_COINS,
  COLORS,
  DECK_SIZE,
  LETTERS_PER_COLOR,
  WILD4_COUNT,
  WILD_COUNT,
  activeColor,
  canPlay,
  dealRound,
  openBoard,
  playableCards,
  potCoins,
  scoreHand,
  winningsCoins,
  type Card,
  type CardColor,
  type CardKind
} from "../cards.js";
import { SEVEN_LETTER_WORDS } from "../words7.js";

const card = (kind: CardKind, color: CardColor | null, value: string): Card => ({
  cardId: `${kind}-${color ?? "none"}-${value}`,
  value,
  color,
  kind
});

const letters = (cards: Card[]) => cards.filter((c) => c.kind === "letter");
const byColor = (cards: Card[]) => {
  const out = new Map<CardColor, number>();
  for (const color of COLORS) out.set(color, 0);
  for (const c of letters(cards)) out.set(c.color as CardColor, (out.get(c.color as CardColor) ?? 0) + 1);
  return out;
};

/**
 * The pool is the deck's source material: a word that is not seven letters, or
 * that repeats, would either break the deal's guarantee or make a round
 * undealable.
 */
test("the word pool holds only distinct seven-letter A-Z words", () => {
  assert.ok(SEVEN_LETTER_WORDS.length >= 100, `pool is too small to deal from: ${SEVEN_LETTER_WORDS.length}`);
  for (const word of SEVEN_LETTER_WORDS) {
    assert.match(word, /^[a-z]{7}$/, `"${word}" is not seven lowercase A-Z letters`);
  }
  assert.equal(new Set(SEVEN_LETTER_WORDS).size, SEVEN_LETTER_WORDS.length, "the pool repeats a word");
});

/**
 * The whole point of the constructed deal: what a player is handed is a real
 * word, spelled out, and only in letters — an action card would break the word
 * and the board's reveal at the end of the round.
 */
test("every seat is dealt seven letter cards that spell one real word", () => {
  const deal = dealRound(4);

  assert.equal(deal.hands.length, 4, "a four-seat table gets four hands");
  assert.equal(new Set(deal.words).size, 4, "a deal must not hand out the same word twice");

  deal.hands.forEach((hand, seat) => {
    assert.equal(hand.length, 7, `seat ${seat} must hold seven cards`);
    for (const c of hand) {
      assert.equal(c.kind, "letter", `seat ${seat} was dealt a ${c.kind}, which cannot spell a word`);
      assert.ok(c.color, `seat ${seat} was dealt a colourless letter`);
    }
    const word = deal.words[seat] as string;
    assert.ok(SEVEN_LETTER_WORDS.includes(word), `"${word}" is not in the pool`);
    assert.equal(
      [...hand.map((c) => c.value)].sort().join(""),
      [...word].sort().join(""),
      `seat ${seat}'s cards do not spell "${word}"`
    );
  });
});

/**
 * Official shape: nineteen number cards per colour become nineteen letter cards
 * per colour, alongside the same action cards, plus the four extra Discard All
 * cards this mode adds. Dealt cards are part of those nineteen, not extra.
 */
test("the deck keeps the official shape, with letters where the numbers were", () => {
  const deal = dealRound(4);
  const inPlay = [...deal.hands.flat(), ...deal.drawPile];

  assert.equal(inPlay.length, DECK_SIZE, `a table should hold ${DECK_SIZE} cards, found ${inPlay.length}`);

  const perColor = byColor(inPlay);
  for (const color of COLORS) {
    assert.equal(
      perColor.get(color),
      LETTERS_PER_COLOR,
      `${color} should hold ${LETTERS_PER_COLOR} letter cards once dealt, found ${perColor.get(color)}`
    );
  }

  for (const color of COLORS) {
    for (const [kind, count] of Object.entries(ACTION_COUNTS)) {
      const found = deal.drawPile.filter((c) => c.kind === kind && c.color === color).length;
      assert.equal(found, count, `${color} should hold ${count} ${kind} cards, found ${found}`);
    }
  }

  assert.equal(deal.drawPile.filter((c) => c.kind === "wild").length, WILD_COUNT);
  assert.equal(deal.drawPile.filter((c) => c.kind === "wild4").length, WILD4_COUNT);
  for (const wild of deal.drawPile.filter((c) => c.kind === "wild" || c.kind === "wild4")) {
    assert.equal(wild.color, null, "a wild is colourless until it is played");
  }
});

/** A dealt card that also sits in the draw pile would put two of it in play. */
test("no dealt card is left in the draw pile and every card id is unique", () => {
  const deal = dealRound(4);
  const dealt = new Set(deal.hands.flat().map((c) => c.cardId));
  for (const c of deal.drawPile) {
    assert.ok(!dealt.has(c.cardId), `${c.cardId} was dealt and is still drawable`);
  }
  const all = [...deal.hands.flat(), ...deal.drawPile].map((c) => c.cardId);
  assert.equal(new Set(all).size, all.length, "a card id is in play twice");
});

/** The first player must have something to match, so the board opens on a letter. */
test("the board opens on a letter card, never on an action", () => {
  const deal = dealRound(4);
  const opened = openBoard(deal.drawPile);

  assert.equal(opened.board.length, 1);
  assert.equal(opened.board[0]?.kind, "letter", "the board opened on a non-letter");
  assert.equal(opened.drawPile.length, deal.drawPile.length - 1, "opening the board must consume one card");
});

test("matching follows UNO: colour, same letter, same symbol", () => {
  const board = [card("letter", "red", "a")];

  assert.ok(canPlay(card("letter", "red", "k"), board, null, []), "a red card may go on red");
  assert.ok(canPlay(card("letter", "blue", "a"), board, null, []), "a blue A may go on a red A");
  assert.ok(!canPlay(card("letter", "blue", "k"), board, null, []), "a blue K matches neither colour nor letter");

  const symbols = [card("skip", "green", "skip")];
  assert.ok(canPlay(card("skip", "blue", "skip"), symbols, null, []), "a Skip may go on a Skip");
  assert.ok(!canPlay(card("draw2", "blue", "+2"), symbols, null, []), "a +2 may not go on a Skip");
});

/**
 * The Wild Draw Four restriction is what makes it challengeable, so it has to be
 * enforced against the hand rather than merely asked of the client.
 */
test("a Wild goes on anything, a Wild Draw Four only when the colour is missing", () => {
  const board = [card("letter", "red", "a")];
  const holdingRed = [card("letter", "red", "k"), card("wild4", null, "+4")];
  const holdingBlue = [card("letter", "blue", "k"), card("wild4", null, "+4")];

  assert.ok(canPlay(card("wild", null, "wild"), board, null, holdingRed), "a Wild always plays");
  assert.ok(!canPlay(card("wild4", null, "+4"), board, null, holdingRed), "a +4 is illegal while holding red");
  assert.ok(canPlay(card("wild4", null, "+4"), board, null, holdingBlue), "a +4 is legal with no red in hand");
  assert.equal(playableCards(holdingRed, board, null).filter((c) => c.kind === "wild4").length, 0);
});

test("a wild names the colour that is in force", () => {
  assert.equal(activeColor([card("letter", "green", "k")], null), "green");
  assert.equal(activeColor([card("wild", null, "wild")], "yellow"), "yellow");
  assert.equal(activeColor([card("wild", null, "wild")], null), null);
});

/** Scoring is the official one, with letters standing in for the numbers. */
test("what a hand is worth follows the official card values", () => {
  assert.equal(scoreHand([card("letter", "red", "e")]), 1);
  assert.equal(scoreHand([card("letter", "red", "z")]), 6);
  assert.equal(scoreHand([card("skip", "red", "skip")]), 20);
  assert.equal(scoreHand([card("reverse", "red", "reverse")]), 20);
  assert.equal(scoreHand([card("draw2", "red", "+2")]), 20);
  assert.equal(scoreHand([card("discardAll", "red", "all")]), 50);
  assert.equal(scoreHand([card("wild", null, "wild")]), 50);
  assert.equal(scoreHand([card("wild4", null, "+4")]), 50);
  assert.equal(
    scoreHand([card("letter", "red", "e"), card("wild", null, "wild")]),
    51,
    "a hand is the sum of its cards"
  );
});

/** One table, one stake: everybody buys in at 500 and the winner takes the rest. */
test("a table buys in at 500 a seat and the winner takes it", () => {
  assert.equal(BUY_IN_COINS, 500);
  assert.equal(potCoins(4), 2000);
  assert.equal(winningsCoins(4), 1500);
});
