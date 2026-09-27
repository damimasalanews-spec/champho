import test from 'node:test';
import assert from 'node:assert/strict';
import { canPlayWord, chooseAiWord, playableWords, resolveBookDraw, wordLetters } from './go-wild-2v2-word-rules.js';

test('the next turn uses the final letter of the table word', () => {
  assert.deepEqual(wordLetters('Drama Queen!'), { first: 'D', last: 'N' });
  assert.equal(canPlayWord('Noodle', 'N'), true);
  assert.equal(canPlayWord('Clown', 'N'), false);
});

test('playable words are selected by their first letter, case-insensitively', () => {
  const hand = [{ word: 'Noodle' }, { word: 'Nuisance' }, { word: 'Clown' }];
  assert.deepEqual(playableWords(hand, 'n'), hand.slice(0, 2));
});

test('a matching word drawn from the book is played and does not stay in hand', () => {
  const hand = [{ word: 'Clown' }], drawnWord = { word: 'Noodle' };
  assert.deepEqual(resolveBookDraw(hand, drawnWord, 'N'), { hand, play: drawnWord, passed: false });
});

test('a nonmatching book word stays in hand and the turn passes', () => {
  const hand = [{ word: 'Clown' }], drawnWord = { word: 'Yapper' };
  assert.deepEqual(resolveBookDraw(hand, drawnWord, 'N'), { hand: [...hand, drawnWord], play: null, passed: true });
});

test('AI only chooses words that match the required first letter', () => {
  const hand = [{ word: 'Clown' }, { word: 'Noodle' }, { word: 'Nuisance' }];
  assert.equal(chooseAiWord(hand, 'N', () => 0.5).word, 'Nuisance');
  assert.equal(chooseAiWord(hand, 'Z'), null);
});

