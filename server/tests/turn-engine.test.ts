import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../db.js";
import { runMigrations } from "../migrations.js";
import { beginFirstTurn, closeTurn, transition, SOLVE_WINDOW_MS, type TransitionOutcome } from "../engine.js";
import { sweepExpiredTurns } from "../scheduler.js";
import { BOT_TIMING, randomDelayInRange, clampToWindow, botHasValidMove } from "../bots.js";
import { canSpell, selectCardsForWord } from "../words.js";
import { ensureHandCanSpell } from "../engine.js";

before(async () => {
  await runMigrations(pool);
});

after(async () => {
  await pool.end();
});

type Seat = { playerId: string; isBot: boolean };

async function makeRoom(humans: number, bots: number): Promise<{ roomId: string; humanIds: string[]; botIds: string[] }> {
  const room = await pool.query(
    `INSERT INTO public.game_rooms(state,phase,round_number,turn_number) VALUES('waiting','waiting',1,0) RETURNING id`
  );
  const roomId = room.rows[0].id as string;
  const humanIds: string[] = [];
  const botIds: string[] = [];
  let seat = 0;

  for (let i = 0; i < humans; i += 1) {
    const playerId = randomUUID();
    humanIds.push(playerId);
    await pool.query(
      `INSERT INTO public.room_players(room_id,player_id,seat_number,connected,turn_state)
       VALUES($1,$2,$3,true,'waiting')`,
      [roomId, playerId, seat]
    );
    seat += 1;
  }

  for (let i = 0; i < bots; i += 1) {
    const playerId = randomUUID();
    botIds.push(playerId);
    const personality = (["easy", "normal", "aggressive"] as const)[i % 3];
    await pool.query(
      `INSERT INTO public.room_players(room_id,player_id,seat_number,connected,turn_state,is_bot,bot_personality,display_name)
       VALUES($1,$2,$3,true,'waiting',true,$4,$5)`,
      [roomId, playerId, seat, personality, `Bot${i + 1}`]
    );
    seat += 1;
  }

  await pool.query(`DELETE FROM public.match_queue WHERE room_id=$1`, [roomId]);
  return { roomId, humanIds, botIds };
}

/**
 * Move a still-playing turn's clock into the past so the sweeper sees it as due.
 *
 * Only `turn_started_at` and `turn_deadline_at` are touched: both are outside the
 * first-solver immutability trigger, and both are moved together so the
 * `turn_deadline_at > turn_started_at` CHECK still holds. Restricted to
 * phase='playing', where `solve_window_ends_at` is NULL and unused.
 */
async function forceDeadlinePast(roomId: string, offsetMs = -500): Promise<void> {
  await pool.query(
    `UPDATE public.game_rooms
        SET turn_started_at = clock_timestamp() - (($2::int + 3000) || ' milliseconds')::interval,
            turn_deadline_at = clock_timestamp() + ($2::int || ' milliseconds')::interval
      WHERE id=$1 AND phase='playing'`,
    [roomId, offsetMs]
  );
}

async function readRoom(roomId: string) {
  const result = await pool.query(
    `SELECT turn_number,round_number,phase,active_player_id,first_solver_id,solve_window_ends_at,turn_deadline_at,target_word,state
       FROM public.game_rooms WHERE id=$1`,
    [roomId]
  );
  return result.rows[0];
}

async function terminalCount(roomId: string, turnNumber: number): Promise<number> {
  const result = await pool.query(
    `SELECT count(*)::int AS count FROM public.turn_actions
      WHERE room_id=$1 AND turn_number=$2 AND terminal IS NOT NULL`,
    [roomId, turnNumber]
  );
  return Number(result.rows[0].count);
}

// ---------------------------------------------------------------------------
// §18 — the hang. Before this, nothing closed a window nobody submitted to.
// ---------------------------------------------------------------------------

test("a turn nobody answers is closed by the server as timed_out and advances exactly once", async () => {
  const { roomId, humanIds } = await makeRoom(2, 0);
  try {
    const started = await beginFirstTurn(roomId);
    assert.ok(started, "turn should start");
    const turnNumber = started!.snapshot.turnNumber;

    await forceDeadlinePast(roomId);

    const closed = await sweepExpiredTurns();
    assert.ok(closed >= 1, "sweeper must close the expired turn");

    const room = await readRoom(roomId);
    assert.equal(Number(room.turn_number), turnNumber + 1, "turn advances exactly once");
    assert.equal(room.phase, "playing", "next turn is live");
    assert.ok(room.turn_deadline_at, "next turn has a deadline");
    assert.equal(await terminalCount(roomId, turnNumber), 1, "exactly one terminal transition");
  } finally {
    await pool.query(`DELETE FROM public.game_rooms WHERE id=$1`, [roomId]);
  }
});

test("a solve closes as 'solved' once the window expires, not as timed_out", async () => {
  const { roomId, humanIds } = await makeRoom(2, 0);
  try {
    const started = await beginFirstTurn(roomId);
    const turnNumber = started!.snapshot.turnNumber;
    const room = await readRoom(roomId);
    const target = room.target_word as string;
    const playerId = humanIds[1]!;

    // Give the human the exact cards, then solve.
    const hand = await pool.query(`SELECT private_hand FROM public.room_players WHERE room_id=$1 AND player_id=$2`, [
      roomId,
      playerId
    ]);
    const cards = (hand.rows[0].private_hand as Array<{ cardId: string; value: string }>);
    const cardIds: string[] = [];
    const used = new Set<string>();
    for (const letter of target) {
      const card = cards.find((candidate) => candidate.value === letter && !used.has(candidate.cardId));
      assert.ok(card, `hand must contain '${letter}'`);
      used.add(card.cardId);
      cardIds.push(card.cardId);
    }

    const solved = await transition({
      kind: "submit",
      roomId,
      turnNumber,
      actionId: randomUUID(),
      playerId,
      cards: cardIds,
      word: target
    });
    assert.equal(solved.ok, true);
    assert.equal(solved.result?.status, "accepted");
    assert.equal(solved.result?.scoreDelta, 1);

    const afterSolve = await readRoom(roomId);
    assert.equal(afterSolve.phase, "solve_window");
    assert.equal(afterSolve.first_solver_id, playerId);
    assert.equal(Number(afterSolve.turn_number), turnNumber, "a scored solve does NOT advance on its own");

    // A solved turn already has solve_window_ends_at set, and that column is
    // protected by the immutability trigger — so wait the window out for real
    // rather than rewinding the clock.
    await new Promise((resolve) => setTimeout(resolve, SOLVE_WINDOW_MS + 250));

    const outcome = await closeTurn({ roomId, turnNumber });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.terminal, "solved", "terminal state reflects that someone solved");
    assert.equal(outcome.turnEnded?.firstSolverId, playerId);
    assert.equal(await terminalCount(roomId, turnNumber), 1);
  } finally {
    await pool.query(`DELETE FROM public.game_rooms WHERE id=$1`, [roomId]);
  }
});

// ---------------------------------------------------------------------------
// §24 / §54 — submit vs timeout, and the double-transition backstop
// ---------------------------------------------------------------------------

test("a submit and a timeout racing the same turn produce exactly one terminal transition", async () => {
  const { roomId, humanIds } = await makeRoom(2, 0);
  try {
    const started = await beginFirstTurn(roomId);
    const turnNumber = started!.snapshot.turnNumber;
    await forceDeadlinePast(roomId);

    const playerId = humanIds[1]!;
    const cards = await pool.query(`SELECT private_hand FROM public.room_players WHERE room_id=$1 AND player_id=$2`, [
      roomId,
      playerId
    ]);
    const first = (cards.rows[0].private_hand as Array<{ cardId: string; value: string }>)[0]!;

    const outcomes: TransitionOutcome[] = await Promise.all([
      closeTurn({ roomId, turnNumber }),
      transition({
        kind: "submit",
        roomId,
        turnNumber,
        actionId: randomUUID(),
        playerId,
        cards: [first.cardId],
        word: first.value
      })
    ]);

    const winners = outcomes.filter((outcome) => outcome.terminal !== null);
    assert.equal(winners.length, 1, "exactly one writer may terminate the turn");
    assert.equal(await terminalCount(roomId, turnNumber), 1, "one terminal row");

    const room = await readRoom(roomId);
    assert.equal(Number(room.turn_number), turnNumber + 1, "the turn advanced exactly once");
  } finally {
    await pool.query(`DELETE FROM public.game_rooms WHERE id=$1`, [roomId]);
  }
});

test("two timeouts with different action ids cannot both advance the turn", async () => {
  const { roomId } = await makeRoom(1, 1);
  try {
    const started = await beginFirstTurn(roomId);
    const turnNumber = started!.snapshot.turnNumber;
    await forceDeadlinePast(roomId);

    const outcomes = await Promise.all([
      transition({ kind: "timeout", roomId, turnNumber, actionId: `race-a:${randomUUID()}` }),
      transition({ kind: "timeout", roomId, turnNumber, actionId: `race-b:${randomUUID()}` })
    ]);

    const terminals = outcomes.filter((outcome) => outcome.terminal !== null);
    assert.equal(terminals.length, 1, "only one timeout may win");
    assert.equal(await terminalCount(roomId, turnNumber), 1);

    const room = await readRoom(roomId);
    assert.equal(Number(room.turn_number), turnNumber + 1);
  } finally {
    await pool.query(`DELETE FROM public.game_rooms WHERE id=$1`, [roomId]);
  }
});

test("a repeated timeout is idempotent and does not advance twice", async () => {
  const { roomId } = await makeRoom(1, 1);
  try {
    const started = await beginFirstTurn(roomId);
    const turnNumber = started!.snapshot.turnNumber;
    await forceDeadlinePast(roomId);

    const first = await closeTurn({ roomId, turnNumber });
    assert.equal(first.ok, true);
    const afterFirst = await readRoom(roomId);

    // §25: a duplicate action id returns the previously recorded result rather
    // than a fresh success, and must not re-apply any effect.
    const second = await closeTurn({ roomId, turnNumber });
    assert.equal(second.replayed, true, "the recorded result is replayed");
    assert.equal(second.terminal, "timed_out", "the original terminal state is returned");

    const afterSecond = await readRoom(roomId);
    assert.equal(Number(afterSecond.turn_number), Number(afterFirst.turn_number), "no second advance");
    assert.equal(await terminalCount(roomId, turnNumber), 1);
  } finally {
    await pool.query(`DELETE FROM public.game_rooms WHERE id=$1`, [roomId]);
  }
});

// ---------------------------------------------------------------------------
// §26 — stale actions must not mutate the current game
// ---------------------------------------------------------------------------

test("a submission for a previous turn is rejected as stale and mutates nothing", async () => {
  const { roomId, humanIds } = await makeRoom(1, 1);
  try {
    const started = await beginFirstTurn(roomId);
    const liveTurn = started!.snapshot.turnNumber;
    const staleTurn = liveTurn - 1 < 0 ? liveTurn + 5 : liveTurn - 1;

    const before = await readRoom(roomId);
    const handBefore = await pool.query(
      `SELECT private_hand,hand_version,score FROM public.room_players WHERE room_id=$1 AND player_id=$2`,
      [roomId, humanIds[0]]
    );

    const outcome = await transition({
      kind: "submit",
      roomId,
      turnNumber: staleTurn,
      actionId: randomUUID(),
      playerId: humanIds[0]!,
      cards: ["nope"],
      word: "nope"
    });

    assert.equal(outcome.ok, false);
    assert.equal(outcome.code, "stale_turn");

    const after = await readRoom(roomId);
    assert.equal(Number(after.turn_number), Number(before.turn_number), "turn unchanged");
    const handAfter = await pool.query(
      `SELECT private_hand,hand_version,score FROM public.room_players WHERE room_id=$1 AND player_id=$2`,
      [roomId, humanIds[0]]
    );
    assert.deepEqual(handAfter.rows[0].private_hand, handBefore.rows[0].private_hand, "hand unchanged");
    assert.equal(Number(handAfter.rows[0].score), Number(handBefore.rows[0].score), "score unchanged");
  } finally {
    await pool.query(`DELETE FROM public.game_rooms WHERE id=$1`, [roomId]);
  }
});

test("cards that are not in the player's hand are rejected without consuming anything", async () => {
  const { roomId, humanIds } = await makeRoom(2, 0);
  try {
    const started = await beginFirstTurn(roomId);
    const turnNumber = started!.snapshot.turnNumber;

    const outcome = await transition({
      kind: "submit",
      roomId,
      turnNumber,
      actionId: randomUUID(),
      playerId: humanIds[1]!,
      cards: [randomUUID()],
      word: "ab"
    });

    assert.equal(outcome.ok, false);
    assert.equal(outcome.code, "invalid_cards");
    const player = await pool.query(`SELECT score FROM public.room_players WHERE room_id=$1 AND player_id=$2`, [
      roomId,
      humanIds[1]
    ]);
    assert.equal(Number(player.rows[0].score), 0, "no score awarded");
  } finally {
    await pool.query(`DELETE FROM public.game_rooms WHERE id=$1`, [roomId]);
  }
});

// ---------------------------------------------------------------------------
// §17 — no_valid_move
// ---------------------------------------------------------------------------

test("the active bot with no possible move ends the turn early as no_valid_move", async () => {
  const { roomId, humanIds, botIds } = await makeRoom(1, 1);
  try {
    await beginFirstTurn(roomId);
    const botId = botIds[0]!;

    // Make the bot active with a hand that cannot spell the target.
    await pool.query(`UPDATE public.game_rooms SET active_player_id=$2, artist_id=$2, target_word='zzz' WHERE id=$1`, [
      roomId,
      botId
    ]);
    await pool.query(`UPDATE public.room_players SET private_hand=$3::jsonb WHERE room_id=$1 AND player_id=$2`, [
      roomId,
      botId,
      JSON.stringify([
        { cardId: randomUUID(), value: "a" },
        { cardId: randomUUID(), value: "b" }
      ])
    ]);
    // Nobody else can spell 'zzz' either, so the turn is genuinely dead.
    await pool.query(`UPDATE public.room_players SET private_hand=$3::jsonb WHERE room_id=$1 AND player_id=$2`, [
      roomId,
      humanIds[0],
      JSON.stringify(Array.from({ length: 14 }, () => ({ cardId: randomUUID(), value: "a" })))
    ]);

    const room = await readRoom(roomId);
    const turnNumber = Number(room.turn_number);

    const outcome = await transition({
      kind: "no_valid_move",
      roomId,
      turnNumber,
      actionId: `botnomove:${randomUUID()}`,
      playerId: botId
    });

    assert.equal(outcome.ok, true);
    assert.equal(outcome.terminal, "no_valid_move");

    const after = await readRoom(roomId);
    assert.equal(Number(after.turn_number), turnNumber + 1, "turn advanced exactly once");
    assert.equal(await terminalCount(roomId, turnNumber), 1);
  } finally {
    await pool.query(`DELETE FROM public.game_rooms WHERE id=$1`, [roomId]);
  }
});

test("a bot claiming no valid move while it does hold one is rejected", async () => {
  const { roomId, humanIds, botIds } = await makeRoom(1, 1);
  try {
    await beginFirstTurn(roomId);
    const botId = botIds[0]!;
    await pool.query(`UPDATE public.game_rooms SET active_player_id=$2, artist_id=$2, target_word='ab' WHERE id=$1`, [
      roomId,
      botId
    ]);
    await pool.query(`UPDATE public.room_players SET private_hand=$3::jsonb WHERE room_id=$1 AND player_id=$2`, [
      roomId,
      botId,
      JSON.stringify([
        { cardId: randomUUID(), value: "a" },
        { cardId: randomUUID(), value: "b" }
      ])
    ]);
    // Another player CAN spell 'ab', so the bot's claim is false.
    await pool.query(`UPDATE public.room_players SET private_hand=$3::jsonb WHERE room_id=$1 AND player_id=$2`, [
      roomId,
      humanIds[0],
      JSON.stringify([
        { cardId: randomUUID(), value: "a" },
        { cardId: randomUUID(), value: "b" }
      ])
    ]);
    const room = await readRoom(roomId);
    const turnNumber = Number(room.turn_number);

    const outcome = await transition({
      kind: "no_valid_move",
      roomId,
      turnNumber,
      actionId: `botnomove:${randomUUID()}`,
      playerId: botId
    });

    assert.equal(outcome.ok, false);
    assert.equal(outcome.code, "valid_move_exists", "a false claim must not end the turn");
    const after = await readRoom(roomId);
    assert.equal(Number(after.turn_number), turnNumber, "turn unchanged");
  } finally {
    await pool.query(`DELETE FROM public.game_rooms WHERE id=$1`, [roomId]);
  }
});

test("a human client cannot declare itself unable to move", async () => {
  const { roomId, humanIds } = await makeRoom(1, 1);
  try {
    await beginFirstTurn(roomId);
    const room = await readRoom(roomId);

    const outcome = await transition({
      kind: "no_valid_move",
      roomId,
      turnNumber: Number(room.turn_number),
      actionId: `botnomove:${randomUUID()}`,
      playerId: humanIds[0]!
    });

    assert.equal(outcome.ok, false);
    assert.equal(outcome.code, "bot_actions_are_server_owned");
  } finally {
    await pool.query(`DELETE FROM public.game_rooms WHERE id=$1`, [roomId]);
  }
});

// ---------------------------------------------------------------------------
// §42 — the central invariant, under randomised concurrent pressure
// ---------------------------------------------------------------------------

test("randomised concurrent pressure never advances a turn more than once", async () => {
  for (let iteration = 0; iteration < 25; iteration += 1) {
    const { roomId, humanIds } = await makeRoom(2, 1);
    try {
      const started = await beginFirstTurn(roomId);
      const turnNumber = started!.snapshot.turnNumber;

      // Half the rounds are expired (so timeout can win); half are live.
      if (iteration % 2 === 0) await forceDeadlinePast(roomId);

      const playerId = humanIds[1]!; // seat 0 is the artist, so seat 1 solves
      const player = await pool.query(`SELECT private_hand FROM public.room_players WHERE room_id=$1 AND player_id=$2`, [
        roomId,
        playerId
      ]);
      const card = (player.rows[0].private_hand as Array<{ cardId: string; value: string }>)[0]!;

      const contenders: Array<Promise<TransitionOutcome>> = [];
      for (let i = 0; i < 6; i += 1) {
        const actionId = `mix:${iteration}:${i}:${randomUUID()}`;
        switch (i % 3) {
          case 0:
            contenders.push(transition({ kind: "timeout", roomId, turnNumber, actionId }));
            break;
          case 1:
            contenders.push(
              transition({ kind: "submit", roomId, turnNumber, actionId, playerId, cards: [card.cardId], word: card.value })
            );
            break;
          default:
            contenders.push(transition({ kind: "timeout", roomId, turnNumber, actionId }));
        }
      }

      const outcomes = await Promise.all(contenders);
      const terminals = outcomes.filter((outcome) => outcome.terminal !== null);
      const room = await readRoom(roomId);

      assert.equal(
        terminals.length <= 1,
        true,
        `iteration ${iteration}: at most one terminal transition, saw ${terminals.length}`
      );
      assert.equal(
        Number(room.turn_number) - turnNumber <= 1,
        true,
        `iteration ${iteration}: turn advanced at most once`
      );
      assert.equal(
        (await terminalCount(roomId, turnNumber)) <= 1,
        true,
        `iteration ${iteration}: at most one terminal row`
      );
      if (terminals.length === 1) {
        assert.equal(Number(room.turn_number), turnNumber + 1, `iteration ${iteration}: a terminal must advance exactly once`);
      }
    } finally {
      await pool.query(`DELETE FROM public.game_rooms WHERE id=$1`, [roomId]);
    }
  }
});

// ---------------------------------------------------------------------------
// §16 / §44 — bot timing
// ---------------------------------------------------------------------------

test("bot decision delays stay inside the published personality ranges", () => {
  for (const personality of ["easy", "normal", "aggressive"] as const) {
    const { thinking, noMove } = BOT_TIMING[personality];
    for (let i = 0; i < 400; i += 1) {
      const think = randomDelayInRange(thinking);
      assert.ok(think >= thinking[0] && think <= thinking[1], `${personality} thinking ${think} outside ${thinking}`);
      const wait = randomDelayInRange(noMove);
      assert.ok(wait >= noMove[0] && wait <= noMove[1], `${personality} no-move ${wait} outside ${noMove}`);
    }
  }
});

test("the published ranges are the values the specification requires", () => {
  assert.deepEqual(BOT_TIMING.easy, { thinking: [1500, 2700], noMove: [600, 1000] });
  assert.deepEqual(BOT_TIMING.normal, { thinking: [900, 2000], noMove: [450, 800] });
  assert.deepEqual(BOT_TIMING.aggressive, { thinking: [350, 1200], noMove: [250, 600] });
});

test("a bot with a valid move is never scheduled outside the solve window", () => {
  // 2700ms is the longest any personality thinks; the window is 3000ms.
  const longestThink = Math.max(...Object.values(BOT_TIMING).map((timing) => timing.thinking[1]));
  assert.ok(longestThink < 3000, "no personality may think past the 3s window");
  // And if the clock is nearly out, the delay is pulled inside the deadline.
  assert.equal(clampToWindow(2700, 400), 350);
  assert.equal(clampToWindow(2700, 0), 0);
});

// ---------------------------------------------------------------------------
// §12 — hand continuity
// ---------------------------------------------------------------------------

test("hands are patched by the minimum amount and always become solvable", () => {
  const hand = [
    { cardId: "1", value: "a" },
    { cardId: "2", value: "b" },
    { cardId: "3", value: "x" },
    { cardId: "4", value: "y" }
  ];
  const { hand: patched, changed } = ensureHandCanSpell(hand, "ab");
  assert.equal(changed, 0, "an already solvable hand is untouched");
  assert.deepEqual(patched.map((card) => card.value), ["a", "b", "x", "y"]);

  const { hand: patched2, changed: changed2 } = ensureHandCanSpell(hand, "cab");
  assert.equal(changed2, 1, "only the missing letter is injected");
  assert.equal(patched2.length, 4, "hand size preserved");
  assert.ok(canSpell(patched2, "cab"), "patched hand can spell the target");
});

test("selectCardsForWord returns cards in the order that spells the word", () => {
  const hand = [
    { cardId: "1", value: "b" },
    { cardId: "2", value: "a" },
    { cardId: "3", value: "t" }
  ];
  assert.deepEqual(selectCardsForWord(hand, "tab"), ["3", "2", "1"]);
  assert.deepEqual(selectCardsForWord(hand, "bat"), ["1", "2", "3"]);
  assert.equal(selectCardsForWord(hand, "zzz"), null);
  assert.equal(botHasValidMove(hand, "tab"), true);
  assert.equal(botHasValidMove(hand, "zz"), false);
});

test("a hand never holds two cards with the same id", () => {
  const { hand } = ensureHandCanSpell(
    [
      { cardId: "dup", value: "a" },
      { cardId: "dup", value: "a" }
    ],
    "zzz"
  );
  const ids = new Set(hand.map((card) => card.cardId));
  assert.equal(ids.size, hand.length, "card ids must stay unique");
});

// ---------------------------------------------------------------------------
// Regression: action ids are opaque strings, never UUIDs.
//
// submissions.submission_id was declared UUID while the protocol specifies a
// free-form id. Both real callers send non-UUID ids, so every submit aborted
// transactionally and no turn could ever be solved. db/006 fixes the column.
// ---------------------------------------------------------------------------

test("non-UUID action ids are accepted, in both real caller formats", async () => {
  const formats: Array<(roomId: string, turn: number, playerId: string) => string> = [
    () => "r1758441234567-1",
    (roomId, turn, playerId) => `bot:${roomId}:${turn}:${playerId}`
  ];

  for (const makeId of formats) {
    const { roomId, humanIds } = await makeRoom(2, 0);
    try {
      const started = await beginFirstTurn(roomId);
      const turnNumber = started!.snapshot.turnNumber;
      const room = await readRoom(roomId);
      const target = room.target_word as string;
      const playerId = humanIds[1]!;

      const hand = await pool.query(
        `SELECT private_hand FROM public.room_players WHERE room_id=$1 AND player_id=$2`,
        [roomId, playerId]
      );
      const cardIds = selectCardsForWord(hand.rows[0].private_hand, target);
      assert.ok(cardIds, "the solver's hand must be able to spell the target");

      const actionId = makeId(roomId, turnNumber, playerId);
      const outcome = await transition({
        kind: "submit",
        roomId,
        turnNumber,
        actionId,
        playerId,
        cards: cardIds!,
        word: target
      });

      assert.equal(outcome.ok, true, `actionId "${actionId}" must be accepted, got ${outcome.code}`);
      assert.equal(outcome.result?.status, "accepted");
      assert.equal(outcome.result?.scoreDelta, 1);
    } finally {
      await pool.query(`DELETE FROM public.game_rooms WHERE id=$1`, [roomId]);
    }
  }
});

// ---------------------------------------------------------------------------
// §13: the artist draws; they do not solve their own drawing.
// ---------------------------------------------------------------------------

test("the artist cannot solve their own drawing", async () => {
  const { roomId, humanIds } = await makeRoom(2, 0);
  try {
    const started = await beginFirstTurn(roomId);
    const turnNumber = started!.snapshot.turnNumber;
    const room = await readRoom(roomId);
    const target = room.target_word as string;
    const artistId = room.active_player_id as string;
    assert.equal(artistId, humanIds[0], "seat 0 draws first");

    const hand = await pool.query(
      `SELECT private_hand FROM public.room_players WHERE room_id=$1 AND player_id=$2`,
      [roomId, artistId]
    );
    const cardIds = selectCardsForWord(hand.rows[0].private_hand, target);
    assert.ok(cardIds, "the artist's hand can spell it — which is exactly why they must not submit");

    const outcome = await transition({
      kind: "submit",
      roomId,
      turnNumber,
      actionId: "r1758441234567-9",
      playerId: artistId,
      cards: cardIds!,
      word: target
    });

    assert.equal(outcome.ok, false);
    assert.equal(outcome.code, "artist_cannot_solve");

    const after = await readRoom(roomId);
    assert.equal(Number(after.turn_number), turnNumber, "the turn must not advance");
    assert.equal(after.first_solver_id, null, "no first solver may be awarded");
    const scored = await pool.query(
      `SELECT score FROM public.room_players WHERE room_id=$1 AND player_id=$2`,
      [roomId, artistId]
    );
    assert.equal(Number(scored.rows[0].score), 0, "the artist must not score");
  } finally {
    await pool.query(`DELETE FROM public.game_rooms WHERE id=$1`, [roomId]);
  }
});
