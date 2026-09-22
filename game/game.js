'use strict';

const WORD_POOL = [
  {
    theme: 'Nature',
    target: 'MOUNTAIN',
    scramble: 'NUMAONTI',
    bonuses: ['MOUNT', 'UNION', 'ANION', 'MOAT', 'MINT', 'MAIN', 'INTO', 'ATOM', 'UNIT', 'ANTI', 'TUNA'],
  },
  {
    theme: 'Waterside',
    target: 'LAKESIDE',
    scramble: 'DIESELKA',
    bonuses: ['IDEAS', 'ASIDE', 'SKIED', 'SLIDE', 'LAKE', 'SIDE', 'IDEA', 'LEAK', 'SAID', 'SEAL', 'DEAL', 'KIDS', 'DAIS', 'SAIL'],
  },
  {
    theme: 'Victory',
    target: 'CHAMPION',
    scramble: 'PANCHIMO',
    bonuses: ['CHAMP', 'PIANO', 'CHAIN', 'MANIC', 'CAMP', 'MOAN', 'PAIN', 'MAIN', 'ICON', 'CHIN', 'CHIP', 'AMINO'],
  },
  {
    theme: 'Forest',
    target: 'PINEWOOD',
    scramble: 'WOODENPI',
    bonuses: ['WOODEN', 'ENDOW', 'PINE', 'WOOD', 'WINE', 'POND', 'DONE', 'NODE', 'WIND', 'OPEN', 'DOWN', 'DINE', 'OWED'],
  },
  {
    theme: 'Weather',
    target: 'SUNSHINE',
    scramble: 'SHINNUES',
    bonuses: ['SHINE', 'NINE', 'HISS', 'SINS', 'HENS', 'NUNS', 'HUES', 'SHUN', 'INNS', 'SUNS'],
  },
  {
    theme: 'Food',
    target: 'PANCAKES',
    scramble: 'SNACKAPE',
    bonuses: ['PANCAKE', 'SNACK', 'CAKES', 'PACKS', 'PEAKS', 'CAPES', 'CANES', 'CAKE', 'PACK', 'PANS', 'CANE', 'NAPE', 'SNAP', 'ACNE', 'PEAK', 'SACK', 'CAPE'],
  },
  {
    theme: 'Night',
    target: 'MOONBEAM',
    scramble: 'BAMMOONE',
    bonuses: ['MOON', 'BEAM', 'MOAN', 'BONE', 'NAME', 'MANE', 'BOOM', 'MEMO', 'BANE', 'OMEN', 'AMEN'],
  },
  {
    theme: 'Ocean',
    target: 'SEASHORE',
    scramble: 'ASHEROES',
    bonuses: ['SEAHORSE', 'ASHORE', 'HORSE', 'SHEAR', 'SHARE', 'HEARS', 'ROSES', 'SHORE', 'ROSE', 'SORE', 'HOSE', 'HERO', 'HEAR', 'EARS', 'SOAR', 'OARS', 'SEAR'],
  },
  {
    theme: 'Music',
    target: 'KEYBOARD',
    scramble: 'OKEYBARD',
    bonuses: ['BARKED', 'BREAK', 'BRAKE', 'BAKED', 'BOARD', 'BROAD', 'BORED', 'ROBED', 'YARD', 'BARK', 'DARK', 'BARD', 'ROAD', 'READ', 'DEAR', 'DARE', 'BORE', 'ROBE'],
  },
  {
    theme: 'Garden',
    target: 'BLOSSOM',
    scramble: 'MOBLOSS',
    bonuses: ['BLOOMS', 'BLOOM', 'MOSS', 'LOOMS', 'LOOM', 'LOSS', 'BOOM'],
  },
  {
    theme: 'Winter',
    target: 'SNOWFLAKE',
    scramble: 'WOLFSKANE',
    bonuses: ['FLAKES', 'FLAKE', 'ALONE', 'WAKE', 'FAKE', 'FAWN', 'FLEA', 'FLOE', 'SLOE', 'LOAN', 'WOLF', 'FLAN', 'LAWN', 'SNOW'],
  },
  {
    theme: 'Animals',
    target: 'ELEPHANT',
    scramble: 'NETHPALE',
    bonuses: ['PLANET', 'PLANE', 'LEAPT', 'HEAL', 'HEEL', 'LEAP', 'PALE', 'TALE', 'TEAL', 'NAPE', 'PANT', 'HEAT', 'HELP', 'PEAL'],
  },
  {
    theme: 'Sky',
    target: 'RAINBOW',
    scramble: 'WRAINBO',
    bonuses: ['BRAIN', 'BROWN', 'BORN', 'BARN', 'IRON', 'RAIN', 'BROW', 'BOW', 'WAR', 'RAW', 'OAR', 'BAN', 'NAB', 'BIN', 'ROB', 'ROW', 'WIN'],
  },
  {
    theme: 'Earth',
    target: 'VOLCANO',
    scramble: 'OCVOLAN',
    bonuses: ['NOVA', 'OVAL', 'COAL', 'CLAN', 'COLA', 'CAN', 'VAN', 'CON'],
  },
  {
    theme: 'Medieval',
    target: 'CASTLE',
    scramble: 'ELCAST',
    bonuses: ['CLEAT', 'SLATE', 'LEAST', 'STEAL', 'TALES', 'TEALS', 'SALE', 'EAST', 'CAST', 'LAST', 'SALT', 'LATE', 'TALE', 'TEAL', 'ACES', 'SEAT', 'LACE', 'CASE'],
  },
  {
    theme: 'Space',
    target: 'ROCKET',
    scramble: 'OCKRET',
    bonuses: ['ROCK', 'CORE', 'CORK', 'TORE', 'TREK', 'COKE', 'OKER', 'TORC', 'COT', 'TOE'],
  },
  {
    theme: 'Strings',
    target: 'GUITAR',
    scramble: 'TIARGU',
    bonuses: ['GRIT', 'RUG', 'ART', 'TAR', 'RAT', 'RAG', 'GUT', 'TUG', 'AIR', 'TAG'],
  },
  {
    theme: 'Photo',
    target: 'CAMERA',
    scramble: 'AMERCA',
    bonuses: ['RACE', 'CARE', 'ACER', 'CAME', 'REAM', 'MARC', 'ARM', 'EAR', 'ERA', 'ACE', 'MAR', 'RAM', 'CAR', 'CAM', 'ARC'],
  },
  {
    theme: 'Wheels',
    target: 'BICYCLE',
    scramble: 'ELCICYB',
    bonuses: ['CYCLE', 'CLICY', 'BILE', 'ICE'],
  },
  {
    theme: 'Rainy',
    target: 'UMBRELLA',
    scramble: 'LUMBAREL',
    bonuses: ['LUMBER', 'RUMBLE', 'UMBER', 'BLAME', 'AMBLE', 'MURAL', 'RUMBA', 'BULL', 'BELL', 'RULE', 'REAL', 'BALE', 'BEAM', 'MULE', 'MALE', 'BURL', 'LURE', 'LAME'],
  },
  {
    theme: 'Lunch',
    target: 'SANDWICH',
    scramble: 'SANDWCIH',
    bonuses: ['WIND', 'SAND', 'HAND', 'CHIN', 'WISH', 'WAND', 'DISH', 'SWAN', 'SAID', 'DASH', 'WINS', 'AND', 'SIN'],
  },
  {
    theme: 'Pirates',
    target: 'TREASURE',
    scramble: 'ERASURET',
    bonuses: ['ERASE', 'TREES', 'TEARS', 'RATES', 'STARE', 'UREA', 'SEAT', 'EAST', 'REST', 'EARS', 'TRUE', 'SURE', 'STAR', 'RAT', 'ART', 'EAR'],
  },
  {
    theme: 'Gems',
    target: 'DIAMOND',
    scramble: 'ADMONDI',
    bonuses: ['DOMAIN', 'NOMAD', 'AMINO', 'MOAN', 'DOIN', 'DAM', 'MAD', 'MAN', 'NOD', 'AID', 'AND', 'DIN'],
  },
  {
    theme: 'Insects',
    target: 'BUTTERFLY',
    scramble: 'TERFLYBUT',
    bonuses: ['BUTTER', 'FLUTE', 'REBUT', 'TUBER', 'BUTTE', 'FLUB', 'TRULY', 'BURLY', 'BYTE', 'TUBE', 'BURL', 'FURY', 'LYE', 'YET', 'FUR', 'RUE', 'ELF'],
  },
  {
    theme: 'Prehistoric',
    target: 'DINOSAUR',
    scramble: 'SAURDINO',
    bonuses: ['SOUND', 'ROUND', 'ARSON', 'RINDS', 'RADIO', 'DINOS', 'SODA', 'SOUR', 'RAIN', 'RUIN', 'SAND', 'IRON', 'OUR', 'NOD', 'DIN'],
  },
  {
    theme: 'Travel',
    target: 'AIRPLANE',
    scramble: 'AIRPALNE',
    bonuses: ['PLANE', 'PANEL', 'PEARL', 'LEARN', 'PERIL', 'NEAR', 'PLAN', 'PALE', 'PAIN', 'PANE', 'NAIL', 'LINE', 'LAIR', 'RAIL', 'PINE', 'LEAN'],
  },
  {
    theme: 'Celebration',
    target: 'FIREWORKS',
    scramble: 'FIREWROKS',
    bonuses: ['WORKS', 'WORK', 'FIRES', 'FIRE', 'FORKS', 'FORK', 'SWORE', 'SOWER', 'SKIER', 'OWERS', 'WIRES', 'WIRE', 'ROSE', 'SORE', 'WOES', 'RISE', 'RISK'],
  },
  {
    theme: 'Explorer',
    target: 'COMPASS',
    scramble: 'SCOMPAS',
    bonuses: ['SCAMP', 'CAMP', 'COMP', 'MOPS', 'PASS', 'SOAP', 'SCAM', 'CAPS', 'MASS', 'MOSS', 'COP', 'SOP'],
  },
  {
    theme: 'Light',
    target: 'LANTERN',
    scramble: 'NALTERN',
    bonuses: ['LEARN', 'RENT', 'NEAR', 'EARN', 'TALE', 'LATE', 'TEAR', 'RATE', 'TEAL', 'REAL', 'LEAN', 'LENT', 'ANT', 'EAR', 'TEN', 'NET', 'ALE'],
  },
  {
    theme: 'Summer',
    target: 'BEACHBALL',
    scramble: 'BEACHLLAB',
    bonuses: ['BLEACH', 'BEACH', 'LEACH', 'CABLE', 'BABEL', 'ABLE', 'BALE', 'EACH', 'LACE', 'BELL', 'BALL', 'CALL', 'HALL', 'ALE'],
  },
];

const ROUND_COUNT = 30;

function pickRounds() {
  const a = WORD_POOL.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, ROUND_COUNT);
}

let ROUNDS = pickRounds();

const ROUND_TIME = 45;
const EMOJIS = ['😄', '😂', '😮', '😭', '😡', '🤔', '😎', '🥳', '👏', '👍', '❤️', '🎉'];
const AMBIENT_LINES = [
  'Nice one!', 'Good luck everyone!', 'Almost there!', "Let's go!",
  'Hmm this one is tricky...', 'This theme is easy 😄',
  'Who shuffled my letters?!', 'One more word...', 'So close!',
];
const REPLY_LINES = ['😄', 'gg', 'haha true', 'good luck!', '👍', 'same here'];
const THANK_LINES = ['thanks! 😄', '😂', '🙌', 'right back at you!'];

const $ = (id) => document.getElementById(id);

const S = {
  phase: 'menu', // menu | splash | playing | roundEnd | gameOver
  mode: 'classic', // classic | sketch
  round: 0,
  done: 0,        // rounds completed
  timeLeft: ROUND_TIME,
  tiles: [],        // {letter, used}
  slots: [],        // tile index or -1
  found: new Set(),
  solvedBy: null,
  botPlans: [],     // {idx, solve, time, done, gain}
  giftClaimed: false,
  muted: false,
  lastGain: 0,
  players: [],
};

function makePlayers() {
  const guest = 'Guest' + Math.floor(100000 + Math.random() * 900000);
  return [
    { name: 'Surojit',    emoji: '🧑',   ring: '#22d3ee', bnr: '#0e7490', chat: '#fbbf24', coins: 0, pos: 'pos-tl' },
    { name: 'Isla.Criss', emoji: '👧', ring: '#f472b6', bnr: '#be185d', chat: '#fb923c', coins: 0, pos: 'pos-tr' },
    { name: guest,        emoji: '🧑🏻', ring: '#f9a8d4', bnr: '#1d4ed8', chat: '#fde047', coins: 0, pos: 'pos-front', you: true },
    { name: 'Champ',      emoji: '🧑',   ring: '#facc15', bnr: '#b45309', chat: '#fbbf24', coins: 0, pos: 'pos-mr' },
  ];
}
const you = () => S.players.find((p) => p.you);
const youIdx = () => S.players.findIndex((p) => p.you);

/* ---------------- profile bridge ----------------
   The profile shell embeds this game and posts what each seat is wearing. The
   art is local (copied from the profile), so seats render even if the shell is
   slow or unreachable. Coins earned here are posted back so the shell can save
   them - a guest has no account, so that save is the only record. */
const FRAME_BOX = {   // frame id -> [opening box %, centre x, centre y]
  crystal: [56.0, 0.495, 0.564], royal:   [49.6, 0.495, 0.609],
  emerald: [55.2, 0.502, 0.552], thorn:   [48.2, 0.498, 0.509],
  silk:    [57.4, 0.498, 0.533], pearl:   [45.7, 0.493, 0.514],
  volt:    [53.5, 0.507, 0.519], cosmos:  [56.3, 0.507, 0.505],
  prism:   [51.7, 0.450, 0.557],
};
/* bots wear their own kit so every seat shows a full look */
/* title ids match the title art that ships with the profile: they are named
   after the frame themes, not after the portraits */
const BOT_KIT = [
  { portrait: 'ninja',  frame: 'thorn',   title: 'royal'   },
  { portrait: 'wizard', frame: 'emerald', title: 'silk'    },
  { portrait: 'robot',  frame: 'volt',    title: 'cosmos'  },
];
const KIT = { portrait: 'classic', frame: 'crystal', title: 'crystal', name: '', coins: null };

function kitFor(p) {
  if (p.you) return KIT;
  let n = 0;
  for (const q of S.players) { if (q === p) break; if (!q.you) n++; }
  return BOT_KIT[n % BOT_KIT.length];
}
function applyKit() {
  S.players.forEach((p) => {
    const k = kitFor(p) || {};
    p.portrait = k.portrait || '';
    p.frame    = k.frame    || '';
    p.title    = k.title    || '';
  });
  const y = you();
  if (y && KIT.name) y.name = KIT.name;
}
/* the portrait is cut to the ring's own opening, exactly as the profile does */
function seatArt(p) {
  if (!p.portrait) return '';
  const f = p.frame && FRAME_BOX[p.frame] ? FRAME_BOX[p.frame] : null;
  let h = '<span class="aface"';
  if (f) {
    h += ' style="--hx:' + ((f[1] - f[0] / 200) * 100).toFixed(3) + '%;' +
         '--hy:' + ((f[2] - f[0] / 200) * 100).toFixed(3) + '%;--hw:' + f[0] + '%;' +
         '--hm:url(../assets/frames/' + p.frame + '_hole.webp)"';
  }
  h += '><img src="../assets/avatars/' + p.portrait + '.webp" alt=""></span>';
  if (p.frame) h += '<img class="aframe" src="../assets/frames/' + p.frame + '.webp" alt="">';
  return h;
}
/* every coin the player earns is reported so it survives the session */
function creditYou(n) {
  const y = you();
  if (!y || !n) return;
  y.coins += n;
  try { parent.postMessage({ champEarn: { coins: n, result: 'round' } }, '*'); } catch (e) {}
}
window.addEventListener('message', function (e) {
  const d = e && e.data;
  if (!d || typeof d !== 'object') return;
  const L = d.champProfile || d.champLoadout || d;
  if (L && (L.portrait || L.frame || L.title != null || L.name || L.coins != null)) {
    if (L.portrait) KIT.portrait = L.portrait;
    if (L.frame)    KIT.frame    = L.frame;
    if (L.title != null) KIT.title = L.title;
    if (L.name)     KIT.name     = L.name;
    if (L.coins != null) KIT.coins = +L.coins;
    applyKit();
    try { renderCards(); updateHUD(); } catch (err) {}
  }
});
try { parent.postMessage({ champReady: true }, '*'); } catch (e) {}

/* ---------------- sound (all original, synthesized) ---------------- */
let AC = null;
function ac() {
  if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
  if (AC.state === 'suspended') AC.resume();
  return AC;
}
function note(freq, dur = 0.12, type = 'sine', gain = 0.05, when = 0, slideTo = null, force = false) {
  if (S.muted && !force) return;
  try {
    const c = ac(), o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, c.currentTime + when);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + when + dur);
    g.gain.setValueAtTime(gain, c.currentTime + when);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + when + dur);
    o.connect(g).connect(c.destination);
    o.start(c.currentTime + when); o.stop(c.currentTime + when + dur + 0.02);
  } catch (e) { /* audio unavailable */ }
}
function whoosh(dur = 0.25, gain = 0.05, when = 0, freq = 1200) {
  if (S.muted) return;
  try {
    const c = ac(), len = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq;
    const g = c.createGain(); g.gain.value = gain;
    src.connect(f).connect(g).connect(c.destination);
    src.start(c.currentTime + when);
  } catch (e) { /* audio unavailable */ }
}
const sfx = {
  tap:    () => note(700, 0.05, 'triangle', 0.05),
  place:  (i) => note(500 + i * 60, 0.07, 'square', 0.045),
  back:   () => note(320, 0.07, 'square', 0.04),
  shuffle:() => { whoosh(0.3, 0.06, 0, 900); whoosh(0.25, 0.05, 0.12, 1600); },
  error:  () => { note(220, 0.18, 'sawtooth', 0.06, 0, 110); note(160, 0.22, 'sawtooth', 0.05, 0.08, 80); },
  coin:   () => { note(1250, 0.06, 'sine', 0.06); note(1650, 0.12, 'sine', 0.06, 0.06); },
  bonus:  () => [880, 1108, 1318].forEach((f, i) => note(f, 0.1, 'triangle', 0.06, i * 0.07)),
  good:   () => [523, 659, 784].forEach((f, i) => note(f, 0.12, 'triangle', 0.06, i * 0.09)),
  solve:  () => { [523, 659, 784, 1046].forEach((f, i) => note(f, 0.14, 'triangle', 0.07, i * 0.08)); whoosh(0.4, 0.04, 0, 2000); },
  win:    () => [392, 523, 659, 784, 1046, 1318].forEach((f, i) => note(f, 0.18, 'triangle', 0.07, i * 0.1)),
  lose:   () => { note(300, 0.3, 'sawtooth', 0.05, 0, 150); note(200, 0.4, 'sawtooth', 0.05, 0.25, 100); },
  bot:    () => { note(494, 0.09, 'triangle', 0.05); note(624, 0.12, 'triangle', 0.05, 0.09); },
  round:  () => { whoosh(0.35, 0.05, 0, 800); note(880, 0.15, 'sine', 0.06, 0.25); },
  tick:   () => note(1000, 0.04, 'square', 0.035),
  emote:  () => note(950, 0.08, 'sine', 0.05, 0, 1400),
  gift:   () => [784, 988, 1175, 1568].forEach((f, i) => note(f, 0.1, 'sine', 0.05, i * 0.06)),
};

/* original background music loop */
let musicOn = false, musicTimer = null, musicBar = 0;
const CHORDS = [
  [261.63, 329.63, 392.00],
  [196.00, 246.94, 293.66],
  [220.00, 261.63, 329.63],
  [174.61, 220.00, 261.63],
];
function playBar() {
  const c = CHORDS[musicBar % CHORDS.length];
  musicBar++;
  const m = (f, d, t, g, w) => note(f, d, t, g, w, null, true);
  c.forEach((f) => m(f, 1.7, 'triangle', 0.012));
  [0, 1, 2, 1, 0, 2, 1, 2].forEach((n, i) => m(c[n] * 2, 0.16, 'sine', 0.018, i * 0.25));
  m(c[0] / 2, 0.4, 'sine', 0.028);
  m(c[0] / 2, 0.4, 'sine', 0.028, 1.0);
}
function setMusic(on) {
  musicOn = on;
  $('musicBtn').textContent = on ? '🎵' : '🎼';
  if (on && !musicTimer) { playBar(); musicTimer = setInterval(playBar, 2000); }
  if (!on && musicTimer) { clearInterval(musicTimer); musicTimer = null; }
}

/* ---------------- rendering ---------------- */
function renderCards() {
  const wrap = $('cards');
  applyKit();
  wrap.innerHTML = '';
  S.players.forEach((p, i) => {
    const card = document.createElement('div');
    card.className = 'pcard ' + p.pos + (p.you ? ' you' : '');
    card.id = 'card-' + i;
    card.style.animationDelay = (i * 90) + 'ms';
    card.innerHTML =
      '<div class="plate">' +
      '<div class="atile' + (p.portrait ? ' has-art' : '') + '" style="--ring:' + p.ring + '">' +
      '<div class="bubble"></div><span class="rank-badge">4</span>' + seatArt(p) +
      (p.portrait ? '' : '<span class="aemoji">' + p.emoji + '</span>') + '</div>' +
      '<div class="nbanner" style="--bnr:' + p.bnr + '"><span class="nbadge">' + p.name[0].toUpperCase() + '</span>' +
      '<span class="nname">' + p.name + '</span></div>' +
      '<div class="racebar"><i></i></div>' +
      '<div class="pcoins">🪙 <span class="pcoinval">' + p.coins + '</span></div>' +
      (p.you ? '<button class="emote-btn" data-i="' + i + '">😄 ▾</button>' : '') +
      '</div>';
    wrap.appendChild(card);
  });
  wrap.querySelectorAll('.emote-btn').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    openPicker(+b.dataset.i, b);
  }));
  updateCrown();
}

function updateHUD() {
  $('hudCoins').textContent = you().coins;
  $('roundPill').textContent = 'ROUND ' + S.done + '/' + ROUNDS.length;
  const m = Math.floor(S.timeLeft / 60), s = S.timeLeft % 60;
  $('timerPill').textContent = '⏱ ' + m + ':' + String(s).padStart(2, '0');
  $('timerPill').classList.toggle('low', S.phase === 'playing' && S.timeLeft <= 10);
  S.players.forEach((p, i) => {
    const el = document.querySelector('#card-' + i + ' .pcoinval');
    if (el) el.textContent = p.coins;
  });
}

function updateCrown() {
  const order = S.players.map((_, i) => i).sort((a, b) => S.players[b].coins - S.players[a].coins);
  const lead = S.players[order[0]].coins;
  order.forEach((idx, r) => {
    const card = document.querySelector('#card-' + idx);
    if (!card) return;
    const badge = card.querySelector('.rank-badge');
    if (badge) {
      badge.textContent = ['\u{1F3C6}', '\u{1F948}', '\u{1F949}', '4'][r] || String(r + 1);
      badge.className = 'rank-badge r' + (r + 1);
    }
    const bar = card.querySelector('.racebar i');
    if (bar) bar.style.width = (lead > 0 ? Math.round(S.players[idx].coins / lead * 100) : 0) + '%';
  });
}

function renderTray(deal) {
  const tilesEl = $('tiles'), slotsEl = $('slots');
  tilesEl.innerHTML = ''; slotsEl.innerHTML = '';
  S.tiles.forEach((t, i) => {
    const b = document.createElement('button');
    b.className = 'tile' + (t.used ? ' used' : '') + (deal ? ' deal' : '');
    if (deal) b.style.animationDelay = (i * 45) + 'ms';
    b.textContent = t.letter;
    b.dataset.i = i;
    b.addEventListener('click', () => tapTile(i));
    tilesEl.appendChild(b);
  });
  const n = ROUNDS[S.round].target.length;
  for (let s = 0; s < n; s++) {
    const d = document.createElement('button');
    const ti = S.slots[s];
    d.className = 'slot' + (ti >= 0 ? ' filled' : '');
    d.textContent = ti >= 0 ? S.tiles[ti].letter : '';
    d.addEventListener('click', () => tapSlot(s));
    slotsEl.appendChild(d);
  }
  $('submitBtn').classList.toggle('ready', S.phase === 'playing' && S.slots.every((i) => i >= 0));
}

function renderParchment() {
  const r = ROUNDS[S.round];
  $('pTheme').textContent = S.phase === 'menu' ? '' : 'Theme: ' + r.theme + ' · ' + r.target.length + ' letters';
  const found = $('pFound');
  found.innerHTML = '';
  S.found.forEach((w) => {
    const sp = document.createElement('span');
    sp.textContent = w;
    found.appendChild(sp);
  });
}

/* ---------------- sketch board ---------------- */
function renderSketch(word) {
  const svg = $('sketchSvg');
  const data = (window.SKETCH_DATA && window.SKETCH_DATA[word]) || window.SKETCH_DATA._default;
  svg.innerHTML = data.join('');
  $('sketchWord').textContent = '';
  $('sketchWord').classList.remove('show');
  const board = document.querySelector('.board-frame');
  if (board) board.classList.remove('celebrate');
  const els = [...svg.querySelectorAll('path,circle,ellipse,line,polyline,polygon,rect')];
  els.forEach((el, i) => {
    let len = 0;
    try { len = el.getTotalLength ? el.getTotalLength() : 0; } catch (e) { len = 0; }
    if (!len || !isFinite(len)) len = 320;
    el.style.strokeDasharray = len + ' ' + len;
    el.style.strokeDashoffset = len;
    el.getBoundingClientRect();
    const dur = 0.45 + Math.min(0.9, len / 420);
    el.style.transition = 'stroke-dashoffset ' + dur.toFixed(2) + 's ease ' + (i * 0.16).toFixed(2) + 's';
    el.style.strokeDashoffset = '0';
  });
}

function flyLettersToBoard(word) {
  const boardEl = document.querySelector('.board-face');
  if (!boardEl) return;
  const b = boardEl.getBoundingClientRect();
  const slotEls = [...document.querySelectorAll('#slots .slot')];
  const n = word.length;
  const step = Math.min(40, (b.width * 0.86) / n);
  const totalW = step * n;
  const left0 = b.left + b.width / 2 - totalW / 2 + step / 2;
  const topY = b.top + b.height * 0.62;
  slotEls.forEach((el, i) => {
    if (i >= n) return;
    const r = el.getBoundingClientRect();
    const sx = r.left + r.width / 2, sy = r.top + r.height / 2;
    const s = document.createElement('span');
    s.className = 'fly-letter';
    s.textContent = word[i];
    s.style.left = sx + 'px';
    s.style.top = sy + 'px';
    $('fx').appendChild(s);
    const dx = (left0 + i * step) - sx;
    const dy = topY - sy;
    requestAnimationFrame(() => {
      s.style.transition = 'transform .85s cubic-bezier(.35,-0.35,.45,1.35) ' + (i * 0.07).toFixed(2) + 's, opacity .3s ease ' + (0.9 + i * 0.07).toFixed(2) + 's';
      s.style.transform = 'translate(' + dx + 'px,' + dy + 'px) translateZ(140px) rotateY(360deg) scale(1.25)';
      s.style.opacity = '0.15';
    });
    setTimeout(() => s.remove(), 1500 + i * 70);
  });
  setTimeout(() => {
    const cap = $('sketchWord');
    cap.textContent = word;
    cap.classList.add('show');
  }, 950);
}

function announceSketch(solverIdx) {
  const name = solverIdx === youIdx() ? 'You' : S.players[solverIdx].name;
  const a = $('sketchAnnounce');
  a.textContent = '🎉 ' + name + ' guessed it — ' + ROUNDS[S.round].target + '!';
  a.classList.remove('show');
  void a.offsetWidth;
  a.classList.add('show');
}

function setMode(mode) {
  S.mode = mode;
  $('modePill').textContent = mode === 'sketch' ? 'SKETCH' : 'CLASSIC';
  const sketch = mode === 'sketch';
  $('sketchBoard').classList.toggle('hidden', !sketch);
  $('parchment').classList.toggle('hidden', sketch);
}


/* ---------------- fx ---------------- */
function showBubble(cardIdx, emoji) {
  const card = $('card-' + cardIdx);
  if (!card) return;
  const b = card.querySelector('.bubble');
  b.textContent = emoji;
  b.classList.remove('show');
  void b.offsetWidth;
  b.classList.add('show');
  clearTimeout(b._t);
  b._t = setTimeout(() => b.classList.remove('show'), 1900);
  sfx.emote();
}
function coinFly(fromEl) {
  const a = fromEl.getBoundingClientRect(), b = $('hudCoins').getBoundingClientRect();
  const sp = document.createElement('span');
  sp.className = 'coin-fly';
  sp.textContent = '🪙';
  sp.style.left = (a.left + a.width / 2) + 'px';
  sp.style.top = a.top + 'px';
  $('fx').appendChild(sp);
  requestAnimationFrame(() => {
    sp.style.transform = 'translate(' + (b.left - a.left - a.width / 2) + 'px,' + (b.top - a.top) + 'px) scale(.6)';
    sp.style.opacity = '0.2';
  });
  setTimeout(() => sp.remove(), 750);
}
function confetti(n = 70) {
  const colors = ['#fbbf24', '#f472b6', '#4db1ff', '#34d977', '#f87171', '#a78bfa'];
  for (let i = 0; i < n; i++) {
    const c = document.createElement('span');
    c.className = 'confetti';
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = colors[i % colors.length];
    c.style.animationDuration = (1.6 + Math.random() * 1.6) + 's';
    c.style.animationDelay = (Math.random() * 0.5) + 's';
    $('fx').appendChild(c);
    setTimeout(() => c.remove(), 4000);
  }
}
let toastTimer = null;
function toast(msg, ms = 1600) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

/* ---------------- chat ---------------- */
function addMsg(who, text, color, sys) {
  const box = $('chatMsgs');
  const d = document.createElement('div');
  d.className = 'msg' + (sys ? ' sys' : '');
  if (sys) {
    d.textContent = text;
  } else {
    const w = document.createElement('span');
    w.className = 'who';
    w.style.color = color || '#fbbf24';
    w.textContent = who + ': ';
    d.appendChild(w);
    d.appendChild(document.createTextNode(text));
  }
  box.appendChild(d);
  box.scrollTop = box.scrollHeight;
  while (box.children.length > 60) box.removeChild(box.firstChild);
}
function botChat(line) {
  const bots = S.players.filter((p) => !p.you);
  const b = bots[Math.floor(Math.random() * bots.length)];
  addMsg(b.name, line, b.chat);
}

/* ---------------- game flow ---------------- */
let advanceTimer = null;

function newGame() {
  clearTimeout(advanceTimer);
  ROUNDS = pickRounds();
  S.players = makePlayers();
  S.round = 0;
  S.done = 0;
  S.giftClaimed = false;
  $('giftBtn').disabled = false;
  renderCards();
  $('chatMsgs').innerHTML = '';
  addMsg('Isla.Criss', 'Nice one!', '#fb923c');
  addMsg(you().name, 'Good luck everyone!', you().chat);
  addMsg('Surojit', 'Almost there!', '#fbbf24');
  addMsg('Champ', "Let's go!", '#fbbf24');
  hideOverlays();
  startRound(0);
}

function startGame(mode) {
  setMode(mode);
  sfx.good();
  newGame();
}

function startRound(i) {
  clearTimeout(advanceTimer);
  S.round = i;
  S.phase = 'splash';
  S.timeLeft = ROUND_TIME;
  S.found = new Set();
  S.solvedBy = null;
  S.lastGain = 0;
  const r = ROUNDS[i];
  S.tiles = r.scramble.split('').map((ch) => ({ letter: ch, used: false }));
  S.slots = new Array(r.target.length).fill(-1);
  S.botPlans = S.players
    .map((p, idx) => ({ idx, solve: !p.you && Math.random() < 0.8, time: 10 + Math.floor(Math.random() * 22), done: false, gain: 0 }))
    .filter((b) => !S.players[b.idx].you);
  $('splashRound').textContent = 'ROUND ' + (i + 1) + '/' + ROUNDS.length;
  $('splashTheme').textContent = S.mode === 'sketch' ? 'Guess the sketch!' : 'Theme: ' + r.theme;
  $('splashOverlay').classList.remove('hidden');
  updateHUD();
  renderTray();
  if (S.mode === 'sketch') {
    $('sketchAnnounce').classList.remove('show');
    $('sketchAnnounce').textContent = '';
    renderSketch(r.target);
  } else {
    renderParchment();
  }
  setTimeout(() => {
    $('splashOverlay').classList.add('hidden');
    if (S.phase === 'splash') S.phase = 'playing';
    renderTray(true);
    if (S.mode === 'sketch') renderSketch(r.target);
    sfx.round();
    if (Math.random() < 0.7) {
      const bots = S.players.map((p, i) => i).filter((i) => !S.players[i].you);
      showBubble(bots[Math.floor(Math.random() * bots.length)], EMOJIS[Math.floor(Math.random() * EMOJIS.length)]);
    }
  }, 1100);
}

function tick() {
  if (S.phase !== 'playing') return;
  S.timeLeft--;
  const elapsed = ROUND_TIME - S.timeLeft;
  for (const b of S.botPlans) {
    if (!b.done && b.solve && elapsed >= b.time) {
      b.done = true;
      botSolves(b);
    }
  }
  if (S.timeLeft <= 5 && S.timeLeft > 0) sfx.tick();
  if (S.timeLeft <= 0) { timeUp(); return; }
  updateHUD();
}

function botSolves(b) {
  if (S.phase !== 'playing') return;
  const p = S.players[b.idx];
  b.gain = 80 + S.timeLeft;
  p.coins += b.gain;
  sfx.bot();
  addMsg(p.name, S.mode === 'sketch' ? 'I guessed it! 🎉' : 'I found the word! 😄', p.chat);
  showBubble(b.idx, '🎉');
  updateHUD(); updateCrown();
  onSolved(b.idx);
}

function tapTile(i) {
  if (S.phase !== 'playing') return;
  const t = S.tiles[i];
  if (t.used) return;
  const s = S.slots.indexOf(-1);
  if (s < 0) return;
  t.used = true;
  S.slots[s] = i;
  sfx.place(s);
  renderTray();
  const slotEl = document.querySelectorAll('#slots .slot')[s];
  if (slotEl) slotEl.classList.add('pop');
}

function tapSlot(s) {
  if (S.phase !== 'playing') return;
  const ti = S.slots[s];
  if (ti < 0) return;
  S.tiles[ti].used = false;
  S.slots[s] = -1;
  sfx.back();
  renderTray();
}

function shuffleTiles() {
  if (S.phase !== 'playing') return;
  clearSlots();
  for (let i = S.tiles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [S.tiles[i], S.tiles[j]] = [S.tiles[j], S.tiles[i]];
  }
  sfx.shuffle();
  renderTray();
}

function submit() {
  if (S.phase !== 'playing') return;
  const word = S.slots.filter((i) => i >= 0).map((i) => S.tiles[i].letter).join('');
  if (!word) { sfx.error(); return; }
  const r = ROUNDS[S.round];
  if (S.mode === 'sketch') { submitSketch(word, r); return; }
  if (word === r.target) {
    const gain = 100 + S.timeLeft;
    creditYou(gain);
    S.lastGain = gain;
    sfx.solve();
    coinFly($('bottomPanel'));
    confetti(80);
    addMsg(you().name, 'I got it!! 🎉', you().chat);
    showBubble(youIdx(), '🥳');
    updateHUD(); updateCrown();
    onSolved(youIdx());
    return;
  }
  if (r.bonuses.includes(word) && !S.found.has(word)) {
    S.found.add(word);
    creditYou(25);
    sfx.bonus();
    coinFly($('bottomPanel'));
    toast('+25 🪙 bonus word: ' + word);
    clearSlots();
    renderParchment();
    updateHUD(); updateCrown();
    return;
  }
  if (S.found.has(word)) toast('Already found!');
  else toast('Not a word!');
  sfx.error();
  const panel = $('bottomPanel');
  panel.classList.remove('shake');
  void panel.offsetWidth;
  panel.classList.add('shake');
  document.querySelectorAll('#slots .slot.filled').forEach((el) => {
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  });
}

function submitSketch(word, r) {
  if (word === r.target) {
    const gain = 100 + S.timeLeft;
    creditYou(gain);
    S.lastGain = gain;
    sfx.solve();
    coinFly($('bottomPanel'));
    confetti(90);
    addMsg(you().name, 'I guessed it!! 🎉', you().chat);
    showBubble(youIdx(), '🥳');
    updateHUD(); updateCrown();
    onSolved(youIdx());
    return;
  }
  sfx.error();
  toast('Not it — look closer at the sketch!');
  const panel = $('bottomPanel');
  panel.classList.remove('shake');
  void panel.offsetWidth;
  panel.classList.add('shake');
  document.querySelectorAll('#slots .slot.filled').forEach((el) => {
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  });
}

function clearSlots() {
  S.slots.forEach((ti, s) => { if (ti >= 0) { S.tiles[ti].used = false; S.slots[s] = -1; } });
  renderTray();
}

function onSolved(solverIdx) {
  if (S.phase !== 'playing') return;
  S.phase = 'roundEnd';
  S.solvedBy = solverIdx;
  S.done = S.round + 1;
  const word = ROUNDS[S.round].target;
  const isYou = solverIdx === youIdx();
  toast(isYou
    ? '+' + S.lastGain + ' 🪙  ' + word + '!'
    : S.players[solverIdx].name + ' beat you to ' + word + '!', 1900);
  if (S.mode === 'sketch') {
    if (isYou) {
      flyLettersToBoard(word);
    } else {
      setTimeout(() => {
        const cap = $('sketchWord');
        cap.textContent = word;
        cap.classList.add('show');
      }, 700);
    }
    announceSketch(solverIdx);
    setTimeout(() => {
      const board = document.querySelector('.board-frame');
      if (board) board.classList.add('celebrate');
    }, 1000);
  }
  updateHUD(); updateCrown();
  advanceTimer = setTimeout(advanceRound, S.mode === 'sketch' ? 2100 : 1500);
}

function timeUp() {
  if (S.phase !== 'playing') return;
  S.phase = 'roundEnd';
  S.done = S.round + 1;
  const word = ROUNDS[S.round].target;
  sfx.error();
  toast('⏰ Time up \u2014 it was ' + word, 1900);
  addMsg(null, "Time's up \u2014 the word was " + word, null, true);
  if (S.mode === 'sketch') {
    const cap = $('sketchWord');
    cap.textContent = word;
    cap.classList.add('show');
  }
  updateHUD();
  advanceTimer = setTimeout(advanceRound, 2100);
}

function advanceRound() {
  if (S.phase === 'gameOver') return;
  if (S.round + 1 < ROUNDS.length) startRound(S.round + 1);
  else gameOver();
}

function gameOver() {
  S.phase = 'gameOver';
  S.done = ROUNDS.length;
  updateHUD();
  const sorted = [...S.players].sort((a, b) => b.coins - a.coins);
  const winner = sorted[0];
  $('endTitle').textContent = '🏆 FINAL LEADERBOARD';
  $('endSub').textContent = (winner.you ? 'You are the Champ!' : winner.name + ' takes the crown') +
    ' \u00B7 ' + ROUNDS.length + ' rounds';
  const body = $('endBody');
  body.innerHTML = '';
  body.appendChild(buildPodium(sorted));
  const lead = sorted[0].coins || 1;
  const medals = ['🏆', '🥈', '🥉', '4'];
  sorted.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'lb-row' + (i === 0 ? ' top' : '') + (p.you ? ' you' : '');
    row.style.animationDelay = (300 + i * 110) + 'ms';
    row.innerHTML =
      '<span class="lb-medal">' + medals[i] + '</span>' +
      '<span class="lb-ava" style="--ring:' + p.ring + '">' + p.emoji + '</span>' +
      '<span class="lb-name">' + (p.you ? 'You' : p.name.split('.')[0]) + '</span>' +
      '<span class="lb-bar"><i style="width:' + Math.max(4, Math.round(p.coins / lead * 100)) + '%"></i></span>' +
      '<span class="lb-coins">' + p.coins + ' 🪙</span>';
    body.appendChild(row);
  });
  $('endOverlay').classList.remove('hidden');
  if (winner.you) { sfx.win(); confetti(120); } else { sfx.lose(); }
}

function buildPodium(sorted) {
  const wrap = document.createElement('div');
  wrap.className = 'podium';
  const seq = [
    { p: sorted[1], cls: 'p2', n: 2 },
    { p: sorted[0], cls: 'p1', n: 1 },
    { p: sorted[2], cls: 'p3', n: 3 },
  ];
  seq.forEach((s2) => {
    if (!s2.p) return;
    const col = document.createElement('div');
    col.className = 'pod ' + s2.cls;
    col.innerHTML =
      '<div class="pod-ava" style="--ring:' + s2.p.ring + '">' + (s2.n === 1 ? '<span class="pod-crown">👑</span>' : '') + s2.p.emoji + '</div>' +
      '<div class="pod-name">' + (s2.p.you ? 'You' : s2.p.name.split('.')[0]) + '</div>' +
      '<div class="pod-coins">🪙 ' + s2.p.coins + '</div>' +
      '<div class="pod-step">' + s2.n + '</div>';
    wrap.appendChild(col);
  });
  return wrap;
}

function hideOverlays() {
  ['menuOverlay', 'splashOverlay', 'endOverlay'].forEach((id) => $(id).classList.add('hidden'));
}

/* ---------------- emoji picker / reactions ---------------- */
let pickerFor = -1;
function openPicker(targetIdx, anchorEl) {
  const pk = $('emojiPicker');
  pickerFor = targetIdx;
  pk.innerHTML = '';
  EMOJIS.forEach((e) => {
    const b = document.createElement('button');
    b.textContent = e;
    b.addEventListener('click', (ev) => { ev.stopPropagation(); pickEmoji(e); });
    pk.appendChild(b);
  });
  const r = anchorEl.getBoundingClientRect();
  pk.classList.remove('hidden');
  const left = Math.min(window.innerWidth - 300, Math.max(8, r.left - 120));
  pk.style.left = left + 'px';
  pk.style.top = Math.max(8, r.bottom + 8) + 'px';
}
function pickEmoji(e) {
  $('emojiPicker').classList.add('hidden');
  sfx.tap();
  if (pickerFor === youIdx()) {
    showBubble(youIdx(), e);
  } else {
    showBubble(pickerFor, e);
    const t = S.players[pickerFor];
    if (Math.random() < 0.5) setTimeout(() => addMsg(t.name, THANK_LINES[Math.floor(Math.random() * THANK_LINES.length)], t.chat), 900 + Math.random() * 1200);
  }
}

/* ---------------- wiring ---------------- */
$('shuffleBtn').addEventListener('click', shuffleTiles);
$('submitBtn').addEventListener('click', submit);
$('playBtn').addEventListener('click', () => startGame('classic'));
$('sketchBtn').addEventListener('click', () => startGame('sketch'));
$('againBtn').addEventListener('click', () => { sfx.good(); newGame(); });
$('menuBtn').addEventListener('click', () => { hideOverlays(); openMenu(); });
$('homeBtn').addEventListener('click', () => { openMenu(); });
$('resumeBtn').addEventListener('click', () => { hideOverlays(); });

function openMenu() {
  $('resumeBtn').classList.toggle('hidden', S.phase === 'menu' || S.phase === 'gameOver');
  $('menuOverlay').classList.remove('hidden');
}

$('musicBtn').addEventListener('click', () => { setMusic(!musicOn); sfx.tap(); });
$('soundBtn').addEventListener('click', () => {
  S.muted = !S.muted;
  $('soundBtn').textContent = S.muted ? '🔇' : '🔊';
  if (!S.muted) sfx.tap();
});

$('giftBtn').addEventListener('click', () => {
  if (S.giftClaimed || S.phase === 'menu') return;
  S.giftClaimed = true;
  $('giftBtn').disabled = true;
  creditYou(75);
  sfx.gift();
  coinFly($('giftBtn'));
  confetti(40);
  toast('🎁 Gift claimed! +75 🪙');
  showBubble(youIdx(), '🎁');
  updateHUD(); updateCrown();
});

$('chatBtn').addEventListener('click', () => {
  $('chatPanel').classList.toggle('hidden');
  sfx.tap();
});
$('reactBtn').addEventListener('click', (e) => openPicker(youIdx(), e.currentTarget));

function sendChat() {
  const inp = $('chatText');
  const text = inp.value.trim();
  if (!text) return;
  addMsg(you().name, text, you().chat);
  inp.value = '';
  sfx.tap();
  if (Math.random() < 0.6) setTimeout(() => botChat(REPLY_LINES[Math.floor(Math.random() * REPLY_LINES.length)]), 1000 + Math.random() * 2000);
}
$('chatSend').addEventListener('click', sendChat);
$('chatText').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

document.addEventListener('click', (e) => {
  if (!e.target.closest('#emojiPicker') && !e.target.closest('.emote-btn') && !e.target.closest('#reactBtn')) {
    $('emojiPicker').classList.add('hidden');
  }
});

setInterval(tick, 1000);
setInterval(() => {
  if (S.phase === 'playing' && Math.random() < 0.45) botChat(AMBIENT_LINES[Math.floor(Math.random() * AMBIENT_LINES.length)]);
}, 11000);
setInterval(() => {
  if (S.phase === 'playing' && Math.random() < 0.25) {
    const bots = S.players.map((p, i) => i).filter((i) => !S.players[i].you);
    showBubble(bots[Math.floor(Math.random() * bots.length)], EMOJIS[Math.floor(Math.random() * EMOJIS.length)]);
  }
}, 14000);

/* boot */
S.players = makePlayers();
setMode('classic');
renderCards();
updateHUD();
renderParchment();
addMsg('Isla.Criss', 'Nice one!', '#fb923c');
addMsg('Surojit', 'Almost there!', '#fbbf24');
addMsg('Champ', "Let's go!", '#fbbf24');

/* test hook */
window.__champ = {
  S, ROUNDS: () => ROUNDS, WORD_POOL,
  target: () => ROUNDS[S.round].target,
  spell(word) {
    for (const ch of word) {
      const i = S.tiles.findIndex((t) => t.letter === ch && !t.used);
      if (i >= 0) tapTile(i);
    }
  },
  submit, startRound, newGame, startGame, setMode, renderSketch, flyLettersToBoard, announceSketch,
  onSolved, timeUp, advanceRound, gameOver, pickRounds,
};
