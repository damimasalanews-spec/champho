import type { BotPersonality, Card } from "./rooms.js";
import { DRAWABLE_WORDS } from "./doodles.js";

/** Words that have a doodle template, so a bot artist can sketch them. */
const DRAWABLE_SET = new Set(DRAWABLE_WORDS);

/**
 * Word bank. Difficulty is expressed as word length, which is the only thing a
 * player can actually perceive: §16 asks easy bots to prefer "simpler words".
 */
const WORD_BANK: Record<BotPersonality, readonly string[]> = {
  easy: [
    "cat","dog","sun","cup","map","tea","hat","bus","key","pen","box","owl","fox","bee","ant","egg",
    "ice","jar","net","pot","rug","sky","top","van","web","yak","zip","moon","star","tree","fish","bird",
    "leaf","rain","snow","wind","fire","wood","kite","lamp","milk","nest","sand","ship","sock","wave"
  ],
  normal: [
    "cloud","stone","river","tiger","chair","bread","light","plant","honey","brick","clock","dream",
    "eagle","flame","grape","house","lemon","music","ocean","paper","queen","robot","sugar","table",
    "voice","water","amber","beach","cabin","daisy","ivory","melon"
  ],
  aggressive: [
    "lantern","pyramid","journey","diamond","kitchen","harvest","crystal","dolphin","library","mystery",
    "octopus","penguin","rainbow","saffron","thunder","volcano","whisper","basket","canyon","dragon",
    "empire","falcon","garden","hammer","island","jungle","kettle","legend","marble","needle","pepper",
    "quartz","rocket","silver","temple","velvet","window","yellow","zephyr","bridge","candle","forest",
    "glacier","harbour","morning","sunrise"
  ]
};

export const ALL_PERSONALITIES: readonly BotPersonality[] = ["easy", "normal", "aggressive"];

export function pickTargetWord(
  personality: BotPersonality,
  random: () => number = Math.random,
  options: { drawableOnly?: boolean } = {}
): string {
  const bank = WORD_BANK[personality];
  // A bot artist has no pointer, so it can only sketch words that have a doodle
  // template. Restrict its bank to those. If the intersection is empty (the
  // aggressive bank shares no words with the templates) the fallback has to stay
  // inside the drawable set too — falling back to the full bank would hand the
  // turn a word that cannot be drawn at all.
  const restricted = options.drawableOnly ? bank.filter((word) => DRAWABLE_SET.has(word)) : bank;
  const pool = restricted.length > 0 ? restricted : options.drawableOnly ? DRAWABLE_WORDS : bank;
  return pool[Math.floor(random() * pool.length)] as string;
}

/**
 * The house's word: the artist in the current game is the game itself, so the
 * only requirement is that a doodle exists for the word.
 *
 * Drawn from the whole drawable set rather than one personality bank, which
 * keeps the pool at every template (a 3-letter `cat` next to a 6-letter
 * `lantern`) instead of narrowing it to one difficulty band. `exclude` is the
 * previous word, so the same drawing never comes up twice running.
 */
export function pickHouseWord(random: () => number = Math.random, exclude: string | null = null): string {
  const pool = exclude ? DRAWABLE_WORDS.filter((word) => word !== exclude) : DRAWABLE_WORDS;
  const source = pool.length > 0 ? pool : DRAWABLE_WORDS;
  return source[Math.floor(random() * source.length)] as string;
}

/**
 * How often a formed hand is guaranteed to contain the target's letters.
 * Easy bots miss the answer often, aggressive bots almost never — this is what
 * makes §17's no_valid_move a real, reachable state rather than dead code.
 */
const GUARANTEE_BY_PERSONALITY: Record<BotPersonality, number> = {
  easy: 0.55,
  normal: 0.75,
  aggressive: 0.95
};

export function shouldGuaranteeSolution(personality: BotPersonality, random: () => number = Math.random): boolean {
  return random() < GUARANTEE_BY_PERSONALITY[personality];
}

/** True when the hand holds every letter needed, accounting for repeats. */
export function canSpell(hand: Card[], word: string): boolean {
  const counts = new Map<string, number>();
  for (const card of hand) counts.set(card.value, (counts.get(card.value) ?? 0) + 1);
  for (const letter of word) {
    const available = counts.get(letter) ?? 0;
    if (available === 0) return false;
    counts.set(letter, available - 1);
  }
  return true;
}

/**
 * Deterministically choose one card per letter, in word order, so the returned
 * array spells `word` when concatenated. Returns null when impossible.
 */
export function selectCardsForWord(hand: Card[], word: string): string[] | null {
  const used = new Set<string>();
  const cardIds: string[] = [];
  for (const letter of word) {
    const card = hand.find((candidate) => candidate.value === letter && !used.has(candidate.cardId));
    if (!card) return null;
    used.add(card.cardId);
    cardIds.push(card.cardId);
  }
  return cardIds;
}

/**
 * Human-readable name for a bot seat, in table order.
 *
 * The names are handed out by seat number, and the seats are laid out around the
 * table in that same order, so this list is the order the turn visits the bots:
 * seat 1 is Aiko, seat 2 the next name, and so on. It reads Aiko, Mina, Kai down
 * the table.
 */
const BOT_NAMES = ["Aiko", "Mina", "Kai", "Rex", "Luna", "Jax", "Panda", "Fox"];
export function botDisplayName(index: number): string {
  return BOT_NAMES[index % BOT_NAMES.length] as string;
}
