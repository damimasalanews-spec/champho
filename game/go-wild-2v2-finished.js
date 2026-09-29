import { WORD_BANK } from './english-word-bank.js?v=coins-11';
import { createWordGrid, normalizeGuess, scoreWord, COLS } from './word-grid-rules.js?v=coins-12';

(() => {
  'use strict';
  const PLAYERS = [
    { id: 'champ', name: 'Champ', team: 'A', color: '#50e8ef' },
    { id: 'poker', name: 'Poker', team: 'A', color: '#54a8ff' },
    { id: 'kalkal', name: 'Kalkal', team: 'B', color: '#bd78ff' },
    { id: 'jess', name: 'Jess', team: 'B', color: '#ff9b59' }
  ];
  const BOT_IDS = ['poker', 'kalkal', 'jess'];
  const $ = id => document.getElementById(id);
  const gridEl = $('letterGrid');
  const tiles = [];
  let round = null;
  let timer = null;
  let botTimers = [];
  let resultReveal = 0;   /* pending reveal of the round-end modal */
  let secondsLeft = 120;
  let path = [];

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
    round.layout.grid.forEach((letter, index) => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'letter-tile';
      tile.setAttribute('role', 'gridcell');
      tile.textContent = letter.toUpperCase();
      tile.setAttribute('aria-label', `Letter ${letter.toUpperCase()}, row ${Math.floor(index / COLS) + 1}, column ${index % COLS + 1}`);
      tile.style.animationDelay = `${(index % COLS) * 32 + Math.floor(index / COLS) * 22}ms`;
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
    const progress = Math.round(round.found.size / targets.length * 100);
    const progressBar = $('wordProgress');
    const progressTrack = progressBar?.parentElement;
    if (progressBar) progressBar.style.width = `${progress}%`;
    if (progressTrack) progressTrack.setAttribute('aria-valuenow', String(round.found.size));
    const progressLabel = $('wordProgressLabel');
    if (progressLabel) progressLabel.textContent = `${round.found.size} / ${targets.length}`;
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

  /* Every seat opens the round with a stake already in it, so the post-match
     wall push always has something to play for - a player who finds no words
     would otherwise hold nothing and the payout would be nothing. */
  const START_COINS = 500;

  function renderScores() {
    for (const player of PLAYERS) {
      const score = round.scores[player.id];
      $(`coins-${player.id}`).textContent = String(score.coins);
      $(`words-${player.id}`).textContent = `${score.words} ${score.words === 1 ? 'word' : 'words'}`;
    }
    const teams = { A: 0, B: 0 };
    PLAYERS.forEach(player => { teams[player.team] += round.scores[player.id].coins; });
    $('teamCoinsA').textContent = String(teams.A);
    $('teamCoinsB').textContent = String(teams.B);
    const totalCoins = $('totalCoins');
    if (totalCoins) totalCoins.textContent = String(teams.A + teams.B);
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
      const team = document.createElement('small');
      team.textContent = `TEAM ${player.team}`;
      identity.append(name, team);
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
    const rowA = Math.floor(a / COLS), colA = a % COLS;
    const rowB = Math.floor(b / COLS), colB = b % COLS;
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
    if (!round || round.ended) return false;
    const result = scoreWord(round.layout.words, value, round.found, playerId);
    if (!result) {
      const normalized = normalizeGuess(value);
      const known = round.layout.words.some(item => item.word === normalized);
      flashMessage(!normalized ? 'Choose letters or type a word first.' : known ? 'That word has already been found.' : 'Not one of the hidden words. Try another path.', 'bad');
      return false;
    }
    round.found.add(result.word);
    const target = round.layout.words.find(item => item.word === result.word);
    round.foundPaths.push(target.path);
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
    const revealAfter = animateCoins(playerId, result.coins, result.word, target.path);
    if (round.found.size === round.layout.words.length) finishRound('all-found', revealAfter);
    return true;
  }

  function scheduleBots() {
    botTimers.forEach(id => window.clearTimeout(id));
    botTimers = [];
    if (!round || round.ended) return;
    const open = round.layout.words.filter(item => !round.found.has(item.word));
    if (!open.length) return;
    const playerId = BOT_IDS[Math.floor(Math.random() * BOT_IDS.length)];
    const target = open[Math.floor(Math.random() * open.length)];
    const delay = 8500 + Math.random() * 15500;
    botTimers.push(window.setTimeout(() => {
      if (round && !round.ended) {
        if (submitGuess(target.word, playerId)) scheduleBots();
        else scheduleBots();
      }
    }, delay));
  }

  function finishRound(reason, wait = 0) {
    if (!round || round.ended) return;
    round.ended = true;
    window.clearInterval(timer);
    botTimers.forEach(id => window.clearTimeout(id));
    const totals = { A: 0, B: 0 };
    PLAYERS.forEach(player => { totals[player.team] += round.scores[player.id].coins; });
    const winner = totals.A === totals.B ? null : totals.A > totals.B ? 'A' : 'B';
    $('resultTitle').textContent = winner ? `TEAM ${winner} WINS` : 'IT’S A TIE';
    $('resultText').textContent = `Team A ${totals.A} coins · Team B ${totals.B} coins. ${reason === 'all-found' ? `All ${round.layout.words.length} words found!` : `${round.found.size} of ${round.layout.words.length} words found.`}`;
    /* The round normally ends on the word that was just found, so its celebration
       is still on screen. Hold the modal - and the cascade - back until that
       celebration has landed its coins, or the player never sees the word that
       won them the round: it plays behind the blur. A clock expiry has no
       celebration, so wait is 0 and the modal opens at once. */
    const showResult = () => {
      resultReveal = 0;
      if (!round) return;
      $('resultModal').classList.add('open');
      $('resultModal').setAttribute('aria-hidden', 'false');
      /* presentation only: the round-win cascade, once per round, obeying the mute toggle */
      window.__champCoins?.winStinger?.();
    };

    /* ---- WALL PUSH --------------------------------------------------------
       The series runs BEFORE the result card: TOP 1 vs TOP 2, then TOP 3 vs
       TOP 4. `wait` has already delayed us past the word celebration, so the
       duel also lands after it rather than on top of it.

       Ranking comes from the round scores that are already on screen - coins
       first, words as the tiebreak. The stake is each seat's displayed coin
       count, so the numbers in the duel are real in-game numbers rather than
       invented ones.

       The stake rule is the one the game asked for, and it is symmetric: the
       loser pays their OWN balance. So when TOP 1 wins he takes everything TOP 2
       holds, and when TOP 2 wins he doubles - TOP 1 funds exactly TOP 2's
       balance, capped by what TOP 1 actually has. settle() already does this.

       The duel DISPLAYS the settlement and deliberately writes to no balance:
       this game's coins are per-round scores, and treating them as a persistent
       wallet is a game-design decision, not an animation one. */
    /* The wall push settles in real coins. The winner takes the loser's stake and
     the loser keeps whatever the winner's balance could not reach, so a 1,500
     against 1,300 ends either 2,800 to nil or 2,600 to 200 - never below zero,
     which is why nothing here needs a floor. This module owns the scores, so the
     transfer lands here and the standings behind the animation redraw at once. */
  function settleStake(s) {
    if (!round || !s) return;
    const win = round.scores[s.winnerId], lose = round.scores[s.loserId];
    if (!win || !lose) return;
    win.coins += s.paid;
    lose.coins -= s.paid;
    renderScores();
  }

  const reveal = () => {
      if (!round) { showResult(); return; }
      const wp = window.ChampWallPush;
      const guess = window.ChampWallGuess;
      const canPush = !!wp && typeof wp.play === 'function';
      const canContest = !!guess && typeof guess.play === 'function';
      if (!canPush && !canContest) { showResult(); return; }
      const ranked = [...PLAYERS].sort((a, b) => {
        const sa = round.scores[a.id], sb = round.scores[b.id];
        return (sb.coins - sa.coins) || (sb.words - sa.words);
      });
      const side = p => ({
        name: p.name,
        coins: round.scores[p.id].coins,
        team: p.team === 'A' ? 'TEAM WILD' : 'TEAM FLAME',
        id: p.id,
        key: (p.id === 'jess' || p.id === 'champ') ? 'boy' : 'girl'
      });
      const duels = [
        { rankA: 1, rankB: 2, a: side(ranked[0]), b: side(ranked[1]) },
        { rankA: 3, rankB: 4, a: side(ranked[2]), b: side(ranked[3]) }
      ];
      try {
        /* The clipart contest runs the guessing and hands each duel back WITH a
           verdict, so the post-match reel plays a duel it did not decide. Each
           side carries its player id because the contest has to know which seat
           the human answers for. If the contest module is missing this falls
           straight back to the old coin-flip push. */
        if (canContest) guess.play(duels, {
          push: canPush ? wp : null,
          /* The post-match closes on its own receipt, so a contest that ran
             does NOT open the TEAM A / TEAM B card. That card is still the
             fallback when nothing could be played at all: an empty verdict
             list means the contest bailed, and then there is nothing else. */
          onDone: function (results) { if (!results || !results.length) showResult(); },
          onSettled: settleStake
        });
        else wp.play(duels, { onDone: showResult });
      } catch (e) {
        console.warn('wall push failed, showing the result card anyway', e);
        showResult();
      }
    };
    resultReveal = wait > 0 ? window.setTimeout(reveal, wait) : 0;
    if (wait <= 0) reveal();
  }

  function updateTimer() {
    const minutes = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
    const seconds = String(secondsLeft % 60).padStart(2, '0');
    $('timer').textContent = `${minutes}:${seconds}`;
  }

  function resetRound() {
    /* presentation only: a celebration still in flight belongs to the board being
       replaced. Without this its letters keep floating over the new grid at the
       old coordinates until their own timers expire. */
    window.__champCoins?.cancel?.();
    /* an unanswered contest bot must not fire onto the next board */
    window.ChampWallGuess?.cancel?.();
    window.clearTimeout(resultReveal);
    resultReveal = 0;
    window.clearInterval(timer);
    botTimers.forEach(id => window.clearTimeout(id));
    $('resultModal').classList.remove('open');
    $('resultModal').setAttribute('aria-hidden', 'true');
    $('guessInput').value = '';
    $('guessMessage').classList.remove('good', 'bad');
    $('guessMessage').textContent = 'Any player can guess, in any order.';
    $('roundMessage').textContent = 'Everyone starts on ' + START_COINS.toLocaleString('en-US') + ' coins. A correct word earns 100 coins per letter.';
    path = [];
    round = {
      layout: createWordGrid(WORD_BANK),
      found: new Set(),
      foundPaths: [],
      scores: Object.fromEntries(PLAYERS.map(player => [player.id, { coins: START_COINS, words: 0 }])),
      ended: false
    };
    secondsLeft = 120;
    buildGrid();
    renderSlots();
    renderScores();
    renderPath();
    updateTimer();
    timer = window.setInterval(() => {
      if (!round || round.ended) return;
      secondsLeft--;
      updateTimer();
      if (secondsLeft <= 0) finishRound('time');
    }, 1000);
    scheduleBots();
  }

  $('guessForm').addEventListener('submit', event => {
    event.preventDefault();
    submitGuess($('guessInput').value, $('playerSelect').value);
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

  window.__champWordGrid = {
    state: () => ({ grid: [...round.layout.grid], words: round.layout.words.map(item => item.word), found: [...round.found], scores: structuredClone(round.scores), secondsLeft, ended: round.ended }),
    guess: (word, player = 'champ') => submitGuess(word, player),
    reset: resetRound
  };
})();

