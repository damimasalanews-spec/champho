export function canPlayCard(card, { pending = 0, color, top, hand = [] }) {
  if (!card) return false;
  if (pending > 0) return card.type === 'wild4';

  if (card.type === 'wild4' && hand.some(other =>
    other.id !== card.id && other.color === color && other.type !== 'wild4'
  )) return false;

  return card.color === 'wild' || card.color === color ||
    (top && (card.value === top.value || card.type === top.type));
}

export function chooseAiCard(hand, context) {
  const weight = { draw2: 9, skip: 8, reverse: 7, wild: 6, wild4: 5 };
  return hand.filter(card => canPlayCard(card, { ...context, hand }))
    .sort((a, b) => (weight[b.type] || 1) - (weight[a.type] || 1))[0] || null;
}

export function resolveChallenge(isLastWild4Legal, pending) {
  if (isLastWild4Legal) {
    return { offenderDraws: 0, challengerDraws: pending + 2, challengerKeepsTurn: false };
  }
  return { offenderDraws: pending, challengerDraws: 0, challengerKeepsTurn: true };
}

export function resolveAcceptedPenalty(pending) {
  return { draws: pending, skipTurn: true };
}
