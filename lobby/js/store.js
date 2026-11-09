/* ===========================================================================
   CHAMP WORD — lobby state
   One object, one key in localStorage, one subscribe call. Screens never write
   to storage directly; they call an action here so every mutation is in one
   place and every render sees the same shape.
   =========================================================================== */

import { PLAYER, PASS_TIERS } from './data.js';

const KEY = 'champword.lobby.v2';

const DEFAULTS = () => ({
  signedIn: true,
  player: { ...PLAYER },
  settings: {
    sound: true,
    music: true,
    vibration: true,
    motion: true,
    friendRequests: true,
    partyInvites: true,
    live: true
  },
  owned: ['av-jester', 'fr-jade'],
  equipped: { characters: 'av-jester', frames: 'fr-jade', effects: null },
  daily: { streak: 3, claimed: [0, 1], today: 2 },
  claimedTiers: [1, 2, 3],
  claimedMissions: ['d4'],
  notificationsRead: false
});

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS();
    const parsed = JSON.parse(raw);
    const base = DEFAULTS();
    return {
      ...base,
      ...parsed,
      player: { ...base.player, ...(parsed.player || {}) },
      settings: { ...base.settings, ...(parsed.settings || {}) },
      equipped: { ...base.equipped, ...(parsed.equipped || {}) }
    };
  } catch {
    return DEFAULTS();
  }
}

let state = load();
const listeners = new Set();
let saveTimer;

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* private mode: the session still works, it just will not survive a reload */
    }
  }, 120);
}

function emit(reason) {
  persist();
  listeners.forEach((fn) => fn(state, reason));
}

export const store = {
  get state() { return state; },

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  /* --- player ------------------------------------------------------------ */
  updatePlayer(patch) {
    state.player = { ...state.player, ...patch };
    emit('player');
  },

  rename(name) {
    const clean = String(name || '').trim().slice(0, 18);
    if (!clean) return false;
    state.player.name = clean;
    emit('player');
    return true;
  },

  addCoins(n) {
    state.player.coins = Math.max(0, state.player.coins + n);
    emit('coins');
  },

  addGems(n) {
    state.player.gems = Math.max(0, state.player.gems + n);
    emit('gems');
  },

  /** Returns a reason string when the purchase cannot complete. */
  buy(item) {
    if (state.owned.includes(item.id)) return 'Already in your collection.';
    if (item.currency === 'gems') {
      if (state.player.gems < item.price) return 'Not enough diamonds.';
      state.player.gems -= item.price;
    } else if (state.player.coins < item.price) {
      return 'Not enough coins.';
    } else {
      state.player.coins -= item.price;
    }
    state.owned.push(item.id);
    emit('purchase');
    return null;
  },

  equip(item, cat) {
    state.equipped[cat] = state.equipped[cat] === item.id ? null : item.id;
    emit('equip');
  },

  /* --- daily ------------------------------------------------------------- */
  claimDaily() {
    const { today, claimed } = state.daily;
    if (claimed.includes(today)) return 0;
    const reward = 100 + today * 50;
    claimed.push(today);
    state.player.coins += reward;
    emit('daily');
    return reward;
  },

  /* --- season pass ------------------------------------------------------- */
  claimTier(tier) {
    if (state.claimedTiers.includes(tier.tier)) return null;
    if (state.player.seasonXp < tier.xp) return null;
    state.claimedTiers.push(tier.tier);
    if (tier.kind === 'coins') state.player.coins += tier.amount;
    if (tier.kind === 'gems') state.player.gems += tier.amount;
    emit('tier');
    return tier;
  },

  nextTier() {
    return PASS_TIERS.find((t) => !state.claimedTiers.includes(t.tier)) ?? null;
  },

  /* --- missions ---------------------------------------------------------- */
  claimMission(id) {
    if (state.claimedMissions.includes(id)) return false;
    state.claimedMissions.push(id);
    emit('mission');
    return true;
  },

  /* --- settings ---------------------------------------------------------- */
  toggle(key) {
    state.settings[key] = !state.settings[key];
    document.documentElement.dataset.motion = state.settings.motion ? 'full' : 'reduced';
    emit('settings');
    return state.settings[key];
  },

  /* --- session ----------------------------------------------------------- */
  signOut() {
    state = DEFAULTS();
    state.signedIn = false;
    state.player.name = 'Guest';
    emit('signout');
  },

  signIn(name) {
    state.signedIn = true;
    if (name) state.player.name = name;
    emit('signin');
  },

  reset() {
    state = DEFAULTS();
    emit('reset');
  },

  markNotificationsRead() {
    state.notificationsRead = true;
    emit('notifications');
  }
};

/* Keep the motion preference and the OS preference in one place. */
document.documentElement.dataset.motion = state.settings.motion ? 'full' : 'reduced';
