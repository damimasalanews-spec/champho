import test, { after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../db.js";
import { BOT_TIMING, cardTurnDelayMs, planCardTurn } from "../bots.js";
import type { Card, CardColor, CardKind } from "../cards.js";
import type { LoadedRound } from "../room-cards.js";

after(async () => {
  await pool.end();
});

let seq = 0;
const card = (kind: CardKind, color: CardColor | null, value: string): Card => ({
  cardId: `c${++seq}`,
  value,
  color,
  kind
});

const round = (hand: Card[], board: Card[] = [card("letter", "red", "a")]): LoadedRound => ({
  seats: ["p0", "p1", "p2", "p3"],
  hands: [hand, [], [], []],
  words: ["lantern", "picture", "balloon", "rainbow"],
  board,
  drawPile: [card("letter", "blue", "k"), card("letter", "blue", "k")],
  named: null,
  direction: 1,
  activeSeat: 0,
  drawnCardId: null,
  unoSaid: [false, false, false, false],
  finished: false,
  winnerSeat: null
});

/** A bot with nothing it can legally throw has to draw — that is the whole turn. */
test("a bot with no legal card draws", () => {
  const plan = planCardTurn(round([card("letter", "blue", "k")]), 0);
  assert.equal(plan.kind, "draw");
  assert.equal(plan.cardId, null);
  assert.equal(plan.color, null);
});

test("a bot throws a card that matches, and names no colour for it", () => {
  const red = card("letter", "red", "k");
  const byColor = planCardTurn(round([red, card("letter", "blue", "k")]), 0);
  assert.equal(byColor.kind, "play");
  assert.equal(byColor.cardId, red.cardId, "red matches the colour in force");
  assert.equal(byColor.color, null, "only a wild names a colour");

  const blueA = card("letter", "blue", "a");
  const byLetter = planCardTurn(round([blueA]), 0);
  assert.equal(byLetter.kind, "play");
  assert.equal(byLetter.cardId, blueA.cardId, "the blue A matches the letter on top");
});

/**
 * A wild names the colour the bot holds most of, which is the only reason a wild
 * is worth throwing rather than dumping.
 */
test("a wild names the colour the bot holds most of", () => {
  const plan = planCardTurn(
    round([
      card("wild", null, "wild"),
      card("letter", "green", "k"),
      card("letter", "green", "t"),
      card("letter", "yellow", "k")
    ]),
    0
  );

  assert.equal(plan.kind, "play");
  assert.equal(plan.color, "green", "green is held twice against yellow's once");
});

test("a Wild Draw Four names a colour too, and only when it may be thrown", () => {
  const allowed = planCardTurn(
    round([card("wild4", null, "+4"), card("letter", "blue", "k"), card("letter", "blue", "t")]),
    0
  );
  assert.equal(allowed.kind, "play", "no red in hand, so the +4 is legal");
  assert.equal(allowed.color, "blue");

  const refused = planCardTurn(
    round([card("wild4", null, "+4"), card("letter", "red", "k")]),
    0
  );
  assert.equal(refused.kind, "play");
  assert.notEqual(refused.cardId, null);
  assert.equal(refused.color, null, "holding red, the +4 is illegal, so a red card is thrown instead");
});

test("a bot's thinking time stays inside its personality's range", () => {
  for (const [personality, timing] of Object.entries(BOT_TIMING)) {
    const fastest = cardTurnDelayMs(personality as keyof typeof BOT_TIMING, () => 0);
    const slowest = cardTurnDelayMs(personality as keyof typeof BOT_TIMING, () => 1);

    assert.equal(fastest, timing.thinking[0], `${personality} should be able to think as little as its floor`);
    assert.equal(slowest, timing.thinking[1] + 1, `${personality} should cap near its ceiling`);
  }
});
