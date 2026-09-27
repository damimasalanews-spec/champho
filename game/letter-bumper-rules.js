const LETTERS = /[A-Z]/g;

export function lettersForWord(word) {
  return String(word ?? '').toUpperCase().match(LETTERS) || [];
}

function canBuildWord(rack, entry) {
  const available = new Map();
  for (const letter of rack) available.set(letter, (available.get(letter) || 0) + 1);
  for (const letter of lettersForWord(entry)) {
    const count = available.get(letter) || 0;
    if (!count) return false;
    available.set(letter, count - 1);
  }
  return true;
}

export function findWordFromLetters(rack, lexicon, minLength = 3) {
  const candidates = [...new Set(lexicon || [])]
    .filter(entry => lettersForWord(entry).length >= minLength && canBuildWord(rack, entry))
    .sort((a, b) => lettersForWord(b).length - lettersForWord(a).length);
  return candidates[0] || null;
}

export function resolveLetterCapture(rack, letter, lexicon, minLength = 3) {
  const available = [...rack, String(letter).toUpperCase()];
  const word = findWordFromLetters(available, lexicon, minLength);
  if (!word) return { rack: available, word: null };

  const remaining = [...available];
  for (const needed of lettersForWord(word)) {
    remaining.splice(remaining.indexOf(needed), 1);
  }
  return { rack: remaining, word };
}

export function chooseMatchingLetter(book, used, requiredLetter, random = Math.random) {
  const inBook = (book || []).filter(value => String(value).toUpperCase() === requiredLetter);
  const candidates = inBook.length ? inBook : (used || []).filter(value => String(value).toUpperCase() === requiredLetter);
  return candidates.length ? candidates[Math.floor(random() * candidates.length)] : null;
}

