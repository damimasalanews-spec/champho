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
  const BOT_IDS = ['poker', 'kalkal', 'jess'];

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
     one is crowned with a coin shield for their next TWO turns, so no later
     scorer can take from their purse while it stands, and finds stack. The
     player holding the most coins always answers first, then the turn
     travels the seat cycle — champ, jess, kalkal, poker, back to champ. The
     grid pays the first correct answer; from then on every correct answer
     takes its coins out of the previous scorer's purse. The round's final
     word can only be won by touching the letters — drag it, don't type it.
     The leaderboard prints when all 30 words are found; top coins win. */
  const BOARDS = 5;             /* five boards of six hidden words = 30 */
  const CHAMP_WORDS = 4;        /* four champ words hidden in the round */
  const CHAMP_SHIELD_TURNS = 2; /* each champ find shields the finder's coins */
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
  /* the coin shield: finding a champ word shields that player's purse for
     their next two turns — no later scorer can take from it while it stands.
     Finds stack, and the turn the word was found on never counts against it. */
  let shieldTurns = {};
  let shieldFresh = new Set();
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
  const START_COINS = 500;

  function renderScores() {
    for (const player of PLAYERS) {
      const score = round.scores[player.id];
      $(`coins-${player.id}`).textContent = String(score.coins);
      $(`words-${player.id}`).textContent = `${score.words} ${score.words === 1 ? 'word' : 'words'}`;
    }
    const totalCoins = $('totalCoins');
    if (totalCoins) totalCoins.textContent = String(PLAYERS.reduce((sum, player) => sum + round.scores[player.id].coins, 0));
    renderSeatMarks();
  }

  /* ---------------- competition layer -------------------------------------
     Three things sit on top of the coin chain, and all three are read from
     state the round already keeps: who scored last, what each purse holds, and
     how many words in a row a seat has found. */

  const COMBO_CAP = 3;   /* a run tops out at x3, or one lucky seat runs away */

  function comboMultiplier(streak) {
    if (streak < 2) return 1;
    return Math.min(COMBO_CAP, 1 + (streak - 1) * 0.5);   /* 1.5, 2, 2.5, 3 */
  }

  /* A bounty only exists when somebody is actually ahead - a 1-coin lead is not
     a bounty, it is noise. 200 coins is two words. */
  const BOUNTY_LEAD = 200;

  function coinLeaderId() {
    if (!round) return null;
    const purses = PLAYERS.map(player => ({ id: player.id, coins: round.scores[player.id].coins }));
    purses.sort((a, b) => b.coins - a.coins);
    const [first, second] = purses;
    if (!first || first.coins <= 0) return null;
    if (!second || first.coins - second.coins < BOUNTY_LEAD) return null;
    return first.id;
  }

  /* Both marks are about the next word, not the last one: the seat that will
     pay for the next find (unless shielded), and the seat carrying the bounty. */
  function renderSeatMarks(activeId) {
    if (!round) return;
    if (activeId === undefined) activeId = activeSeatId;
    const mark = activeId ? markOf(activeId) : null;

    document.querySelectorAll('.gwx-seat').forEach(seat => {
      const id = seat.dataset.player;
      const pips = heat[id] || 0;
      seat.classList.toggle('is-mark', Boolean(mark && mark.id === id));
      seat.classList.toggle('is-wanted', pips >= HEAT_MAX);
      seat.classList.toggle('steal-target', Boolean(mark && mark.id === id));

      let meter = seat.querySelector('.gwx-heat');
      if (pips <= 0) {
        if (meter) meter.remove();
        return;
      }
      if (!meter) {
        meter = document.createElement('span');
        meter.className = 'gwx-heat';
        meter.innerHTML = '<i></i><i></i><i></i>';
        (seat.querySelector('.gwx-card-count') || seat.querySelector('.gwx-seat-coins') || seat).appendChild(meter);
      }
      Array.from(meter.children).forEach((pip, index) => pip.classList.toggle('on', index < pips));
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
    /* presentation only: the word is thrown into the grid, dances, becomes coins,
       and those coins arc to whoever scored. Falls back to the plain shower. */
    if (window.__champCoins?.celebrate) return window.__champCoins.celebrate(playerId, word, cells, coins);
    window.__champCoins?.play(playerId, coins);
    return 0;
  }

  /* ================= THE HEIST ==============================================
     The old rule was one line: every find after the first is paid by the last
     scorer. Flat, silent, and it rewarded nothing - the best play was to find
     any word at all, because every word stole the same way.

     Four parts replace it, and each answers a question the player asks:

       MARK    - who am I robbing? A red reticle on the seat you would hit.
       HEAT    - what does robbing cost me? Every steal marks you; at three you
                 become the target for the whole table.
       LOCKDOWN- how do I defend? A CHAMP word still buys turns of immunity,
                 and an immune seat cannot rob either.
       JACKPOT - why keep playing when I am behind? After 25 of 30 words the
                 richest seat is the jackpot and steals pay triple, so a losing
                 table is one word from level.

     Stealing is capped at 60% of a purse, so nobody is wiped out by one word,
     and heat caps a runaway robber instead of the scoreboard doing it.
     ======================================================================== */
  const HEAT_MAX = 3;
  const JACKPOT_AT = 25;        /* words found, of thirty */
  const STEAL_RATE = 0.30;      /* base share of the mark's purse */
  const STEAL_CAP = 0.60;       /* never more than this share in one hit */

  let heat = {};
  /* Heat cools only on a turn where you did not rob. Decaying it every turn
     made HEAT_MAX unreachable - one steal per turn always lost one heat - and a
     wanted state that can never happen is not a system, it is a decoration. */
  let robbedThisTurn = false;
  let lastRobbery = null;       /* { thief, victim } - what REVENGE is measured against */
  let jackpotArmed = false;

  const purseOf = id => (round && round.scores[id] ? round.scores[id].coins : 0);
  const isLockedDown = id => (shieldTurns[id] || 0) > 0;

  function richestSeat(excludeId) {
    let best = null;
    let bestCoins = 0;
    for (const player of PLAYERS) {
      if (player.id === excludeId || isLockedDown(player.id)) continue;
      const coins = purseOf(player.id);
      if (coins > bestCoins) { bestCoins = coins; best = player.id; }
    }
    return best;
  }

  /* The wanted seat outranks the purse: rob enough and you are the target no
     matter how rich anyone else is. */
  function markOf(playerId) {
    const wanted = PLAYERS
      .map(player => player.id)
      .filter(id => id !== playerId && !isLockedDown(id) && (heat[id] || 0) >= HEAT_MAX)
      .sort((a, b) => purseOf(b) - purseOf(a));
    if (wanted.length) return { id: wanted[0], reason: 'wanted' };
    if (jackpotArmed) {
      const rich = richestSeat(playerId);
      if (rich) return { id: rich, reason: 'jackpot' };
    }
    if (lastScorer && lastScorer !== playerId && !isLockedDown(lastScorer)) {
      return { id: lastScorer, reason: 'chain' };
    }
    return null;
  }

  /**
   * Apply one find. Returns everything the presentation needs, and mutates the
   * purses - the single place coins change hands, so the message, the seats and
   * the celebration can never disagree with the scoreboard.
   */
  function resolveHeist(playerId, base, streak) {
    const multiplier = comboMultiplier(streak);
    const mark = markOf(playerId);
    const revenge = Boolean(lastRobbery && lastRobbery.victim === playerId && mark && lastRobbery.thief === mark.id);
    const jackpot = Boolean(mark && mark.reason === 'jackpot');
    let taken = 0;
    let fromId = null;

    if (mark) {
      const purse = purseOf(mark.id);
      const raw = Math.round(base * 0.5 * multiplier * (jackpot ? 3 : 1) * (revenge ? 1.5 : 1)
        + purse * STEAL_RATE * (jackpot ? 1 : 1));
      taken = Math.max(0, Math.min(raw, Math.round(purse * STEAL_CAP), purse));
      if (taken > 0) {
        fromId = mark.id;
        round.scores[fromId].coins -= taken;
        round.scores[playerId].coins += taken;
        if (!jackpot) heat[playerId] = Math.min(HEAT_MAX, (heat[playerId] || 0) + 1);
        robbedThisTurn = true;
        lastRobbery = { thief: playerId, victim: fromId };
      }
    }

    if (!fromId) {
      /* nothing worth robbing: the grid pays the word itself */
      taken = Math.round(base * multiplier * (jackpotArmed ? 3 : 1));
      round.scores[playerId].coins += taken;
    }

    return {
      taken,
      fromId,
      multiplier,
      revenge,
      jackpot,
      heat: heat[playerId] || 0,
      markReason: mark ? mark.reason : null,
      wipedOut: Boolean(fromId && purseOf(fromId) === 0)
    };
  }

  /* Coins travel. A number above a card says a robbery happened; a stream of
     coins crossing the table says WHO robbed WHOM, which is the part a player
     needs in order to retaliate. */
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
    const spin = 240 + Math.random() * 200;
    const started = performance.now();

    const step = now => {
      const t = Math.min(1, (now - started) / duration);
      const x = from.x + dx * t;
      const y = from.y + dy * t - lift * 4 * t * (1 - t);
      const z = Math.sin(Math.PI * t) * 90;
      coin.style.transform =
        'perspective(600px) translate3d(' + (x - from.x).toFixed(1) + 'px,' +
        (y - from.y).toFixed(1) + 'px,' + z.toFixed(1) + 'px)' +
        ' rotateY(' + (spin * t).toFixed(0) + 'deg) rotateX(' + (spin * 0.6 * t).toFixed(0) + 'deg)' +
        ' scale(' + (1 + z / 500).toFixed(2) + ')';
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

  let jackpotBanner = null;

  function armJackpot() {
    if (jackpotBanner) return;
    jackpotBanner = document.createElement('div');
    jackpotBanner.className = 'jackpot-banner';
    jackpotBanner.innerHTML = '<b>JACKPOT</b><span>richest seat pays triple</span>';
    document.body.appendChild(jackpotBanner);
  }

  function disarmJackpot() {
    if (!jackpotBanner) return;
    jackpotBanner.remove();
    jackpotBanner = null;
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
      /* a champ word crowns the finder: two turns of coin protection, and
         finds stack — the shield badge shows the turns remaining */
      shieldTurns[playerId] = (shieldTurns[playerId] || 0) + CHAMP_SHIELD_TURNS;
      shieldFresh.add(playerId);
      shieldBadge(playerId);
      cardFloater(playerId, 'champ');
      chatSay(nameOf(playerId), 'found the CHAMP word ' + result.word.toUpperCase() + '! Coins shielded for 2 turns!');
    }
    if (result.hidden) round.found.add(result.word);
    round.foundPaths.push(result.path);
    /* the coin chain: the FIRST correct answer of the round is paid by the
       grid itself; every later correct answer is paid out of the previous
       scorer's purse — take what they hold, the grid adds nothing. A player
       wearing the coin shield (they found a champ word) can't be robbed:
       the grid pays instead. */
    const streak = (comboStreak[playerId] || 0) + 1;
    comboStreak[playerId] = streak;
    const heist = resolveHeist(playerId, result.coins, streak);
    const credited = heist.taken;
    const fromId = heist.fromId;
    const multiplier = heist.multiplier;
    if (multiplier > 1) {
      const shown = Number.isInteger(multiplier) ? multiplier : multiplier.toFixed(1);
      notify('COMBO \u00d7' + shown + ' \u00b7 ' + streak + ' words in a row', 'combo');
      seatEvent(playerId, 'combo', '\u00d7' + shown + ' COMBO');
    }
    round.scores[playerId].words++;
    lastScorer = playerId;
    path = [];
    $('guessInput').value = '';
    $('guessMessage').classList.remove('bad');
    $('guessMessage').classList.add('good');
    const marks = [];
    if (multiplier > 1) marks.push('\u00d7' + (Number.isInteger(multiplier) ? multiplier : multiplier.toFixed(1)) + ' COMBO');
    if (heist.jackpot) marks.push('JACKPOT \u00d73');
    if (heist.revenge) marks.push('REVENGE +50%');
    if (heist.markReason === 'wanted') marks.push('WANTED');
    const tagSuffix = marks.length ? ' \u00b7 ' + marks.join(' \u00b7 ') : '';
    $('guessMessage').textContent = fromId
      ? `HEIST! ${result.word.toUpperCase()} \u2192 +${credited} taken from ${nameOf(fromId)}${heist.wipedOut ? ' \u2014 purse emptied' : ''}${tagSuffix}. Heat ${heist.heat}/${HEAT_MAX}.`
      : `${result.word.toUpperCase()} found! +${credited} from the grid to ${nameOf(playerId)}${tagSuffix}.`;

    /* the jackpot is armed by the words themselves, not by a timer */
    if (!jackpotArmed && round.foundAll.size >= JACKPOT_AT) {
      jackpotArmed = true;
      notify('JACKPOT ARMED \u00b7 the richest seat now pays triple', 'bounty');
      armJackpot();
    }
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
      if (heist.jackpot) notify('JACKPOT \u00b7 ' + nameOf(playerId) + ' takes ' + credited + ' from ' + nameOf(fromId), 'bounty');
      if (heist.revenge) notify('REVENGE \u00b7 ' + nameOf(playerId) + ' takes it back from ' + nameOf(fromId), 'combo');
      if (heist.heat >= HEAT_MAX) notify('WANTED \u00b7 ' + nameOf(playerId) + ' is the table\u2019s target', 'steal');
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

  /* the turn handoff: the seat cycle always travels forward, and the coin
     shield of the finishing player burns one turn off its count — the turn
     the champ word was found on never counts against it. */
  function advanceTurnIndex() {
    const outgoing = TURN_ORDER[turnState.index];
    if (shieldFresh.has(outgoing)) shieldFresh.delete(outgoing);
    else if ((shieldTurns[outgoing] || 0) > 0) {
      shieldTurns[outgoing]--;
      shieldBadge(outgoing);
    }
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
    /* a robber who stops robbing cools down; one who keeps going stays wanted */
    if (activeSeatId && activeSeatId !== id) {
      if (!robbedThisTurn && (heat[activeSeatId] || 0) > 0) {
        heat[activeSeatId] = Math.max(0, heat[activeSeatId] - 1);
      }
      robbedThisTurn = false;
    }
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
      if (Math.random() < BOT_SKILL && round.words30.length - round.foundAll.size > 1) {
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
    if (passStreak >= TURN_ORDER.length && round.words30.length - round.foundAll.size > 1) {
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
  /* the coin-shield badge: pinned above a protected seat's portrait with the
     turns of coin protection left; removed when the count runs out */
  function shieldBadge(playerId) {
    const seat = document.querySelector('.gwx-seat[data-player="' + playerId + '"]');
    if (!seat) return;
    let badge = seat.querySelector('.gw-shield');
    const turns = shieldTurns[playerId] || 0;
    if (turns <= 0) { if (badge) badge.remove(); return; }
    if (!badge) {
      badge = document.createElement('i');
      badge.className = 'gw-shield';
      seat.appendChild(badge);
    }
    badge.textContent = 'SHIELD \u00D7' + turns;
  }

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
    $('roundMessage').textContent = 'Board ' + round.level + ' of ' + BOARDS + ' — ' + round.foundAll.size + ' of 30 words found. Four CHAMP words shield coins for 2 turns.';
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
      ended: false
    };
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
    shieldTurns = {};
    comboStreak = {};
    activeSeatId = null;
    heat = {};
    robbedThisTurn = false;
    lastRobbery = null;
    jackpotArmed = false;
    disarmJackpot();
    shieldFresh = new Set();
    document.querySelectorAll('.gw-shield').forEach(badge => badge.remove());
    turnState = { index: 0, endsAt: 0, tick: 0, botTimer: 0 };
    renderTurnArrows();
    startTurn();
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
      shieldTurns: { ...shieldTurns },
      ended: round.ended
    }),
    guess: (word, player = 'champ', fromDrag = false) => submitGuess(word, player, fromDrag),
    gift: (toId, id) => sendGift('champ', toId, GIFTS.find(g => g.id === id || g.art === id || g.name.toUpperCase() === String(id || '').toUpperCase())),
    setTurnSpeed: ms => { turnMs = Math.max(400, Math.min(TURN_MS, Number(ms) || TURN_MS)); },
    skipToBoard: n => { if (round && !round.ended) { round.level = Math.max(1, Math.min(BOARDS, Number(n) || 1)); dealLevel(); } },
    skipToLevel: n => { if (round && !round.ended) { round.level = Math.max(1, Math.min(BOARDS, Number(n) || 1)); dealLevel(); } },
    reset: resetRound
  };
})();

