/* CHAMP WORD - Go Wild word grid.
   Seven words, one at each length from 3 to 9. Those lengths sum to 42, which is
   exactly the cell count of a 7x6 board, so the seven words can tile it without
   sharing a single letter: every letter belongs to one word, and a completed
   round leaves nothing unhighlighted. Sharing used to be how the board got
   filled, which meant a letter could sit in two words at once. */
export const COLS = 7;
export const ROWS = 6;
const TOTAL = COLS * ROWS;
const LENGTHS = [3, 4, 5, 6, 7, 8, 9];

export function normalizeGuess(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z]/g, '');
}

export function wordsByLength(bank, minLen = 3, maxLen = 9) {
  const groups = new Map();
  for (const entry of new Set(bank || [])) {
    const word = normalizeGuess(entry);
    if (word.length < minLen || word.length > maxLen) continue;
    if (!groups.has(word.length)) groups.set(word.length, []);
    if (!groups.get(word.length).includes(word)) groups.get(word.length).push(word);
  }
  return groups;
}

function neighbours(index) {
  const row = Math.floor(index / COLS), col = index % COLS, result = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    const r = row + dr, c = col + dc;
    if (r >= 0 && r < ROWS && c >= 0 && c < COLS) result.push(r * COLS + c);
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

/* One randomised Hamiltonian path over every cell. Cutting it into runs gives
   seven connected paths that between them cover the board exactly once, which is
   the only way a word can own every letter it uses while the board still ends up
   complete. Ordering each step by how many onward moves it leaves (fewest first)
   keeps a random walk from stranding itself in a dead end. */
function hamiltonian(random) {
  const path = [], used = new Set();
  const walk = index => {
    path.push(index);
    used.add(index);
    if (path.length === TOTAL) return true;
    const options = neighbours(index)
      .filter(cell => !used.has(cell))
      .map(cell => ({ cell, onward: neighbours(cell).filter(next => !used.has(next) && next !== index).length }));
    const order = shuffled(options, random).sort((a, b) => a.onward - b.onward);
    for (const item of order) if (walk(item.cell)) return true;
    path.pop();
    used.delete(index);
    return false;
  };
  return walk(Math.floor(random() * TOTAL)) ? path : null;
}

/* How sprawled a deal is: for each word, the area of the rectangle around its
   letters minus the letter count. A tight blob scores 0-3; the old serpentine
   deals could lay one long word right across the board and score 20+. */
function spreadOf(words) {
  let worst = 0;
  for (const item of words) {
    const rows = item.path.map(cell => Math.floor(cell / COLS));
    const cols = item.path.map(cell => cell % COLS);
    const area = (Math.max(...rows) - Math.min(...rows) + 1) * (Math.max(...cols) - Math.min(...cols) + 1);
    worst = Math.max(worst, area - item.word.length);
  }
  return worst;
}

/* A word's letters must sit next to each other: its box may exceed its length
   by at most this much. Deals that sprawl are thrown back. */
const SPREAD_MAX = 5;

function placeWords(bank, random, attempts = 64, opts = {}) {
  const lengths = opts.lengths ?? LENGTHS;
  const exclude = opts.exclude ?? null;
  const byLength = wordsByLength(bank);
  if (lengths.some(length => !(byLength.get(length)?.length))) {
    throw new Error('Word bank must include words of ' + lengths.join(', ') + ' letters.');
  }

  let best = null, bestSpread = Infinity;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const path = hamiltonian(random);
    if (!path) continue;

    const picked = new Set(), words = [];
    let cursor = 0, stuck = false;
    for (const length of lengths) {
      const options = shuffled(byLength.get(length), random).filter(word => !picked.has(word) && !(exclude && exclude.has(word)));
      if (!options.length) { stuck = true; break; }
      picked.add(options[0]);
      words.push({ word: options[0], path: path.slice(cursor, cursor + length) });
      cursor += length;
    }
    if (stuck) continue;

    /* keep the tightest deal seen; the first one inside the compactness bound
       ships at once, and the best-so-far is the safety net so a board always
       comes back even on a run of unlucky walks */
    const spread = spreadOf(words);
    if (spread < bestSpread) {
      bestSpread = spread;
      const grid = Array(TOTAL).fill(null);
      for (const item of words) item.path.forEach((cell, index) => { grid[cell] = item.word[index]; });
      best = { grid, words, cols: COLS, rows: ROWS };
    }
    if (spread <= SPREAD_MAX) return best;
  }
  if (!best) throw new Error('Could not build a ' + COLS + 'x' + ROWS + ' word grid.');
  return best;
}

export function createWordGrid(bank, random = Math.random, opts = {}) {
  return placeWords(bank, random, 64, opts);
}

export function scoreWord(targets, guess, foundWords, playerId, layout) {
  const normalized = normalizeGuess(guess);
  if (!normalized || normalized.length < 2 || normalized.length > 10) return null;
  if (foundWords.has(normalized)) return null;
  const target = targets.find(item => item.word === normalized);
  const path = target ? target.path : (layout ? findWordPath(layout, normalized) : null);
  if (!path) return null;
  return { word: normalized, playerId, coins: normalized.length * 100, length: normalized.length, path, hidden: !!target, ...(target && target.champ ? { champ: true } : {}) };
}

/* A dictionary word only counts when its letters can be traced through
   neighbouring cells of the board. Depth-first walk from every cell that
   holds the first letter; 10 letters is the cap, so the search is tiny. */
export function findWordPath(layout, word) {
  const letters = normalizeGuess(word);
  const cols = layout.cols, rows = layout.rows, grid = layout.grid;
  if (!letters || letters.length < 2 || letters.length > 10 || letters.length > grid.length) return null;
  const step = (cell, index, path, used) => {
    if (index === letters.length) return path;
    const row = Math.floor(cell / cols), col = cell % cols;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const r = row + dr, c = col + dc;
      if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
      const next = r * cols + c;
      if (used.has(next) || grid[next] !== letters[index]) continue;
      used.add(next);
      path.push(next);
      const done = step(next, index + 1, path, used);
      if (done) return done;
      used.delete(next);
      path.pop();
    }
    return null;
  };
  for (let cell = 0; cell < grid.length; cell++) {
    if (grid[cell] !== letters[0]) continue;
    const path = step(cell, 1, [cell], new Set([cell]));
    if (path) return path;
  }
  return null;
}

/* -------------------------------------------------------------------------
   THE WORD HUNT BOARD
   Thirty hidden words, 2-10 letters, scattered across a wide letter grid the
   way a word search lays them out: straight lines in any of the eight
   directions, and words may share letters where they cross. Leftover cells
   get filler letters, so a finished board no longer highlights every tile.
   ------------------------------------------------------------------------- */
const HUNT_COLS = 14;
const HUNT_DIRS = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]];

function huntLengths(random, count) {
  const lengths = [];
  for (let length = 2; length <= 10; length++) {
    for (let i = 0; i < 3; i++) lengths.push(length);
  }
  while (lengths.length < count) lengths.push(2 + Math.floor(random() * 9));
  return shuffled(lengths, random).slice(0, count);
}

export function createWordSearchGrid(bank, random = Math.random, opts = {}) {
  const count = opts.count ?? 30;
  const cols = opts.cols ?? HUNT_COLS;
  const byLength = wordsByLength(bank, 2, 10);
  for (let attempt = 0; attempt < 48; attempt++) {
    const lengths = huntLengths(random, count);
    const total = lengths.reduce((n, length) => n + length, 0);
    const rows = Math.max(12, Math.ceil(total / cols) + 1);
    const grid = Array(cols * rows).fill(null);
    const words = [];
    const used = new Set();
    let stuck = false;
    for (const length of [...lengths].sort((a, b) => b - a)) {
      const options = shuffled(byLength.get(length) || [], random).filter(word => !used.has(word));
      let placed = false;
      for (const word of options.slice(0, 16)) {
        if (placeStraight(word)) { placed = true; break; }
      }
      if (!placed) { stuck = true; break; }
    }
    if (stuck) continue;
    const ALPHA = 'eeeaaaiioonnrtssttllccuuddppmnhgbyfvrwkjxqz';
    for (let i = 0; i < grid.length; i++) {
      if (!grid[i]) grid[i] = ALPHA[Math.floor(random() * ALPHA.length)];
    }
    return { grid, words, cols, rows };

    function placeStraight(word) {
      for (let t = 0; t < 80; t++) {
        const dir = HUNT_DIRS[Math.floor(random() * HUNT_DIRS.length)];
        const row0 = Math.floor(random() * rows), col0 = Math.floor(random() * cols);
        const path = [];
        let ok = true;
        for (let i = 0; i < word.length; i++) {
          const r = row0 + dir[0] * i, c = col0 + dir[1] * i;
          if (r < 0 || r >= rows || c < 0 || c >= cols) { ok = false; break; }
          const cell = r * cols + c;
          if (grid[cell] && grid[cell] !== word[i]) { ok = false; break; }
          path.push(cell);
        }
        if (!ok) continue;
        path.forEach((cell, i) => { grid[cell] = word[i]; });
        used.add(word);
        words.push({ word, path });
        return true;
      }
      return false;
    }
  }
  throw new Error('Could not build the word-hunt grid.');
}