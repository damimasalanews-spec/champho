import test from "node:test";
import assert from "node:assert/strict";
import { BUY_IN_COINS } from "../cards.js";
import { startRound, type RoundState } from "../round.js";
import type { LoadedRound } from "../room-cards.js";
import { buildRoundView, type SeatMeta } from "../round-view.js";

const SEATS = ["p0", "p1", "p2", "p3"];

function loaded(overrides: Partial<RoundState> = {}): LoadedRound {
  const round = startRound(4);
  return { ...round, ...overrides, seats: SEATS };
}

function seatMeta(): SeatMeta[] {
  return SEATS.map((playerId, seat) => ({
    playerId,
    displayName: `Player ${seat}`,
    connected: true,
    score: seat * 10,
    isBot: seat > 0
  }));
}

const options = {
  roomId: "room-1",
  roundNumber: 3,
  turnNumber: 17,
  phase: "playing",
  deadlineAt: new Date("2026-09-23T12:00:00.000Z"),
  seats: seatMeta()
};

/**
 * The view exists to draw this line. Everything below checks one side of it: a
 * seat gets its own hand, and nobody else's cards or unrevealed words reach it.
 */
test("a seat sees its own hand and only a count of everyone else's", () => {
  const round = loaded();
  const view = buildRoundView(round, 1, options);

  assert.deepEqual(view.you.hand, round.hands[1], "the viewer's hand is complete");
  assert.equal(view.seats[1]?.handCount, (round.hands[1] as unknown[]).length);
  assert.equal(view.seats[0]?.handCount, (round.hands[0] as unknown[]).length);
  assert.equal(view.seats[0]?.playerId, "p0");
  assert.equal(view.you.playerId, "p1");
  assert.equal(view.you.seat, 1);
});

test("no other seat's cards appear anywhere in the view", () => {
  const round = loaded();
  const view = buildRoundView(round, 0, options);
  const json = JSON.stringify(view);

  const mine = new Set((round.hands[0] as { cardId: string }[]).map((c) => c.cardId));
  round.hands.forEach((hand, seat) => {
    if (seat === 0) return;
    for (const card of hand) {
      assert.ok(!mine.has(card.cardId), "the seats must not share a card");
      assert.ok(
        !json.includes(card.cardId),
        `seat ${seat}'s card ${card.cardId} leaked into seat 0's view`
      );
    }
  });
});

test("the draw pile is a count, never its contents", () => {
  const round = loaded();
  const json = JSON.stringify(buildRoundView(round, 0, options));

  assert.equal(buildRoundView(round, 0, options).drawCount, round.drawPile.length);
  for (const card of round.drawPile) {
    assert.ok(!json.includes(card.cardId), `an undrawn card ${card.cardId} leaked into the view`);
  }
});

/**
 * The word is the board's reveal at the end of a round. A seat that learned it
 * early could aim for the hand it belongs to.
 */
test("the words stay secret until the round has been won", () => {
  const playing = buildRoundView(loaded(), 0, options);
  const json = JSON.stringify(playing);

  assert.equal(playing.you.word, null);
  assert.equal(playing.result, null);
  for (const word of loaded().words) {
    assert.ok(!json.includes(word), `the word "${word}" leaked while the round was in play`);
  }
});

test("a won round reveals the words in the result", () => {
  const round = loaded({ finished: true, winnerSeat: 2 });
  const view = buildRoundView(round, 0, options);

  assert.ok(view.result, "a settled round carries its result");
  assert.equal(view.result?.winnerSeat, 2);
  assert.equal(view.result?.word, round.words[2]);
  assert.equal(view.result?.standings[2]?.word, round.words[2]);
  assert.equal(view.you.word, round.words[0], "the viewer's own word is revealed too");
  assert.equal(view.activePlayerId, null, "a won round has nobody to act");
  assert.ok(view.seats.every((seat) => !seat.isActive));
});

test("only the seat holding the turn is offered legal cards", () => {
  const round = loaded({ activeSeat: 2 });

  const onTurn = buildRoundView(round, 2, options);
  const offTurn = buildRoundView(round, 1, options);

  // A dealt hand may legitimately have nothing playable, which is what drawing
  // is for, so this asserts the seat is offered only its own cards rather than
  // that it is offered any.
  const ownIds = new Set(onTurn.you.hand.map((card) => card.cardId));
  assert.ok(
    onTurn.you.legal.every((cardId) => ownIds.has(cardId)),
    "a seat may only ever be offered its own cards"
  );
  assert.deepEqual(offTurn.you.legal, [], "nobody else is offered a card");
  assert.equal(offTurn.seats[2]?.isActive, true);
  assert.equal(offTurn.activePlayerId, "p2");
});

/**
 * A seat that has drawn may throw that card and nothing else, and it must know:
 * offering the rest would light up cards the server is about to refuse. A deal
 * is random, so this is hand-built rather than dealt.
 */
test("after a draw only the drawn card is offered, and only when it is playable", () => {
  const board = [{ cardId: "b1", value: "a", color: "red" as const, kind: "letter" as const }];
  const hand = [
    { cardId: "h1", value: "k", color: "blue" as const, kind: "letter" as const },
    { cardId: "h2", value: "a", color: "red" as const, kind: "letter" as const }
  ];
  const base: LoadedRound = {
    seats: SEATS,
    hands: [hand, [], [], []],
    words: ["lantern", "picture", "balloon", "rainbow"],
    board,
    drawPile: [],
    named: null,
    direction: 1,
    activeSeat: 0,
    drawnCardId: "h2",
    unoSaid: [false, false, false, false],
    finished: false,
    winnerSeat: null
  };

  const playable = buildRoundView(base, 0, options);
  assert.equal(playable.you.drawnCardId, "h2");
  assert.deepEqual(playable.you.legal, ["h2"], "the drawn card matches the colour");
  assert.equal(playable.deadlineAt, "2026-09-23T12:00:00.000Z");

  const unplayable = buildRoundView({ ...base, drawnCardId: "h1" }, 0, options);
  assert.equal(unplayable.you.drawnCardId, "h1");
  assert.deepEqual(unplayable.you.legal, [], "a drawn card that matches nothing cannot be thrown");
});

test("the table's own state is public: direction, named colour and the pile", () => {
  const round = loaded({ direction: -1, named: "green" });
  const view = buildRoundView(round, 3, options);

  assert.equal(view.direction, -1);
  assert.equal(view.namedColor, "green");
  assert.deepEqual(view.board, round.board, "the thrown pile is visible to everyone");
  assert.equal(view.roundNumber, 3);
  assert.equal(view.turnNumber, 17);
  assert.equal(view.phase, "playing");
});

/**
 * The table is played for coins, so every seat's balance is public — and it comes
 * from the server's wallets, never from a number the client worked out for itself.
 */
test("the wallets are the server's, for every seat and for the viewer", () => {
  const coins = new Map([
    ["p0", 1500],
    ["p1", 500],
    ["p2", 0],
    ["p3", 1000]
  ]);

  const view = buildRoundView(loaded(), 1, { ...options, coins });

  assert.deepEqual(view.seats.map((seat) => seat.coins), [1500, 500, 0, 1000]);
  assert.equal(view.you.coins, 500, "the viewer's own balance is the one it shows");
  assert.equal(view.seats[1]?.playerId, "p1");
});

/**
 * A fixture with no wallets must not read as "this seat is broke": one stake is
 * the same default the deal and the payout use.
 */
test("a seat with no recorded wallet is shown holding one stake", () => {
  const view = buildRoundView(loaded(), 0, options);

  assert.equal(view.you.coins, BUY_IN_COINS);
  assert.ok(view.seats.every((seat) => seat.coins === BUY_IN_COINS));
});
