/*
 * Database-agnostic concurrency specification for Classic turns.
 *
 * Wire these helpers to the repository's real turn-transition service in the
 * integration runner. The assertions intentionally describe invariants rather
 * than database-specific implementation details.
 */

const assert = require('node:assert/strict');

const ACTIVE = 'active';
const SOLVED = 'solved';
const TIMED_OUT = 'timed_out';
const NO_VALID_MOVE = 'no_valid_move';

function makeTurn(overrides = {}) {
  return {
    roomId: 'test-room',
    turnNumber: 17,
    currentPlayerId: 'bot-1',
    state: ACTIVE,
    firstSolverId: null,
    handVersion: 8,
    solveWindowEndsAt: Date.now() + 3000,
    ...overrides,
  };
}

function validSubmit(turn, actionId = crypto.randomUUID()) {
  return {
    type: 'submit', actionId, roomId: turn.roomId,
    turnNumber: turn.turnNumber, playerId: turn.currentPlayerId,
    handVersion: turn.handVersion, cardIds: ['c1', 'c2', 'c3'], word: 'CAT',
  };
}

function timeout(turn, actionId = crypto.randomUUID()) {
  return {
    type: 'timeout', actionId, roomId: turn.roomId,
    turnNumber: turn.turnNumber, playerId: turn.currentPlayerId,
  };
}

function noMove(turn, actionId = crypto.randomUUID()) {
  return {
    type: 'no_valid_move', actionId, roomId: turn.roomId,
    turnNumber: turn.turnNumber, playerId: turn.currentPlayerId,
  };
}

function assertInvariant(before, after, events) {
  const terminal = events.filter((e) =>
    ['solved', 'timed_out', 'no_valid_move'].includes(e.type));
  const advances = events.filter((e) => e.type === 'turn_advanced');

  assert.ok(terminal.length <= 1, `multiple terminal transitions: ${terminal.length}`);
  assert.ok(advances.length <= 1, `multiple turn advances: ${advances.length}`);

  if (terminal.length === 1) assert.equal(advances.length, 1);
  if (after.state === SOLVED) assert.ok(after.firstSolverId);
  if (after.state !== SOLVED) assert.equal(after.firstSolverId, null);
  assert.ok(after.handVersion - before.handVersion <= 1);
}

async function concurrent(...operations) {
  return Promise.all(operations.map((operation) => operation()));
}

/*
 * Adapter contract expected from the real test harness:
 *
 * harness.seedTurn(turn)
 * harness.processTurnAction(action)
 * harness.readTurn(roomId)
 * harness.readEvents(roomId, turnNumber)
 * harness.readHand(playerId)
 * harness.injectFailure(point)
 * harness.clearFailure()
 * harness.reset()
 */

async function raceSubmitTimeout(harness) {
  const turn = makeTurn();
  await harness.seedTurn(turn);

  const [submitResult, timeoutResult] = await concurrent(
    () => harness.processTurnAction(validSubmit(turn)),
    () => harness.processTurnAction(timeout(turn)),
  );

  const after = await harness.readTurn(turn.roomId);
  const events = await harness.readEvents(turn.roomId, turn.turnNumber);

  assert.ok(!(submitResult.accepted && timeoutResult.accepted));
  assertInvariant(turn, after, events);
  return { submitResult, timeoutResult, after };
}

async function duplicateAction(harness, actionFactory) {
  const turn = makeTurn();
  await harness.seedTurn(turn);
  const action = actionFactory(turn);

  const [a, b] = await concurrent(
    () => harness.processTurnAction(action),
    () => harness.processTurnAction(action),
  );

  const after = await harness.readTurn(turn.roomId);
  const events = await harness.readEvents(turn.roomId, turn.turnNumber);

  assertInvariant(turn, after, events);
  assert.ok(!(a.accepted && b.accepted));
  return { a, b, after };
}

async function staleAction(harness) {
  const turn = makeTurn({ turnNumber: 18, currentPlayerId: 'bot-2' });
  await harness.seedTurn(turn);

  const stale = validSubmit(makeTurn({ turnNumber: 17, currentPlayerId: 'bot-1' }));
  const result = await harness.processTurnAction(stale);
  const after = await harness.readTurn(turn.roomId);

  assert.equal(result.accepted, false);
  assert.equal(after.turnNumber, 18);
  assert.equal(after.state, ACTIVE);
}

async function retryAfterUnknownCommit(harness) {
  const turn = makeTurn();
  await harness.seedTurn(turn);
  const action = validSubmit(turn);

  const first = await harness.processTurnAction(action, {
    failResponseAfterCommit: true,
  });
  const retry = await harness.processTurnAction(action);

  const after = await harness.readTurn(turn.roomId);
  const events = await harness.readEvents(turn.roomId, turn.turnNumber);

  assert.equal(retry.actionId, action.actionId);
  assertInvariant(turn, after, events);
  assert.equal(events.filter((e) => e.type === 'turn_advanced').length, 1);
  return { first, retry, after };
}

async function rollbackAfterCardConsumption(harness) {
  const turn = makeTurn();
  await harness.seedTurn(turn);
  const beforeHand = await harness.readHand(turn.currentPlayerId);
  const action = validSubmit(turn);

  await harness.injectFailure('after_card_consumption');
  const failed = await harness.processTurnAction(action);
  await harness.clearFailure();

  const after = await harness.readTurn(turn.roomId);
  const afterHand = await harness.readHand(turn.currentPlayerId);
  const events = await harness.readEvents(turn.roomId, turn.turnNumber);

  assert.equal(failed.accepted, false);
  assert.deepEqual(afterHand, beforeHand);
  assert.equal(after.state, ACTIVE);
  assert.equal(after.turnNumber, turn.turnNumber);
  assert.equal(after.firstSolverId, null);
  assert.equal(after.handVersion, turn.handVersion);
  assert.equal(events.filter((e) => e.type === 'turn_advanced').length, 0);
}

async function randomizedStress(harness, iterations = 1000) {
  for (let i = 0; i < iterations; i += 1) {
    await harness.reset();
    const turn = makeTurn({
      turnNumber: i + 1,
      solveWindowEndsAt: Date.now() + (Math.random() < 0.5 ? 0 : 3000),
    });
    await harness.seedTurn(turn);

    const action = validSubmit(turn, `stress-${i}`);
    const retry = { ...action };
    const actions = [action, retry, timeout(turn, `timeout-${i}`), noMove(turn, `nomove-${i}`)];

    for (let j = actions.length - 1; j > 0; j -= 1) {
      const k = Math.floor(Math.random() * (j + 1));
      [actions[j], actions[k]] = [actions[k], actions[j]];
    }

    await concurrent(...actions.map((a) => () => harness.processTurnAction(a)));

    const after = await harness.readTurn(turn.roomId);
    const events = await harness.readEvents(turn.roomId, turn.turnNumber);
    assertInvariant(turn, after, events);
  }
}

module.exports = {
  makeTurn,
  validSubmit,
  timeout,
  noMove,
  assertInvariant,
  raceSubmitTimeout,
  duplicateAction,
  staleAction,
  retryAfterUnknownCommit,
  rollbackAfterCardConsumption,
  randomizedStress,
};
