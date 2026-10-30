import test from 'node:test';
import assert from 'node:assert/strict';
import { WORD_BANK } from './english-word-bank.js';
import { createWordGrid, normalizeGuess, scoreWord, COLS, ROWS } from './word-grid-rules.js';

test('a board tiles every cell once with seven words, one per length 3-9', () => {
  const puzzle = createWordGrid(WORD_BANK);
  assert.equal(COLS * ROWS, 42);
  assert.equal(puzzle.grid.length, 42);
  assert.equal(puzzle.words.length, 7);
  assert.deepEqual(puzzle.words.map(item => item.word.length).sort((a, b) => a - b), [3, 4, 5, 6, 7, 8, 9]);

  const owner = new Map();
  for (const item of puzzle.words) {
    assert.equal(item.path.length, item.word.length);
    assert.equal(item.path.map(index => puzzle.grid[index]).join(''), item.word);
    for (let i = 1; i < item.path.length; i++) {
      const rowA = Math.floor(item.path[i - 1] / COLS), colA = item.path[i - 1] % COLS;
      const rowB = Math.floor(item.path[i] / COLS), colB = item.path[i] % COLS;
      assert.ok(Math.max(Math.abs(rowA - rowB), Math.abs(colA - colB)) === 1);
    }
    /* the guarantee: a letter belongs to one word only */
    for (const cell of item.path) {
      assert.equal(owner.has(cell), false, `cell ${cell} is in both "${owner.get(cell)}" and "${item.word}"`);
      owner.set(cell, item.word);
    }
  }
  /* and the other half of it: nothing is left over, so a won round highlights
     the entire grid */
  assert.equal(owner.size, 42);
  assert.equal(puzzle.grid.filter(letter => letter === null).length, 0);
});

test('guess normalization accepts case and punctuation', () => {
  assert.equal(normalizeGuess(' Mountain! '), 'mountain');
});

test('correct words award 100 coins per letter and cannot score twice', () => {
  const targets = [{ word: 'cat', path: [0, 1, 2] }, { word: 'river', path: [7, 8, 9, 10, 11] }];
  const found = new Set();
  assert.deepEqual(scoreWord(targets, 'CAT', found, 'champ'), { word: 'cat', playerId: 'champ', coins: 300, length: 3, path: [0, 1, 2], hidden: true });
  found.add('cat');
  assert.equal(scoreWord(targets, 'cat', found, 'jess'), null);
  assert.equal(scoreWord(targets, 'nope', found, 'jess'), null);
  assert.equal(scoreWord(targets, 'river', found, 'jess').coins, 500);
});

test('a dictionary word that is not hidden still scores when it traces through the board', () => {
  /* a 2x2 board: c t across the top, a s across the bottom */
  const layout = { grid: ['c', 't', 'a', 's'], cols: 2, rows: 2 };
  const traced = scoreWord([], 'CATS', new Set(), 'champ', layout);
  assert.equal(traced.coins, 400);
  assert.equal(traced.hidden, false);
  assert.deepEqual(traced.path, [0, 2, 1, 3]);
  assert.equal(scoreWord([], 'c', new Set(), 'champ', layout), null);   /* one letter is too short */
  assert.equal(scoreWord([], 'ax', new Set(), 'champ', layout), null);  /* not on the board */
});