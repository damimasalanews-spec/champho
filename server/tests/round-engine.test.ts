import test from "node:test";
import assert from "node:assert/strict";
import type { Card } from "../cards.js";
import type { RoundEvent } from "../round.js";
import { ROUND_END_PAUSE_MS, roundEndElapsed, roundEventsOf } from "../round-engine.js";

const card: Card = { cardId: "c1", value: "a", color: "red", kind: "letter" };

/**
 * The rules speak in cards and seats; the wire speaks in event names. A
 * mistranslation here would not fail anything else — the client would simply be
 * told the wrong thing — so each one is pinned.
 */
test("every rules event maps to a wire event", () => {
  const cases: { event: RoundEvent; eventType: string; check: (payload: Record<string, unknown>) => void }[] = [
    {
      event: { type: "card_thrown", seat: 2, card, named: "blue" },
      eventType: "card_thrown",
      check: (payload) => {
        assert.equal(payload.seat, 2);
        assert.deepEqual(payload.card, card);
        assert.equal(payload.namedColor, "blue");
      }
    },
    {
      event: { type: "drew", seat: 1, count: 4 },
      eventType: "card_drawn",
      check: (payload) => assert.equal(payload.count, 4)
    },
    {
      event: { type: "discarded_color", seat: 0, color: "green", count: 3 },
      eventType: "card_thrown",
      check: (payload) => assert.equal(payload.discarded, "green")
    },
    {
      event: { type: "direction", direction: -1 },
      eventType: "turn_ended",
      check: (payload) => assert.equal(payload.direction, -1)
    },
    {
      event: { type: "skipped", seat: 3 },
      eventType: "turn_ended",
      check: (payload) => assert.equal(payload.skippedSeat, 3)
    },
    {
      event: { type: "called_uno", seat: 1 },
      eventType: "uno_called",
      check: (payload) => assert.equal(payload.seat, 1)
    },
    {
      event: { type: "caught", seat: 1, penalty: 2 },
      eventType: "uno_caught",
      check: (payload) => assert.equal(payload.penalty, 2)
    },
    {
      event: { type: "round_won", seat: 0, word: "lantern" },
      eventType: "round_won",
      check: (payload) => assert.equal(payload.word, "lantern")
    }
  ];

  for (const { event, eventType, check } of cases) {
    const mapped = roundEventsOf([event]);
    assert.equal(mapped.length, 1, `${event.type} should map to exactly one wire event`);
    assert.equal(mapped[0]?.eventType, eventType, `${event.type} mapped to the wrong wire event`);
    check(mapped[0]?.payload ?? {});
  }
});

test("an unknown rules event is dropped rather than guessed at", () => {
  const unknown = { type: "something_new", seat: 0 } as unknown as RoundEvent;
  assert.deepEqual(roundEventsOf([unknown]), []);
});

test("the next round waits out the pause after a won one", () => {
  const ended = new Date("2026-09-23T12:00:00.000Z");

  assert.equal(roundEndElapsed(ended, new Date(ended.getTime() + ROUND_END_PAUSE_MS - 1)), false);
  assert.equal(roundEndElapsed(ended, new Date(ended.getTime() + ROUND_END_PAUSE_MS)), true);
  assert.equal(
    roundEndElapsed(null, new Date(ended.getTime() + 1)),
    true,
    "a room with no clock is not held back"
  );
});
