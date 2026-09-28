const SIZE = 6;
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

function freePath(grid, length, random, anchor, anchorWordIndex) {
  const path = Array(length), used = new Set();
  path[anchorWordIndex] = anchor;
  used.add(anchor);
  let budget = 240;
  const fill = index => {
    if (index === length) return true;
    if (--budget < 0) return false;
    const previous = path[index - 1];
    for (const next of shuffled(neighbors(previous), random)) {
      if (used.has(next) || grid[next] !== null) continue;
      path[index] = next;
      used.add(next);
      if (fill(index + 1)) return true;
      used.delete(next);
    }
    return false;
  };
  const fillBackwards = index => {
    if (index < 0) return fill(anchorWordIndex + 1);
    if (--budget < 0) return false;
    for (const next of shuffled(neighbors(path[index + 1]), random)) {
      if (used.has(next) || grid[next] !== null) continue;
      path[index] = next;
      used.add(next);
      if (fillBackwards(index - 1)) return true;
      used.delete(next);
    }
    return false;
  };
  if (anchorWordIndex === 0) return fill(1) ? path : null;
  if (anchorWordIndex === length - 1) return fillBackwards(length - 2) ? path : null;
  return fillBackwards(anchorWordIndex - 1) ? path : null;
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
  if ([3, 4, 5, 6, 7, 8, 9].some(length => !(byLength.get(length)?.length))) {
    throw new Error('Word bank must include words from 3 through 9 letters.');
  }

  for (let attempt = 0; attempt < attempts; attempt++) {
    const grid = Array(36).fill(null), placed = [], selected = new Set();
    const longest = shuffled(byLength.get(9), random).slice(0, 8);
    let success = false;

    for (const first of longest) {
      const path = firstPath(grid, first, random);
      if (!path) continue;
      path.forEach((cell, index) => { grid[cell] = first[index]; });
      placed.push({ word: first, path }); selected.add(first);

      const addNext = length => {
        if (length < 3) return true;
        const candidates = shuffled(byLength.get(length), random).filter(word => !selected.has(word)).slice(0, 7);
        const anchors = [];
        for (const cell of shuffled(cells, random)) if (grid[cell] !== null) {
          for (const word of candidates) for (let i = 0; i < word.length; i++) {
            if (word[i] === grid[cell]) anchors.push({ cell, word, index: i });
          }
        }
        for (const anchor of shuffled(anchors, random).slice(0, 48)) {
          const path = freePath(grid, anchor.word.length, random, anchor.cell, anchor.index);
          if (!path) continue;
          const added = [];
          path.forEach((cell, index) => {
            if (grid[cell] === null) { grid[cell] = anchor.word[index]; added.push(cell); }
          });
          placed.push({ word: anchor.word, path }); selected.add(anchor.word);
          if (addNext(length - 1)) return true;
          placed.pop(); selected.delete(anchor.word);
          for (const cell of added) grid[cell] = null;
        }
        return false;
      };
      if (addNext(8)) { success = true; break; }
      placed.length = 0; selected.clear(); grid.fill(null);
    }
    if (success && grid.every(letter => letter !== null)) return { grid, words: placed };
  }
  throw new Error('Could not build a connected 6×6 word grid.');
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

