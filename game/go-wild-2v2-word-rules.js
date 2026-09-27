const LETTERS = /[A-Z]/g;

export function wordLetters(value) {
  const letters = String(value ?? '').toUpperCase().match(LETTERS) || [];
  return letters.length ? { first: letters[0], last: letters.at(-1) } : null;
}

export function canPlayWord(word, requiredLetter) {
  const letters = wordLetters(typeof word === 'string' ? word : word?.word);
  return Boolean(letters && letters.first === String(requiredLetter ?? '').toUpperCase());
}

export function playableWords(hand, requiredLetter) {
  return (hand || []).filter(word => canPlayWord(word, requiredLetter));
}

export function resolveBookDraw(hand, drawnWord, requiredLetter) {
  if (canPlayWord(drawnWord, requiredLetter)) {
    return { hand: [...hand], play: drawnWord, passed: false };
  }
  return { hand: [...hand, drawnWord], play: null, passed: true };
}

export function chooseAiWord(hand, requiredLetter, random = Math.random) {
  const legal = playableWords(hand, requiredLetter);
  return legal.length ? legal[Math.floor(random() * legal.length)] : null;
}

