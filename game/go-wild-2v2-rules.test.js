import test from 'node:test';
import assert from 'node:assert/strict';
import { canPlayCard, chooseAiCard, resolveAcceptedPenalty, resolveChallenge } from './go-wild-2v2-rules.js';

const top = { id: 'top', color: 'blue', type: 'number', value: '5' };
const wild4 = { id: 'w4', color: 'wild', type: 'wild4', value: '+4' };
const context = (hand, pending = 0) => ({ hand, pending, color: 'blue', top });

test('Wild +4 is legal only when no active-color card remains in hand', () => {
  assert.equal(canPlayCard(wild4, context([wild4])), true);
  assert.equal(canPlayCard(wild4, context([wild4, { color: 'blue', type: 'number', value: '2' }])), false);
  assert.equal(canPlayCard(wild4, context([wild4, { color: 'red', type: 'number', value: '2' }])), true);
  assert.equal(canPlayCard(wild4, context([wild4, { color: 'wild', type: 'wild', value: 'W' }])), true);
});

test('only a Wild +4 can answer a pending stack, regardless of active color', () => {
  assert.equal(canPlayCard(wild4, context([wild4, { color: 'blue', type: 'number', value: '2' }], 8)), true);
  assert.equal(canPlayCard({ color: 'blue', type: 'number', value: '5' }, context([], 8)), false);
});

test('AI avoids an illegal Wild +4 when an active-color card is held', () => {
  const blue = { id: 'b', color: 'blue', type: 'number', value: '2' };
  assert.equal(chooseAiCard([wild4, blue], context([wild4, blue])).id, 'b');
});

test('AI may stack a legal Wild +4 and ignores non +4 cards during a stack', () => {
  const blue = { id: 'b', color: 'blue', type: 'number', value: '2' };
  assert.equal(chooseAiCard([wild4, blue], context([wild4, blue], 8)).id, 'w4');
});

test('successful challenge returns the accumulated penalty to the offender and keeps challenger turn', () => {
  assert.deepEqual(resolveChallenge(false, 12), {
    offenderDraws: 12, challengerDraws: 0, challengerKeepsTurn: true
  });
});

test('failed challenge adds two cards to the stack and skips the challenger', () => {
  const result = resolveChallenge(true, 8);
  assert.deepEqual(result, { offenderDraws: 0, challengerDraws: 10, challengerKeepsTurn: false });
});

test('accepting a stacked penalty draws its full value and skips the turn', () => {
  assert.deepEqual(resolveAcceptedPenalty(16), { draws: 16, skipTurn: true });
});
