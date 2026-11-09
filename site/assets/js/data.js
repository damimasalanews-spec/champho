/* ===========================================================================
   CHAMP WORD — demo content
   Everything a signed-in player can see before the server answers. The lobby
   runs from this file alone when no backend is reachable, which is what makes
   the site reviewable as a static deploy.
   =========================================================================== */

export const SEASON = {
  id: 'S01',
  name: 'Word Rush',
  ends: '2026-12-14T23:59:00Z',
  daysLeft: 39
};

/**
 * The five games the deployed home actually offers.
 *
 * These are transcribed from the live page, not invented: WORD UNO (classic),
 * GO WILD, UNO FUN PACK ("no mercy"), UNO CONTEST and PLAY WITH FRIENDS.
 * `game` opens a separate client in the round frame; `route` stays inside the
 * lobby for the screens that are not a table.
 */
export const MODES = [
  {
    id: 'classic',
    tone: 'classic',
    icon: 'cards',
    title: 'Word UNO',
    sub: 'Classic · 4 seats',
    desc: 'The original table: match the colour or the word, seven cards in hand, one winner.',
    cta: 'Open Classic',
    game: 'game/'
  },
  {
    id: 'wild',
    tone: 'wild',
    icon: 'flame',
    title: 'Go Wild',
    sub: '+2 · +4 · wild',
    desc: 'The 2v2 word grid: seven by six letters, thirty words a round, two teams of two.',
    cta: 'Open Go Wild',
    game: 'go-wild-2v2-finished.html'
  },
  {
    id: 'fun',
    tone: 'ruby',
    icon: 'dice',
    title: 'UNO Fun Pack',
    sub: 'No mercy!',
    desc: 'The ruthless rule set — stacking, forced draws and no let-up until a hand is empty.',
    cta: 'Coming soon',
    // There is no separate No Mercy build in the repository: the deployed home
    // opens the classic client for this card, and so does this one. When a Fun
    // Pack client lands, point this at it and drop pending.
    pending: true,
    game: 'game/'
  },
  {
    id: 'contest',
    tone: 'ranked',
    icon: 'crown',
    title: 'UNO Contest',
    sub: 'Season 01 ladder',
    desc: 'The ranked contest. Every win moves your season position; the ladder resets at the close.',
    cta: 'View the contest',
    route: 'ranks'
  },
  {
    id: 'friends',
    tone: 'private',
    icon: 'users',
    title: 'Play with Friends',
    sub: 'Private · free',
    desc: 'Open a table for your own group and hand out the six-character code.',
    cta: 'Open a table',
    route: 'room'
  }
];

export const PLAYER = {
  name: 'Champ',
  tag: '#4821',
  playerId: '1521719913732',
  title: 'Sheriff Mafia',
  level: 47,
  xp: 658,
  xpMax: 912,
  coins: 2_372_600,
  gems: 148,
  league: 'ELITE',
  highest: 'MASTER',
  trophies: 9262,
  wins: 1470,
  games: 2312,
  streak: 11,
  likes: 180,
  medals: 33,
  achievements: 54,
  charisma: 461,
  biggestWin: 24_960,
  seasonXp: 4860
};

export const LIVE_TABLES = [
  { id: 'T-8841', host: 'LunaGamer', players: ['LunaGamer', 'Kai_88', 'Rhea'], seats: 3, cap: 4, mode: 'Classic', stake: 250, live: true },
  { id: 'T-8836', host: 'KingRohan', players: ['KingRohan', 'Mira_Vale'], seats: 2, cap: 4, mode: 'Go Wild', stake: 500, live: true },
  { id: 'T-8829', host: 'Emma_Star', players: ['Emma_Star'], seats: 1, cap: 4, mode: 'Classic', stake: 250, live: true },
  { id: 'T-8822', host: 'NightOwl', players: ['NightOwl', 'VexHalo', 'Juno_K', 'PaperCrane'], seats: 4, cap: 4, mode: 'Classic', stake: 100, live: false }
];

export const FRIENDS = [
  { name: 'Emma_Star', status: 'In a Classic table', state: 'game', level: 52 },
  { name: 'KingRohan', status: 'Online', state: 'on', level: 44 },
  { name: 'LunaGamer', status: 'Online · queued', state: 'on', level: 39 },
  { name: 'NightOwl', status: 'Last seen 2h ago', state: 'off', level: 31 },
  { name: 'Mira_Vale', status: 'Last seen yesterday', state: 'off', level: 27 }
];

export const LEADERBOARD = [
  { rank: 1, name: 'SilverFang', level: 61, league: 'MASTER', score: 18_440, wins: 892, seasonXp: 4120 },
  { rank: 2, name: 'Emma_Star', level: 52, league: 'MASTER', score: 17_210, wins: 811, seasonXp: 5980 },
  { rank: 3, name: 'KageNoYume', level: 58, league: 'ELITE', score: 16_980, wins: 795, seasonXp: 6410 },
  { rank: 4, name: 'KingRohan', level: 44, league: 'ELITE', score: 14_620, wins: 703, seasonXp: 2880 },
  { rank: 5, name: 'LunaGamer', level: 39, league: 'ELITE', score: 13_905, wins: 668, seasonXp: 5240 },
  { rank: 6, name: 'PaperCrane', level: 46, league: 'DIAMOND', score: 12_180, wins: 590, seasonXp: 7150 },
  { rank: 7, name: 'NightOwl', level: 31, league: 'DIAMOND', score: 11_440, wins: 554, seasonXp: 3690 },
  { rank: 8, name: 'Mira_Vale', level: 27, league: 'DIAMOND', score: 10_020, wins: 512, seasonXp: 4760 },
  { rank: 9, name: 'VexHalo', level: 35, league: 'PLATINUM', score: 9_640, wins: 470, seasonXp: 2140 },
  { rank: 10, name: 'Juno_K', level: 29, league: 'PLATINUM', score: 8_870, wins: 441, seasonXp: 3010 }
];

export const MISSIONS_DAILY = [
  { id: 'd1', name: 'Play 3 matches', detail: 'Any mode', progress: 2, goal: 3, reward: 150, icon: 'cards' },
  { id: 'd2', name: 'Win a round with a wild card', detail: 'Classic or Go Wild', progress: 0, goal: 1, reward: 250, icon: 'flame' },
  { id: 'd3', name: 'Call UNO before your last card', detail: 'Timing counts', progress: 1, goal: 2, reward: 100, icon: 'target' },
  { id: 'd4', name: 'Send a reaction to a table', detail: 'Sticker or emote', progress: 3, goal: 3, reward: 75, icon: 'sparkle' }
];

export const MISSIONS_WEEKLY = [
  { id: 'w1', name: 'Win 10 tables', detail: 'Resets Monday', progress: 6, goal: 10, reward: 1200, icon: 'trophy' },
  { id: 'w2', name: 'Play 5 private tables', detail: 'With friends', progress: 1, goal: 5, reward: 800, icon: 'users' },
  { id: 'w3', name: 'Reach a 7-win streak', detail: 'Best streak this season', progress: 4, goal: 7, reward: 1500, icon: 'flame' }
];

export const EVENTS = [
  { id: 'e1', name: 'Word Rush', sub: 'Season 01 · live now', badge: 'LIVE', glow: 'rgb(224 181 103 / 0.28)', icon: 'crown' },
  { id: 'e2', name: 'Moonlit Doubles', sub: 'Go Wild weekend · 2v2', badge: 'WEEKEND', glow: 'rgb(185 138 224 / 0.3)', icon: 'swords' },
  { id: 'e3', name: 'The Long Table', sub: 'Endurance · 30 rounds', badge: 'SOON', glow: 'rgb(111 214 176 / 0.26)', icon: 'clock' }
];

/* Seven days of free rewards. kind only drives the icon on the card. */
export const DAILY_REWARDS = [
  { amount: 100, kind: 'coins' },
  { amount: 150, kind: 'coins' },
  { amount: 5, kind: 'gems' },
  { amount: 250, kind: 'coins' },
  { amount: 400, kind: 'coins' },
  { amount: 12, kind: 'gems' },
  { amount: 900, kind: 'coins' }
];
export const PASS_TIERS = [
  { tier: 1, xp: 0, name: 'Coin cache', kind: 'coins', amount: 500, rarity: 'common', icon: 'coin' },
  { tier: 2, xp: 400, name: 'Moon felt card back', kind: 'cosmetic', rarity: 'rare', icon: 'cards' },
  { tier: 3, xp: 900, name: 'Diamond pair', kind: 'gems', amount: 20, rarity: 'rare', icon: 'gem' },
  { tier: 4, xp: 1500, name: 'Night Owl avatar', kind: 'cosmetic', rarity: 'epic', icon: 'user' },
  { tier: 5, xp: 2200, name: 'Gold rim frame', kind: 'cosmetic', rarity: 'epic', icon: 'star' },
  { tier: 6, xp: 3000, name: 'Coin chest', kind: 'coins', amount: 2500, rarity: 'rare', icon: 'coin' },
  { tier: 7, xp: 3900, name: 'Castle table skin', kind: 'cosmetic', rarity: 'legend', icon: 'crown' },
  { tier: 8, xp: 4900, name: 'Diamond dozen', kind: 'gems', amount: 60, rarity: 'epic', icon: 'gem' },
  { tier: 9, xp: 6000, name: 'Royal sigil effect', kind: 'cosmetic', rarity: 'legend', icon: 'sparkle' },
  { tier: 10, xp: 7200, name: 'Word Rush crown', kind: 'cosmetic', rarity: 'legend', icon: 'crown' }
];

export const SHOP_ITEMS = [
  { id: 'av-owl', name: 'Night Owl', cat: 'characters', rarity: 'epic', price: 900, currency: 'coins', icon: 'user' },
  { id: 'av-sheriff', name: 'Sheriff Mafia', cat: 'characters', rarity: 'legend', price: 120, currency: 'gems', icon: 'user' },
  { id: 'av-jester', name: 'Moon Jester', cat: 'characters', rarity: 'rare', price: 450, currency: 'coins', icon: 'user' },
  { id: 'av-scholar', name: 'Word Scholar', cat: 'characters', rarity: 'common', price: 250, currency: 'coins', icon: 'user' },
  { id: 'fr-gold', name: 'Gold Rim', cat: 'frames', rarity: 'legend', price: 80, currency: 'gems', icon: 'star' },
  { id: 'fr-thorn', name: 'Thorn Wreath', cat: 'frames', rarity: 'epic', price: 700, currency: 'coins', icon: 'star' },
  { id: 'fr-jade', name: 'Jade Halo', cat: 'frames', rarity: 'rare', price: 400, currency: 'coins', icon: 'star' },
  { id: 'fx-ember', name: 'Ember Trail', cat: 'effects', rarity: 'epic', price: 650, currency: 'coins', icon: 'sparkle' },
  { id: 'fx-frost', name: 'Frost Draw', cat: 'effects', rarity: 'rare', price: 480, currency: 'coins', icon: 'sparkle' },
  { id: 'fx-crown', name: 'Crown Burst', cat: 'effects', rarity: 'legend', price: 150, currency: 'gems', icon: 'crown' },
  { id: 'tb-castle', name: 'Castle Felt', cat: 'effects', rarity: 'legend', price: 110, currency: 'gems', icon: 'crown' },
  { id: 'tb-jade', name: 'Deep Jade Table', cat: 'effects', rarity: 'epic', price: 820, currency: 'coins', icon: 'cards' }
];

export const SHOP_CATS = [
  { id: 'all', label: 'All' },
  { id: 'characters', label: 'Characters' },
  { id: 'frames', label: 'Frames' },
  { id: 'effects', label: 'Effects' }
];

export const NOTIFICATIONS = [
  { id: 'n1', kind: 'reward', title: 'Season reward ready', body: 'Tier 4 of Word Rush is claimable.', when: '2h ago', unread: true },
  { id: 'n2', kind: 'social', title: 'Emma_Star invited you', body: 'Private table · Classic · 250 stake.', when: '4h ago', unread: true },
  { id: 'n3', kind: 'game', title: 'Streak extended', body: 'You have won 11 tables in a row.', when: 'Yesterday', unread: false }
];

export const ACCOUNT_TITLES = ['Word Starter', 'Table Regular', 'Wild Caller', 'Season Contender', 'Master of Rounds'];

export const FAQ = [
  { q: 'How does a round end?', a: 'A seat wins by playing its last card. The winner takes the pot less its own stake; the table keeps the felt.' },
  { q: 'What does Wild do?', a: 'A wild card names the next colour. A +4 wild also gives the next seat four cards unless they challenge it.' },
  { q: 'Is the lobby saved locally?', a: 'Yes. Progress, cosmetics and preferences stay in this browser until the server takes over.' }
];
