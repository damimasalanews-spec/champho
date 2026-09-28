import { WORD_BANK } from './nepali-roman-word-bank.js';
import { createWordGrid, normalizeGuess, scoreWord } from './word-grid-rules.js';

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
      tile.setAttribute('aria-label', `Letter ${letter.toUpperCase()}, row ${Math.floor(index / 6) + 1}, column ${index % 6 + 1}`);
      tile.style.animationDelay = `${(index % 6) * 32 + Math.floor(index / 6) * 22}ms`;
      tile.dataset.index = String(index);
      tile.addEventListener('click', () => selectCell(index));
      gridEl.appendChild(tile);
      tiles.push(tile);
    });
  }

  function renderSlots() {
    const host = $('wordSlots');
    host.replaceChildren();
    round.layout.words.slice().sort((a, b) => a.word.length - b.word.length).forEach(target => {
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
  }

  function renderPath() {
    tiles.forEach((tile, index) => {
      tile.classList.toggle('selected', path.includes(index));
      tile.classList.toggle('found', round.foundPaths.some(foundPath => foundPath.includes(index)));
    });
    const value = path.map(index => round.layout.grid[index]).join('').toUpperCase();
    $('selectedLetters').textContent = value || '—';
    if (path.length) $('guessInput').value = value.toLowerCase();
  }

  function isNeighbor(a, b) {
    const rowA = Math.floor(a / 6), colA = a % 6;
    const rowB = Math.floor(b / 6), colB = b % 6;
    return Math.max(Math.abs(rowA - rowB), Math.abs(colA - colB)) === 1;
  }

  function selectCell(index) {
    if (!round || round.ended) return;
    const current = path.indexOf(index);
    if (current >= 0) path = path.slice(0, current);
    else if (!path.length || isNeighbor(path[path.length - 1], index)) path.push(index);
    else path = [index];
    $('guessMessage').textContent = path.length ? 'Keep tracing, then press GUESS.' : 'Any player can guess, in any order.';
    $('guessMessage').className = '';
    renderPath();
  }

  function flashMessage(text, kind = '') {
    $('guessMessage').textContent = text;
    $('guessMessage').className = kind;
    $('roundMessage').textContent = text;
  }

  function animateCoins(playerId, coins, word) {
    const panel = document.querySelector(`[data-player="${playerId}"]`);
    panel?.classList.remove('just-scored');
    requestAnimationFrame(() => panel?.classList.add('just-scored'));
    const floater = document.createElement('div');
    floater.className = 'coin-floater';
    floater.textContent = `+${coins} ✦`;
    panel?.appendChild(floater);
    window.setTimeout(() => floater.remove(), 1250);
    $('roundMessage').textContent = `${PLAYERS.find(item => item.id === playerId).name} found ${word.toUpperCase()} · +${coins} coins!`;
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
    $('guessMessage').className = 'good';
    $('guessMessage').textContent = `${result.word.toUpperCase()} found! +${result.coins} coins to ${PLAYERS.find(item => item.id === playerId).name}.`;
    renderSlots();
    renderScores();
    renderPath();
    animateCoins(playerId, result.coins, result.word);
    if (round.found.size === round.layout.words.length) finishRound('all-found');
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

  function finishRound(reason) {
    if (!round || round.ended) return;
    round.ended = true;
    window.clearInterval(timer);
    botTimers.forEach(id => window.clearTimeout(id));
    const totals = { A: 0, B: 0 };
    PLAYERS.forEach(player => { totals[player.team] += round.scores[player.id].coins; });
    const winner = totals.A === totals.B ? null : totals.A > totals.B ? 'A' : 'B';
    $('resultTitle').textContent = winner ? `TEAM ${winner} WINS` : 'IT’S A TIE';
    $('resultText').textContent = `Team A ${totals.A} coins · Team B ${totals.B} coins. ${reason === 'all-found' ? 'All seven words found!' : `${round.found.size} of 7 words found.`}`;
    $('resultModal').classList.add('open');
    $('resultModal').setAttribute('aria-hidden', 'false');
  }

  function updateTimer() {
    const minutes = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
    const seconds = String(secondsLeft % 60).padStart(2, '0');
    $('timer').textContent = `${minutes}:${seconds}`;
  }

  function resetRound() {
    window.clearInterval(timer);
    botTimers.forEach(id => window.clearTimeout(id));
    $('resultModal').classList.remove('open');
    $('resultModal').setAttribute('aria-hidden', 'true');
    $('guessInput').value = '';
    $('guessMessage').className = '';
    $('guessMessage').textContent = 'Any player can guess, in any order.';
    $('roundMessage').textContent = 'A correct word earns 100 coins per letter.';
    path = [];
    round = {
      layout: createWordGrid(WORD_BANK),
      found: new Set(),
      foundPaths: [],
      scores: Object.fromEntries(PLAYERS.map(player => [player.id, { coins: 0, words: 0 }])),
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
  $('clearPathBtn').addEventListener('click', () => {
    path = [];
    $('guessInput').value = '';
    renderPath();
    $('guessMessage').textContent = 'Any player can guess, in any order.';
    $('guessMessage').className = '';
  });
  $('restartBtn').addEventListener('click', resetRound);
  $('playAgainBtn').addEventListener('click', resetRound);
  resetRound();

  window.__champWordGrid = {
    state: () => ({ grid: [...round.layout.grid], words: round.layout.words.map(item => item.word), found: [...round.found], scores: structuredClone(round.scores), secondsLeft, ended: round.ended }),
    guess: (word, player = 'champ') => submitGuess(word, player),
    reset: resetRound
  };
})();
