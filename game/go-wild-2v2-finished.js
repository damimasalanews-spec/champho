import { WORD_BANK } from './english-word-bank.js?v=turns-1';
import { createWordGrid, normalizeGuess, scoreWord } from './word-grid-rules.js?v=thirty-1';

(() => {
  'use strict';
  const PLAYERS = [
    { id: 'champ', name: 'Champ', color: '#50e8ef' },
    { id: 'poker', name: 'Poker', color: '#54a8ff' },
    { id: 'kalkal', name: 'Kalkal', color: '#bd78ff' },
    { id: 'jess', name: 'Jess', color: '#ff9b59' }
  ];
  /* The three seats that are not the player. They play themselves from the bot
     takeover loop further down; this list is the single place that decides it, so
     turning a bot seat into a real opponent later means removing its id here and
     letting the server own that seat instead. */
  const BOT_IDS = ['poker', 'kalkal', 'jess'];
  const HUMAN_ID = 'champ';

  /* ---- the signed-in player ------------------------------------------------
     The lobby owns the account; the board only needs a name for the bottom seat
     and a purse to settle against. Both arrive by postMessage, because the game
     also runs opened on its own (the arcade demo does), where the name baked into
     the markup is still correct. Nothing here trusts the message for anything but
     display and bookkeeping - the board has no authority over coins. */
  function setHumanName(raw) {
    const name = String(raw == null ? '' : raw).trim().slice(0, 16);
    if (!name) return;
    const seat = PLAYERS.find(player => player.id === HUMAN_ID);
    if (seat) seat.name = name;
    const label = document.querySelector('.gwx-seat[data-player="' + HUMAN_ID + '"] .gwx-player-card strong');
    if (label) label.textContent = name;
  }

  window.addEventListener('message', event => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (typeof data.champName === 'string') setHumanName(data.champName);
    if (data.champProfile && typeof data.champProfile === 'object') setHumanName(data.champProfile.name);
  });

  /* Tell the lobby the board is ready for an identity. Ignored when standalone. */
  try {
    if (window.parent && window.parent !== window) window.parent.postMessage({ champReady: true }, '*');
  } catch (error) { /* cross-origin parent: the board runs on its own defaults */ }

  const $ = id => document.getElementById(id);
  const gridEl = $('letterGrid');
  const tiles = [];
  let round = null;
  let resultReveal = 0;   /* pending reveal of the round-end modal */
  let path = [];
  /* ---- the round ----------------------------------------------------------
     Thirty words, five boards of six on the same 7x6 grid the game always
     had. Every word is laid into its board letter by letter, so tracing or
     typing always spells exactly what is hidden, and a word can only score
     once in the whole round — no double answers. Four of the thirty are
     CHAMP words (the longest word on the first four boards): whoever finds
     one is simply the longest word on its board, and in the robbery half that
     length is what takes the most coins off the table. The
     player holding the most coins always answers first, then the turn
     travels the seat cycle — champ, jess, kalkal, poker, back to champ. The
     grid pays the first correct answer; from then on every correct answer
     takes its coins out of the previous scorer's purse. The round's final
     word can only be won by touching the letters — drag it, don't type it.
     The leaderboard prints when all 30 words are found; top coins win. */
  const BOARDS = 5;             /* five boards of six hidden words = 30 */
  const CHAMP_WORDS = 4;        /* four champ words hidden in the round */
  /* six lengths per board that sum to exactly 42 — the 7x6 cell count — so
     every letter on a board belongs to one of its words, the way the original
     seven-word deal tiled it */
  const BOARD_LENGTHS = [[4, 6, 7, 8, 8, 9], [4, 5, 7, 8, 9, 9], [5, 6, 7, 7, 8, 9], [3, 6, 7, 8, 9, 9], [4, 5, 7, 8, 9, 9]];
  const TURN_MS = 15000;
  /* the seats round the table in play order: champ bottom-left, jess
     bottom-right, kalkal top-right, poker top-left. The player holding the
     most coins always opens the round, then the turn keeps travelling this
     cycle — from each seat to the next one round the table. */
  const SEAT_CYCLE = ['champ', 'jess', 'kalkal', 'poker'];
  let TURN_ORDER = SEAT_CYCLE.slice();
  const BOT_SKILL = 0.85;
  let turnState = null;   /* { index, endsAt, tick, botTimer } */
  let passStreak = 0;
  let turnMs = TURN_MS;   /* the dev hook can speed the clock up */
  /* between a correct answer and the coins landing on the scorer's avatar the
     table is "settling": the clock is parked, nobody's 15 seconds are running */
  let settling = false;
  let handoverTimer = 0;
  let lastScorer = null;

  /* consecutive finds per seat, this round: the run bonus. A miss clears only
     the seat that missed, so a rival's dry turn cannot reset your streak. */
  let comboStreak = {};
  /* who holds the turn. renderScores() re-marks the seats after every find and
     has no seat to hand, so the mark function reads this instead - without it
     the scorer was painted as the seat about to pay for its own word. */
  let activeSeatId = null;


  function buildGrid() {
    gridEl.replaceChildren();
    tiles.length = 0;
    gridEl.style.setProperty('--gwx-cols', String(round.layout.cols));
    gridEl.style.setProperty('--gwx-rows', String(round.layout.rows));
    gridEl.setAttribute('aria-label', `${round.layout.cols} by ${round.layout.rows} letter grid`);
    const colorLabel = $('colorLabel');
    if (colorLabel) colorLabel.innerHTML = '<i></i> ' + round.layout.cols + '×' + round.layout.rows + ' LETTER GRID';
    round.layout.grid.forEach((letter, index) => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'letter-tile';
      tile.setAttribute('role', 'gridcell');
      tile.textContent = letter.toUpperCase();
      tile.setAttribute('aria-label', `Letter ${letter.toUpperCase()}, row ${Math.floor(index / round.layout.cols) + 1}, column ${index % round.layout.cols + 1}`);
      tile.style.animationDelay = `${(index % round.layout.cols) * 12 + Math.floor(index / round.layout.cols) * 8}ms`;
      tile.dataset.index = String(index);
      tile.addEventListener('click', () => selectCell(index));
      gridEl.appendChild(tile);
      tiles.push(tile);
    });
  }

  function renderSlots() {
    const host = $('wordSlots');
    /* the hidden-words rail is retired from the table; the level rail still paints */
    if (!host) { paintLevelRail(); return; }
    const targets = round.layout.words.slice().sort((a, b) => a.word.length - b.word.length);
    paintLevelRail();
    targets.forEach(target => {
      const slot = document.createElement('div');
      const solved = round.found.has(target.word);
      slot.className = 'word-slot' + (solved ? ' done' : '');
      const length = document.createElement('b');
      length.textContent = solved ? target.word.toUpperCase() : `${target.word.length} LETTERS`;
      const label = document.createElement('small');
      label.textContent = solved ? 'FOUND' : 'HIDDEN WORD';
      slot.append(length, label);
      host.appendChild(slot);
    });
  }

  /* Every seat opens the round with coins already on the board, so the
     leaderboard always has something to rank. */
  const START_COINS = 2000;   /* above the standing floor, so nobody starts out */

  function renderScores() {
    for (const player of PLAYERS) {
      const score = round.scores[player.id];
      $(`coins-${player.id}`).textContent = String(score.coins);
      $(`words-${player.id}`).textContent = String(score.words);
    }
    const totalCoins = $('totalCoins');
    if (totalCoins) totalCoins.textContent = String(PLAYERS.reduce((sum, player) => sum + round.scores[player.id].coins, 0));
    renderSeatMarks();
    renderCompetition();
  }

  /* ---------------- competition layer -------------------------------------
     Three things sit on top of the coin chain, and all three are read from
     state the round already keeps: who scored last, what each purse holds, and
     how many words in a row a seat has found. */

  const COMBO_CAP = 5;   /* five consecutive finds reaches the x2 cap */
  const COMBO_STEP = 0.25;
  const COMBO_MAX = 2;

  function comboMultiplier(playerId) {
    const streak = comboStreak[playerId] || 0;
    return Math.min(COMBO_MAX, 1 + Math.max(0, streak - 1) * COMBO_STEP);
  }

  function richestActiveId() {
    return PLAYERS.filter(player => !isOut(player.id))
      .sort((a, b) => purseOf(b.id) - purseOf(a.id) || round.scores[b.id].words - round.scores[a.id].words)[0]?.id || null;
  }

  function closestRivalId() {
    const champCoins = purseOf(HUMAN_ID);
    return PLAYERS.filter(player => player.id !== HUMAN_ID && !isOut(player.id))
      .sort((a, b) => Math.abs(purseOf(a.id) - champCoins) - Math.abs(purseOf(b.id) - champCoins))[0]?.id || null;
  }

  function renderCompetition() {
    if (!round) return;
    let panel = $('competitionHud');
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'competitionHud';
      panel.className = 'gwx-competition-hud';
      panel.setAttribute('aria-label', 'Live competition standings');
      panel.innerHTML = '<div class="gwx-comp-stat"><small>👑 BOUNTY LEADER</small><strong data-comp="leader">—</strong><em data-comp="leader-coins"></em></div>' +
        '<div class="gwx-comp-stat"><small>⚔️ YOUR RIVAL</small><strong data-comp="rival">—</strong><em data-comp="rival-coins"></em></div>' +
        '<div class="gwx-comp-stat"><small>🔥 YOUR STREAK</small><strong data-comp="streak">0 · x1.00</strong><em data-comp="revenge">No revenge queued</em></div>';
      const table = $('table');
      if (table) table.appendChild(panel);
    }

    const leaderId = richestActiveId();
    const rivalId = closestRivalId();
    const leader = PLAYERS.find(player => player.id === leaderId);
    const rival = PLAYERS.find(player => player.id === rivalId);
    const streak = comboStreak[HUMAN_ID] || 0;
    const revengeId = round.revengeTargets && round.revengeTargets[HUMAN_ID];

    const put = (key, value) => {
      const node = panel.querySelector('[data-comp="' + key + '"]');
      if (node) node.textContent = value;
    };
    put('leader', leader ? leader.name : 'No target');
    put('leader-coins', leader ? purseOf(leader.id).toLocaleString('en-US') + ' coins' : '');
    put('rival', rival ? rival.name : 'No rival');
    put('rival-coins', rival ? Math.abs(purseOf(rival.id) - purseOf(HUMAN_ID)).toLocaleString('en-US') + ' coins away' : '');
    put('streak', streak + ' in a row · x' + comboMultiplier(HUMAN_ID).toFixed(2));
    put('revenge', revengeId ? 'REVENGE READY vs ' + nameOf(revengeId) : 'No revenge queued');

    document.querySelectorAll('.gwx-seat').forEach(seat => {
      seat.classList.toggle('is-bounty', Boolean(inRobbery() && leaderId && seat.dataset.player === leaderId));
      seat.classList.toggle('has-revenge', Boolean(round.revengeTargets && round.revengeTargets[seat.dataset.player]));
    });
    panel.classList.toggle('is-robbery', inRobbery());
  }




  /* Both marks are about the next word, not the last one: the seat that will
     pay for the next find (unless shielded), and the seat carrying the bounty. */
  function renderSeatMarks(activeId) {
    if (!round) return;
    if (activeId === undefined) activeId = activeSeatId;
    /* the reticle answers "who am I about to hit": the seat that played before
       you, which is the seat rotation robs */
    const target = activeId && inRobbery() ? seatBefore(activeId) : null;

    document.querySelectorAll('.gwx-seat').forEach(seat => {
      const id = seat.dataset.player;
      seat.classList.toggle('is-mark', Boolean(target && target === id));
      seat.classList.toggle('is-out', isOut(id));
    });
  }



  function renderPath() {
    tiles.forEach((tile, index) => {
      tile.classList.toggle('selected', path.includes(index));
      tile.classList.toggle('found', round.foundPaths.some(foundPath => foundPath.includes(index)));
    });
    const value = path.map(index => round.layout.grid[index]).join('').toUpperCase();
    if (path.length) $('guessInput').value = value.toLowerCase();
  }

  function isNeighbor(a, b) {
    const cols = round.layout.cols;
    const rowA = Math.floor(a / cols), colA = a % cols;
    const rowB = Math.floor(b / cols), colB = b % cols;
    return Math.max(Math.abs(rowA - rowB), Math.abs(colA - colB)) === 1;
  }

  function selectCell(index) {
    if (!round || round.ended) return;
    const current = path.indexOf(index);
    if (current >= 0) path = path.slice(0, current);
    else if (!path.length || isNeighbor(path[path.length - 1], index)) path.push(index);
    else path = [index];
    $('guessMessage').textContent = path.length ? 'Keep tracing, then press GUESS.' : 'Any player can guess, in any order.';
    $('guessMessage').classList.remove('good', 'bad');
    renderPath();
  }

  function flashMessage(text, kind = '') {
    const message = $('guessMessage');
    message.textContent = text;
    message.classList.toggle('good', kind === 'good');
    message.classList.toggle('bad', kind === 'bad');
    $('roundMessage').textContent = text;
  }

  function animateCoins(playerId, coins, word, cells) {
    const panel = document.querySelector(`.gwx-seat[data-player="${playerId}"]`);
    if (panel) {
      /* The class has to be released again afterwards. Leaving it on meant the
         score pop could only ever play once per seat in a whole session. */
      panel.classList.remove('just-scored');
      requestAnimationFrame(() => panel.classList.add('just-scored'));
      window.clearTimeout(panel._justScoredTimer);
      panel._justScoredTimer = window.setTimeout(() => panel.classList.remove('just-scored'), 800);
    }
    const floater = document.createElement('div');
    floater.className = 'coin-floater';
    floater.textContent = `+${coins} ✦`;
    panel?.appendChild(floater);
    window.setTimeout(() => floater.remove(), 1250);
    $('roundMessage').textContent = `${PLAYERS.find(item => item.id === playerId).name} found ${word.toUpperCase()} · +${coins} coins!`;
    /* Presentation only: the word is thrown into the grid, dances, becomes coins
       and those coins arc to the scorer. The robbery half runs the same
       celebration - the letters thrown into the grid, the clatter, the coins
       arcing out - because removing it made the second half of the round feel
       like a different, quieter game. The stream between the two player cards
       is drawn on top of it, so the theft is still attributable. */
    if (window.__champCoins?.celebrate) return window.__champCoins.celebrate(playerId, word, cells, coins);
    window.__champCoins?.play(playerId, coins);
    return 0;
  }

  /* ================= PHASES =================================================
     The round is two halves, and the table is always told which half it is in.

       BUILD     words 1-20    every correct word is paid by the grid, by its
                               length. Nothing can be lost, so the first twenty
                               words are about banking a purse.
       ROBBERY   words 21-30   the grid stops paying. A correct word takes
                               coins from the richest seat instead, and the
                               amount is that word's length - a four takes
                               little, an eight takes a lot.

     A seat that falls under the floor STANDS: out of the round, keeping what
     is left, unable to rob and unable to be robbed. The second half is a fight
     over seats, not over points.
     ======================================================================== */
  const BUILD_WORDS = 20;            /* words found before robbery opens */
  const COIN_PER_LETTER = 80;        /* build: length x this, from the grid */
  const STEAL_PER_LETTER = 250;      /* robbery: length x this, out of a purse */
  const ELIMINATION_FLOOR = 2000;    /* under this a seat is out for the round */
  const STEAL_SHARE = 0.7;           /* one word cannot take more than this */

  let eliminated = new Set();

  const inRobbery = () => Boolean(round && round.foundAll.size >= BUILD_WORDS);
  const isOut = id => eliminated.has(id);
  const purseOf = id => (round && round.scores[id] ? round.scores[id].coins : 0);

  /* Robbery runs turn by turn: you rob the seat that played before you. Every
     seat therefore robs exactly one neighbour and is robbed by the other one, so
     a cycle of four turns takes once from everybody. Selecting "the richest"
     instead meant one player could rob all round and never be hit. */
  function seatBefore(playerId) {
    const order = TURN_ORDER;
    const index = order.indexOf(playerId);
    if (index < 0) return null;
    for (let step = 1; step < order.length; step += 1) {
      const candidate = order[(index - step + order.length) % order.length];
      if (candidate !== playerId && !isOut(candidate)) return candidate;
    }
    return null;
  }

  function standUp(playerId) {
    if (eliminated.has(playerId)) return;
    eliminated.add(playerId);
    /* standing costs the purse: the coins are forfeit for this round, not
       frozen, so being knocked out is a loss and not a safe parking spot */
    if (round && round.scores[playerId]) round.scores[playerId].coins = 0;

    const seat = document.querySelector('.gwx-seat[data-player="' + playerId + '"]');
    if (seat) {
      seat.classList.add('is-out');
      const card = seat.querySelector('.gwx-player-card');
      if (card && !card.querySelector('.seat-lost')) {
        const tag = document.createElement('div');
        tag.className = 'seat-lost';
        tag.textContent = playerId === 'champ'
          ? 'You lost the game \u2014 wait for the next game'
          : 'Lost \u2014 out for this round';
        card.appendChild(tag);
      }
    }
    notify(playerId === 'champ'
      ? 'YOU LOST \u00b7 under ' + ELIMINATION_FLOOR.toLocaleString('en-US') + ' coins \u00b7 wait for the next game'
      : 'OUT \u00b7 ' + nameOf(playerId) + ' is under ' + ELIMINATION_FLOOR.toLocaleString('en-US') + ' and loses the round',
      'steal', 4200);
    seatEvent(playerId, 'robbed', 'LOST');
  }

  function checkFloor(playerId) {
    if (!round || isOut(playerId)) return false;
    if (purseOf(playerId) >= ELIMINATION_FLOOR) return false;
    standUp(playerId);
    return true;
  }

  /** The only place coins move. Returns what the presentation needs. */
  function resolveWord(playerId, word) {
    const length = word.length;
    const multiplier = comboMultiplier(playerId);
    const out = { length, robbery: inRobbery(), gained: 0, taken: 0, fromId: null, stood: null, multiplier, bounty: false, revenge: false };

    if (!out.robbery) {
      out.gained = Math.round(length * COIN_PER_LETTER * multiplier);
      round.scores[playerId].coins += out.gained;
      return out;
    }

    const revengeTarget = round.revengeTargets && round.revengeTargets[playerId];
    const target = revengeTarget && !isOut(revengeTarget) && revengeTarget !== playerId
      ? revengeTarget
      : seatBefore(playerId);
    out.revenge = Boolean(revengeTarget && target === revengeTarget);
    if (out.revenge) delete round.revengeTargets[playerId];

    if (!target) {                     /* nobody left to rob: small fallback payout */
      out.gained = Math.round(length * COIN_PER_LETTER * 0.5 * multiplier);
      round.scores[playerId].coins += out.gained;
      return out;
    }

    const bountyId = richestActiveId();
    out.bounty = target === bountyId && target !== playerId;
    const bountyMultiplier = out.bounty ? 1.25 : 1;
    const revengeMultiplier = out.revenge ? 1.5 : 1;
    const purse = purseOf(target);
    const want = Math.round(length * STEAL_PER_LETTER * multiplier * bountyMultiplier * revengeMultiplier);
    const take = Math.max(0, Math.min(want, Math.round(purse * STEAL_SHARE), purse));
    if (take > 0) {
      round.scores[target].coins -= take;
      round.scores[playerId].coins += take;
      out.taken = take;
      out.fromId = target;
      round.revengeTargets[target] = playerId;
      if (checkFloor(target)) out.stood = target;
    }
    return out;
  }

  /* ---- the banner: one line that says which half of the round this is ----- */
  let phaseBanner = null;

  function renderPhase() {
    if (!round) return;
    if (!phaseBanner) {
      phaseBanner = document.createElement('div');
      phaseBanner.className = 'phase-banner';
      document.body.appendChild(phaseBanner);
    }
    const found = round.foundAll.size;
    const robbery = found >= BUILD_WORDS;
    phaseBanner.classList.toggle('is-robbery', robbery);
    phaseBanner.innerHTML = robbery
      ? '<b>ROBBERY</b><span>word ' + Math.min(30, found + 1) + ' of 30 \u00b7 long words take more</span>'
      : '<b>BUILD</b><span>word ' + Math.min(BUILD_WORDS, found + 1) + ' of ' + BUILD_WORDS + ' \u00b7 every word pays</span>';
  }

  /* Coins travel. A number above a card says a robbery happened; a stream of
     coins crossing the table says WHO robbed WHOM. */
  function avatarPoint(playerId) {
    const avatar = document.querySelector('.gwx-seat[data-player="' + playerId + '"] .gwx-avatar');
    if (!avatar) return null;
    const box = avatar.getBoundingClientRect();
    if (!box.width) return null;
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }

  function launchHeistCoin(from, to) {
    const coin = document.createElement('span');
    coin.className = 'heist-coin';
    coin.style.left = from.x + 'px';
    coin.style.top = from.y + 'px';
    document.body.appendChild(coin);

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.hypot(dx, dy);
    const duration = Math.min(700, Math.max(420, distance * 1.1));
    const lift = Math.min(160, Math.max(60, distance * 0.32));
    /* A coin spun on Y turns edge-on and reads as a stretched blob, which is
       what these were. The spin stays in the screen plane, where a disc still
       looks like a disc, and the only tilt is a slight lean at the top of the
       arc. */
    const spin = 160 + Math.random() * 140;
    const started = performance.now();

    const step = now => {
      const t = Math.min(1, (now - started) / duration);
      const x = from.x + dx * t;
      const y = from.y + dy * t - lift * 4 * t * (1 - t);
      const z = Math.sin(Math.PI * t) * 60;
      coin.style.transform =
        'perspective(600px) translate3d(' + (x - from.x).toFixed(1) + 'px,' +
        (y - from.y).toFixed(1) + 'px,' + z.toFixed(1) + 'px)' +
        ' rotateZ(' + (spin * t).toFixed(0) + 'deg)' +
        ' rotateX(' + (18 * Math.sin(Math.PI * t)).toFixed(0) + 'deg)' +
        ' scale(' + (1 + z / 900).toFixed(2) + ')';
      if (t < 1) requestAnimationFrame(step);
      else coin.remove();
    };
    requestAnimationFrame(step);
  }

  function heistStream(fromId, toId, amount) {
    const from = avatarPoint(fromId);
    const to = avatarPoint(toId);
    if (!from || !to) return;
    const count = amount >= 1200 ? 9 : amount >= 600 ? 7 : 5;
    for (let i = 0; i < count; i += 1) {
      window.setTimeout(() => launchHeistCoin(from, to), i * 55);
    }
  }

  function submitGuess(value, playerId, fromDrag = false) {
    if (!round || round.ended || !turnState || settling) return false;
    if (TURN_ORDER[turnState.index] !== playerId) return false;   /* strict seat turns */
    /* only the round's thirty hidden words score — no dictionary doubles —
       and a word can score once in the whole round, never twice */
    if (!fromDrag && round.words30.length - round.foundAll.size === 1) {
      flashMessage('The last word can only be won by touching the letters — drag it!', 'bad');
      return false;
    }
    const result = scoreWord(round.words30, value, round.foundAll, playerId, null);
    if (!result) {
      const normalized = normalizeGuess(value);
      const known = round.words30.some(item => item.word === normalized);
      flashMessage(!normalized ? 'Choose letters or type a word first.' : known ? 'That word has already been found.' : 'Not one of the 30 hidden words. Trace the letters.', 'bad');
      comboStreak[playerId] = 0;   /* a dry turn breaks your run, nobody else's */
      return false;
    }
    round.foundAll.add(result.word);
    if (result.champ) {
      cardFloater(playerId, 'champ');
      notify('CHAMP WORD \u00b7 ' + result.word.toUpperCase() + ' is the longest on this board', 'combo', 2400);
    }
    if (result.hidden) round.found.add(result.word);
    round.foundPaths.push(result.path);
    /* the coin chain: the FIRST correct answer of the round is paid by the
       grid itself; every later correct answer is paid out of the previous
       scorer's purse — take what they hold, the grid adds nothing. A player
       wearing the coin shield (they found a champ word) can't be robbed:
       the grid pays instead. */
    comboStreak[playerId] = (comboStreak[playerId] || 0) + 1;
    const outcome = resolveWord(playerId, result.word);
    /* taken in the robbery half, gained in the build half: the display reads the
       amount that actually moved, or a fallback payout shows as "+0 coins" */
    const credited = outcome.taken || outcome.gained;
    const fromId = outcome.fromId;
    if (comboStreak[playerId] >= 2) {
      notify(nameOf(playerId) + ' is on a ' + comboStreak[playerId] + '-word streak · x' + outcome.multiplier.toFixed(2), 'combo', 2200);
      seatEvent(playerId, 'combo', 'x' + outcome.multiplier.toFixed(2));
    }
    if (outcome.revenge) notify(nameOf(playerId) + ' got REVENGE on ' + nameOf(fromId) + ' · 1.5x attack!', 'steal', 3000);
    if (outcome.bounty) notify(nameOf(playerId) + ' claimed the BOUNTY from ' + nameOf(fromId) + ' · 25% bonus!', 'bounty', 3000);
    round.scores[playerId].words++;
    lastScorer = playerId;
    path = [];
    $('guessInput').value = '';
    $('guessMessage').classList.remove('bad');
    $('guessMessage').classList.add('good');
    $('guessMessage').textContent = fromId
      ? `${result.word.toUpperCase()} \u2192 +${credited} taken from ${nameOf(fromId)} \u00b7 ${outcome.length} letters.`
      : `${result.word.toUpperCase()} found! +${outcome.gained} \u00b7 ${outcome.length} letters${outcome.robbery ? ' \u00b7 nobody left to rob' : ''}.`;
    renderPhase();
    renderSlots();
    renderScores();
    renderPath();
    /* the celebration shows what actually changed hands; the donor wears the bill
       and the coins visibly travel from one card to the other */
    if (fromId && credited > 0) {
      const donorPanel = document.querySelector('.gwx-seat[data-player="' + fromId + '"]');
      if (donorPanel) {
        const bill = document.createElement('div');
        bill.className = 'coin-floater donor';
        bill.textContent = '\u2212' + credited + ' \u2726';
        donorPanel.appendChild(bill);
        window.setTimeout(() => bill.remove(), 1250);
      }
      heistStream(fromId, playerId, credited);
      seatEvent(fromId, 'robbed', '\u2212' + credited);
      seatEvent(playerId, 'combo', '+' + credited);
    }
    const revealAfter = animateCoins(playerId, credited, result.word, result.path);
    if (round.foundAll.size >= round.words30.length) { finishRound('complete', revealAfter); return true; }
    /* the scorer's moment: park the clock while the word dances into coins
       and they fly onto this avatar. When the coins land, the next player
       gets their own exact 15 seconds - not a millisecond of it spent during
       the celebration. */
    settling = true;
    window.clearInterval(turnState.tick);
    window.clearTimeout(turnState.botTimer);
    const activeSeat = activeSeatEl(TURN_ORDER[turnState.index]);
    if (activeSeat) {
      activeSeat.style.setProperty('--turn-pct', '1');
      /* the turn is decided: the ring retires and the coin arc has the stage */
      seatRings().forEach(ring => ring.remove());
    }
    handoverTimer = window.setTimeout(() => {
      settling = false;
      /* the next board comes up only after the celebration has landed, so the
         found word always plays out over the grid it was found on */
      if (round.found.size === round.layout.words.length) {
        round.level++;
        dealLevel();
        $('roundMessage').textContent = 'BOARD ' + round.level + ' of ' + BOARDS + ' — ' + round.foundAll.size + ' of 30 words found.';
      }
      if (round && !round.ended) passTurn(true);
    }, Math.max(400, revealAfter || 0));
    return true;
  }

  /* clean handover once the coins have landed: the old turn's timers die here,
     and startTurn() reads the clock fresh for the next seat */
  function passTurn(found) {
    if (!turnState || !round || round.ended) return;
    settling = false;
    window.clearInterval(turnState.tick);
    window.clearTimeout(turnState.botTimer);
    const seat = activeSeatEl(TURN_ORDER[turnState.index]);
    if (seat) { seat.classList.remove('active'); seat.style.removeProperty('--turn-pct'); }
    seatRings().forEach(ring => ring.remove());
    passStreak = 0;
    advanceTurnIndex();
    startTurn();
  }

  /* the turn handoff: the seat cycle always travels forward; seats that stood
     up are skipped when their turn comes round. */
  function advanceTurnIndex() {
    turnState.index = (turnState.index + 1) % TURN_ORDER.length;
  }

  function finishRound(reason, wait = 0) {
    if (!round || round.ended) return;
    round.ended = true;
    stopTurns();
    /* no teams: the player holding the most coins wins outright */
    const ranking = PLAYERS.slice().sort((a, b) =>
      round.scores[b.id].coins - round.scores[a.id].coins || round.scores[b.id].words - round.scores[a.id].words
    );
    const topScore = round.scores[ranking[0].id].coins;
    const tied = ranking.filter(player => round.scores[player.id].coins === topScore);
    $('resultTitle').textContent = tied.length > 1 ? 'IT’S A TIE' : ranking[0].name.toUpperCase() + ' WINS';
    /* Hand the round back to the lobby so it can be banked against the account.
       The board never writes the player's purse itself: it reports what the round
       produced, and champAward() in the lobby is the only thing that credits it. */
    try {
      const mine = round.scores[HUMAN_ID];
      if (mine && window.parent && window.parent !== window) {
        window.parent.postMessage({
          champEarn: {
            playerId: HUMAN_ID,
            name: PLAYERS.find(player => player.id === HUMAN_ID).name,
            coins: mine.coins,
            xp: Math.round(mine.words) * 10,
            result: ranking[0].id === HUMAN_ID ? 'win' : 'loss',
            detail: 'Go Wild · ' + round.foundAll.size + '/30 words'
              + (ranking[0].id === HUMAN_ID ? ' · won the round' : '')
          }
        }, '*');
      }
    } catch (error) { /* standalone, or a parent that ignores it */ }

    $('resultText').textContent = `${ranking[0].name} ${topScore.toLocaleString('en-US')} coins · ${ranking[1].name} ${round.scores[ranking[1].id].coins.toLocaleString('en-US')} · ${ranking[2].name} ${round.scores[ranking[2].id].coins.toLocaleString('en-US')} · ${ranking[3].name} ${round.scores[ranking[3].id].coins.toLocaleString('en-US')}. ${reason === 'complete' ? 'All 30 words found!' : reason === 'passed' ? 'Called at board ' + round.level + '.' : `${round.foundAll.size} of 30 words found.`}`;
    /* The round normally ends on the word that was just found, so its celebration
       is still on screen. Hold the modal - and the cascade - back until that
       celebration has landed its coins, or the player never sees the word that
       won them the round: it plays behind the blur. A clock expiry has no
       celebration, so wait is 0 and the modal opens at once. */
    /* the round ends straight into the leaderboard: the four players ranked by
       the coins they finished the round with, words as the tiebreak */
    const renderResultBoard = () => {
      const host = $('resultBoard');
      if (!host) return;
      const ranking = PLAYERS.slice().sort((a, b) =>
        round.scores[b.id].coins - round.scores[a.id].coins || round.scores[b.id].words - round.scores[a.id].words
      );
      host.replaceChildren();
      ranking.forEach((player, index) => {
        const row = document.createElement('li');
        row.className = 'gwx-leader-row' + (index === 0 && round.scores[player.id].coins > 0 ? ' leading' : '');
        const rank = document.createElement('span');
        rank.className = 'gwx-leader-rank';
        rank.textContent = String(index + 1).padStart(2, '0');
        const identity = document.createElement('span');
        identity.className = 'gwx-leader-identity';
        const name = document.createElement('strong');
        name.textContent = player.name;
        const role = document.createElement('small');
        role.textContent = index === 0 ? 'WINNER' : 'RIVAL';
        identity.append(name, role);
        const coins = document.createElement('b');
        coins.className = 'gwx-leader-coins';
        coins.textContent = String(round.scores[player.id].coins);
        row.append(rank, identity, coins);
        host.appendChild(row);
      });
    };
    const showResult = () => {
      resultReveal = 0;
      if (!round) return;
      renderResultBoard();
      $('resultModal').classList.add('open');
      $('resultModal').setAttribute('aria-hidden', 'false');
      /* presentation only: the round-win cascade, once per round, obeying the mute toggle */
      window.__champCoins?.winStinger?.();
    };

    /* No post-match section any more: the wall-push duel and the clipart
       contest are gone from the game entirely. When the round ends the
       leaderboard modal opens — the `wait` that held it back past the word
       celebration still applies. */
    resultReveal = wait > 0 ? window.setTimeout(showResult, wait) : 0;
    if (wait <= 0) showResult();
  }

  /* ---- the turn engine ------------------------------------------------------
     One active seat at a time. The avatar wears a glowing countdown ring and the
     seat card lights up, so everybody can see whose 15 seconds are running. */
  function activeSeatEl(id) {
    return document.querySelector(`.gwx-seat[data-player="${id}"]`);
  }

  function stopTurns() {
    if (!turnState) return;
    window.clearInterval(turnState.tick);
    window.clearTimeout(turnState.botTimer);
    const seat = activeSeatEl(TURN_ORDER[turnState.index]);
    if (seat) { seat.classList.remove('active'); seat.style.removeProperty('--turn-pct'); }
    seatRings().forEach(ring => ring.remove());
    turnState = null;
    $('guessInput').disabled = true;
    const submit = document.querySelector('#guessForm button');
    if (submit) submit.disabled = true;
  }

  function seatRings() {
    return document.querySelectorAll('.gwx-avatar .turn-ring');
  }

  function startTurn() {
    if (!round || round.ended) return;
    /* a seat that stood up no longer takes turns */
    let guard = 0;
    while (isOut(TURN_ORDER[turnState.index]) && guard < TURN_ORDER.length) {
      turnState.index = (turnState.index + 1) % TURN_ORDER.length;
      guard += 1;
    }
    const id = TURN_ORDER[turnState.index];
    /* a fresh turn starts with a clean slate: any half-traced word belonged
       to the previous turn, and keeping it made the first tile click toggle
       the stale selection OFF instead of starting the new word */
    path = [];
    $('guessInput').value = '';
    renderPath();
    const seat = activeSeatEl(id);
    if (seat) {
      seat.classList.add('active');
      const avatar = seat.querySelector('.gwx-avatar');
      if (avatar && !avatar.querySelector('.turn-ring')) {
        const ring = document.createElement('i');
        ring.className = 'turn-ring';
        /* four red arrows chase each other around the portrait in 3D */
        for (let i = 0; i < 4; i++) {
          const arrow = document.createElement('b');
          arrow.style.setProperty('--a', (i * 90) + 'deg');
          ring.appendChild(arrow);
        }
        avatar.appendChild(ring);
      }
      /* the orbit is the clock: exactly one lap per turn, restarted at 0 so the
         arrows always finish the circuit as the 15 seconds run out */
      const ringEl = seat.querySelector('.turn-ring');
      if (ringEl) {
        ringEl.style.animation = 'none';
        void ringEl.offsetWidth;
        ringEl.style.animation = '';
        ringEl.style.setProperty('--orbit-ms', String(turnMs));
      }
    }
    renderTurnArrows();
    turnState.endsAt = performance.now() + turnMs;
    turnState.tick = window.setInterval(tickTurn, 100);
    const player = PLAYERS.find(item => item.id === id);
    const human = id === 'champ';
    document.querySelectorAll('.gwx-seat').forEach(seat => {
      const status = seat.querySelector('.gwx-player-status');
      if (!status) return;
      status.textContent = seat.dataset.player === id
        ? (human ? 'YOUR TURN' : 'TAKING TURN')
        : 'READY TO HUNT';
    });
    activeSeatId = id;
    renderSeatMarks(id);
    $('turnLabel').textContent = human ? 'YOUR TURN — FIND A WORD' : player.name.toUpperCase() + "'S TURN";
    /* the round's final word can only be won by dragging it, so the text box
       closes and the letters do the talking */
    const lastWord = round.words30.length - round.foundAll.size === 1;
    $('guessInput').disabled = !human || lastWord;
    const submit = document.querySelector('#guessForm button');
    if (submit) submit.disabled = !human;
    $('guessInput').placeholder = human ? (lastWord ? 'Drag the final word!' : 'Type your word') : 'Waiting for ' + player.name + '…';
    if (human) {
      $('guessMessage').textContent = 'Tap neighboring letters or type a word — 15 seconds.';
      $('guessInput').focus({ preventScroll: true });
    } else {
      $('guessMessage').textContent = player.name + ' is thinking…';
      /* Bots take any word, including the last one. Holding them off the final
         word was meant to hand the human the closing moment, but a human who
         cannot see that word leaves the table with one word and no way to
         finish: the drag requirement is theirs, the closing is not. The human
         still gets first refusal - the input stays enabled and it is only the
         bot's own turn that can take it - but the round can always end. */
      if (Math.random() < BOT_SKILL) {
        const hidden = round.layout.words.filter(item => !round.foundAll.has(item.word));
        const word = hidden.length ? hidden[Math.floor(Math.random() * hidden.length)].word : null;
        if (word) {
          turnState.botTimer = window.setTimeout(() => {
            if (round && !round.ended && turnState && TURN_ORDER[turnState.index] === id) submitGuess(word, id);
          }, turnMs * (0.15 + Math.random() * 0.5));
        }
      }
    }
    tickTurn();
  }

  function tickTurn() {
    if (!turnState || settling) return;
    const left = Math.max(0, turnState.endsAt - performance.now());
    updateTimer(left);
    const seat = activeSeatEl(TURN_ORDER[turnState.index]);
    if (seat) seat.style.setProperty('--turn-pct', String(left / turnMs));
    if (!round || round.ended) return;
    if (left <= 0) endTurn(false);
  }

  function endTurn(found) {
    if (!turnState || !round || round.ended) return;
    window.clearInterval(turnState.tick);
    window.clearTimeout(turnState.botTimer);
    const seat = activeSeatEl(TURN_ORDER[turnState.index]);
    if (seat) { seat.classList.remove('active'); seat.style.removeProperty('--turn-pct'); }
    seatRings().forEach(ring => ring.remove());
    passStreak = found ? 0 : passStreak + 1;
    /* while the round's final word pends, the table can't walk away from it:
       the last word is only ever finished by touching the letters */
    /* Deadlock guard: one word left, a full lap with nobody taking it. That is
       reachable whenever the only seat able to drag it has stood up. The seat
       on turn takes it so the round can close. */
    const wordsLeft = round.words30.length - round.foundAll.size;
    if (wordsLeft === 1 && passStreak >= TURN_ORDER.length) {
      const hidden = round.layout.words.filter(item => !round.foundAll.has(item.word));
      if (hidden.length && submitGuess(hidden[0].word, TURN_ORDER[turnState.index], true)) return;
      /* the board is finished but the round is not: nothing to drag here, so
         deal the next board instead of passing forever on an empty grid */
      if (!hidden.length && wordsLeft > 0 && round.level < BOARDS) {
        round.level += 1;
        dealLevel();
        passStreak = 0;
        startTurn();
        return;
      }
    }
    if (passStreak >= TURN_ORDER.length && wordsLeft > 1) {
      const stillOnBoard = round.layout.words.filter(item => !round.foundAll.has(item.word));
      if (stillOnBoard.length > 0) {
        /* Advancing here is what broke the endgame. dealLevel replaces the whole
           board, so a word still sitting on it disappears from the round for
           good and the count can never reach thirty. Stay and keep looking. */
        passStreak = 0;
        advanceTurnIndex();
        startTurn();
        return;
      }
      /* a full cycle with no find moves the game on: deal the next level, or
         close the match when the last board is on the table */
      if (round.level >= BOARDS) { stopTurns(); finishRound('passed'); return; }
      round.level++;
      dealLevel();
      passStreak = 0;
    }
    advanceTurnIndex();
    startTurn();
  }

  /* ---- stall watchdog ------------------------------------------------------
     One wedged celebration is enough to freeze the table: tickTurn returns
     while settling is true, so if the handover timer that clears it never runs,
     the clock never expires, no turn is ever passed, and the game sits at
     whatever word it reached while the bots carry on emoting. The watchdog is
     deliberately independent of the turn clock - it is the thing that notices
     the clock stopped - and it can only fire when the seat AND the found count
     have both been unchanged, so it cannot interrupt a live turn. */
  let lastSeat = null;
  let lastFound = -1;
  let lastMoveAt = 0;
  let lastProgressAt = 0;
  const stallStats = { fires: 0, lastGap: 0, lastOwed: 0 };
  /* How long a table may go without a find before the round is closed. This has
     to be measured in laps, not seconds: a turn is fifteen seconds and a bot may
     well pass on it, so a fixed 25 seconds ended rounds at word twenty with the
     board half full. Two full laps of nobody finding anything is a stall; one
     slow turn is not. */
  const stallLimitMs = () => Math.max(60000, turnMs * TURN_ORDER.length * 2);

  function stallWatchdog() {
    if (!round || round.ended) {
      lastFound = -1;
      lastProgressAt = 0;
      return;
    }
    const now = performance.now();

    /* Progress first, before anything can return: the round's own counter is
       the only signal that matters, and turnState being null is itself a
       symptom of the stalls this is meant to catch. */
    if (round.foundAll.size !== lastFound) {
      lastFound = round.foundAll.size;
      lastProgressAt = now;
    }
    if (!lastProgressAt) lastProgressAt = now;

    const wordsOwed = round.words30.length - round.foundAll.size;

    /* Absolute net: two full laps with no word found and the round is over,
       whatever the reason. A game that cannot end is worse than one that ends
       early - but it must not fire on a merely slow turn. */
    if (wordsOwed > 0 && now - lastProgressAt > stallLimitMs()) {
      stallStats.fires += 1;
      stallStats.lastGap = Math.round(now - lastProgressAt);
      stallStats.lastOwed = wordsOwed;
      finishRound('complete', 400);
      lastProgressAt = now;
      return;
    }
    if (wordsOwed <= 0 || !turnState) return;

    if (activeSeatId !== lastSeat) {
      lastSeat = activeSeatId;
      lastMoveAt = now;
    }
    const overdueCelebration = settling && now - (turnState.endsAt || now) > 2500;
    const overdueTurn = !settling && turnState.endsAt && now - turnState.endsAt > 2000;
    if (!overdueCelebration && !overdueTurn) return;

    settling = false;
    seatRings().forEach(ring => ring.remove());
    const hidden = round.layout.words.filter(item => !round.foundAll.has(item.word));

    if (hidden.length === 0 && round.level < BOARDS) {
      round.level += 1;
      dealLevel();
      if (!round.ended) startTurn();
      lastMoveAt = now;
      return;
    }
    if (hidden.length === 1) {
      if (submitGuess(hidden[0].word, TURN_ORDER[turnState.index], true)) {
        lastMoveAt = now;
        return;
      }
    }
    if (!round.ended) { advanceTurnIndex(); startTurn(); }
    lastMoveAt = now;
  }




  function updateTimer(msLeft) {
    const total = Math.max(0, Math.ceil(msLeft / 1000));
    $('timer').textContent = '0:' + String(total).padStart(2, '0');
  }

  /* ---- action words: skip & reverse ----------------------------------------
     Eight cards — four SKIP, four REVERSE — are shuffled and dealt two to each
     player at the round's start. A SKIP burns the next player's turn (the turn
     jumps two seats); a REVERSE flips the direction of travel, and the table
     keeps running that way until another REVERSE is played. You can only play
     yours during your own turn. */
  /* the word slam: a stamped CHAMP WORD! pops over the avatar of whoever
     scored it — the message line is hidden in this skin */
  function cardFloater(playerId, kind) {
    const seat = document.querySelector('.gwx-seat[data-player="' + playerId + '"]');
    if (!seat) return;
    const slam = document.createElement('b');
    slam.className = 'card-floater ' + kind;
    slam.textContent = kind === 'champ' ? 'CHAMP WORD!' : kind.toUpperCase() + '!';
    seat.appendChild(slam);
    window.setTimeout(() => slam.remove(), 1550);
  }

  function renderTurnArrows() {
    document.querySelector('.gw-arrows')?.remove();
  }
  function positionTurnArrow(arrow) {
    if (!arrow) return;
    const shell = document.querySelector('.gwx-letter-grid-shell');
    if (!shell) return;
    const box = shell.getBoundingClientRect();
    const id = arrow.dataset.player;
    /* each beacon blasts out from its measured seat bearing: the seats sit
       on a wide diamond (champ lower-left across from jess lower-right,
       poker upper-left across from kalkal upper-right per the live table)
       with a different edge margin per side */
    const bearing = {
      champ: { fx: 'left', edge: -30 },
      jess: { fx: 'right', edge: -30 },
      kalkal: { fx: 'right', edge: -34 },
      poker: { fx: 'left', edge: -34 }
    }[id];
    const rise = { champ: 26, jess: 26, kalkal: -30, poker: -30 }[id];
    arrow.style.left = bearing.fx === 'left'
      ? Math.round(box.left + bearing.edge) + 'px'
      : Math.round(box.right - bearing.edge - arrow.offsetWidth) + 'px';
    arrow.style.top = rise > 0
      ? Math.round(box.bottom - rise - arrow.offsetHeight) + 'px'
      : Math.round(box.top - rise) + 'px';
  }

  /* the sample avatar frames and filters from the account dashboard: every bot
     rolls a fresh frame + filter combo at the start of each round */
  const FX_FRAMES = ['fx-frame-cyber', 'fx-frame-sheriff', 'fx-frame-neon', 'fx-frame-vine'];
  const FX_FILTERS = ['fx-filter-warm', 'fx-filter-cool', 'fx-filter-mono', 'fx-filter-pop'];
  function applyBotFx() {
    for (const id of BOT_IDS) {
      const avatar = document.querySelector(`.gwx-seat[data-player="${id}"] .gwx-avatar`);
      if (!avatar) continue;
      avatar.classList.remove(...FX_FRAMES, ...FX_FILTERS);
      avatar.classList.add(FX_FRAMES[Math.floor(Math.random() * FX_FRAMES.length)]);
      avatar.classList.add(FX_FILTERS[Math.floor(Math.random() * FX_FILTERS.length)]);
    }
  }

  /* ---------------------------------------------------------------- gifting ---
     The social system is the classic mode's own: tap a rival's avatar to open
     the gift tray (six classic gifts at this table's prices), tap your own
     avatar or a seat's emote button for the emoji + rabbit-emote board. Gifts
     fly a real arc, shake the receiver, spark, bubble, get thanked in chat,
     and rivals often lob one straight back. */
  const GIFTS = [
    { id: 'cupcake', art: '\uD83E\uDD67', name: 'Cupcake',    cost: 100 },
    { id: 'egg',     art: '\uD83E\uDD5A', name: 'Golden egg', cost: 100, gold: true },
    { id: 'tomato',  art: '\uD83C\uDF45', name: 'Tomato',     cost: 200 },
    { id: 'rose',    art: '\uD83C\uDF39', name: 'Rose',       cost: 300 },
    { id: 'bear',    art: '\uD83E\uDDF8', name: 'Teddy bear', cost: 400 },
    { id: 'cake',    art: '\uD83C\uDF70', name: 'Cake slice', cost: 800 }
  ];

  /* ---- gift art -----------------------------------------------------------
     Drawn, not typed. An emoji is rendered by whatever font the device happens
     to have, so the same gift arrived as a different picture on every phone and
     could not be lit or shadowed as a single object. Each mark below is drawn
     in a 48x48 box: one silhouette, one highlight, one shadow edge, in the
     colours the tray uses. Gradient ids are per-gift so a tray of six and a
     gift in flight cannot collide. */
  const GIFT_ART = {
    cupcake:
      '<defs><linearGradient id="cwGcFrost" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff4f8"/><stop offset="1" stop-color="#ff9dc0"/></linearGradient>' +
      '<linearGradient id="cwGcCup" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4db4f0"/><stop offset="1" stop-color="#1f6fb8"/></linearGradient></defs>' +
      '<path d="M13.5 25h21l-3.2 15.2A3 3 0 0 1 28.3 43h-8.6a3 3 0 0 1-3-2.8z" fill="url(#cwGcCup)"/>' +
      '<path d="M16 29.5h16M15 34h18M16.5 38.5h15" stroke="#0d4d84" stroke-opacity=".45" stroke-width="1.6" stroke-linecap="round"/>' +
      '<path d="M11.5 25.5c0-6.8 5.6-11.8 12.5-11.8s12.5 5 12.5 11.8c0 1.6-1.2 2.5-2.9 2.5H14.4c-1.7 0-2.9-.9-2.9-2.5z" fill="url(#cwGcFrost)"/>' +
      '<ellipse cx="24" cy="14.8" rx="6.2" ry="4" fill="#fff8fb"/>' +
      '<circle cx="24" cy="7.8" r="3.2" fill="#e8443a"/><circle cx="22.9" cy="6.8" r="1" fill="#ff9d94"/>',
    egg:
      '<defs><radialGradient id="cwGcEgg" cx="34%" cy="26%" r="78%"><stop offset="0" stop-color="#fffbe0"/><stop offset=".5" stop-color="#f8cf4a"/><stop offset="1" stop-color="#a9741a"/></radialGradient></defs>' +
      '<ellipse cx="24" cy="26" rx="13.6" ry="17.6" fill="url(#cwGcEgg)"/>' +
      '<path d="M24 8.6c7.3 0 13.2 7.4 13.4 17" stroke="#fff" stroke-opacity=".38" stroke-width="2.2" fill="none" stroke-linecap="round"/>' +
      '<ellipse cx="18.4" cy="17.8" rx="3.3" ry="5.1" fill="#fff" opacity=".62" transform="rotate(-18 18.4 17.8)"/>',
    tomato:
      '<defs><radialGradient id="cwGcTom" cx="32%" cy="26%" r="80%"><stop offset="0" stop-color="#ff8d7f"/><stop offset=".55" stop-color="#e2402f"/><stop offset="1" stop-color="#9c1f16"/></radialGradient></defs>' +
      '<circle cx="24" cy="27.5" r="15" fill="url(#cwGcTom)"/>' +
      '<ellipse cx="18" cy="21" rx="3.9" ry="2.9" fill="#fff" opacity=".48" transform="rotate(-26 18 21)"/>' +
      '<path d="M24 10.6l2.2 4.6 5-1.6-2.6 4.4 4.4 2.8-5 .8.6 5-3.4-3.7-3.4 3.7.6-5-5-.8 4.4-2.8-2.6-4.4 5 1.6z" fill="#38b552"/>' +
      '<circle cx="24" cy="16.2" r="1.6" fill="#1f7a33"/>',
    rose:
      '<path d="M24 33.4V43" stroke="#2b8c3d" stroke-width="3.4" stroke-linecap="round"/>' +
      '<ellipse cx="31.4" cy="39.4" rx="6.2" ry="3.3" fill="#38b552" transform="rotate(-22 31.4 39.4)"/>' +
      '<ellipse cx="16.6" cy="41.4" rx="5.2" ry="2.9" fill="#2b8c3d" transform="rotate(18 16.6 41.4)"/>' +
      '<circle cx="24" cy="21" r="12.6" fill="#b8282a"/>' +
      '<circle cx="24" cy="21" r="9.6" fill="#e2402f"/>' +
      '<path d="M24 12.4c4.8 0 8.6 3.8 8.6 8.6s-3.8 8.6-8.6 8.6" fill="none" stroke="#8e1c1e" stroke-width="2.2" stroke-linecap="round"/>' +
      '<path d="M24 16.6c2.5 0 4.4 2 4.4 4.4s-2 4.4-4.4 4.4-4.4-2-4.4-4.4 2-4.4 4.4-4.4z" fill="#c72f2c"/>' +
      '<ellipse cx="19.4" cy="15.4" rx="2.5" ry="1.7" fill="#ff9d94" opacity=".72" transform="rotate(-28 19.4 15.4)"/>',
    bear:
      '<circle cx="12.6" cy="14" r="6.4" fill="#9c6b42"/><circle cx="35.4" cy="14" r="6.4" fill="#9c6b42"/>' +
      '<circle cx="12.6" cy="14" r="3.1" fill="#d5a878"/><circle cx="35.4" cy="14" r="3.1" fill="#d5a878"/>' +
      '<circle cx="24" cy="27" r="14.6" fill="#b07c4c"/>' +
      '<ellipse cx="24" cy="32.6" rx="8.4" ry="6.6" fill="#e7c49b"/>' +
      '<circle cx="18.5" cy="23.4" r="2.2" fill="#3a2418"/><circle cx="29.5" cy="23.4" r="2.2" fill="#3a2418"/>' +
      '<circle cx="19.2" cy="22.7" r=".8" fill="#fff" opacity=".85"/><circle cx="30.2" cy="22.7" r=".8" fill="#fff" opacity=".85"/>' +
      '<ellipse cx="24" cy="30.4" rx="2.9" ry="2.2" fill="#3a2418"/>' +
      '<path d="M24 32.8v2.3M24 35.1c-.9 1.2-2.2 1.6-3.4 1.2M24 35.1c.9 1.2 2.2 1.6 3.4 1.2" stroke="#3a2418" stroke-width="1.4" stroke-linecap="round" fill="none"/>',
    cake:
      /* a triangle reads as a tent at 40px however it is shaded, so this is the
         side of a slice instead: frosting, sponge, cream, sponge, in bands. The
         bands are what name it; the cherry only confirms it. */
      '<rect x="7" y="14.5" width="34" height="7.5" rx="3.6" fill="#ffc4d6"/>' +
      '<rect x="7" y="20" width="34" height="9.5" fill="#fbe0b4"/>' +
      '<rect x="7" y="29" width="34" height="4.8" fill="#ffffff"/>' +
      '<rect x="7" y="33.2" width="34" height="7.6" rx="3.6" fill="#c98b4b"/>' +
      '<path d="M7 24.6h34M7 31.4h34" stroke="#00000014" stroke-width="1"/>' +
      '<path d="M36.5 22.5v6.2M36.5 34.2v4.6" stroke="#ffffff5c" stroke-width="2.4" stroke-linecap="round"/>' +
      '<circle cx="24" cy="10.4" r="4" fill="#e8443a"/><circle cx="22.9" cy="9.9" r="1.1" fill="#ff9d94"/>' +
      '<path d="M24 7.4c1.7 0 2.9 1.2 2.9 2.7" stroke="#2b8c3d" stroke-width="1.7" fill="none" stroke-linecap="round"/>' +
      '<path d="M4.5 42h39" stroke="#dccbaa" stroke-width="2.2" stroke-linecap="round"/>'
  };

  const giftArt = g =>
    '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">' +
    (GIFT_ART[g.id] || GIFT_ART.cupcake) +
    '</svg>';

  const THANK_LINES = ['thanks!', 'haha!', 'right back at you!'];
  let giftTimer = 0, ambienceTimer = 0;

  /* ---- the emoji set: uploaded clips, greenscreens keyed out --------------
     Each emoji is a looping alpha webm cut to exactly 2s from the uploaded
     greenscreen mp4, with its own recorded laugh (uploaded m4a, silence
     trimmed) registered in audio-cues. Every emoji surface on the table shows
     these two, in this order. The stage stays on screen for exactly the sound
     length: the clip plays at natural laugh speed so the full animation lands
     when the laugh ends. */
  const EMOJIS = [
    { name: 'Haha', src: './game/emoji/haha-2s.webm', cue: 'haha', LOOP_MS: 2000, SOUND_MS: 770 },
    { name: 'Ahha', src: './game/emoji/ahha-2s.webm', cue: 'ahha', LOOP_MS: 2000, SOUND_MS: 1680 }
  ];

  function playVideoEmoji(seat, emoji) {
    if (!seat || !emoji) return;
    document.querySelectorAll('.vid-emoji-stage').forEach(el => el.remove());
    const stage = document.createElement('div');
    stage.className = 'vid-emoji-stage';
    seat.appendChild(stage);
    /* an aliased holder paints the chat bubble: tinted card, dashed rim, tail */
    const holder = document.createElement('div');
    holder.className = 'vid-emoji-holder';
    stage.appendChild(holder);
    const video = document.createElement('video');
    video.className = 'vid-emoji-video';
    video.src = emoji.src;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('aria-hidden', 'true');
    holder.appendChild(video);
    /* the 2s asset is the laugh slowed down; at this rate the full laugh lands
       exactly when the recorded sound ends, so both stop together */
    video.playbackRate = +(2 / (emoji.SOUND_MS / 1000)).toFixed(3);
    const play = video.play();
    if (play && play.catch) play.catch(() => {});
    /* backstop at a loop boundary so cancelled timers can never strand the stage */
    window.setTimeout(() => stage.remove(), emoji.LOOP_MS + 220);
    return stage;
  }

  /* one emoji performance: the laugh starts with the clip, the bubble pops at
     the sound's end so animation and sound always stop together. */
  function showBubble(id, emojiIndex) {
    const seat = document.querySelector(`.gwx-seat[data-player="${id}"]`);
    if (!seat) return;
    const emoji = EMOJIS[Math.max(0, Math.min(EMOJIS.length - 1, emojiIndex || 0))];
    playVideoEmoji(seat, emoji);
    try { window.ChampCues && window.ChampCues.play(emoji.cue); } catch (e) {}
    /* the show lasts exactly the laugh: sound and animation end together */
    window.clearTimeout(seat._vidEmojiTimer);
    seat._vidEmojiTimer = window.setTimeout(() => {
      const stage = seat.querySelector('.vid-emoji-stage');
      if (stage) stage.remove();
    }, emoji.SOUND_MS);
  }

  function nameOf(id) { return (PLAYERS.find(p => p.id === id) || { name: id }).name; }

  function seatPoint(id) {
    const avatar = document.querySelector(`.gwx-seat[data-player="${id}"] .gwx-avatar`);
    if (!avatar) return null;
    const r = avatar.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, el: avatar };
  }

  /* Everything the table does that a player cannot see for themselves lands
     here: a gift, a combo run, a new bounty, a shield eating a steal. The old
     version kept one slot and deleted it before showing the next, so a combo
     landing on the same frame as a gift silently lost one of them. */
  const NOTICE_MAX = 3;

  function notify(msg, kind = 'info', ms = 2800) {
    let stack = document.querySelector('.gift-toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'gift-toast-stack';
      stack.setAttribute('role', 'status');
      stack.setAttribute('aria-live', 'polite');
      document.body.appendChild(stack);
    }
    /* The same line arriving again - "not enough coins" from three impatient
       taps - must refresh its own slot. Stacking copies buries everything else
       and makes the feed unreadable exactly when it is busiest. */
    const live = Array.from(stack.children).find((child) => child.textContent === msg);
    const toast = live || document.createElement('div');
    if (live) {
      window.clearTimeout(live.noticeTimer);
      live.classList.remove('is-out');
      stack.prepend(live);
    } else {
      toast.className = 'gift-toast is-' + kind;
      toast.textContent = msg;
      stack.prepend(toast);
    }
    while (stack.children.length > NOTICE_MAX) stack.lastElementChild.remove();
    toast.noticeTimer = window.setTimeout(() => {
      toast.classList.add('is-out');
      window.setTimeout(() => toast.remove(), 240);
    }, ms);
  }

  function socialToast(msg, ms = 1900) {
    notify(msg, 'info', ms);
  }

  /* A seat reacts where the eye already is. A line at the top of the screen is
     still something to go looking for; when the thing happens to a seat, the
     avatar block and the purse share one 3D pop and a tag names the cause right
     there. Three seconds, then it settles. */
  const SEAT_EVENT_MS = 3000;
  const seatEventTimers = new WeakMap();

  function seatEvent(seatId, kind, label) {
    const seat = document.querySelector('.gwx-seat[data-player="' + seatId + '"]');
    if (!seat) return;
    const card = seat.querySelector('.gwx-player-card') || seat;

    seat.classList.remove('seat-event', 'is-gift', 'is-combo', 'is-bounty', 'is-shield');
    void seat.offsetWidth;                       /* restart rather than ignore */
    seat.classList.add('seat-event', 'is-' + kind);

    let tag = card.querySelector('.seat-event-tag');
    if (!tag) {
      tag = document.createElement('i');
      tag.className = 'seat-event-tag';
      card.appendChild(tag);
    }
    tag.textContent = label;
    tag.style.animation = 'none';
    void tag.offsetWidth;
    tag.style.animation = '';

    const previous = seatEventTimers.get(seat);
    if (previous) window.clearTimeout(previous);
    seatEventTimers.set(seat, window.setTimeout(() => {
      seat.classList.remove('seat-event', 'is-gift', 'is-combo', 'is-bounty', 'is-shield');
      const stale = card.querySelector('.seat-event-tag');
      if (stale) stale.remove();
    }, SEAT_EVENT_MS));
  }

  function chatSay(who, text) {
    try { appendChatMessage(who + ' ' + text, who === nameOf('champ') ? 'champ' : 'bot'); } catch (e) {}
  }




  /* ---------------- pickers: classic gift tray + emoji/rabbit board ------- */
  function closePickers() {
    document.querySelectorAll('.gw-picker').forEach(p => p.remove());
  }

  function openPicker(playerId, anchorEl, mode) {
    closePickers();
    const pk = document.createElement('div');
    pk.className = 'gw-picker';
    if (mode === 'gift') {
      const purse = round ? round.scores.champ.coins : 0;
      const head = document.createElement('div');
      head.className = 'gp-head';
      head.innerHTML = '<span class="gp-who">Gift <b>' + nameOf(playerId).split('.')[0] + '</b></span>' +
        '<span class="gp-purse">¢ ' + purse + '</span>';
      pk.appendChild(head);
      const grid = document.createElement('div');
      grid.className = 'gp-grid';
      GIFTS.forEach(g => {
        const b = document.createElement('button');
        b.className = 'gift-tile' + (g.cost > purse ? ' poor' : '');
        b.setAttribute('aria-label', g.name + ' gift, ' + g.cost + ' coins');
        b.innerHTML = '<span class="gift-art">' + giftArt(g) + '</span>' +
          '<span class="gt-name">' + g.name + '</span>' +
          '<span class="gt-cost">¢ ' + g.cost + '</span>';
        b.title = g.name + ' \u2014 ' + g.cost + ' coins';
        b.addEventListener('click', ev => { ev.stopPropagation(); const ok = sendGift('champ', playerId, g); if (ok) closePickers(); });
        grid.appendChild(b);
      });
      pk.appendChild(grid);
    } else {
      /* the emoji board: one small looping tile per emoji, in order */
      const grid = document.createElement('div');
      grid.className = 'emo-grid';
      EMOJIS.forEach((emoji, index) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'emo-tile vid-tile';
        b.title = emoji.name + ' emoji';
        b.setAttribute('aria-label', 'Send the ' + emoji.name.toLowerCase() + ' emoji');
        const vid = document.createElement('video');
        vid.className = 'vid-poster';
        vid.src = emoji.src;
        vid.loop = true;
        vid.muted = true;
        vid.autoplay = true;
        vid.playsInline = true;
        const attempt = vid.play();
        if (attempt && attempt.catch) attempt.catch(() => {});
        b.appendChild(vid);
        b.addEventListener('click', ev => {
          ev.stopPropagation();
          closePickers();
          showBubble(playerId, index);
          if (playerId !== 'champ') chatSay(nameOf('champ'), 'sent the ' + emoji.name + ' emoji at ' + nameOf(playerId));
        });
        grid.appendChild(b);
      });
      pk.appendChild(grid);
    }
    document.body.appendChild(pk);
    const r = anchorEl.getBoundingClientRect();
    const w = pk.offsetWidth, h = pk.offsetHeight;
    pk.style.left = Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2)) + 'px';
    let top = r.bottom + 10;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 10);
    pk.style.top = top + 'px';
  }

  /* ---------------- one gift, one arc -------------------------------------- */
  function sendGift(fromId, toId, g) {
    if (!round || round.ended || !g || fromId === toId) return false;
    const from = round.scores[fromId], to = round.scores[toId];
    if (!from || !to) return false;
    if (from.coins < g.cost) {
      if (fromId === 'champ') socialToast('Not enough coins \u2014 find words to earn more \uD83E\uDE99');
      return false;
    }
    from.coins -= g.cost;
    to.coins += g.cost;
    renderScores();
    throwGift(fromId, toId, g);
    seatEvent(toId, 'gift', g.name);
    if (fromId === 'champ') {
      chatSay(nameOf('champ'), 'sent a ' + g.name.toLowerCase() + ' to ' + nameOf(toId));
      notify(g.name + ' \u2192 ' + nameOf(toId) + '  \u00b7  \u2212' + g.cost + ' \u00a2', 'gift');
    }
    return true;
  }

  /* A throw is a projectile, so it is animated as one: the horizontal component
     is constant, the vertical is a parabola under gravity, and a third axis
     brings the item toward the camera at the top of the arc. The previous
     version eased both ends of a Bézier and scaled on a sine, which is why it
     read as a bubble drifting across the table instead of something thrown.
     The tumble unwinds over the last third so the gift arrives face-on. */
  function throwGift(fromId, toId, g) {
    const a = seatPoint(fromId), b = seatPoint(toId);
    if (!a || !b) return;

    const el = document.createElement('span');
    el.className = 'gift-fly';
    el.setAttribute('aria-label', g.name);
    el.innerHTML = '<span class="gift-art">' + giftArt(g) + '</span>';
    el.style.left = a.x + 'px';
    el.style.top = a.y + 'px';

    /* the ground shadow is anchored at the receiver's feet and only slides in
       x, so it cannot fly with the gift - that is what marks the height */
    const shadow = document.createElement('span');
    shadow.className = 'gift-shadow';
    shadow.style.left = b.x + 'px';
    shadow.style.top = (b.y + 26) + 'px';

    document.body.append(el, shadow);

    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    const dur = Math.min(900, Math.max(520, dist * 1.55));
    const peak = Math.min(230, Math.max(90, dist * 0.42));   /* rise above the chord */
    const depth = Math.min(150, dist * 0.28);                /* travel toward the camera */
    /* These marks are flat, so a full flip on X or Y turns them edge-on and the
       gift all but disappears for half the flight. The tumble therefore happens
       in the screen plane (Z, which keeps the silhouette), while X and Y only
       lean - enough to catch the light and read as solid, never enough to
       vanish. */
    const leanX = 14 + Math.random() * 8;
    const leanY = 20 + Math.random() * 12;
    const spinZ = (Math.random() < 0.5 ? -1 : 1) * (300 + Math.random() * 140);
    const t0 = performance.now();

    const step = now => {
      const t = Math.min(1, (now - t0) / dur);
      const x = a.x + dx * t;
      const y = a.y + dy * t - peak * 4 * t * (1 - t);
      const z = depth * Math.sin(Math.PI * t);
      const settle = 1 - t * t * t;
      const arc = Math.sin(Math.PI * t);

      el.style.transform =
        'perspective(760px)' +
        ' translate3d(' + (x - a.x).toFixed(1) + 'px,' + (y - a.y).toFixed(1) + 'px,' + z.toFixed(1) + 'px)' +
        ' rotateX(' + (leanX * arc).toFixed(1) + 'deg)' +
        ' rotateY(' + (leanY * Math.sin(2 * Math.PI * t) * (1 - t * 0.5)).toFixed(1) + 'deg)' +
        ' rotateZ(' + (spinZ * t * settle).toFixed(1) + 'deg)' +
        ' scale(' + (1 + z / 420).toFixed(3) + ')';

      const lift = depth > 0 ? z / depth : 0;
      shadow.style.transform =
        'translate3d(' + (x - b.x).toFixed(1) + 'px,0,0) scale(' + (1 - lift * 0.5).toFixed(3) + ')';
      shadow.style.opacity = (0.55 - lift * 0.42).toFixed(3);

      if (t < 1) requestAnimationFrame(step);
      else { el.remove(); shadow.remove(); giftImpact(fromId, toId, g); }
    };
    requestAnimationFrame(step);
  }

  function sparks(pt) {
    for (let i = 0; i < 7; i++) {
      const s = document.createElement('span');
      s.className = 'gift-spark';
      s.style.left = pt.x + 'px';
      s.style.top = pt.y + 'px';
      document.body.appendChild(s);
      const ang = (i / 7) * Math.PI * 2, d = 44 + Math.random() * 32;
      requestAnimationFrame(() => {
        s.style.transform = 'translate(' + (Math.cos(ang) * d).toFixed(1) + 'px,' + (Math.sin(ang) * d).toFixed(1) + 'px) scale(.3)';
        s.style.opacity = '0';
      });
      window.setTimeout(() => s.remove(), 700);
    }
  }

  function giftImpact(fromId, toId, g) {
    const pt = seatPoint(toId);
    if (pt) {
      pt.el.classList.remove('gift-hit');
      void pt.el.offsetWidth;
      pt.el.classList.add('gift-hit');
      window.setTimeout(() => pt.el.classList.remove('gift-hit'), 640);
      /* a shockwave at the point of contact: the spark burst alone reads as
         confetti, the expanding ring reads as an impact */
      const ring = document.createElement('span');
      ring.className = 'gift-ring';
      ring.style.left = pt.x + 'px';
      ring.style.top = pt.y + 'px';
      document.body.appendChild(ring);
      window.setTimeout(() => ring.remove(), 480);
      sparks(pt);
    }
    /* the gift lands as sparks on the avatar — no emoji reaction on top */
    if (toId === 'champ') socialToast('\uD83C\uDF81 ' + nameOf(fromId) + ' threw a ' + g.name.toLowerCase() + ' at you!');
    else if (Math.random() < 0.8) {
      window.setTimeout(() => chatSay(nameOf(toId), THANK_LINES[Math.floor(Math.random() * THANK_LINES.length)]), 800 + Math.random() * 900);
    }
    /* a rival often lobs something straight back, so the arc is seen both ways */
    if (fromId === 'champ' && Math.random() < 0.42) {
      const back = GIFTS[Math.floor(Math.random() * 4)];
      window.setTimeout(() => { if (round && !round.ended) throwGift(toId, 'champ', back); }, 1500 + Math.random() * 900);
    }
  }

  /* ------------- wiring: tap avatars like the classic table --------------- */
  function wireSeatSocial() {
    document.querySelectorAll('.gwx-seat').forEach(seat => {
      const id = seat.dataset.player;
      if (!id || seat.dataset.socialWired) return;
      seat.dataset.socialWired = '1';
      const avatar = seat.querySelector('.gwx-avatar');
      /* own profile: nothing pops from the avatar — the emoji icon is the way in.
         Rivals keep the gift tray on their avatar. */
      if (avatar && id !== 'champ') {
        avatar.style.cursor = 'pointer';
        avatar.addEventListener('click', ev => {
          ev.stopPropagation();
          openPicker(id, avatar, 'gift');
        });
      }
      /* tapping the avatar opens that seat's board — no per-seat emote button */
    });
    document.addEventListener('click', event => {
      if (!event.target.closest('.gw-picker') && !event.target.closest('.gwx-avatar')) closePickers();
    });
  }

  /* bots gift the player now and then, and emote among themselves */
  function scheduleBotGift() {
    window.clearTimeout(giftTimer);
    giftTimer = window.setTimeout(() => {
      if (round && !round.ended && turnState && turnState.tick) {
        const from = BOT_IDS[Math.floor(Math.random() * BOT_IDS.length)];
        sendGift(from, 'champ', GIFTS[Math.floor(Math.random() * 4)]);
      }
      scheduleBotGift();
    }, 35000 + Math.random() * 40000);
  }

  function scheduleBotAmbience() {
    window.clearTimeout(ambienceTimer);
    ambienceTimer = window.setTimeout(() => {
      if (round && !round.ended) {
        const who = BOT_IDS[Math.floor(Math.random() * BOT_IDS.length)];
        showBubble(who, Math.floor(Math.random() * EMOJIS.length));
      }
      scheduleBotAmbience();
    }, 14000 + Math.random() * 6000);
  }

  function buildLevelRail() {
    const track = document.querySelector('.gwx-level-track');
    if (!track) return;
    track.setAttribute('aria-valuemax', String(BOARDS));
    track.querySelectorAll('i').forEach(pip => pip.remove());
    for (let i = 0; i < BOARDS; i++) {
      const pip = document.createElement('i');
      pip.style.left = ((i + 1) / (BOARDS + 1) * 100).toFixed(2) + '%';
      track.appendChild(pip);
    }
  }

  /* the rail reads LEVEL n/30: filled pips are cleared levels, the bar covers
     the whole hunt, and hidden-word progress sits in the label */
  function paintLevelRail() {
    const track = document.querySelector('.gwx-level-track');
    const bar = $('wordProgress');
    const overall = round.words30.length ? round.foundAll.size / round.words30.length : 0;
    if (bar) bar.style.width = (Math.max(0, Math.min(1, overall)) * 100).toFixed(2) + '%';
    if (track) {
      track.setAttribute('aria-valuenow', String(round.level));
      track.querySelectorAll('i').forEach((pip, index) => pip.classList.toggle('on', index < round.level - 1));
    }
    const label = $('wordProgressLabel');
    if (label) label.textContent = round.foundAll.size + ' / ' + round.words30.length + ' WORDS';
  }

  /* the whole round's thirty words are dealt up front: five boards of six,
     every word laid letter by letter into its own 7x6 board, all thirty
     unique. The longest word on each of the first four boards is that
     board's CHAMP word. */
  function buildBoards() {
    const used = new Set();
    round.boards = [];
    for (let board = 0; board < BOARDS; board++) {
      const lengths = BOARD_LENGTHS[board % BOARD_LENGTHS.length];
      let layout;
      try {
        layout = createWordGrid(WORD_BANK, Math.random, { lengths, exclude: used });
      } catch {
        layout = createWordGrid(WORD_BANK, Math.random, { lengths });
      }
      layout.words.forEach(item => used.add(item.word));
      /* safety net: any cell the deal left empty (a length set that came up
         short) gets a filler letter so the board never renders a hole */
      const ALPHA = 'eeeaaaiioonnrtssttllccuuddppmm';
      layout.grid.forEach((letter, cell) => { if (!letter) layout.grid[cell] = ALPHA[Math.floor(Math.random() * ALPHA.length)]; });
      round.boards.push(layout);
    }
    round.boards.slice(0, CHAMP_WORDS).forEach(layout => {
      const top = Math.max(...layout.words.map(item => item.word.length));
      const king = layout.words.find(item => item.word.length === top);
      if (king) king.champ = true;
    });
    round.words30 = [];
    round.boards.forEach((layout, index) => {
      layout.words.forEach(item => round.words30.push({ word: item.word, path: item.path, champ: !!item.champ, board: index + 1 }));
    });
  }

  /* bring the next board up: its words were already laid at reset, so this
     just seats the board and repaints the rails */
  function dealLevel() {
    round.layout = round.boards[round.level - 1];
    round.found = new Set();
    round.foundPaths = [];
    buildLevelRail();
    buildGrid();
    renderSlots();
    renderPath();
    $('roundLabel').textContent = String(round.level).padStart(2, '0');
    $('roundMessage').textContent = 'Board ' + round.level + ' of ' + BOARDS + ' — ' + round.foundAll.size + ' of 30 words found. First 20 words pay out; after that every word robs the richest seat.';
    renderPhase();
  }

  function resetRound() {
    /* presentation only: a celebration still in flight belongs to the board being
       replaced. Without this its letters keep floating over the new grid at the
       old coordinates until their own timers expire. */
    window.__champCoins?.cancel?.();
    window.clearTimeout(resultReveal);
    resultReveal = 0;
    window.clearTimeout(handoverTimer);
    settling = false;
    stopTurns();
    document.querySelectorAll('.gwx-seat').forEach(seat => { seat.classList.remove('active'); seat.style.removeProperty('--turn-pct'); });
    $('resultModal').classList.remove('open');
    $('resultModal').setAttribute('aria-hidden', 'true');
    $('guessInput').value = '';
    $('guessMessage').classList.remove('good', 'bad');
    $('guessMessage').textContent = '30 levels, 15 seconds a turn. Hidden words pay 100 coins a letter.';
    $('roundMessage').textContent = 'Everyone starts on ' + START_COINS.toLocaleString('en-US') + ' coins. The top purse opens; the grid pays the first find, then every find is paid by the scorer before you.';
    path = [];
    round = {
      level: 1,
      layout: null,
      found: new Set(),
      foundPaths: [],
      foundAll: new Set(),
      words30: [],
      boards: [],
      scores: Object.fromEntries(PLAYERS.map(player => [player.id, { coins: START_COINS, words: 0 }])),
      revengeTargets: {},
      ended: false
    };
    comboStreak = {};
    buildBoards();
    dealLevel();
    renderScores();
    applyBotFx();
    passStreak = 0;
    /* the richest purse always opens the round; the turn then travels the
       seat cycle from there — champ, jess, kalkal, poker, back to champ. */
    const maxCoins = Math.max(...PLAYERS.map(player => round.scores[player.id].coins));
    const opener = SEAT_CYCLE.find(id => round.scores[id].coins === maxCoins);
    const at = SEAT_CYCLE.indexOf(opener);
    TURN_ORDER = SEAT_CYCLE.map((_, i) => SEAT_CYCLE[(at + i) % SEAT_CYCLE.length]);
    lastScorer = null;
    eliminated = new Set();
    document.querySelectorAll('.gwx-seat.is-out').forEach(seat => seat.classList.remove('is-out'));
    activeSeatId = null;
    document.querySelectorAll('.gw-shield').forEach(badge => badge.remove());
    turnState = { index: 0, endsAt: 0, tick: 0, botTimer: 0 };
    renderTurnArrows();
    startTurn();
    /* one watchdog for the page, not per round: it only ever fires when the
       table has stopped moving, so an idle restart costs nothing */
    lastProgressAt = performance.now();
    if (!window.__champStallWatch) window.__champStallWatch = window.setInterval(stallWatchdog, 700);
  }

  $('guessForm').addEventListener('submit', event => {
    event.preventDefault();
    /* No cue here: a word that lands is thrown into the grid by the
       celebration itself, which owns that beat and would otherwise double this
       one up. A word that misses never reaches the grid, so it is silent. */
    submitGuess($('guessInput').value, turnState ? TURN_ORDER[turnState.index] : 'champ', path.length > 0);
  });
  $('guessInput').addEventListener('input', () => {
    path = [];
    renderPath();
  });
  const controlsMenu = $('gwx-controls-menu');
  $('restartBtn').addEventListener('click', () => { controlsMenu.hidden = !controlsMenu.hidden; });
  $('restart-round-btn').addEventListener('click', () => { controlsMenu.hidden = true; resetRound(); });
  document.addEventListener('click', event => {
    if (!event.target.closest('.gwx-tools')) controlsMenu.hidden = true;
  });
  $('gwx-profile').addEventListener('click', () => {
    try {
      if (window.parent !== window && typeof window.parent.__openChampProfile === 'function') {
        window.parent.__openChampProfile();
        return;
      }
    } catch (error) { /* the standalone game may be embedded cross-origin */ }
    window.location.href = 'index.html';
  });
  let installHintTimer = 0;
  $('gwx-install-app').addEventListener('click', async () => {
    const outcome = await window.champWord?.promptInstall?.();
    if (outcome === 'accepted') return;
    $('gwx-install-hint').hidden = false;
    window.clearTimeout(installHintTimer);
    installHintTimer = window.setTimeout(() => { $('gwx-install-hint').hidden = true; }, 5000);
  });
  window.addEventListener('appinstalled', () => { $('gwx-install-app').hidden = true; });
  $('playAgainBtn').addEventListener('click', resetRound);
  const emojiToggle = $('emojiToggle');
  const chatToggle = $('chatToggle');
  const emojiMenu = $('emojiMenu');
  const chatPanel = $('tableChatPanel');
  const reaction = $('champReaction');
  const chatMessages = $('chatMessages');
  const chatConnection = $('chatConnection');
  let reactionTimer = null;
  let chatSocket = null;
  let chatReconnectTimer = null;
  let chatRequest = 0;
  let chatRoomId = new URLSearchParams(location.search).get('room');
  const chatPlayerKey = 'champword.playerId';
  let chatPlayerId = localStorage.getItem(chatPlayerKey);
  if (!chatPlayerId) {
    chatPlayerId = globalThis.crypto?.randomUUID?.() || `player-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    localStorage.setItem(chatPlayerKey, chatPlayerId);
  }
  function closeSocialMenus() {
    emojiMenu.hidden = true;
    emojiToggle.setAttribute('aria-expanded', 'false');
  }
  function toggleSocialMenu(menu, button) {
    const opening = menu.hidden;
    closeSocialMenus();
    menu.hidden = !opening;
    button.setAttribute('aria-expanded', String(opening));
  }

  function appendChatMessage(text, playerId, at = new Date().toISOString()) {
    const bubble = document.createElement('div');
    bubble.className = `table-chat-bubble${playerId === chatPlayerId ? ' mine' : ''}`;
    const body = document.createElement('span');
    body.textContent = text;
    const time = document.createElement('small');
    time.textContent = new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    bubble.append(body, time);
    chatMessages.appendChild(bubble);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
  function setChatStatus(text, connected = false) {
    chatConnection.textContent = text;
    chatConnection.classList.toggle('connected', connected);
  }
  function connectTableChat() {
    if (chatSocket && (chatSocket.readyState === WebSocket.OPEN || chatSocket.readyState === WebSocket.CONNECTING)) return;
    const host = location.hostname;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socketUrl = host === 'champword-backend.onrender.com' || host === 'localhost' || host === '127.0.0.1'
      ? `${protocol}//${location.host}`
      : 'wss://champword-backend.onrender.com';
    setChatStatus('Connecting…');
    try {
      chatSocket = new WebSocket(socketUrl);
    } catch {
      setChatStatus('Chat unavailable');
      return;
    }
    chatSocket.addEventListener('open', () => {
      const requestId = `grid-chat-${Date.now()}-${++chatRequest}`;
      if (chatRoomId) chatSocket.send(JSON.stringify({ type: 'join_room', requestId, roomId: chatRoomId, playerId: chatPlayerId }));
      else chatSocket.send(JSON.stringify({ type: 'create_room', requestId, playerId: chatPlayerId }));
    });
    chatSocket.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'room_snapshot' && message.roomId) {
        chatRoomId = message.roomId;
        const nextUrl = new URL(location.href);
        nextUrl.searchParams.set('room', chatRoomId);
        history.replaceState(null, '', nextUrl);
        setChatStatus('Connected · share the invite link', true);
      } else if (message.type === 'chat_message') {
        appendChatMessage(message.text, message.playerId, message.at);
      } else if (message.type === 'error') {
        setChatStatus('Reconnect to chat');
      }
    });
    chatSocket.addEventListener('close', () => {
      setChatStatus('Reconnecting…');
      clearTimeout(chatReconnectTimer);
      chatReconnectTimer = window.setTimeout(connectTableChat, 2400);
    });
    chatSocket.addEventListener('error', () => setChatStatus('Connecting…'));
  }
  emojiToggle.addEventListener('click', () => toggleSocialMenu(emojiMenu, emojiToggle));
  chatToggle.addEventListener('click', () => {
    closeSocialMenus();
    chatPanel.hidden = !chatPanel.hidden;
    chatToggle.setAttribute('aria-expanded', String(!chatPanel.hidden));
    if (!chatPanel.hidden) $('tableChatInput').focus();
  });
  $('closeChat').addEventListener('click', () => {
    chatPanel.hidden = true;
    chatToggle.setAttribute('aria-expanded', 'false');
  });
  $('tableChatForm').addEventListener('submit', event => {
    event.preventDefault();
    const input = $('tableChatInput');
    const text = input.value.trim();
    if (!text) return;
    if (!chatSocket || chatSocket.readyState !== WebSocket.OPEN || !chatRoomId) {
      setChatStatus('Reconnecting…');
      connectTableChat();
      return;
    }
    chatSocket.send(JSON.stringify({ type: 'chat_send', requestId: `grid-chat-${Date.now()}-${++chatRequest}`, text }));
    input.value = '';
    input.focus();
  });
  $('copyRoomLink').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setChatStatus('Invite link copied', true);
    } catch {
      setChatStatus('Copy the page link to invite players');
    }
  });
  /* the dashboard's emoji tray: the same small tiles, in order, over Champ */
  EMOJIS.forEach((emoji, index) => {
    const dashTile = document.createElement('button');
    dashTile.type = 'button';
    dashTile.className = 'vid-tile dash';
    dashTile.title = emoji.name + ' emoji';
    dashTile.setAttribute('aria-label', 'Send the ' + emoji.name.toLowerCase() + ' emoji');
    const vid = document.createElement('video');
    vid.className = 'vid-poster';
    vid.src = emoji.src;
    vid.loop = true;
    vid.muted = true;
    vid.autoplay = true;
    vid.playsInline = true;
    const attempt = vid.play();
    if (attempt && attempt.catch) attempt.catch(() => {});
    const caption = document.createElement('span');
    caption.className = 'vid-tile-caption';
    caption.textContent = emoji.name;
    dashTile.append(vid, caption);
    dashTile.addEventListener('click', ev => {
      ev.stopPropagation();
      closeSocialMenus();
      showBubble('champ', index);
    });
    emojiMenu.appendChild(dashTile);
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('.champ-social-controls')) closeSocialMenus();
  });
  connectTableChat();
  resetRound();
  wireSeatSocial();
  scheduleBotGift();
  scheduleBotAmbience();

  window.__champWordGrid = {
    state: () => ({
      grid: [...round.layout.grid], cols: round.layout.cols, rows: round.layout.rows,
      words: round.words30.map(item => item.word),
      champWords: round.words30.filter(item => item.champ).map(item => item.word),
      found: [...round.foundAll],
      board: round.level, level: round.level, levels: BOARDS, boards: BOARDS,
      scores: structuredClone(round.scores),
      active: turnState ? TURN_ORDER[turnState.index] : null,
      secondsLeft: turnState ? Math.max(0, Math.round((turnState.endsAt - performance.now()) / 1000)) : 0,
      order: TURN_ORDER.slice(), lastScorer,
      phase: inRobbery() ? 'robbery' : 'build', eliminated: [...eliminated],
      ended: round.ended
    }),
    guess: (word, player = 'champ', fromDrag = false) => submitGuess(word, player, fromDrag),
    gift: (toId, id) => sendGift('champ', toId, GIFTS.find(g => g.id === id || g.art === id || g.name.toUpperCase() === String(id || '').toUpperCase())),
    stall: () => ({
      progressAgo: Math.round(performance.now() - lastProgressAt),
      limit: stallLimitMs(),
      owed: round ? round.words30.length - round.foundAll.size : -1,
      level: round ? round.level : -1,
      lastFound: lastFound,
      size: round ? round.foundAll.size : -1,
      fires: stallStats.fires,
      lastGap: stallStats.lastGap,
      lastOwed: stallStats.lastOwed
    }),
    setTurnSpeed: ms => { turnMs = Math.max(400, Math.min(TURN_MS, Number(ms) || TURN_MS)); },
    skipToBoard: n => { if (round && !round.ended) { round.level = Math.max(1, Math.min(BOARDS, Number(n) || 1)); dealLevel(); } },
    skipToLevel: n => { if (round && !round.ended) { round.level = Math.max(1, Math.min(BOARDS, Number(n) || 1)); dealLevel(); } },
    reset: resetRound
  };
})();

