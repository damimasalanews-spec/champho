import {
  BUY_IN_COINS,
  COLORS,
  HAND_SIZE,
  canPlay,
  dealRound,
  openBoard,
  playableCards,
  scoreHand,
  winningsCoins,
  type Card,
  type CardColor
} from "./cards.js";

/**
 * A round of Classic mode, played on the table's board.
 *
 * This module owns the rules and nothing else: no database, no sockets, no
 * timers. The server layer reads a room out of PostgreSQL, replays the actions
 * recorded against it through these functions, and writes the result back, which
 * is what makes the whole round testable without a database.
 *
 * State changes are returned as a new state; nothing here mutates its input.
 */

export type RoundState = {
  /** One hand per seat. */
  hands: Card[][];
  /** The seven-letter word each seat's opening hand spells. */
  words: string[];
  /** Cards thrown onto the board, oldest first. The last one is on top. */
  board: Card[];
  drawPile: Card[];
  /** The colour a Wild named, or null while the top card's own colour stands. */
  named: CardColor | null;
  /** 1 is clockwise, -1 is anticlockwise. */
  direction: 1 | -1;
  /** Seat index, not a player id: the server maps ids to seats. */
  activeSeat: number;
  /** The card this seat drew, which they may still throw this turn. */
  drawnCardId: string | null;
  /** Whether each seat has called UNO on its current one-card hand. */
  unoSaid: boolean[];
  finished: boolean;
  winnerSeat: number | null;
};

export type RoundEvent =
  | { type: "card_thrown"; seat: number; card: Card; named: CardColor | null }
  | { type: "drew"; seat: number; count: number }
  | { type: "discarded_color"; seat: number; color: CardColor; count: number }
  | { type: "direction"; direction: 1 | -1 }
  | { type: "skipped"; seat: number }
  | { type: "called_uno"; seat: number }
  | { type: "caught"; seat: number; penalty: number }
  | { type: "round_won"; seat: number; word: string };

export type RoundOutcome = {
  ok: boolean;
  /** Why the action was refused, for the client to show. */
  code: string | null;
  state: RoundState;
  events: RoundEvent[];
};

export type Standing = {
  seat: number;
  /** Points left in the hand, scored the official way. */
  remaining: number;
  /** What the seat's opening hand spelled, revealed at the end. */
  word: string;
  coins: number;
};

export type RoundResult = {
  winnerSeat: number;
  /** The winner's seven-letter word, spelled out on the board. */
  word: string;
  pot: number;
  standings: Standing[];
};

const seatCountOf = (state: RoundState) => state.hands.length;

function clone(state: RoundState): RoundState {
  return {
    ...state,
    hands: state.hands.map((hand) => hand.slice()),
    board: state.board.slice(),
    drawPile: state.drawPile.slice(),
    words: state.words.slice(),
    unoSaid: state.unoSaid.slice()
  };
}

function refuse(state: RoundState, code: string): RoundOutcome {
  return { ok: false, code, state, events: [] };
}

/** The seat `steps` places along the current direction. */
export function nextSeat(state: RoundState, steps: number): number {
  const count = seatCountOf(state);
  return (((state.activeSeat + state.direction * steps) % count) + count) % count;
}

/**
 * Take `count` cards for a seat. When the draw pile runs dry the board is
 * recycled underneath its top card, exactly as the official game does, so a long
 * round cannot starve.
 */
function draw(state: RoundState, seat: number, count: number): number {
  let taken = 0;
  for (let i = 0; i < count; i += 1) {
    if (state.drawPile.length === 0) {
      if (state.board.length <= 1) break;
      const top = state.board[state.board.length - 1] as Card;
      const recycled = state.board.slice(0, -1);
      const shuffled = recycled
        .map((card) => ({ card, order: Math.random() }))
        .sort((a, b) => a.order - b.order)
        .map((entry) => entry.card);
      state.board = [top];
      state.drawPile = shuffled;
    }
    const card = state.drawPile.shift();
    if (!card) break;
    (state.hands[seat] as Card[]).push(card);
    taken += 1;
  }
  return taken;
}

/**
 * A new round: the words are chosen, the hands are dealt from them, and the
 * board opens on a letter so the first seat has something to match.
 */
export function startRound(seatCount: number): RoundState {
  const deal = dealRound(seatCount);
  const opened = openBoard(deal.drawPile);

  return {
    hands: deal.hands,
    words: deal.words,
    board: opened.board,
    drawPile: opened.drawPile,
    named: null,
    direction: 1,
    activeSeat: 0,
    drawnCardId: null,
    unoSaid: deal.hands.map(() => false),
    finished: false,
    winnerSeat: null
  };
}

/** Everything the seat holding `hand` could legally throw right now. */
export function legalCards(state: RoundState, seat: number): Card[] {
  const hand = state.hands[seat] as Card[];
  return playableCards(hand, state.board, state.named);
}

/**
 * Throw a card onto the board.
 *
 * `named` is required for a Wild or a Wild Draw Four: the card itself is
 * colourless, so the colour that continues the round is the player's choice.
 */
export function playCard(
  state: RoundState,
  seat: number,
  cardId: string,
  named: CardColor | null = null
): RoundOutcome {
  if (state.finished) return refuse(state, "round_over");
  if (seat !== state.activeSeat) return refuse(state, "not_your_turn");

  const hand = state.hands[seat] as Card[];
  const card = hand.find((c) => c.cardId === cardId);
  if (!card) return refuse(state, "card_not_in_hand");

  // A seat that drew this turn may throw that card and nothing else, which is
  // the official rule; otherwise their turn is over.
  if (state.drawnCardId && cardId !== state.drawnCardId) return refuse(state, "already_drew");
  if (!canPlay(card, state.board, state.named, hand)) return refuse(state, "illegal_play");

  const needsColor = card.kind === "wild" || card.kind === "wild4";
  if (needsColor && (!named || !COLORS.includes(named))) return refuse(state, "must_name_color");

  const next = clone(state);
  next.drawnCardId = null;

  const nextHand = next.hands[seat] as Card[];
  nextHand.splice(nextHand.indexOf(card), 1);
  next.board.push(card);
  next.named = needsColor ? named : null;

  const events: RoundEvent[] = [{ type: "card_thrown", seat, card, named: needsColor ? named : null }];

  // Down to one card: the seat must have said UNO before now, or it can be
  // caught by anyone at the table.
  next.unoSaid[seat] = nextHand.length === 1 ? next.unoSaid[seat] === true : false;

  // The card's effect resolves before the round is allowed to end. Official UNO
  // still hands the cards over when the last card played is a Draw Two or a Wild
  // Draw Four, so a winning throw cannot be allowed to skip its own effect.
  switch (card.kind) {
    case "skip": {
      const skipped = nextSeat(next, 1);
      events.push({ type: "skipped", seat: skipped });
      next.activeSeat = nextSeat(next, 2);
      break;
    }
    case "reverse": {
      next.direction = next.direction === 1 ? -1 : 1;
      events.push({ type: "direction", direction: next.direction });
      // Two seats have no direction to reverse, so it acts as a Skip.
      next.activeSeat = seatCountOf(next) === 2 ? nextSeat(next, 2) : nextSeat(next, 1);
      break;
    }
    case "draw2": {
      const victim = nextSeat(next, 1);
      draw(next, victim, 2);
      events.push({ type: "skipped", seat: victim });
      events.push({ type: "drew", seat: victim, count: 2 });
      next.activeSeat = nextSeat(next, 2);
      break;
    }
    case "wild4": {
      const victim = nextSeat(next, 1);
      draw(next, victim, 4);
      events.push({ type: "skipped", seat: victim });
      events.push({ type: "drew", seat: victim, count: 4 });
      next.activeSeat = nextSeat(next, 2);
      break;
    }
    case "discardAll": {
      // The card is coloured, so it clears the rest of that colour out of hand.
      const color = card.color as CardColor;
      const keep: Card[] = [];
      for (const held of next.hands[seat] as Card[]) {
        if (held.color === color) continue;
        keep.push(held);
      }
      const removed = (next.hands[seat] as Card[]).length - keep.length;
      next.hands[seat] = keep;
      events.push({ type: "discarded_color", seat, color, count: removed });
      next.activeSeat = nextSeat(next, 1);
      break;
    }
    default: {
      next.activeSeat = nextSeat(next, 1);
      break;
    }
  }

  if ((next.hands[seat] as Card[]).length === 0) {
    next.finished = true;
    next.winnerSeat = seat;
    events.push({ type: "round_won", seat, word: next.words[seat] as string });
  }

  return { ok: true, code: null, state: next, events };
}

/**
 * Draw one card. The seat may then throw that card, or end the turn with `pass`.
 */
export function drawCard(state: RoundState, seat: number): RoundOutcome {
  if (state.finished) return refuse(state, "round_over");
  if (seat !== state.activeSeat) return refuse(state, "not_your_turn");
  if (state.drawnCardId) return refuse(state, "already_drew");

  const next = clone(state);
  const taken = draw(next, seat, 1);
  if (taken === 0) return refuse(state, "draw_pile_empty");

  const hand = next.hands[seat] as Card[];
  const drawn = hand[hand.length - 1] as Card;
  next.drawnCardId = drawn.cardId;

  return { ok: true, code: null, state: next, events: [{ type: "drew", seat, count: 1 }] };
}

/** End the turn without throwing, which is the only way past a drawn card. */
export function pass(state: RoundState, seat: number): RoundOutcome {
  if (state.finished) return refuse(state, "round_over");
  if (seat !== state.activeSeat) return refuse(state, "not_your_turn");

  const next = clone(state);
  next.drawnCardId = null;
  next.activeSeat = nextSeat(next, 1);
  return { ok: true, code: null, state: next, events: [] };
}

/** Say UNO while holding one card. */
export function callUno(state: RoundState, seat: number): RoundOutcome {
  const next = clone(state);
  next.unoSaid[seat] = true;
  return { ok: true, code: null, state: next, events: [{ type: "called_uno", seat }] };
}

/**
 * Catch a seat that went down to one card without saying UNO. The penalty is the
 * official one: two cards, drawn before the next player begins.
 */
export function catchUno(state: RoundState, targetSeat: number): RoundOutcome {
  const hand = state.hands[targetSeat] as Card[];
  if (!hand || hand.length !== 1) return refuse(state, "nothing_to_catch");
  if (state.unoSaid[targetSeat]) return refuse(state, "uno_was_called");

  const next = clone(state);
  draw(next, targetSeat, 2);
  return {
    ok: true,
    code: null,
    state: next,
    events: [
      { type: "caught", seat: targetSeat, penalty: 2 },
      { type: "drew", seat: targetSeat, count: 2 }
    ]
  };
}

/** The result once a round is over: the word to reveal, the table, the coins. */
export function settle(state: RoundState, seatCount: number): RoundResult | null {
  if (!state.finished || state.winnerSeat === null) return null;
  const winnerSeat = state.winnerSeat;

  const standings = state.hands.map((hand, seat) => ({
    seat,
    remaining: seat === winnerSeat ? 0 : scoreHand(hand),
    word: state.words[seat] as string,
    coins: seat === winnerSeat ? winningsCoins(seatCount) : -BUY_IN_COINS
  }));

  return {
    winnerSeat,
    word: state.words[winnerSeat] as string,
    pot: BUY_IN_COINS * seatCount,
    standings
  };
}

/** Hands must always be dealt at the size the deal promises. */
export function isDealtHand(hand: Card[]): boolean {
  return hand.length === HAND_SIZE;
}
