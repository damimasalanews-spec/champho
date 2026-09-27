import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseMatchingLetter, findWordFromLetters, resolveLetterCapture } from './letter-bumper-rules.js';

test('captured letters can form a Romanized Nepali word from an unordered rack', () => {
  assert.equal(findWordFromLetters(['A', 'U', 'L'], ['hawa', 'alu']), 'alu');
});

test('a completed word scores and consumes only its letters', () => {
  assert.deepEqual(resolveLetterCapture(['A', 'L'], 'U', ['alu', 'boka']), { rack: [], word: 'alu' });
});

test('a capture without a word keeps its letters available', () => {
  assert.deepEqual(resolveLetterCapture(['A'], 'Z', ['alu']), { rack: ['A', 'Z'], word: null });
});

test('matching book letters are preferred, then recycled letters are used', () => {
  assert.equal(chooseMatchingLetter(['A', 'T', 'T'], ['T'], 'T', () => 0.99), 'T');
  assert.equal(chooseMatchingLetter(['A'], ['T'], 'T'), 'T');
  assert.equal(chooseMatchingLetter(['A'], [], 'T'), null);
});

