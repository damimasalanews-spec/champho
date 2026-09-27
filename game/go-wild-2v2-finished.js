import { WORD_BANK } from './nepali-roman-word-bank.js';
import { resolveLetterCapture } from './letter-bumper-rules.js';

(() => {
  'use strict';

  const WORLD_W = 800;
  const WORLD_H = 500;
  const SHEAR_X = 0.22;
  const SHEAR_Y = 0.12;
  const RADIUS = 23;
  const ZONE_DEPTH = 27;
  const $ = id => document.getElementById(id);
  const canvas = $('letterCanvas');
  const ctx = canvas.getContext('2d');
  const players = [
    { id: 'poker', name: 'Poker', edge: 'north', team: 'A', color: '#00e89a', rack: [], score: 0 },
    { id: 'kalkal', name: 'Kalkal', edge: 'west', team: 'B', color: '#ffae13', rack: [], score: 0 },
    { id: 'champ', name: 'Champ', edge: 'south', team: 'A', color: '#ff2c7d', rack: [], score: 0 },
    { id: 'jess', name: 'Jess', edge: 'east', team: 'B', color: '#b248c3', rack: [], score: 0 }
  ];
  const byId = Object.fromEntries(players.map(player => [player.id, player]));
  const letterPool = Array.from(WORD_BANK.join('').toUpperCase().match(/[A-Z]/g) || []);
  const bots = players.filter(player => player.id !== 'champ');
  let letters = [];
  let pendingSpawns = [];
  let floaters = [];
  let selected = null;
  let pointerTrail = [];
  let pointerId = null;
  let view = { width: 0, height: 0, scale: 1, dpr: 1 };
  let running = false;
  let startedAt = 0;
  let remaining = 45;
  let previousFrame = 0;
  let frameId = 0;
  let nextAi = {};
  let messageUntil = 0;

  function randomBetween(min, max) { return min + Math.random() * (max - min); }
  function randomLetter() { return letterPool[Math.floor(Math.random() * letterPool.length)] || 'A'; }
  function randomSpeed() {
    const angle = Math.random() * Math.PI * 2;
    const speed = randomBetween(95, 185);
    return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
  }
  function makeLetter(x, y) {
    const velocity = randomSpeed();
    return { id: Math.random().toString(36).slice(2), value: randomLetter(), x: x ?? randomBetween(70, WORLD_W - 70), y: y ?? randomBetween(65, WORLD_H - 65), vx: velocity.vx, vy: velocity.vy, angle: randomBetween(-0.18, 0.18), spin: randomBetween(-1.4, 1.4), radius: RADIUS };
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    view.width = rect.width;
    view.height = rect.height;
    view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * view.dpr));
    canvas.height = Math.max(1, Math.round(rect.height * view.dpr));
    const boundsW = WORLD_W + SHEAR_X * WORLD_H + 76;
    const boundsH = WORLD_H + SHEAR_Y * WORLD_W + 84;
    view.scale = Math.max(0.2, Math.min((rect.width - 30) / boundsW, (rect.height - 30) / boundsH));
  }

  function screenToWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const dx = (clientX - rect.left - view.width / 2) / view.scale;
    const dy = (clientY - rect.top - view.height / 2) / view.scale;
    const det = 1 - SHEAR_X * SHEAR_Y;
    return {
      x: WORLD_W / 2 + (dx - SHEAR_X * dy) / det,
      y: WORLD_H / 2 + (dy - SHEAR_Y * dx) / det
    };
  }

  function beginWorldTransform() {
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.translate(view.width / 2, view.height / 2);
    ctx.scale(view.scale, view.scale);
    ctx.transform(1, SHEAR_Y, SHEAR_X, 1, 0, 0);
    ctx.translate(-WORLD_W / 2, -WORLD_H / 2);
  }

  function drawTable() {
    ctx.save();
    ctx.shadowColor = '#000a';
    ctx.shadowBlur = 32;
    ctx.shadowOffsetY = 18;
    ctx.fillStyle = '#081726';
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    ctx.restore();

    const surface = ctx.createLinearGradient(0, 0, WORLD_W, WORLD_H);
    surface.addColorStop(0, '#0b1a2a');
    surface.addColorStop(0.52, '#0c1727');
    surface.addColorStop(1, '#091321');
    ctx.fillStyle = surface;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, WORLD_W, WORLD_H);
    ctx.clip();
    ctx.strokeStyle = '#20507036';
    ctx.lineWidth = 1;
    for (let x = 42; x < WORLD_W; x += 72) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD_H); ctx.stroke();
    }
    for (let y = 42; y < WORLD_H; y += 68) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD_W, y); ctx.stroke();
    }
    ctx.restore();

    ctx.strokeStyle = '#08d8e5';
    ctx.lineWidth = 4;
    ctx.strokeRect(1, 1, WORLD_W - 2, WORLD_H - 2);
    ctx.strokeStyle = '#0a8ca566';
    ctx.lineWidth = 1;
    ctx.strokeRect(17, 17, WORLD_W - 34, WORLD_H - 34);
    drawZone('north', 0.29, 0.71);
    drawZone('south', 0.29, 0.71);
    drawZone('west', 0.29, 0.71);
    drawZone('east', 0.29, 0.71);
    drawTimer();
    drawZoneLabel(byId.poker, WORLD_W / 2, 41, 'center');
    drawZoneLabel(byId.champ, WORLD_W / 2, WORLD_H - 39, 'center');
    drawZoneLabel(byId.kalkal, 48, WORLD_H / 2, 'left');
    drawZoneLabel(byId.jess, WORLD_W - 48, WORLD_H / 2, 'right');
  }

  function drawZone(edge, from, to) {
    const player = players.find(item => item.edge === edge);
    const color = player.color;
    ctx.save();
    ctx.lineCap = 'square';
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 13;
    ctx.lineWidth = 8;
    ctx.beginPath();
    if (edge === 'north' || edge === 'south') {
      const y = edge === 'north' ? 2 : WORLD_H - 2;
      ctx.moveTo(WORLD_W * from, y); ctx.lineTo(WORLD_W * to, y);
    } else {
      const x = edge === 'west' ? 2 : WORLD_W - 2;
      ctx.moveTo(x, WORLD_H * from); ctx.lineTo(x, WORLD_H * to);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.setLineDash([9, 7]);
    ctx.globalAlpha = 0.82;
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (edge === 'north') { ctx.moveTo(WORLD_W * from, 40); ctx.lineTo(WORLD_W * to, 40); }
    if (edge === 'south') { ctx.moveTo(WORLD_W * from, WORLD_H - 40); ctx.lineTo(WORLD_W * to, WORLD_H - 40); }
    if (edge === 'west') { ctx.moveTo(40, WORLD_H * from); ctx.lineTo(40, WORLD_H * to); }
    if (edge === 'east') { ctx.moveTo(WORLD_W - 40, WORLD_H * from); ctx.lineTo(WORLD_W - 40, WORLD_H * to); }
    ctx.stroke();
    ctx.restore();
  }

  function drawZoneLabel(player, x, y, align) {
    ctx.save();
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.font = '900 12px Inter, system-ui, sans-serif';
    ctx.fillStyle = player.color;
    const text = player.id === 'champ' ? 'P1  CHAMP · SOUTH' : player.id === 'poker' ? 'P3  POKER · NORTH' : player.id === 'kalkal' ? 'P2  KALKAL · WEST' : 'P4  JESS · EAST';
    if (player.edge === 'north') y = -23;
    if (player.edge === 'south') y = WORLD_H + 23;
    if (player.edge === 'west') { x = -25; ctx.translate(x, y); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText(text, 0, 0); ctx.restore(); return; }
    if (player.edge === 'east') { x = WORLD_W + 25; ctx.translate(x, y); ctx.rotate(Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText(text, 0, 0); ctx.restore(); return; }
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function drawTimer() {
    const x = WORLD_W / 2, y = WORLD_H / 2, seconds = Math.max(0, Math.ceil(remaining));
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, 82, 0, Math.PI * 2);
    ctx.setLineDash([2, 5]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#08d8e5';
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f8fbff';
    ctx.font = '1000 40px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0'), x, y + 2);
    ctx.fillStyle = '#6e9bb1';
    ctx.font = '900 9px Inter, system-ui, sans-serif';
    ctx.fillText('ROUND TIMER', x, y + 49);
    ctx.restore();
  }

  function drawLetters() {
    for (const letter of letters) {
      ctx.save();
      ctx.translate(letter.x, letter.y);
      ctx.rotate(letter.angle);
      ctx.shadowColor = letter.dragging ? '#08d8e5aa' : '#000c';
      ctx.shadowBlur = letter.dragging ? 28 : 13;
      ctx.shadowOffsetY = letter.dragging ? 4 : 8;
      const fill = ctx.createRadialGradient(-8, -11, 2, 0, 0, letter.radius + 7);
      fill.addColorStop(0, letter.dragging ? '#eaffff' : '#f9fcff');
      fill.addColorStop(0.28, letter.dragging ? '#7befff' : '#b8cce0');
      fill.addColorStop(1, '#59758e');
      ctx.beginPath();
      ctx.arc(0, 0, letter.radius, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffffb8';
      ctx.stroke();
      ctx.fillStyle = '#07121e';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '1000 30px Inter, system-ui, sans-serif';
      ctx.fillText(letter.value, 0, 1);
      ctx.restore();
    }
  }

  function drawFloaters(now) {
    floaters = floaters.filter(item => item.until > now);
    for (const item of floaters) {
      const alpha = Math.min(1, (item.until - now) / 500);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.textAlign = 'center';
      ctx.font = '1000 15px Inter, system-ui, sans-serif';
      ctx.fillStyle = item.color;
      ctx.shadowColor = '#07101ddd';
      ctx.shadowBlur = 8;
      ctx.fillText(item.text, item.x, item.y - (1 - alpha) * 18);
      ctx.restore();
    }
  }

  function draw(now) {
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.clearRect(0, 0, view.width, view.height);
    beginWorldTransform();
    drawTable();
    drawLetters();
    drawFloaters(now);
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  }

  function goalFor(player) {
    if (player.edge === 'north') return { x: WORLD_W / 2, y: -20 };
    if (player.edge === 'south') return { x: WORLD_W / 2, y: WORLD_H + 20 };
    if (player.edge === 'west') return { x: -20, y: WORLD_H / 2 };
    return { x: WORLD_W + 20, y: WORLD_H / 2 };
  }

  function captureZone(letter) {
    const x = letter.x, y = letter.y, r = letter.radius;
    const lowX = WORLD_W * 0.29, highX = WORLD_W * 0.71;
    const lowY = WORLD_H * 0.29, highY = WORLD_H * 0.71;
    if (y - r <= 0 && x >= lowX && x <= highX) return byId.poker;
    if (y + r >= WORLD_H && x >= lowX && x <= highX) return byId.champ;
    if (x - r <= 0 && y >= lowY && y <= highY) return byId.kalkal;
    if (x + r >= WORLD_W && y >= lowY && y <= highY) return byId.jess;
    return null;
  }

  function renderHud() {
    for (const player of players) {
      $('score-' + player.id).textContent = String(player.score);
      const rack = $('rack-' + player.id);
      rack.replaceChildren();
      if (!player.rack.length) {
        const empty = document.createElement('span');
        empty.className = 'rack-empty';
        empty.textContent = 'Catch letters to build a word';
        rack.appendChild(empty);
        continue;
      }
      player.rack.slice(0, 12).forEach(letter => {
        const tile = document.createElement('span');
        tile.className = 'rack-letter';
        tile.textContent = letter;
        rack.appendChild(tile);
      });
      if (player.rack.length > 12) {
        const more = document.createElement('span');
        more.className = 'rack-more';
        more.textContent = '+' + (player.rack.length - 12);
        rack.appendChild(more);
      }
    }
  }

  function captureLetter(player, letter, now) {
    const result = resolveLetterCapture(player.rack, letter.value, WORD_BANK);
    player.rack = result.rack;
    if (result.word) {
      player.score += 1;
      const word = result.word.toUpperCase();
      const team = player.team === 'A' ? 'TEAM A' : 'TEAM B';
      $('roundCallout').textContent = player.name.toUpperCase() + ' MADE “' + word + '” · ' + team + ' +1';
      messageUntil = now + 2200;
      floaters.push({ text: word, x: WORLD_W / 2, y: WORLD_H / 2 - 94, color: player.color, until: now + 1200 });
    } else {
      $('roundCallout').textContent = player.name + ' caught ' + letter.value + ' · keep collecting letters.';
      messageUntil = now + 1500;
    }
    renderHud();
  }

  function applyAiFlicks(now) {
    for (const player of bots) {
      if (now < nextAi[player.id]) continue;
      const candidates = letters.filter(letter => letter !== selected);
      if (candidates.length) {
        const target = goalFor(player);
        candidates.sort((a, b) => {
          const da = (a.x - target.x) ** 2 + (a.y - target.y) ** 2;
          const db = (b.x - target.x) ** 2 + (b.y - target.y) ** 2;
          return da - db;
        });
        const letter = candidates[Math.floor(Math.random() * Math.min(4, candidates.length))];
        const dx = target.x - letter.x, dy = target.y - letter.y;
        const length = Math.max(1, Math.hypot(dx, dy));
        const spread = randomBetween(-0.18, 0.18);
        const angle = Math.atan2(dy, dx) + spread;
        const speed = randomBetween(285, 410);
        letter.vx = Math.cos(angle) * speed;
        letter.vy = Math.sin(angle) * speed;
        letter.spin = randomBetween(-2.2, 2.2);
      }
      nextAi[player.id] = now + randomBetween(700, 1350);
    }
  }

  function updatePhysics(dt, now) {
    applyAiFlicks(now);
    for (const letter of [...letters]) {
      if (letter === selected) continue;
      letter.x += letter.vx * dt;
      letter.y += letter.vy * dt;
      letter.angle += letter.spin * dt;
      const zone = captureZone(letter);
      if (zone) {
        letters.splice(letters.indexOf(letter), 1);
        captureLetter(zone, letter, now);
        pendingSpawns.push(now + 340);
        continue;
      }
      const r = letter.radius;
      if (letter.x < r) { letter.x = r; letter.vx = Math.abs(letter.vx); }
      else if (letter.x > WORLD_W - r) { letter.x = WORLD_W - r; letter.vx = -Math.abs(letter.vx); }
      if (letter.y < r) { letter.y = r; letter.vy = Math.abs(letter.vy); }
      else if (letter.y > WORLD_H - r) { letter.y = WORLD_H - r; letter.vy = -Math.abs(letter.vy); }
    }

    for (let i = 0; i < letters.length; i++) {
      const a = letters[i];
      if (a === selected) continue;
      for (let j = i + 1; j < letters.length; j++) {
        const b = letters[j];
        if (b === selected) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const distance = Math.max(0.01, Math.hypot(dx, dy));
        const minDistance = a.radius + b.radius;
        if (distance >= minDistance) continue;
        const nx = dx / distance, ny = dy / distance;
        const overlap = minDistance - distance;
        a.x -= nx * overlap / 2; a.y -= ny * overlap / 2;
        b.x += nx * overlap / 2; b.y += ny * overlap / 2;
        const relative = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (relative < 0) {
          a.vx += relative * nx; a.vy += relative * ny;
          b.vx -= relative * nx; b.vy -= relative * ny;
        }
      }
    }
    while (pendingSpawns.length && pendingSpawns[0] <= now) {
      pendingSpawns.shift();
      letters.push(makeLetter());
    }
  }

  function finishRound() {
    running = false;
    const scoreA = players.filter(player => player.team === 'A').reduce((sum, player) => sum + player.score, 0);
    const scoreB = players.filter(player => player.team === 'B').reduce((sum, player) => sum + player.score, 0);
    $('resultTitle').textContent = scoreA === scoreB ? 'IT’S A TIE' : scoreA > scoreB ? 'TEAM A WINS' : 'TEAM B WINS';
    $('resultText').textContent = 'Team A ' + scoreA + ' · Team B ' + scoreB + '.';
    $('gameOver').classList.add('open');
    $('gameOver').setAttribute('aria-hidden', 'false');
    $('roundCallout').textContent = 'Round over · play again to start a new bumper match.';
  }

  function frame(now) {
    if (!running) { draw(now); return; }
    const dt = Math.min(0.035, Math.max(0.001, (now - (previousFrame || now)) / 1000));
    previousFrame = now;
    remaining = Math.max(0, 45 - (now - startedAt) / 1000);
    updatePhysics(dt, now);
    draw(now);
    if (remaining <= 0) finishRound();
    else frameId = requestAnimationFrame(frame);
  }

  function resetRound() {
    cancelAnimationFrame(frameId);
    letters = [];
    pendingSpawns = [];
    floaters = [];
    selected = null;
    pointerId = null;
    players.forEach(player => { player.rack = []; player.score = 0; });
    for (let i = 0; i < 12; i++) {
      let x, y, attempts = 0;
      do { x = randomBetween(65, WORLD_W - 65); y = randomBetween(55, WORLD_H - 55); attempts++; }
      while (Math.hypot(x - WORLD_W / 2, y - WORLD_H / 2) < 105 && attempts < 40);
      letters.push(makeLetter(x, y));
    }
    remaining = 45;
    startedAt = performance.now();
    previousFrame = 0;
    const now = performance.now();
    bots.forEach((player, index) => { nextAi[player.id] = now + 350 + index * 280; });
    $('gameOver').classList.remove('open');
    $('gameOver').setAttribute('aria-hidden', 'true');
    $('roundCallout').textContent = 'Drag a letter, then flick it toward a player zone.';
    renderHud();
    running = true;
    frameId = requestAnimationFrame(frame);
  }

  function clampSpeed(value, max) { return Math.max(-max, Math.min(max, value)); }
  function pointerDown(event) {
    if (!running) return;
    const point = screenToWorld(event.clientX, event.clientY);
    let best = null, distance = Infinity;
    for (const letter of letters) {
      const d = Math.hypot(point.x - letter.x, point.y - letter.y);
      if (d < letter.radius + 12 && d < distance) { best = letter; distance = d; }
    }
    if (!best) return;
    event.preventDefault();
    selected = best;
    selected.dragging = true;
    selected.vx = 0; selected.vy = 0;
    pointerId = event.pointerId;
    pointerTrail = [{ x: point.x, y: point.y, time: performance.now() }];
    canvas.setPointerCapture(pointerId);
    $('roundCallout').textContent = 'Flick toward your SOUTH zone or send a letter across the table.';
  }
  function pointerMove(event) {
    if (!selected || event.pointerId !== pointerId) return;
    event.preventDefault();
    const point = screenToWorld(event.clientX, event.clientY);
    selected.x = Math.max(selected.radius, Math.min(WORLD_W - selected.radius, point.x));
    selected.y = Math.max(selected.radius, Math.min(WORLD_H - selected.radius, point.y));
    selected.angle += 0.03;
    pointerTrail.push({ x: selected.x, y: selected.y, time: performance.now() });
    if (pointerTrail.length > 3) pointerTrail.shift();
  }
  function pointerUp(event) {
    if (!selected || event.pointerId !== pointerId) return;
    const point = screenToWorld(event.clientX, event.clientY);
    pointerTrail.push({ x: point.x, y: point.y, time: performance.now() });
    const end = pointerTrail[pointerTrail.length - 1];
    const start = pointerTrail[Math.max(0, pointerTrail.length - 2)];
    const elapsed = Math.max(0.016, (end.time - start.time) / 1000);
    let vx = (end.x - start.x) / elapsed;
    let vy = (end.y - start.y) / elapsed;
    const speed = Math.hypot(vx, vy);
    if (speed < 75 && pointerTrail.length > 1) {
      const origin = pointerTrail[0];
      const totalTime = Math.max(0.12, (end.time - origin.time) / 1000);
      vx = (end.x - origin.x) / totalTime;
      vy = (end.y - origin.y) / totalTime;
    }
    selected.vx = clampSpeed(vx, 620);
    selected.vy = clampSpeed(vy, 620);
    if (Math.hypot(selected.vx, selected.vy) < 70) {
      const velocity = randomSpeed();
      selected.vx = velocity.vx;
      selected.vy = velocity.vy;
    }
    selected.dragging = false;
    selected.spin = clampSpeed(selected.vx / 180, 3);
    selected = null;
    pointerId = null;
  }

  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', pointerUp);
  $('restartBtn').addEventListener('click', resetRound);
  $('playAgainBtn').addEventListener('click', resetRound);
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
  renderHud();
  resetRound();

  window.__champLetterBumper = {
    reset: resetRound,
    state: () => ({ remaining, letters: letters.map(letter => ({ value: letter.value, x: letter.x, y: letter.y })), players: players.map(player => ({ id: player.id, rack: [...player.rack], score: player.score })) })
  };
})();

