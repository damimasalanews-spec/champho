/* Champ Word — Go Wild coin shower
   Presentation only. The game calls play(playerId, amount) after a correct
   word; this draws 50 gold coins flying from the centre of the letter grid to
   the avatar of whoever scored, and plays the sound. It reads nothing from the
   game state and writes nothing to it, so removing this file changes no rule. */
(() => {
  'use strict';

  const THROWN    = 50;                            /* always 50, whatever the word */
  /* Deliberately unhurried: 50 coins released over 1.88s, each taking 720ms to
     cross. A tighter window read as a burst rather than a throw. */
  const TOTAL_MS  = 3000;
  const CHARGE_MS = 180;
  const FLIGHT_MS = 720;
  const POP_MS    = 220;
  const SPAWN_MS  = TOTAL_MS - CHARGE_MS - FLIGHT_MS - POP_MS;
  const Z_INDEX   = 55;                            /* above the board (10) and the
                                                      coin floater (50), below the
                                                      chat panel (60) and modal (100) */
  const MAX_LIVE  = 220;                           /* guard against many quick scores */

  /* Reduced motion gets a still burst instead of a flight: the same coin art,
     no travel and no tumble, so a correct answer is never silently invisible. */
  const SETTLE_MS    = 1150;
  const SETTLE_COUNT = 14;

  /* Celebration sequence: the word is thrown into the grid, dances, turns into
     coins, and only then does the shower arc to whoever scored. */
  const TOSS_LEAD  = 90;
  const TOSS_GAP   = 110;
  const TOSS_MS    = 520;
  /* Squash bounce: one pass of three decaying bounces, no rotation at all, so
     the word stays legible while it dances. 2.6s was asked for — at 1.7s each
     bounce read as a twitch rather than a bounce. */
  const DANCE_MS   = 2600;
  const DANCE_ITER = 1;
  const DANCE_GAP  = 120;
  const MORPH_MS   = 420;

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

  /* The recorded cues live in game/audio-cues.js, which reads its mute from
     this module's own flag, so the speaker button stays the single control
     over every sound on the page. */
  function cue(name) {
    if (muted) return;
    try { window.ChampCues?.play?.(name); } catch (e) { /* audio unavailable */ }
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

  /* a dry wooden click, used when a thrown letter lands on its cell */
  function wordClack(freq) {
    const a = audio();
    if (!a) return;
    const t = a.currentTime;
    const o = a.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(freq, t);
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.11, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
    o.connect(g);
    g.connect(a.destination);
    o.start(t);
    o.stop(t + 0.19);
    coinClink(0.05);
  }

  /* the dance beat: a low body thump, paired with the existing clink as a hat */
  function danceThump(vol) {
    const a = audio();
    if (!a) return;
    const t = a.currentTime;
    const o = a.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(155, t);
    o.frequency.exponentialRampToValueAtTime(62, t + 0.16);
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.18 * vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g);
    g.connect(a.destination);
    o.start(t);
    o.stop(t + 0.22);
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
        /* The landing chime is gone: the supplied coin cue carries the arrival,
           and a chime per coin was doubling it. The hit burst and the seat bump
           stay, since those are the visuals of a coin landing. */
        if (now - lastSmack > 150) {
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

      /* a slower tumble than a real coin, but at this size a fast one strobes */
      const wob = Math.abs(Math.cos(c.spin + (el / 150) * Math.PI));

      /* depth: coins nearer the camera read bigger and throw their shadow lower,
         which is what stops 50 same-sized sprites looking like a flat decal */
      const per = 1 + (c.depth - 0.5) * 0.34;
      const hgt = size * per;
      const wid = Math.max(1.4, hgt * wob);
      const lift = (c.depth - 0.5) * 16;

      if (el < FLIGHT_MS) {
        ctx.globalAlpha = fade * 0.2;
        ctx.drawImage(SHADOW, x - wid * 0.62 + 2 + lift, y - hgt * 0.62 + 3 + lift, wid * 1.24, hgt * 1.24);
      }
      ctx.globalAlpha = fade;
      ctx.drawImage(COIN, x - wid / 2, y - hgt / 2 - lift * 0.4, wid, hgt);
      if (1 - wob > 0.12) {
        ctx.globalAlpha = fade * (1 - wob) * 0.6;
        ctx.drawImage(COIN_EDGE, x - wid / 2, y - hgt / 2 - lift * 0.4, wid, hgt);
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
  function play(playerId, amount, origin) {
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
      /* the still burst is the same event as the flight, and this branch
         returns before the cue below, so it gets one of its own. Nothing
         flies in this branch, so the reaction lands on the same beat. */
      cue("coins");
      cue("yeah");
      if (!raf) raf = window.requestAnimationFrame(frame);
      return;
    }

    /* normally the middle of the grid; a word celebration hands in the centroid
       of the cells the word was made from, so the coins leave from there */
    const gx = origin && origin.x != null ? origin.x : gr.left + gr.width / 2;
    const gy = origin && origin.y != null ? origin.y : gr.top + gr.height / 2;
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
    /* the grid throwing the coins at the player who scored, and then the
       player's own reaction to receiving them. The coins need FLIGHT_MS to
       arrive, so the reaction is scheduled there instead of stacked on the
       throw: two sounds on one frame just read as one louder sound. */
    cue("coins");
    seq(FLIGHT_MS, () => cue("yeah"));

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
        depth: Math.random(),
        spin: Math.random() * Math.PI,
        avatar,
        hit: false
      });
    }

    /* closing flourish once the last coin has landed */
    window.setTimeout(() => {
      glows.push({ t0: performance.now(), x: ax, y: ay });
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

  /* ---------------------------------------------------------------- stinger */
  /* "Sparkle cascade" for the end of a round: a fast run of bells over two low
     brass notes, landing on one bright bell. Everything goes both dry and into
     a small noise-built room, or a synth fanfare just sounds like a test tone. */

  let roomIn = null;

  function winRoom(a) {
    if (!roomIn) {
      const len = Math.floor(a.sampleRate * 0.5);
      const buf = a.createBuffer(2, len, a.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
      }
      const conv = a.createConvolver();
      conv.buffer = buf;
      const wet = a.createGain();
      wet.gain.value = 0.24;
      roomIn = a.createGain();
      roomIn.gain.value = 1;
      roomIn.connect(conv);
      conv.connect(wet);
      wet.connect(a.destination);
    }
    return roomIn;
  }

  function stingerBell(a, dry, snd, t, freq, vol, dur) {
    [[1, 1], [2.76, 0.32], [5.4, 0.14]].forEach((part) => {
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = 'sine';
      o.frequency.value = freq * part[0];
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol * part[1], t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0008, t + dur / Math.sqrt(part[0]));
      o.connect(g);
      g.connect(dry);
      g.connect(snd);
      o.start(t);
      o.stop(t + dur + 0.06);
    });
  }

  /* two detuned saws through a fast downward sweep is what makes a synth read
     as brass rather than as a buzzer */
  function stingerBrass(a, dry, snd, t, freq, vol, dur) {
    const lp = a.createBiquadFilter();
    const g = a.createGain();
    lp.type = 'lowpass';
    lp.Q.value = 0.9;
    lp.frequency.setValueAtTime(freq * 8, t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(420, freq * 2.8), t + 0.24);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.022);
    g.gain.setValueAtTime(vol, t + dur * 0.55);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    [-7, 7].forEach((cents) => {
      const o = a.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = cents;
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.06);
    });
    lp.connect(g);
    g.connect(dry);
    g.connect(snd);
  }

  function winStinger() {
    const a = audio();
    if (!a) return;
    const dry = a.destination;
    const snd = winRoom(a);
    const t0 = a.currentTime + 0.03;

    /* the cascade */
    const run = [523.25, 587.33, 659.25, 783.99, 880, 987.77, 1046.5, 1318.5];
    run.forEach((freq, i) => {
      stingerBell(a, dry, snd, t0 + i * 0.062, freq, i === run.length - 1 ? 0.15 : 0.115, 0.5);
    });

    /* the two low brass notes holding underneath */
    stingerBrass(a, dry, snd, t0, 261.63, 0.085, 1.5);
    stingerBrass(a, dry, snd, t0, 392, 0.075, 1.5);

    /* the landing */
    const land = t0 + 0.5;
    stingerBell(a, dry, snd, land, 1568, 0.14, 1.2);

    const sub = a.createOscillator();
    const sg = a.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(120, land);
    sub.frequency.exponentialRampToValueAtTime(60, land + 0.14);
    sg.gain.setValueAtTime(0.0001, land);
    sg.gain.linearRampToValueAtTime(0.15, land + 0.006);
    sg.gain.exponentialRampToValueAtTime(0.0008, land + 0.2);
    sub.connect(sg);
    sg.connect(dry);
    sg.connect(snd);
    sub.start(land);
    sub.stop(land + 0.22);

    /* one shimmer of noise so it opens out instead of being pure tones */
    const len = Math.floor(a.sampleRate * 1.1);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.2);
    const src = a.createBufferSource();
    src.buffer = buf;
    const hp = a.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 4200;
    const hg = a.createGain();
    hg.gain.setValueAtTime(0.0001, land);
    hg.gain.linearRampToValueAtTime(0.085, land + 0.005);
    hg.gain.exponentialRampToValueAtTime(0.0008, land + 1.6);
    src.connect(hp);
    hp.connect(hg);
    hg.connect(dry);
    hg.connect(snd);
    src.start(land);
  }

  /* ------------------------------------------------------- word celebration */
  /* Presentation only. Each letter of the found word is flown from the scoring
     player's seat onto the cell it came from, dances there in 3D, turns into a
     coin, and hands over to the shower. The game's own tile is hidden while a
     clone stands in for it, so the board reads as brand new letters landing —
     but no round state is read or written. */

  let layer = null;
  let seqTimers = [];
  let hiddenTiles = [];

  function ensureLayer() {
    if (layer) return layer;
    layer = document.createElement('div');
    layer.className = 'gwx-dance-layer';
    layer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(layer);
    return layer;
  }

  function seq(ms, fn) { seqTimers.push(window.setTimeout(fn, ms)); }

  /* a cancelled sequence must never leave a cell invisible */
  function releaseTiles() {
    hiddenTiles.forEach((t) => t.classList.remove('gwx-thrown'));
    hiddenTiles = [];
  }

  function cancelSequence() {
    seqTimers.forEach((t) => window.clearTimeout(t));
    seqTimers = [];
    releaseTiles();
    if (layer) layer.textContent = '';
  }

  /* Tear down everything a celebration still owns. The game calls this when the
     round resets. The letter clones live on a page-level layer and their timers
     are real timeouts, so without this a word still in flight keeps floating
     over the next board at its old coordinates for about four seconds. */
  function cancel() {
    cancelSequence();
    coins.length = 0;
    sparks.length = 0;
    settles.length = 0;
    if (ctx) ctx.clearRect(0, 0, W, H);
  }

  /* Returns how long until the coins start flying, in ms, so the caller can hold
     the result modal back until the word that won the round has been seen. The
     zero returns mean the sequence did not run; there is nothing to wait for. */
  function celebrate(playerId, word, cells, amount) {
    const grid = document.getElementById('letterGrid');
    const avatar = document.querySelector('.gwx-seat[data-player="' + playerId + '"] .gwx-avatar');

    /* no usable path, or motion is off: the plain shower is the honest answer */
    if (reduce || !grid || !avatar || !Array.isArray(cells) || !cells.length) {
      play(playerId, amount);
      return 0;
    }
    if (!ensureCanvas()) return 0;
    if (!raf) { coins.length = 0; sparks.length = 0; settles.length = 0; }
    cancelSequence();

    const host = ensureLayer();
    const av = avatar.getBoundingClientRect();
    const ox = av.left + av.width / 2;
    const oy = av.top + av.height / 2;
    const sprite = COIN.toDataURL();

    const parts = [];
    cells.forEach((index) => {
      const cell = grid.querySelector('.letter-tile[data-index="' + index + '"]');
      if (!cell || !cell.textContent.trim()) return;
      const r = cell.getBoundingClientRect();
      if (!r.width) return;

      /* the clone borrows the game's own found-tile classes, so it is pixel
         identical to the cell it is standing in for */
      const el = document.createElement('div');
      el.className = 'letter-tile found gwx-dance-tile';
      el.textContent = cell.textContent.trim();
      el.style.left = (r.left + r.width / 2) + 'px';
      el.style.top = (r.top + r.height / 2) + 'px';
      el.style.width = r.width + 'px';
      el.style.height = r.height + 'px';
      el.style.fontSize = window.getComputedStyle(cell).fontSize;
      el.style.transform = 'translate(-50%,-50%)';
      el.style.opacity = '0';

      const shadow = document.createElement('div');
      shadow.className = 'gwx-dance-shadow';
      shadow.style.left = (r.left + r.width * 0.16) + 'px';
      shadow.style.width = (r.width * 0.68) + 'px';
      shadow.style.top = (r.top + r.height - 7) + 'px';

      host.append(shadow, el);
      cell.classList.add('gwx-thrown');
      hiddenTiles.push(cell);
      parts.push({ el, shadow, mid: { x: r.left + r.width / 2, y: r.top + r.height / 2 } });
    });

    if (!parts.length) { releaseTiles(); play(playerId, amount); return 0; }

    /* 1 — thrown from the seat onto the cells that spell the word. One cue for
       the word: the whoosh this replaces sat inside the per-letter loop, so a
       six-letter word stacked six of them on top of each other. */
    cue("throwWord");
    parts.forEach((p, i) => {
      const at = TOSS_LEAD + i * TOSS_GAP;
      const sx = ox - p.mid.x;
      const sy = oy - p.mid.y;
      const apex = 96 + (i % 3) * 16;
      seq(at, () => {
        p.el.style.opacity = '1';
        /* Four stops with their own easings: the letter leaves the hand fast,
           floats up towards the camera, then settles under its own weight. The
           Z values are real depth — the layer carries the perspective. */
        p.el.animate([
          { transform: 'translate(-50%,-50%) translate3d(' + sx + 'px,' + sy + 'px,-72px) scale(.4) rotateY(0deg)',
            opacity: 0, easing: 'ease-out' },
          { offset: .32, transform: 'translate(-50%,-50%) translate3d(' + (sx * .74) + 'px,' + (sy * .74 - apex * .8) + 'px,24px) scale(1.09) rotateY(120deg)',
            opacity: 1, easing: 'ease-in-out' },
          { offset: .68, transform: 'translate(-50%,-50%) translate3d(' + (sx * .3) + 'px,' + (sy * .3 - apex * .74) + 'px,46px) scale(1.15) rotateY(240deg)',
            opacity: 1, easing: 'ease-in' },
          { transform: 'translate(-50%,-50%) translate3d(0,0,0) scale(1) rotateY(360deg)', opacity: 1 }
        ], { duration: TOSS_MS, easing: 'linear', fill: 'forwards' });
      });
      /* the throw lands: this is the point the letter takes on the glass it
         dances in, and it keeps it until the morph replaces it with a coin */
      seq(at + TOSS_MS, () => {
        p.el.classList.add('gwx-glass');
        p.shadow.classList.add('gwx-glass-shadow');
      });
    });

    const danceAt = TOSS_LEAD + (parts.length - 1) * TOSS_GAP + TOSS_MS + 120;

    /* 2 — the word dances on its own cells, on a beat. The beat is the supplied
       coin sound ticked, rather than the synthesised thump and chime it used to
       be, so the dance is made of the same material as the payout after it. */

    parts.forEach((p, i) => {
      const delay = i * DANCE_GAP;
      seq(danceAt, () => {
        /* Squash bounce, kept inside the cell. Scaling about the tile's centre
           (never the bottom edge) keeps the glyph on the cell's centre line — a
           bottom-pinned origin dropped every letter 5.5px low and swelled it
           11px wider than its own cell. The lift is 12px at most, decaying to
           3px, so a letter never leaves its cell while it dances. */
        p.el.animate([
          { transform: 'translate(-50%,-50%) translate3d(0,0,0) scale(1.08,.88)', easing: 'ease-out' },
          { transform: 'translate(-50%,-50%) translate3d(0,-12px,14px) scale(.96,1.06)', easing: 'ease-in' },
          { transform: 'translate(-50%,-50%) translate3d(0,0,0) scale(1.08,.88)', easing: 'ease-out' },
          { transform: 'translate(-50%,-50%) translate3d(0,-7px,8px) scale(.97,1.04)', easing: 'ease-in' },
          { transform: 'translate(-50%,-50%) translate3d(0,0,0) scale(1.05,.93)', easing: 'ease-out' },
          { transform: 'translate(-50%,-50%) translate3d(0,-3px,4px) scale(.99,1.02)', easing: 'ease-in' },
          { transform: 'translate(-50%,-50%) translate3d(0,0,0) scale(1,1)' }
        ], { duration: DANCE_MS, delay, iterations: DANCE_ITER, easing: 'linear' });

        /* the shadow flattens at contact and pulls in on the lift, same beat */
        p.shadow.animate([
          { opacity: .42, transform: 'scale(1.04,.72)', easing: 'ease-out' },
          { opacity: .26, transform: 'scale(.78,.92)', easing: 'ease-in' },
          { opacity: .42, transform: 'scale(1.04,.72)', easing: 'ease-out' },
          { opacity: .3, transform: 'scale(.84,.94)', easing: 'ease-in' },
          { opacity: .4, transform: 'scale(1,.8)', easing: 'ease-out' },
          { opacity: .34, transform: 'scale(.9,.96)', easing: 'ease-in' },
          { opacity: .4, transform: 'scale(1,.88)' }
        ], { duration: DANCE_MS, delay, iterations: DANCE_ITER, easing: 'linear' });
      });
    });

    const danceEnd = danceAt + DANCE_ITER * DANCE_MS + (parts.length - 1) * DANCE_GAP;
    const beat = Math.round(DANCE_MS / 4);
    for (let i = 0, n = Math.ceil((danceEnd - danceAt) / beat); i < n; i++) {
      seq(danceAt + i * beat, () => cue("danceTick"));
    }

    /* 3 — the letters become coins */
    const morphAt = danceEnd + 130;
    parts.forEach((p, i) => {
      seq(morphAt + i * 40, () => {
        p.shadow.style.opacity = '0';
        /* The base sheet paints .letter-tile with `background: … !important` and
           `color: … !important`, which outranks even an inline style — so the
           borrowed tile classes have to go for the coin sprite to show at all. */
        p.el.className = 'gwx-dance-tile gwx-morph';
        p.el.style.backgroundImage = 'url(' + sprite + ')';
        /* a coin flip, not a vanish: it turns through 420 degrees as it shrinks
           and drops away from the camera */
        p.el.animate([
          { transform: 'translate(-50%,-50%) translate3d(0,0,34px) rotateY(0deg) scale(1.14)', opacity: 1, easing: 'ease-out' },
          { offset: .55, transform: 'translate(-50%,-50%) translate3d(0,-8px,18px) rotateY(210deg) scale(.82)', opacity: 1, easing: 'ease-in' },
          { transform: 'translate(-50%,-50%) translate3d(0,0,-46px) rotateY(420deg) scale(.22)', opacity: 0 }
        ], { duration: MORPH_MS, easing: 'linear', fill: 'forwards' });
        coinClink(0.05);
      });
    });
    seq(morphAt + 90, () => coinChime(0.09, -0.3));

    /* 4 — and the coins arc to whoever scored */
    seq(morphAt + MORPH_MS, () => {
      let cx = 0;
      let cy = 0;
      parts.forEach((p) => { cx += p.mid.x; cy += p.mid.y; });
      releaseTiles();
      host.textContent = '';
      play(playerId, amount, { x: cx / parts.length, y: cy / parts.length });
    });

    /* the coins leave at morphAt + MORPH_MS; that is the moment the caller has
       finished showing the word and can safely take the screen */
    return morphAt + MORPH_MS;
  }

  function start() {
    ensureCanvas();
    addSoundToggle();
  }

  window.addEventListener('resize', fit, { passive: true });
  window.__champCoins = {
    play,
    celebrate,
    cancel,
    winStinger,
    setMuted(v) { muted = !!v; },
    isMuted() { return muted; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
