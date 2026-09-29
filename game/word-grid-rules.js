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

function placeWords(bank, random, attempts = 32) {
  const byLength = wordsByLength(bank);
  if (LENGTHS.some(length => !(byLength.get(length)?.length))) {
    throw new Error('Word bank must include words of 3 through 9 letters.');
  }

  for (let attempt = 0; attempt < attempts; attempt++) {
    const path = hamiltonian(random);
    if (!path) continue;

    const picked = new Set(), words = [];
    let cursor = 0, stuck = false;
    for (const length of LENGTHS) {
      const options = shuffled(byLength.get(length), random).filter(word => !picked.has(word));
      if (!options.length) { stuck = true; break; }
      picked.add(options[0]);
      words.push({ word: options[0], path: path.slice(cursor, cursor + length) });
      cursor += length;
    }
    if (stuck) continue;

    const grid = Array(TOTAL).fill(null);
    for (const item of words) item.path.forEach((cell, index) => { grid[cell] = item.word[index]; });
    return { grid, words };
  }
  throw new Error('Could not build a ' + COLS + 'x' + ROWS + ' word grid.');
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