import test, { after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../db.js";
import { ROUND_END_PAUSE_MS } from "../round-engine.js";
import { planSweep, type DueRoundEndRow, type DueTurnRow } from "../scheduler.js";

after(async () => {
  await pool.end();
});

const NOW = new Date("2026-09-23T12:00:00.000Z");

const expiredTurn = (roomId: string, cardRound: boolean, turnNumber = 4): DueTurnRow => ({
  room_id: roomId,
  turn_number: turnNumber,
  card_round: cardRound
});

/** `agoMs` before NOW — the moment the reveal pause starts. */
const revealStarted = (roomId: string, agoMs: number): DueRoundEndRow => ({
  room_id: roomId,
  turn_number: 9,
  turn_deadline_at: new Date(NOW.getTime() - agoMs)
});

/**
 * Which engine owns a room is decided in one place, from one column: a card round
 * never carries a target word, and the drawing game's rooms always do. Getting
 * this wrong means the wrong rules close somebody's turn.
 */
test("an expired turn is routed to the engine that owns the room", () => {
  const jobs = planSweep([expiredTurn("card", true), expiredTurn("drawing", false, 7)], [], NOW);

  assert.deepEqual(jobs, [
    { job: "expire_card", roomId: "card", turnNumber: 4 },
    { job: "expire_drawing", roomId: "drawing", turnNumber: 7 }
  ]);
});

/** A turn number arrives from PostgreSQL as a string often enough to be coerced here, once. */
test("a turn number is a number by the time a job is made", () => {
  const jobs = planSweep([expiredTurn("card", true, 12)], [], NOW);

  assert.equal(jobs[0]?.turnNumber, 12);
  assert.equal(typeof jobs[0]?.turnNumber, "number");
});

/**
 * The reveal is the point of the pause: a table that dealt again immediately
 * would never show the word the winner's hand spelled, and the whole table is
 * looking at it.
 */
test("a round is dealt again only once the reveal pause has elapsed", () => {
  const withinPause = planSweep([], [revealStarted("early", ROUND_END_PAUSE_MS - 1)], NOW);
  assert.deepEqual(withinPause, [], "one millisecond short is still showing the reveal");

  const exactly = planSweep([], [revealStarted("due", ROUND_END_PAUSE_MS)], NOW);
  assert.deepEqual(exactly, [{ job: "deal_next", roomId: "due", turnNumber: 9 }]);

  const overdue = planSweep([], [revealStarted("late", ROUND_END_PAUSE_MS * 4)], NOW);
  assert.equal(overdue[0]?.job, "deal_next", "a round nobody swept up is still dealt, not skipped");
});

/** Sessions the sweeper missed must be caught up, not abandoned. */
test("a round with no recorded deadline is dealt rather than left hanging", () => {
  const jobs = planSweep([], [{ room_id: "lost", turn_number: 3, turn_deadline_at: null }], NOW);

  assert.deepEqual(jobs, [{ job: "deal_next", roomId: "lost", turnNumber: 3 }]);
});

/**
 * A table somebody is sitting at is more urgent than one waiting out its reveal,
 * and the expiries keep the order the query returned them in.
 */
test("turn expiries are handled before deals, in the order they arrived", () => {
  const jobs = planSweep(
    [expiredTurn("first", true), expiredTurn("second", true)],
    [revealStarted("revealing", ROUND_END_PAUSE_MS * 2)],
    NOW
  );

  assert.deepEqual(jobs.map((job) => job.roomId), ["first", "second", "revealing"]);
  assert.equal(jobs.filter((job) => job.job === "deal_next").length, 1);
});

test("an idle table produces nothing to do", () => {
  assert.deepEqual(planSweep([], [], NOW), []);
});
