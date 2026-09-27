import test from 'node:test';
import assert from 'node:assert/strict';
import { canPlayWord, chooseAiWord, chooseMatchingWord, playableWords, resolveBookDraw, wordLetters } from './go-wild-2v2-word-rules.js';

test('the next turn uses the final letter of the table word', () => {
  assert.deepEqual(wordLetters('Drama Queen!'), { first: 'D', last: 'N' });
  assert.equal(canPlayWord('Noodle', 'N'), true);
  assert.equal(canPlayWord('Clown', 'N'), false);
});

test('playable words are selected by their first letter, case-insensitively', () => {
  const hand = [{ word: 'Noodle' }, { word: 'Nuisance' }, { word: 'Clown' }];
  assert.deepEqual(playableWords(hand, 'n'), hand.slice(0, 2));
});

test('book draws prefer a random word that matches the table ending', () => {
  const book = [{ word: 'Noodle' }, { word: 'Suntale' }, { word: 'Susta' }];
  assert.equal(chooseMatchingWord(book, [], 'S', () => 0).word, 'Suntale');
  assert.equal(chooseMatchingWord(book, [], 'S', () => 0.99).word, 'Susta');
});

test('book draws reuse a matching played word when the book has no match', () => {
  const used = [{ word: 'Suntale' }];
  assert.equal(chooseMatchingWord([{ word: 'Noodle' }], used, 'S'), used[0]);
});

test('a matching word drawn from the book is queued for play and removed afterward', () => {
  const hand = [{ word: 'Clown' }], drawnWord = { word: 'Noodle' };
  const resolution = resolveBookDraw(hand, drawnWord, 'N');
  assert.deepEqual(resolution, { hand: [...hand, drawnWord], play: drawnWord, passed: false });
  resolution.hand.splice(resolution.hand.indexOf(resolution.play), 1);
  assert.deepEqual(resolution.hand, hand);
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

