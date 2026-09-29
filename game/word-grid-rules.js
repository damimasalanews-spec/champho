const SIZE = 6;
const LENGTHS = [3, 4, 5, 6, 7, 8];
const FILLER = 'abcdefghijklmnopqrstuvwxyz';
const cells = Array.from({ length: SIZE * SIZE }, (_, index) => index);

export function normalizeGuess(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z]/g, '');
}

export function wordsByLength(bank) {
  const groups = new Map();
  for (const entry of new Set(bank || [])) {
    const word = normalizeGuess(entry);
    if (word.length < 3 || word.length > 9) continue;
    if (!groups.has(word.length)) groups.set(word.length, []);
    if (!groups.get(word.length).includes(word)) groups.get(word.length).push(word);
  }
  return groups;
}

function neighbors(index) {
  const row = Math.floor(index / SIZE), col = index % SIZE, result = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    const r = row + dr, c = col + dc;
    if (r >= 0 && r < SIZE && c >= 0 && c < SIZE) result.push(r * SIZE + c);
  }
  return result;
}

function shuffled(items, random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function firstPath(grid, word, random) {
  const path = [], used = new Set();
  let budget = 5000;
  const walk = index => {
    if (index === word.length) return true;
    if (--budget < 0) return false;
    const options = index === 0 ? shuffled(cells, random) : shuffled(neighbors(path[index - 1]), random);
    for (const cell of options) {
      if (used.has(cell) || grid[cell] !== null) continue;
      path[index] = cell;
      used.add(cell);
      if (walk(index + 1)) return true;
      used.delete(cell);
    }
    return false;
  };
  return walk(0) ? path : null;
}

function placeWords(bank, random, attempts = 32) {
  const byLength = wordsByLength(bank);
  if (LENGTHS.some(length => !(byLength.get(length)?.length))) {
    throw new Error('Word bank must include words from 3 through 8 letters.');
  }

  for (let attempt = 0; attempt < attempts; attempt++) {
    const grid = Array(SIZE * SIZE).fill(null), placed = [], selected = new Set();
    let stuck = false;

    /* Longest first, because the tight ones need the room. firstPath only ever
       steps onto empty cells, so a letter can never end up belonging to two
       words - which is what the old anchor-chaining did on purpose in order to
       fill the board. */
    for (const length of [...LENGTHS].sort((a, b) => b - a)) {
      const candidates = shuffled(byLength.get(length), random)
        .filter(word => !selected.has(word))
        .slice(0, 12);
      let chosen = null;
      for (const candidate of candidates) {
        const path = firstPath(grid, candidate, random);
        if (path) { chosen = { word: candidate, path }; break; }
      }
      if (!chosen) { stuck = true; break; }
      chosen.path.forEach((cell, index) => { grid[cell] = chosen.word[index]; });
      placed.push({ word: chosen.word, path: chosen.path });
      selected.add(chosen.word);
    }
    if (stuck) continue;

    /* the few cells no word uses still have to be letters */
    for (let cell = 0; cell < grid.length; cell++) {
      if (grid[cell] === null) grid[cell] = FILLER[Math.floor(random() * FILLER.length)];
    }
    return { grid, words: placed };
  }
  throw new Error('Could not build a 6x6 word grid with disjoint words.');
}
export function createWordGrid(bank, random = Math.random) {
  return placeWords(bank, random);
}

export function scoreWord(targets, guess, foundWords, playerId) {
  const normalized = normalizeGuess(guess);
  if (!normalized || foundWords.has(normalized)) return null;
  const target = targets.find(item => item.word === normalized);
  if (!target) return null;
  return { word: target.word, playerId, coins: target.word.length * 100, length: target.word.length };
}
