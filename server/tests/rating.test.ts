import test from "node:test";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import {
  BOT_DEFAULT_RATING,
  START_RATING,
  applyRatingChanges,
  expectedScore,
  kFactor,
  ratingDelta,
  tierOf
} from "../rating.js";
import type { LoadedRound } from "../room-cards.js";

const close = (actual: number, expected: number, tolerance = 0.01) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${expected} +/- ${tolerance}, got ${actual}`
  );

/* Every seat at the starting rating: a win must be worth exactly half of K. */
const flatTable = (score: 0 | 1) => [
  { rating: 1200, score },
  { rating: 1200, score },
  { rating: 1200, score }
];

test("a win at the starting rating banks half of K", () => {
  close(ratingDelta(1200, flatTable(1), 0), 32);
});

test("a loss at the starting rating costs the same half of K", () => {
  close(ratingDelta(1200, flatTable(0), 0), -32);
});

/** Beating stronger opposition must be worth more than beating weaker. */
test("an upset pays more than a routine win", () => {
  const upset = ratingDelta(1200, [
    { rating: 1400, score: 1 },
    { rating: 1400, score: 1 },
    { rating: 1400, score: 1 }
  ], 0);
  const routine = ratingDelta(1200, [
    { rating: 1000, score: 1 },
    { rating: 1000, score: 1 },
    { rating: 1000, score: 1 }
  ], 0);
  assert.ok(upset > 45, `upset should clear 45, got ${upset}`);
  assert.ok(routine < 20, `routine should stay under 20, got ${routine}`);
  assert.ok(upset > routine * 2, "the gap has to be wide enough to chase");
});

test("K falls once a player is no longer provisional, and again at the ceiling", () => {
  assert.equal(kFactor(9, 1200), 64);
  assert.equal(kFactor(10, 1200), 24);
  assert.equal(kFactor(11, 1200), 24);
  assert.equal(kFactor(40, 2000), 12);
});

test("expected score is symmetric around an equal opponent", () => {
  close(expectedScore(1200, 1200), 0.5);
  close(expectedScore(1400, 1200) + expectedScore(1200, 1400), 1);
  assert.equal(expectedScore(1200, 1200), 1 - expectedScore(1200, 1200));
});

test("tiers cover the whole ladder and stack in order", () => {
  assert.equal(tierOf(900), "Wood");
  assert.equal(tierOf(1199), "Bronze");
  assert.equal(tierOf(1200), "Silver");
  assert.equal(tierOf(1600), "Diamond");
  assert.equal(tierOf(2400), "Champ");
});

test("no opponents means no movement rather than a NaN rating", () => {
  assert.equal(ratingDelta(1200, [], 0), 0);
});

/* ---- the settlement path ------------------------------------------------ */

type Query = { sql: string; params: unknown[] };

function fakeClient(options: { conflictFor?: Set<string> } = {}) {
  const queries: Query[] = [];
  const conflictFor = options.conflictFor ?? new Set<string>();

  const client = {
    queries,
    async query(sql: string, params: unknown[] = []) {
      queries.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
      /* every seat starts unrated in these tests */
      if (sql.includes("FROM public.player_ratings")) return { rows: [], rowCount: 0 };
      if (sql.includes("INSERT INTO public.rating_changes")) {
        const playerId = String(params[1]);
        if (conflictFor.has(playerId)) return { rows: [], rowCount: 0 };
        return { rows: [{ delta: params[5] }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    }
  };
  return client as unknown as PoolClient & { queries: Query[] };
}

const room = (seats: string[], isBot: boolean[]): LoadedRound =>
  ({ seats, isBot, gameMode: "classic" } as unknown as LoadedRound);

const settled = (winnerSeat: number) =>
  ({ winnerSeat, word: "lantern", pot: 2000, standings: [] } as never);

const insertsOf = (queries: Query[], table: string) =>
  queries.filter((query) => query.sql.includes(`INSERT INTO public.${table}`));

test("a table of bots writes no rating at all", async () => {
  const client = fakeClient();
  await applyRatingChanges(client, "room-1", room(["b0", "b1", "b2", "b3"], [true, true, true, true]), settled(0));
  assert.equal(client.queries.length, 0);
});

test("bots are skipped but still count as opposition", async () => {
  const client = fakeClient();
  await applyRatingChanges(client, "room-1", room(["human", "b1", "b2", "b3"], [false, true, true, true]), settled(0));

  const changes = insertsOf(client.queries, "rating_changes");
  assert.equal(changes.length, 1, "only the human seat is rated");
  /* one human, three bots all rated BOT_DEFAULT_RATING: a win is still worth 32 */
  const delta = Number(changes[0].params[5]);
  close(delta, 32);
});

test("a replayed settlement is skipped, not applied twice", async () => {
  const first = fakeClient();
  await applyRatingChanges(first, "room-1", room(["p0", "p1", "p2", "p3"], [false, false, false, false]), settled(0));
  const firstUpserts = insertsOf(first.queries, "player_ratings").length;
  assert.equal(firstUpserts, 4);

  /* the same room settling again: every rating_changes insert collides */
  const replay = fakeClient({ conflictFor: new Set(["p0", "p1", "p2", "p3"]) });
  await applyRatingChanges(replay, "room-1", room(["p0", "p1", "p2", "p3"], [false, false, false, false]), settled(0));
  assert.equal(
    insertsOf(replay.queries, "player_ratings").length,
    0,
    "a collided change must not reach the belt"
  );
});

test("the winner is credited a win and the losers a loss", async () => {
  const client = fakeClient();
  await applyRatingChanges(client, "room-1", room(["p0", "p1", "p2", "p3"], [false, false, false, false]), settled(2));

  const upserts = insertsOf(client.queries, "player_ratings");
  assert.equal(upserts.length, 4);
  const winner = upserts[2];
  assert.equal(winner.params[0], "p2");
  assert.equal(winner.params[3], 1, "wins");
  assert.equal(winner.params[4], 0, "losses");
  const loser = upserts[0];
  assert.equal(loser.params[3], 0, "wins");
  assert.equal(loser.params[4], 1, "losses");
});

test("the rating written is absolute, never a second addition", async () => {
  const client = fakeClient();
  await applyRatingChanges(client, "room-1", room(["p0", "b1", "b2", "b3"], [false, true, true, true]), settled(0));
  const upsert = insertsOf(client.queries, "player_ratings")[0];
  close(Number(upsert.params[2]), START_RATING + 32);
  assert.ok(
    !upsert.sql.includes("rating = public.player_ratings.rating +"),
    "the upsert must assign the computed value, not add a delta again"
  );
});

test("every rated row carries the round's mode", async () => {
  const client = fakeClient();
  await applyRatingChanges(client, "room-1", room(["p0", "b1", "b2", "b3"], [false, true, true, true]), settled(0));
  for (const query of insertsOf(client.queries, "rating_changes")) {
    assert.equal(query.params[2], "classic");
  }
  for (const query of insertsOf(client.queries, "player_ratings")) {
    assert.equal(query.params[1], "classic");
  }
  assert.equal(BOT_DEFAULT_RATING, 1200);
});
