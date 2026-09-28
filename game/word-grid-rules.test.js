import test from 'node:test';
import assert from 'node:assert/strict';
import { WORD_BANK } from './nepali-roman-word-bank.js';
import { createWordGrid, normalizeGuess, scoreWord } from './word-grid-rules.js';

test('a generated board contains seven connected words, one at each length from 3 to 9', () => {
  const puzzle = createWordGrid(WORD_BANK);
  assert.equal(puzzle.grid.length, 36);
  assert.equal(puzzle.words.length, 7);
  assert.deepEqual(puzzle.words.map(item => item.word.length).sort((a, b) => a - b), [3, 4, 5, 6, 7, 8, 9]);
  for (const item of puzzle.words) {
    assert.equal(item.path.length, item.word.length);
    assert.equal(item.path.map(index => puzzle.grid[index]).join(''), item.word);
    for (let i = 1; i < item.path.length; i++) {
      const rowA = Math.floor(item.path[i - 1] / 6), colA = item.path[i - 1] % 6;
      const rowB = Math.floor(item.path[i] / 6), colB = item.path[i] % 6;
      assert.ok(Math.max(Math.abs(rowA - rowB), Math.abs(colA - colB)) === 1);
    }
  }
});

test('guess normalization accepts case and spaces', () => {
  assert.equal(normalizeGuess(' Ukus Mukus! '), 'ukusmukus');
});

test('correct words award 100 coins per letter and cannot score twice', () => {
  const targets = [{ word: 'alu' }, { word: 'hawa' }];
  const found = new Set();
  assert.deepEqual(scoreWord(targets, 'ALU', found, 'champ'), { word: 'alu', playerId: 'champ', coins: 300, length: 3 });
  found.add('alu');
  assert.equal(scoreWord(targets, 'alu', found, 'jess'), null);
  assert.equal(scoreWord(targets, 'nope', found, 'jess'), null);
  assert.equal(scoreWord(targets, 'hawa', found, 'jess').coins, 400);
});
