/* Champ Word — Go Wild coin shower
   Presentation only. The game calls play(playerId, amount) after a correct
   word; this draws 50 gold coins flying from the centre of the letter grid to
   the avatar of whoever scored, and plays the sound. It reads nothing from the
   game state and writes nothing to it, so removing this file changes no rule. */
(() => {
  'use strict';

  const THROWN    = 50;                            /* always 50, whatever the word */
  const TOTAL_MS  = 2000;
  const CHARGE_MS = 120;
  const FLIGHT_MS = 460;
  const POP_MS    = 140;
  const SPAWN_MS  = TOTAL_MS - CHARGE_MS - FLIGHT_MS - POP_MS;
  const Z_INDEX   = 55;                            /* above the board (10) and the
                                                      coin floater (50), below the
                                                      chat panel (60) and modal (100) */
  const MAX_LIVE  = 220;                           /* guard against many quick scores */

  /* Reduced motion gets a still burst instead of a flight: the same coin art,
     no travel and no tumble, so a correct answer is never silently invisible. */
  const SETTLE_MS    = 1150;
  const SETTLE_COUNT = 14;

  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;

  /* ---------------------------------------------------------------- canvas */
  let canvas = null;
  let ctx = null;
  let W = 0;
  let H = 0;

  function ensureCanvas() {
    if (canvas) return !!ctx;
    canvas = document.createElement('canvas');
    canvas.className = 'gwx-coin-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
    fit();
    return !!ctx;
  }

  function fit() {
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ----------------------------------------------------------------- audio */
  let actx = null;
  let muted = false;
  let lastChime = 0;

  function audio() {
    if (muted) return null;
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      actx = new AC();
    }
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }

  function coinChime(vol, detune) {
    const a = audio();
    if (!a) return;
    const t = a.currentTime;
    const out = a.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.linearRampToValueAtTime(vol, t + 0.004);
    out.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    out.connect(a.destination);
    [[1568, 0.55], [2093, 0.3], [2637, 0.16]].forEach((p) => {
      const o = a.createOscillator();
      o.type = 'triangle';
      o.frequency.value = p[0] * (1 + detune);
      const g = a.createGain();
      g.gain.value = p[1];
      o.connect(g);
      g.connect(out);
      o.start(t);
      o.stop(t + 0.15);
    });
  }

  function coinClink(vol) {
    const a = audio();
    if (!a) return;
    const len = Math.floor(a.sampleRate * 0.028);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const src = a.createBufferSource();
    src.buffer = buf;
    const bp = a.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 4300;
    bp.Q.value = 1.2;
    const g = a.createGain();
    g.gain.value = vol;
    src.connect(bp);
    bp.connect(g);
    g.connect(a.destination);
    src.start();
  }

  function launchWhoosh() {
    const a = audio();
    if (!a) return;
    const len = Math.floor(a.sampleRate * 0.34);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const p = i / len;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - p, 2) * 0.5;
    }
    const src = a.createBufferSource();
    src.buffer = buf;
    const f = a.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.9;
    f.frequency.setValueAtTime(560, a.currentTime);
    f.frequency.exponentialRampToValueAtTime(2500, a.currentTime + 0.3);
    const g = a.createGain();
    g.gain.value = 0.14;
    src.connect(f);
    f.connect(g);
    g.connect(a.destination);
    src.start();
  }

  function fanfare() {
    const a = audio();
    if (!a) return;
    const t0 = a.currentTime;
    [1046, 1318, 1568, 2093].forEach((fq, i) => {
      const t = t0 + i * 0.07;
      const o = a.createOscillator();
      o.type = 'triangle';
      o.frequency.value = fq;
      const g = a.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.11, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
      o.connect(g);
      g.connect(a.destination);
      o.start(t);
      o.stop(t + 0.45);
    });
  }

  /* --------------------------------------------------------------- sprites */
  const GOLD = { rim: '#FFD84D', face: '#F5C518', deep: '#B87F0A', light: '#FFF8D6' };

  function coinSprite(s) {
    const d = 128;
    const c = document.createElement('canvas');
    c.width = d;
    c.height = d;
    const g = c.getContext('2d');
    const k = d / 2;
    const R = d / 2 - 4;

    g.beginPath(); g.arc(k, k, R, 0, Math.PI * 2); g.fillStyle = s.deep; g.fill();
    g.beginPath(); g.arc(k, k, R * 0.955, 0, Math.PI * 2); g.fillStyle = s.rim; g.fill();

    const grd = g.createRadialGradient(k - R * 0.3, k - R * 0.36, R * 0.08, k, k, R * 0.84);
    grd.addColorStop(0, s.light);
    grd.addColorStop(0.42, s.face);
    grd.addColorStop(1, s.deep);
    g.beginPath(); g.arc(k, k, R * 0.82, 0, Math.PI * 2); g.fillStyle = grd; g.fill();

    g.beginPath(); g.arc(k, k, R * 0.82, 0, Math.PI * 2);
    g.lineWidth = R * 0.055; g.strokeStyle = 'rgba(0,0,0,.14)'; g.stroke();

    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5;
      const rad = (i % 2) ? R * 0.19 : R * 0.4;
      g.lineTo(k + Math.cos(a) * rad, k + Math.sin(a) * rad);
    }
    g.closePath(); g.fillStyle = 'rgba(255,255,255,.92)'; g.fill();

    g.beginPath();
    g.arc(k - R * 0.1, k - R * 0.14, R * 0.58, Math.PI * 0.92, Math.PI * 1.58);
    g.lineWidth = R * 0.15;
    g.strokeStyle = 'rgba(255,255,255,.6)';
    g.lineCap = 'round';
    g.stroke();
    return c;
  }

  /* a soft radial blob: `inner` at the centre, transparent at the rim,
     with an optional colour stop part-way out */
  function softSprite(inner, mid, midAt) {
    const d = 64;
    const c = document.createElement('canvas');
    c.width = d;
    c.height = d;
    const g = c.getContext('2d');
    const k = d / 2;
    const grd = g.createRadialGradient(k, k, 0, k, k, k);
    grd.addColorStop(0, inner);
    if (mid) grd.addColorStop(midAt ?? 0.3, mid);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, d, d);
    return c;
  }

  const COIN = coinSprite(GOLD);
  const GLOW = (() => {
    const d = 64;
    const c = document.createElement('canvas');
    c.width = d; c.height = d;
    const g = c.getContext('2d');
    const k = d / 2;
    const grd = g.createRadialGradient(k, k, 0, k, k, k);
    grd.addColorStop(0, GOLD.light);
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, d, d);
    return c;
  })();
  const SHADOW = softSprite('rgba(24,18,4,.45)');
  const SPARK = softSprite('rgba(255,255,255,1)', 'rgba(255,255,255,.7)');

  /* the same coin, darkened, used to shade it as it turns edge-on */
  const COIN_EDGE = (() => {
    const c = document.createElement('canvas');
    c.width = COIN.width;
    c.height = COIN.height;
    const g = c.getContext('2d');
    g.drawImage(COIN, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = 'rgba(58,36,4,.9)';
    g.fillRect(0, 0, c.width, c.height);
    return c;
  })();

  /* ------------------------------------------------------------- the loop */
  let coins = [];
  let sparks = [];
  let charges = [];
  let glows = [];
  let settles = [];
  let raf = 0;
  let lastSmack = 0;

  function bump(el, cls, ms) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    window.setTimeout(() => el.classList.remove(cls), ms);
  }

  function burst(x, y) {
    if (sparks.length > 150) return;
    for (let i = 0; i < 2; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.9 + Math.random() * 1.8;
      sparks.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 0.6,
        life: 1
      });
    }
  }

  function frame(now) {
    if (!ctx) return;
    if (W !== window.innerWidth || H !== window.innerHeight) fit();

    let stopped = true;
    ctx.clearRect(0, 0, W, H);

    for (let i = charges.length - 1; i >= 0; i--) {
      const q = (now - charges[i].t0) / CHARGE_MS;
      if (q >= 1) { charges.splice(i, 1); continue; }
      stopped = false;
      const rr = 16 + Math.sin(q * Math.PI) * 22;
      ctx.globalAlpha = 0.25 + Math.sin(q * Math.PI) * 0.5;
      ctx.drawImage(GLOW, charges[i].x - rr, charges[i].y - rr, rr * 2, rr * 2);
      ctx.globalAlpha = 1;
    }

    for (let i = glows.length - 1; i >= 0; i--) {
      const gp = (now - glows[i].t0) / 420;
      if (gp >= 1) { glows.splice(i, 1); continue; }
      stopped = false;
      const gr = 26 + gp * 54;
      ctx.globalAlpha = (1 - gp) * 0.8;
      ctx.drawImage(GLOW, glows[i].x - gr, glows[i].y - gr, gr * 2, gr * 2);
      ctx.globalAlpha = 1;
    }

    for (let i = settles.length - 1; i >= 0; i--) {
      const s = settles[i];
      const sp = (now - s.t0) / SETTLE_MS;
      if (sp >= 1) { settles.splice(i, 1); continue; }
      stopped = false;
      const wob = Math.abs(Math.cos(s.spin));        /* fixed angle: no tumble */
      const wid = Math.max(1.4, s.size * wob);
      const fade = 1 - sp * sp;
      ctx.globalAlpha = fade;
      ctx.drawImage(COIN, s.x - wid / 2, s.y - s.size / 2, wid, s.size);
      if (1 - wob > 0.12) {
        ctx.globalAlpha = fade * (1 - wob) * 0.6;
        ctx.drawImage(COIN_EDGE, s.x - wid / 2, s.y - s.size / 2, wid, s.size);
      }
      ctx.globalAlpha = 1;
    }

    for (let i = coins.length - 1; i >= 0; i--) {
      const c = coins[i];
      const el = now - c.t0;

      if (el >= FLIGHT_MS + POP_MS) { coins.splice(i, 1); continue; }
      if (el < 0) { stopped = false; continue; }
      stopped = false;

      if (el >= FLIGHT_MS && !c.hit) {
        c.hit = true;
        burst(c.ix, c.iy);
        if (now - lastChime > 52) {
          lastChime = now;
          coinChime(0.05 + Math.random() * 0.02, (Math.random() - 0.5) * 0.07);
          coinClink(0.045);
        }
        if (now - lastSmack > 100) {
          lastSmack = now;
          bump(c.avatar, 'gwx-coin-hit', 280);
        }
      }

      let x;
      let y;
      let size;
      let fade;

      if (el < FLIGHT_MS) {
        const t = el / FLIGHT_MS;
        const e = 1 - Math.pow(1 - t, 2.2);
        x = c.sx + (c.ix - c.sx) * e;
        y = c.sy + (c.iy - c.sy) * e - Math.sin(Math.PI * t) * c.bow;
        size = c.size * (t < 0.12 ? 0.6 + (t / 0.12) * 0.4 : 1);
        fade = 1;
      } else {
        const p = (el - FLIGHT_MS) / POP_MS;
        x = c.ix;
        y = c.iy;
        size = c.size * (1 + p * 0.65);
        fade = 1 - p * p;
      }

      const wob = Math.abs(Math.cos(c.spin + (el / 90) * Math.PI));
      const wid = Math.max(1.4, size * wob);

      if (el < FLIGHT_MS) {
        ctx.globalAlpha = fade * 0.2;
        ctx.drawImage(SHADOW, x - wid * 0.62 + 2, y - size * 0.62 + 3, wid * 1.24, size * 1.24);
      }
      ctx.globalAlpha = fade;
      ctx.drawImage(COIN, x - wid / 2, y - size / 2, wid, size);
      if (1 - wob > 0.12) {
        ctx.globalAlpha = fade * (1 - wob) * 0.6;
        ctx.drawImage(COIN_EDGE, x - wid / 2, y - size / 2, wid, size);
      }
      ctx.globalAlpha = 1;
    }

    for (let i = sparks.length - 1; i >= 0; i--) {
      const k = sparks[i];
      k.x += k.vx;
      k.y += k.vy;
      k.vy += 0.13;
      k.life -= 0.05;
      if (k.life <= 0) { sparks.splice(i, 1); continue; }
      stopped = false;
      const ss = 1.8 + k.life * 2.6;
      ctx.globalAlpha = k.life * 0.9;
      ctx.drawImage(SPARK, k.x - ss, k.y - ss, ss * 2, ss * 2);
      ctx.globalAlpha = 1;
    }

    if (stopped) { raf = 0; return; }
    raf = window.requestAnimationFrame(frame);
  }

  /* ----------------------------------------------------------------- play */
  function play(playerId, amount) {
    if (!ensureCanvas()) return;

    /* If the frame loop is not running, anything still in the arrays is stale:
       a hidden tab suspends requestAnimationFrame, so coins never retire and
       would accumulate until MAX_LIVE silently swallowed later showers. */
    if (!raf) { coins.length = 0; sparks.length = 0; settles.length = 0; }

    const grid = document.getElementById('letterGrid');
    const avatar = document.querySelector('.gwx-seat[data-player="' + playerId + '"] .gwx-avatar');
    if (!grid || !avatar) return;

    const gr = grid.getBoundingClientRect();
    const ar = avatar.getBoundingClientRect();
    if (!gr.width || !ar.width) return;

    if (reduce) {
      /* No flight and no tumble, but never nothing: a ring of coins lands on
         the avatar and fades, so reduced-motion players still get the cue. */
      const now = performance.now();
      const cx = ar.left + ar.width / 2;
      const cy = ar.top + ar.height / 2;
      const R = Math.min(ar.width, ar.height) / 2 - 3;
      for (let i = 0; i < SETTLE_COUNT; i++) {
        const a = (i / SETTLE_COUNT) * Math.PI * 2 + Math.random() * 0.4;
        const rr = R + 8 + Math.random() * 18;
        settles.push({
          x: cx + Math.cos(a) * rr,
          y: cy + Math.sin(a) * rr,
          size: 32 * (0.88 + Math.random() * 0.26),
          spin: Math.random() * Math.PI,
          t0: now
        });
      }
      bump(avatar, 'gwx-coin-hit', 280);
      coinChime(0.08, 0);
      if (!raf) raf = window.requestAnimationFrame(frame);
      return;
    }

    const gx = gr.left + gr.width / 2;
    const gy = gr.top + gr.height / 2;
    const ax = ar.left + ar.width / 2;
    const ay = ar.top + ar.height / 2;
    const R = Math.min(ar.width, ar.height) / 2 - 3;

    const dx = ax - gx;
    const dy = ay - gy;
    const len = Math.max(1, Math.hypot(dx, dy));
    const ux = dx / len;
    const uy = dy / len;

    const now = performance.now();
    const n = THROWN;
    const room = Math.max(0, MAX_LIVE - coins.length);
    const count = Math.min(n, room);

    charges.push({ t0: now, x: gx, y: gy });
    launchWhoosh();

    for (let i = 0; i < count; i++) {
      const tang = (Math.random() - 0.5) * 1.6;
      coins.push({
        t0: now + CHARGE_MS + (i / n) * SPAWN_MS + Math.random() * 9,
        sx: gx + (Math.random() - 0.5) * 18,
        sy: gy + (Math.random() - 0.5) * 18,
        ix: ax - ux * R - uy * tang * R * 0.85,
        iy: ay - uy * R + ux * tang * R * 0.85,
        bow: 10 + Math.random() * 26,
        size: 32 * (0.88 + Math.random() * 0.26),
        spin: Math.random() * Math.PI,
        avatar,
        hit: false
      });
    }

    /* closing flourish once the last coin has landed */
    window.setTimeout(() => {
      glows.push({ t0: performance.now(), x: ax, y: ay });
      fanfare();
      bump(avatar, 'gwx-coin-hit', 280);
      if (!raf) raf = window.requestAnimationFrame(frame);
    }, CHARGE_MS + SPAWN_MS + FLIGHT_MS + POP_MS);

    if (!raf) raf = window.requestAnimationFrame(frame);
  }

  /* --------------------------------------------------------- sound toggle */
  function addSoundToggle() {
    const tools = document.querySelector('.gwx-tools');
    if (!tools || tools.querySelector('.gwx-sound-toggle')) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'gwx-sound-toggle';
    b.setAttribute('aria-label', 'Coin sound');
    b.setAttribute('aria-pressed', 'true');
    b.textContent = '\uD83D\uDD0A';
    b.addEventListener('click', () => {
      muted = !muted;
      b.textContent = muted ? '\uD83D\uDD07' : '\uD83D\uDD0A';
      b.setAttribute('aria-pressed', muted ? 'false' : 'true');
      if (!muted) coinChime(0.09, 0);
    });
    tools.appendChild(b);
  }

  function start() {
    ensureCanvas();
    addSoundToggle();
  }

  window.addEventListener('resize', fit, { passive: true });
  window.__champCoins = {
    play,
    setMuted(v) { muted = !!v; },
    isMuted() { return muted; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
