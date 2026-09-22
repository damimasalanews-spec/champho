import test, { after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../db.js";
import { ANSWER_WINDOW_SHARE, BOT_TIMING, botAnswerDelayMs, clampToWindow } from "../bots.js";
import { ROUND_WINDOW_MS } from "../engine.js";

after(async () => {
  await pool.end();
});

const PERSONALITIES = ["easy", "normal", "aggressive"] as const;
const SAMPLE = Array.from({ length: 201 }, (_, i) => i / 200);

/**
 * §16's fixed timings are the bot's "thinking" beat. They are deliberately not
 * used for a SOLVER's answer any more: the round window belongs to the guessers,
 * so a bot that answered 350ms into a twelve-second round would take every round
 * away from the human before they had looked at the sketch.
 */
test("a solver's answer is paced across the round, never past its deadline", () => {
  for (const personality of PERSONALITIES) {
    for (const sample of SAMPLE) {
      const delay = botAnswerDelayMs(personality, ROUND_WINDOW_MS, () => sample);
      assert.ok(delay >= 0, `${personality}: delay must not be negative, got ${delay}`);
      assert.ok(
        delay <= ROUND_WINDOW_MS - 50,
        `${personality}: a bot must never answer after the window, got ${delay}ms of ${ROUND_WINDOW_MS}ms`
      );
    }
  }
});

test("the answer ramp runs the right way: easy answers late, aggressive early", () => {
  const at = (personality: (typeof PERSONALITIES)[number], sample: number) =>
    botAnswerDelayMs(personality, ROUND_WINDOW_MS, () => sample);

  // Same sample, so this is purely the personality ordering.
  for (const sample of [0, 0.5, 1]) {
    assert.ok(at("aggressive", sample) < at("normal", sample), `aggressive must beat normal at ${sample}`);
    assert.ok(at("normal", sample) < at("easy", sample), `normal must beat easy at ${sample}`);
  }

  // The whole ramp has to stay inside the round and leave the human room to
  // answer: the window is thinking time, so even the quickest possible bot answer
  // must leave most of it alone. At a minute per round that means no bot may
  // answer inside the first half of it.
  for (const personality of PERSONALITIES) {
    const [low, high] = ANSWER_WINDOW_SHARE[personality];
    assert.ok(low > 0 && high < 1, `${personality}: the share must stay inside the window`);
    assert.ok(
      at(personality, 0) >= ROUND_WINDOW_MS * 0.4,
      `${personality}: answering after ${at(personality, 0)}ms robs the player of their thinking time`
    );
  }
});

test("the bot timings still bound their no-move and idle beats", () => {
  for (const personality of PERSONALITIES) {
    const timing = BOT_TIMING[personality];
    assert.ok(timing.thinking[0] < timing.thinking[1], `${personality}: thinking range must be ordered`);
    assert.ok(timing.noMove[0] < timing.noMove[1], `${personality}: noMove range must be ordered`);
    // A no-move beat is clamped like every other decision.
    assert.equal(clampToWindow(timing.noMove[1], 100), 50);
  }
});
