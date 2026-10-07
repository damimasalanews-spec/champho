import { WORD_BANK } from './english-word-bank.js?v=turns-1';
import { createWordGrid, findWordPath, normalizeGuess, scoreWord, wordsByLength } from './word-grid-rules.js?v=compact-1';

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
  /* ---- the level loop ------------------------------------------------------
     Thirty levels. Each level deals one 7x6 board - the same grid the game
     always had - carrying its own seven hidden words. On top of the hidden
     words, ANY dictionary word of 2-10 letters that traces through
     neighbouring letters on the board scores 100 coins a letter. Players
     answer one at a time with 15 seconds each. Champ always opens; the other
     three draw lots for their order, and that order holds for the whole match.
     A correct word books the coins and hands the clock to the next player
     immediately - a fresh 15 seconds, exactly. The clock running out passes the
     turn too. The leaderboard prints after level 30 and the top coin scorer
     wins: there are no teams. */
  const LEVELS = 30;
  const TURN_MS = 15000;
  /* champ first, then the bots in a random draw that sticks for the match */
  const TURN_ORDER = ['champ', ...shuffle(BOT_IDS)];
  const BOT_SKILL = 0.85;
  let turnState = null;   /* { index, endsAt, tick, botTimer } */
  let passStreak = 0;
  let turnMs = TURN_MS;   /* the dev hook can speed the clock up */

  function shuffle(list) {
    const result = [...list];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

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
    host.replaceChildren();
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
    renderLeaderboard();
  }

  function renderLeaderboard() {
    const host = $('leaderboardRows');
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
      role.textContent = player.id === 'champ' ? 'YOU' : 'RIVAL';
      identity.append(name, role);
      const coins = document.createElement('b');
      coins.className = 'gwx-leader-coins';
      coins.textContent = String(round.scores[player.id].coins);
      row.append(rank, identity, coins);
      host.appendChild(row);
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

  function submitGuess(value, playerId) {
    if (!round || round.ended || !turnState) return false;
    if (TURN_ORDER[turnState.index] !== playerId) return false;   /* strict clockwise turns */
    const result = scoreWord(round.layout.words, value, round.scored, playerId, round.layout);
    if (!result) {
      const normalized = normalizeGuess(value);
      const known = round.layout.words.some(item => item.word === normalized);
      flashMessage(!normalized ? 'Choose letters or type a word first.' : known ? 'That word has already been found.' : 'Not one of the hidden words. Try another path.', 'bad');
      return false;
    }
    round.scored.add(result.word);
    if (result.hidden) round.found.add(result.word);
    round.foundPaths.push(result.path);
    round.scores[playerId].coins += result.coins;
    round.scores[playerId].words++;
    path = [];
    $('guessInput').value = '';
    $('guessMessage').classList.remove('bad');
    $('guessMessage').classList.add('good');
    $('guessMessage').textContent = `${result.word.toUpperCase()} found! +${result.coins} coins to ${PLAYERS.find(item => item.id === playerId).name}.`;
    renderSlots();
    renderScores();
    renderPath();
    const revealAfter = animateCoins(playerId, result.coins, result.word, result.path);
    const levelDone = round.found.size === round.layout.words.length;
    if (levelDone && round.level >= LEVELS) { finishRound('complete', revealAfter); return true; }
    if (levelDone) {
      round.level++;
      dealLevel();
      $('roundMessage').textContent = 'LEVEL ' + (round.level - 1) + ' CLEAR! Level ' + round.level + ' board is up.';
    }
    /* a correct word passes the turn on at once: the next player gets their
       own exact 15 seconds, starting now */
    passTurn(true);
    return true;
  }

  /* clean handover used by a correct answer: the old turn's timers die here,
     and startTurn() reads the clock fresh for the next seat */
  function passTurn(found) {
    if (!turnState || !round || round.ended) return;
    window.clearInterval(turnState.tick);
    window.clearTimeout(turnState.botTimer);
    const seat = activeSeatEl(TURN_ORDER[turnState.index]);
    if (seat) { seat.classList.remove('active'); seat.style.removeProperty('--turn-pct'); }
    seatRings().forEach(ring => ring.remove());
    passStreak = 0;
    turnState.index = (turnState.index + 1) % TURN_ORDER.length;
    startTurn();
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
    $('resultText').textContent = `${ranking[0].name} ${topScore.toLocaleString('en-US')} coins · ${ranking[1].name} ${round.scores[ranking[1].id].coins.toLocaleString('en-US')} · ${ranking[2].name} ${round.scores[ranking[2].id].coins.toLocaleString('en-US')} · ${ranking[3].name} ${round.scores[ranking[3].id].coins.toLocaleString('en-US')}. ${reason === 'complete' ? 'All 30 levels cleared!' : reason === 'passed' ? 'Called at level ' + round.level + '.' : `${round.found.size} of ${round.layout.words.length} words found on level ${round.level}.`}`;
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
    turnState.endsAt = performance.now() + turnMs;
    turnState.tick = window.setInterval(tickTurn, 100);
    const player = PLAYERS.find(item => item.id === id);
    const human = id === 'champ';
    $('turnLabel').textContent = human ? 'YOUR TURN — FIND A WORD' : player.name.toUpperCase() + "'S TURN";
    $('guessInput').disabled = !human;
    const submit = document.querySelector('#guessForm button');
    if (submit) submit.disabled = !human;
    $('guessInput').placeholder = human ? 'Type your word' : 'Waiting for ' + player.name + '…';
    if (human) {
      $('guessMessage').textContent = 'Tap neighboring letters or type a word — 15 seconds.';
      $('guessInput').focus({ preventScroll: true });
    } else {
      $('guessMessage').textContent = player.name + ' is thinking…';
      if (Math.random() < BOT_SKILL) {
        const hidden = round.layout.words.filter(item => !round.found.has(item.word));
        let word = null;
        if (hidden.length && Math.random() < 0.8) word = hidden[Math.floor(Math.random() * hidden.length)].word;
        else {
          const open = round.traceable.filter(item => !round.scored.has(item.word));
          if (open.length) word = open[Math.floor(Math.random() * open.length)].word;
        }
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
    if (!turnState) return;
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
    if (passStreak >= TURN_ORDER.length) {
      /* a full cycle with no find moves the game on: deal the next level, or
         close the match when the last board is on the table */
      if (round.level >= LEVELS) { stopTurns(); finishRound('passed'); return; }
      round.level++;
      dealLevel();
      passStreak = 0;
    }
    turnState.index = (turnState.index + 1) % TURN_ORDER.length;
    startTurn();
  }

  function updateTimer(msLeft) {
    const total = Math.max(0, Math.ceil(msLeft / 1000));
    $('timer').textContent = '0:' + String(total).padStart(2, '0');
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
  const EMOJIS = ['\uD83D\uDE04', '\uD83D\uDE02', '\uD83D\uDE2E', '\uD83D\uDE2D', '\uD83D\uDE21', '\uD83E\uDD14', '\uD83D\uDE0E', '\uD83E\uDD73', '\uD83D\uDC4F', '\uD83D\uDC4D', '\u2764\uFE0F', '\uD83C\uDF89'];
  const THANK_LINES = ['thanks! \uD83D\uDE04', '\uD83D\uDE02', '\uD83D\uDC4C', 'right back at you!'];
  let giftTimer = 0, ambienceTimer = 0;

  function nameOf(id) { return (PLAYERS.find(p => p.id === id) || { name: id }).name; }

  function seatPoint(id) {
    const avatar = document.querySelector(`.gwx-seat[data-player="${id}"] .gwx-avatar`);
    if (!avatar) return null;
    const r = avatar.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, el: avatar };
  }

  function socialToast(msg, ms = 1900) {
    document.querySelectorAll('.gift-toast').forEach(t => t.remove());
    const toast = document.createElement('div');
    toast.className = 'gift-toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    window.setTimeout(() => toast.remove(), ms + 120);
  }

  function chatSay(who, text) {
    try { appendChatMessage(who + ' ' + text, who === nameOf('champ') ? 'champ' : 'bot'); } catch (e) {}
  }

  function showBubble(id, emoji) {
    const seat = document.querySelector(`.gwx-seat[data-player="${id}"]`);
    if (!seat) return;
    let b = seat.querySelector('.bubble');
    if (!b) {
      b = document.createElement('span');
      b.className = 'bubble';
      seat.appendChild(b);
    }
    b.textContent = emoji;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
    clearTimeout(b._t);
    b._t = window.setTimeout(() => b.classList.remove('show'), 1900);
  }

  /* the classic mode's drawn emote set ships in game/emojis.js as classic-script
     globals; guarded so this page still works if it ever fails to load */
  const RB_SET = () => (typeof RABBIT_EMOTES === 'undefined' ? [] : RABBIT_EMOTES);
  const RB_SVG = look => (typeof rabbitSVG === 'undefined' ? '\uD83D\uDC30' : rabbitSVG(look));

  /* the classic drawn rabbit emote performs over a seat for its 2 seconds */
  function playEmote(id, emoId) {
    const emo = RB_SET().find(e => e.id === emoId);
    const pt = seatPoint(id);
    if (!emo || !pt) return;
    document.querySelectorAll(`.rb-msg[data-seat="${id}"]`).forEach(m => m.remove());
    const st = document.createElement('div');
    st.className = 'rb-msg';
    st.dataset.seat = id;
    if (pt.x > window.innerWidth * 0.55) st.classList.add('flip');
    const box = document.createElement('div');
    box.className = 'box';
    box.innerHTML = RB_SVG(emo.look);
    st.appendChild(box);
    st.style.left = Math.round(pt.x - 30) + 'px';
    st.style.top = Math.round(pt.y - 74) + 'px';
    document.body.appendChild(st);
    clearTimeout(st._t);
    st._t = window.setTimeout(() => st.remove(), 2000);
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
        '<span class="gp-purse">\uD83E\uDE99 ' + purse + '</span>';
      pk.appendChild(head);
      const grid = document.createElement('div');
      grid.className = 'gp-grid';
      GIFTS.forEach(g => {
        const b = document.createElement('button');
        b.className = 'gift-tile' + (g.cost > purse ? ' poor' : '');
        b.innerHTML = '<span class="gt-art' + (g.gold ? ' gt-gold' : '') + '">' + g.art + '</span>' +
          '<span class="gt-cost">\uD83E\uDE99 ' + g.cost + '</span>';
        b.title = g.name + ' \u2014 ' + g.cost + ' coins';
        b.addEventListener('click', ev => { ev.stopPropagation(); const ok = sendGift('champ', playerId, g); if (ok) closePickers(); });
        grid.appendChild(b);
      });
      pk.appendChild(grid);
    } else {
      const row = document.createElement('div');
      row.className = 'rb-row';
      const cap = document.createElement('span');
      cap.className = 'rb-cap';
      cap.textContent = 'CHAMPWORD EMOTES · 2s';
      row.appendChild(cap);
      (RB_SET()).forEach(e => {
        const b = document.createElement('button');
        b.className = 'rb-btn';
        b.title = e.name + ' - ' + e.line;
        b.innerHTML = RB_SVG(e.look);
        b.addEventListener('click', ev => {
          ev.stopPropagation(); closePickers(); playEmote(playerId, e.id);
          if (playerId !== 'champ') chatSay(nameOf('champ'), 'sent a ' + e.name + ' emote at ' + nameOf(playerId));
        });
        row.appendChild(b);
      });
      pk.appendChild(row);
      const grid = document.createElement('div');
      grid.className = 'emo-grid';
      EMOJIS.forEach(e => {
        const b = document.createElement('button');
        b.textContent = e;
        b.addEventListener('click', ev => { ev.stopPropagation(); closePickers(); showBubble(playerId, e); });
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
    if (fromId === 'champ') {
      chatSay(nameOf('champ'), 'sent a ' + g.name.toLowerCase() + ' to ' + nameOf(toId) + ' ' + g.art);
      socialToast(g.art + ' ' + g.name + ' \u2192 ' + nameOf(toId) + '   \u2212' + g.cost + ' \uD83E\uDE99');
    }
    return true;
  }

  function throwGift(fromId, toId, g) {
    const a = seatPoint(fromId), b = seatPoint(toId);
    if (!a || !b) return;
    const el = document.createElement('span');
    el.className = 'gift-fly';
    el.textContent = g.art;
    if (g.gold) el.classList.add('gt-gold');
    el.style.left = a.x + 'px';
    el.style.top = a.y + 'px';
    document.body.appendChild(el);
    const dur = 620, t0 = performance.now();
    const lift = Math.min(200, Math.max(70, Math.abs(b.y - a.y) * 0.4 + 90));
    const cx = (a.x + b.x) / 2, cy = Math.min(a.y, b.y) - lift;
    const step = now => {
      const t = Math.min(1, (now - t0) / dur), u = 1 - t;
      const x = u * u * a.x + 2 * u * t * cx + t * t * b.x;
      const y = u * u * a.y + 2 * u * t * cy + t * t * b.y;
      const sc = 1 + Math.sin(Math.PI * t) * 0.6;
      el.style.transform = 'translate(' + (x - a.x).toFixed(1) + 'px,' + (y - a.y).toFixed(1) + 'px)' +
        ' rotate(' + Math.round(t * 400) + 'deg) scale(' + sc.toFixed(3) + ')';
      if (t < 1) requestAnimationFrame(step);
      else { el.remove(); giftImpact(fromId, toId, g); }
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
      sparks(pt);
    }
    showBubble(toId, g.art);
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
      if (avatar) {
        avatar.style.cursor = 'pointer';
        avatar.addEventListener('click', ev => {
          ev.stopPropagation();
          openPicker(id === 'champ' ? 'champ' : id, avatar, id === 'champ' ? 'emoji' : 'gift');
        });
      }
      /* the seat's little emote button opens the emoji board for that seat */
      const emoteBtn = document.createElement('button');
      emoteBtn.type = 'button';
      emoteBtn.className = 'emote-btn';
      emoteBtn.textContent = '\uD83D\uDE0A';
      emoteBtn.title = 'Send an emote';
      emoteBtn.addEventListener('click', ev => { ev.stopPropagation(); openPicker(id, emoteBtn, 'emoji'); });
      seat.appendChild(emoteBtn);
    });
    document.addEventListener('click', event => {
      if (!event.target.closest('.gw-picker') && !event.target.closest('.gwx-avatar') && !event.target.closest('.emote-btn')) closePickers();
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
        const emotes = RB_SET();
        if (emotes.length && Math.random() < 0.55) playEmote(who, emotes[Math.floor(Math.random() * emotes.length)].id);
        else showBubble(who, EMOJIS[Math.floor(Math.random() * EMOJIS.length)]);
      }
      scheduleBotAmbience();
    }, 14000 + Math.random() * 6000);
  }

  function buildLevelRail() {
    const track = document.querySelector('.gwx-level-track');
    if (!track) return;
    track.setAttribute('aria-valuemax', String(LEVELS));
    track.querySelectorAll('i').forEach(pip => pip.remove());
    for (let i = 0; i < LEVELS; i++) {
      const pip = document.createElement('i');
      pip.style.left = ((i + 1) / (LEVELS + 1) * 100).toFixed(2) + '%';
      track.appendChild(pip);
    }
  }

  /* the rail reads LEVEL n/30: filled pips are cleared levels, the bar covers
     the whole hunt, and hidden-word progress sits in the label */
  function paintLevelRail() {
    const track = document.querySelector('.gwx-level-track');
    const bar = $('wordProgress');
    const overall = ((round.level - 1) * 7 + round.found.size) / (LEVELS * 7);
    if (bar) bar.style.width = (Math.max(0, Math.min(1, overall)) * 100).toFixed(2) + '%';
    if (track) {
      track.setAttribute('aria-valuenow', String(round.level));
      track.querySelectorAll('i').forEach((pip, index) => pip.classList.toggle('on', index < round.level - 1));
    }
    const label = $('wordProgressLabel');
    if (label) label.textContent = 'LV ' + round.level + '/' + LEVELS;
  }

  /* deal the next level: a fresh 7x6 board - the same grid the game always
     had - with its own seven hidden words, plus the dictionary words that
     trace through it for the bots to hunt */
  function dealLevel() {
    round.layout = createWordGrid(WORD_BANK);
    round.found = new Set();
    round.foundPaths = [];
    round.scored = new Set();
    round.traceable = [...wordsByLength(WORD_BANK, 2, 10).values()].flat()
      .map(word => ({ word, path: findWordPath(round.layout, word) }))
      .filter(item => item.path);
    buildLevelRail();
    buildGrid();
    renderSlots();
    renderPath();
    $('roundLabel').textContent = String(round.level).padStart(2, '0');
    $('roundMessage').textContent = 'Level ' + round.level + ' of ' + LEVELS + ' - hidden words pay 100 coins a letter, and so does any dictionary word you can trace.';
  }

  function resetRound() {
    /* presentation only: a celebration still in flight belongs to the board being
       replaced. Without this its letters keep floating over the new grid at the
       old coordinates until their own timers expire. */
    window.__champCoins?.cancel?.();
    window.clearTimeout(resultReveal);
    resultReveal = 0;
    stopTurns();
    document.querySelectorAll('.gwx-seat').forEach(seat => { seat.classList.remove('active'); seat.style.removeProperty('--turn-pct'); });
    $('resultModal').classList.remove('open');
    $('resultModal').setAttribute('aria-hidden', 'true');
    $('guessInput').value = '';
    $('guessMessage').classList.remove('good', 'bad');
    $('guessMessage').textContent = '30 levels, 15 seconds a turn, clockwise. Hidden words pay 100 coins a letter.';
    $('roundMessage').textContent = 'Everyone starts on ' + START_COINS.toLocaleString('en-US') + ' coins. A correct word earns 100 coins per letter.';
    path = [];
    round = {
      level: 1,
      layout: null,
      found: new Set(),
      foundPaths: [],
      scored: new Set(),
      traceable: [],
      scores: Object.fromEntries(PLAYERS.map(player => [player.id, { coins: START_COINS, words: 0 }])),
      ended: false
    };
    dealLevel();
    renderScores();
    applyBotFx();
    passStreak = 0;
    turnState = { index: 0, endsAt: 0, tick: 0, botTimer: 0 };
    startTurn();
  }

  $('guessForm').addEventListener('submit', event => {
    event.preventDefault();
    /* No cue here: a word that lands is thrown into the grid by the
       celebration itself, which owns that beat and would otherwise double this
       one up. A word that misses never reaches the grid, so it is silent. */
    submitGuess($('guessInput').value, turnState ? TURN_ORDER[turnState.index] : 'champ');
  });
  $('guessInput').addEventListener('input', () => {
    path = [];
    renderPath();
  });
  $('restartBtn').addEventListener('click', resetRound);
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
  function showChampReaction(value, isEmoji = false) {
    reaction.textContent = value;
    reaction.classList.toggle('emoji-reaction', isEmoji);
    reaction.classList.add('visible');
    clearTimeout(reactionTimer);
    reactionTimer = window.setTimeout(() => reaction.classList.remove('visible'), 2200);
    closeSocialMenus();
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
  emojiMenu.addEventListener('click', event => {
    const button = event.target.closest('[data-emoji]');
    if (button) showChampReaction(button.dataset.emoji, true);
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
      words: round.layout.words.map(item => item.word), found: [...round.found],
      level: round.level, levels: LEVELS,
      scores: structuredClone(round.scores),
      active: turnState ? TURN_ORDER[turnState.index] : null,
      secondsLeft: turnState ? Math.max(0, Math.round((turnState.endsAt - performance.now()) / 1000)) : 0,
      ended: round.ended
    }),
    guess: (word, player = 'champ') => submitGuess(word, player),
    gift: (toId, id) => sendGift('champ', toId, GIFTS.find(g => g.id === id || g.art === id || g.name.toUpperCase() === String(id || '').toUpperCase())),
    setTurnSpeed: ms => { turnMs = Math.max(400, Math.min(TURN_MS, Number(ms) || TURN_MS)); },
    skipToLevel: n => { if (round && !round.ended) { round.level = Math.max(1, Math.min(LEVELS, Number(n) || 1)); dealLevel(); } },
    reset: resetRound
  };
})();

