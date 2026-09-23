import test from "node:test";
import assert from "node:assert/strict";
import { COLORS, type Card, type CardColor, type CardKind } from "../cards.js";
import {
  callUno,
  catchUno,
  drawCard,
  legalCards,
  pass,
  playCard,
  settle,
  startRound,
  type RoundState
} from "../round.js";

let seq = 0;
const card = (kind: CardKind, color: CardColor | null, value: string): Card => ({
  cardId: `c${++seq}`,
  value,
  color,
  kind
});

/** A hand-built state, so the rule tests do not depend on a random deal. */
function state(overrides: Partial<RoundState> & { hands: Card[][] }): RoundState {
  return {
    words: ["lantern", "picture", "balloon", "rainbow"],
    board: [],
    drawPile: [],
    named: null,
    direction: 1,
    activeSeat: 0,
    drawnCardId: null,
    unoSaid: overrides.hands.map(() => false),
    finished: false,
    winnerSeat: null,
    ...overrides
  };
}

const filler = (n: number): Card[] => Array.from({ length: n }, () => card("letter", "yellow", "t"));

test("a round opens on a letter, with every seat holding a word", () => {
  const round = startRound(4);

  assert.equal(round.hands.length, 4);
  for (const hand of round.hands) assert.equal(hand.length, 7, "every seat is dealt seven cards");
  assert.equal(round.board.length, 1, "the board opens on exactly one card");
  assert.equal(round.board[0]?.kind, "letter", "the board must open on a letter");
  assert.equal(round.activeSeat, 0);
  assert.equal(round.direction, 1);
  assert.equal(round.finished, false);
  assert.equal(new Set(round.words).size, 4, "no word is dealt twice");
});

test("a throw is refused unless it is your turn, your card, and a legal match", () => {
  const round = state({
    hands: [
      [card("letter", "blue", "k"), card("letter", "red", "a")],
      [card("letter", "red", "a")],
      []
    ],
    board: [card("letter", "red", "a")]
  });

  const notMine = round.hands[1]?.[0] as Card;
  assert.equal(playCard(round, 0, notMine.cardId).code, "card_not_in_hand");

  const theirs = playCard(round, 1, notMine.cardId);
  assert.equal(theirs.code, "not_your_turn", "a seat may not throw out of turn");

  const blue = round.hands[0]?.[0] as Card;
  assert.equal(playCard(round, 0, blue.cardId).code, "illegal_play", "blue K matches neither red nor A");

  const red = round.hands[0]?.[1] as Card;
  const ok = playCard(round, 0, red.cardId);
  assert.equal(ok.ok, true);
  assert.equal(ok.state.board[ok.state.board.length - 1]?.cardId, red.cardId);
  assert.equal((ok.state.hands[0] as Card[]).length, 1);
  assert.equal(ok.state.activeSeat, 1, "play moves to the next seat");
});

test("Skip takes the next seat's turn, and lands the turn past it", () => {
  const round = state({
    hands: [[card("skip", "red", "skip")], [], [], []],
    board: [card("letter", "red", "a")]
  });

  const out = playCard(round, 0, (round.hands[0] as Card[])[0]?.cardId as string);
  assert.equal(out.ok, true);
  assert.equal(out.state.activeSeat, 2, "the seat after the skipped one plays next");
  assert.ok(out.events.some((e) => e.type === "skipped" && e.seat === 1));
});

test("Reverse turns the table around, and acts as a Skip with two seats", () => {
  const four = state({
    hands: [[card("reverse", "red", "reverse")], [], [], []],
    board: [card("letter", "red", "a")]
  });
  const reversed = playCard(four, 0, (four.hands[0] as Card[])[0]?.cardId as string);
  assert.equal(reversed.state.direction, -1);
  assert.equal(reversed.state.activeSeat, 3, "the table now runs anticlockwise");

  const two = state({
    hands: [[card("reverse", "red", "reverse")], []],
    board: [card("letter", "red", "a")]
  });
  const asSkip = playCard(two, 0, (two.hands[0] as Card[])[0]?.cardId as string);
  assert.equal(asSkip.state.activeSeat, 0, "with two seats the thrower plays again");
});

test("Draw Two and Wild Draw Four hand cards to the next seat and skip it", () => {
  for (const [kind, expected] of [["draw2", 2], ["wild4", 4]] as const) {
    const round = state({
      hands: [[card(kind, kind === "draw2" ? "red" : null, kind === "draw2" ? "+2" : "+4")], [], [], []],
      board: [card("letter", "red", "a")],
      drawPile: filler(10)
    });

    const out = playCard(round, 0, (round.hands[0] as Card[])[0]?.cardId as string, "green");
    assert.equal(out.ok, true, `${kind} should be playable`);
    assert.equal((out.state.hands[1] as Card[]).length, expected, `${kind} must hand over ${expected} cards`);
    assert.equal(out.state.activeSeat, 2, `${kind} must skip the seat that drew`);
  }
});

test("a Wild needs a colour named, and the colour it names takes over", () => {
  const round = state({
    hands: [[card("wild", null, "wild")], []],
    board: [card("letter", "red", "a")]
  });
  const id = (round.hands[0] as Card[])[0]?.cardId as string;

  assert.equal(playCard(round, 0, id).code, "must_name_color");
  assert.equal(playCard(round, 0, id, "purple" as CardColor).code, "must_name_color");

  const named = playCard(round, 0, id, "blue");
  assert.equal(named.ok, true);
  assert.equal(named.state.named, "blue");
});

test("the Wild Draw Four restriction is enforced against the hand", () => {
  const holding = state({
    hands: [[card("wild4", null, "+4"), card("letter", "red", "k")], []],
    board: [card("letter", "red", "a")],
    drawPile: filler(6)
  });
  assert.equal(
    playCard(holding, 0, (holding.hands[0] as Card[])[0]?.cardId as string, "blue").code,
    "illegal_play",
    "a +4 may not be thrown while holding the colour in force"
  );
});

test("Discard All clears the rest of that colour, and can win on its own", () => {
  const round = state({
    hands: [
      [card("discardAll", "red", "all"), card("letter", "red", "k"), card("letter", "blue", "k")],
      []
    ],
    board: [card("letter", "red", "a")]
  });

  const out = playCard(round, 0, (round.hands[0] as Card[])[0]?.cardId as string);
  assert.equal(out.ok, true);
  assert.equal((out.state.hands[0] as Card[]).length, 1, "only the blue card should survive");
  assert.equal((out.state.hands[0] as Card[])[0]?.color, "blue");
});

test("throwing your last card ends the round and names the winner", () => {
  const round = state({
    hands: [[card("letter", "red", "a")], [card("letter", "blue", "k")]],
    board: [card("letter", "red", "k")]
  });

  const out = playCard(round, 0, (round.hands[0] as Card[])[0]?.cardId as string);
  assert.equal(out.state.finished, true);
  assert.equal(out.state.winnerSeat, 0);
  assert.ok(out.events.some((e) => e.type === "round_won" && e.word === "lantern"));
});

test("the settle reveals the word, the table and the coins", () => {
  const round = startRound(4);
  const finished: RoundState = { ...round, finished: true, winnerSeat: 2 };

  const result = settle(finished, 4);
  assert.ok(result);
  assert.equal(result.winnerSeat, 2);
  assert.equal(result.word, finished.words[2]);
  assert.equal(result.pot, 2000, "four seats at 500 each");
  assert.equal(result.standings[2]?.coins, 1500, "the winner takes the pot less their own buy-in");
  assert.equal(result.standings[0]?.coins, -500, "everyone else loses their buy-in");
  assert.equal(result.standings[2]?.remaining, 0);
  assert.ok((result.standings[1]?.remaining ?? 0) > 0, "losers are scored on what they still hold");
  assert.equal(settle(round, 4), null, "an unfinished round has no result");
});

test("after drawing you may throw that card, otherwise the turn passes", () => {
  const round = state({
    hands: [[card("letter", "blue", "k"), card("letter", "blue", "k")], []],
    board: [card("letter", "red", "a")],
    drawPile: [card("letter", "red", "a")]
  });

  const drawn = drawCard(round, 0);
  assert.equal(drawn.ok, true);
  const drawnId = drawn.state.drawnCardId;
  assert.ok(drawnId, "the card that was drawn is remembered");

  const oldCard = ((drawn.state.hands[0] as Card[])[0] as Card).cardId;
  assert.equal(playCard(drawn.state, 0, oldCard).code, "already_drew");

  const threw = playCard(drawn.state, 0, drawnId as string);
  assert.equal(threw.ok, true, "the drawn card may be thrown at once");

  const passed = pass(drawn.state, 0);
  assert.equal(passed.state.activeSeat, 1);
  assert.equal(passed.state.drawnCardId, null);
});

test("an empty draw pile recycles the board rather than stalling", () => {
  const round = state({
    hands: [[], []],
    board: [card("letter", "red", "a"), card("letter", "blue", "k"), card("letter", "green", "t")],
    drawPile: []
  });

  const out = drawCard(round, 0);
  assert.equal(out.ok, true);
  assert.equal(out.state.board.length, 1, "the top card stays on the board");
  assert.equal(out.state.board[0]?.color, "green", "and it is the same card that was on top");
  assert.equal((out.state.hands[0] as Card[]).length, 1, "the seat still drew a card");
});

test("a seat that goes down to one card uncalled can be caught for two", () => {
  const round = state({
    hands: [[card("letter", "red", "a"), card("letter", "red", "k")], [card("letter", "blue", "k")], []],
    board: [card("letter", "red", "t")],
    drawPile: filler(6)
  });

  const threw = playCard(round, 0, (round.hands[0] as Card[])[1]?.cardId as string);
  assert.equal((threw.state.hands[0] as Card[]).length, 1);
  assert.equal(threw.state.unoSaid[0], false, "nobody has called UNO yet");

  const caught = catchUno(threw.state, 0);
  assert.equal(caught.ok, true);
  assert.equal((caught.state.hands[0] as Card[]).length, 3, "the penalty is two cards");

  const called = callUno(threw.state, 0);
  assert.equal(catchUno(called.state, 0).code, "uno_was_called");
});

test("legal throws are the ones the rules allow", () => {
  const round = state({
    hands: [[card("letter", "red", "k"), card("letter", "blue", "a"), card("wild4", null, "+4")]],
    board: [card("letter", "red", "a")]
  });

  const legal = legalCards(round, 0).map((c) => c.kind + ":" + c.color);
  assert.ok(legal.includes("letter:red"), "the colour match is legal");
  assert.ok(legal.includes("letter:blue"), "the letter match is legal");
  assert.ok(!legal.includes("wild4:null"), "the +4 is illegal while a red card is held");
  assert.ok(COLORS.includes("red"));
});
