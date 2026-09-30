/* ===========================================================================
   WALL PUSH — post-match duel, ported from the standalone review build
   ===========================================================================
   Usage:
     ChampWallPush.play([
       { rankA:1, rankB:2, a:{name,coins,sprite}, b:{name,coins,sprite} },
       { rankA:3, rankB:4, a:{...},            b:{...}            }
     ], { onDone:function(results){...}, sound:true });

   WHAT WAS KEPT VERBATIM FROM THE REVIEW BUILD
   The parts that were measured and verified there are copied unchanged, because
   they are the parts that were wrong before:
     - the HEAVE (three discrete loads and slams, not a smooth slide). Hands are
       pinned to the slab, so a smooth slide moves body and slab together and the
       whole scene just pans — nothing reads as pushing. The relative distance
       between body and slab is the push, and only the heave creates it.
     - bboxSink, which keeps the lowest point of a rigid, rotated sprite exactly
       on the floor line. Without it a 74-degree topple buried 140px of character
       in the ground.
     - the coin settlement, including the payout cap.

   AND THE TWO BUGS THAT COST THE MOST
   1. A phase object missing a field made dx NaN, the transform string became
      "translate(NaNpx,...)", and the browser DROPPED it silently — no error, no
      visual glitch, the element just kept its previous transform and the
      fighters froze for the whole contest. Every field read here is defaulted,
      and a NaN transform is refused and logged rather than swallowed.
   2. The sprites were referenced by relative path. Opened anywhere else they
      404'd into a fallback silhouette with no arms. Here they are real assets
      that are preloaded, and the duel refuses to start without them.
   =========================================================================== */
(function () {
  "use strict";
  if (window.ChampWallPush) return;

  /* ---------------------------------------------------------------- geometry */
  var S = { FLOOR: 624, CENTER: 800, WALL_HW: 56, RANGE: 100, FULL: 190, KNOCK: 60 };

  /* the two values chosen on the review build's calibration sliders */
  var CONTACT = -14;     // sprite front edge vs the slab's face, in stage px
  var SIZE = 380;        // fighter height, in stage px

  var PH = [
    { k: "setup",  ms: 900 },
    { k: "ready",  ms: 900 },
    { k: "push",   ms: 2400 },
    { k: "break",  ms: 300 },
    { k: "impact", ms: 520 },
    { k: "result", ms: 1050 },
    { k: "settle", ms: 420 }
  ];
  var TOTAL = PH.reduce(function (a, p) { return a + p.ms; }, 0);
  var AT = {};
  (function () { var t = 0; PH.forEach(function (p) { AT[p.k] = t; t += p.ms; }); })();

  var HEAVES = 3, HEAVE_WIND = 0.42, HEAVE_SLAM = 0.56, HEAVE_W = [0.26, 0.32, 0.42];

  /* ------------------------------------------------------------------ maths */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function easeInOut(t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function fmt(n) {
    n = Math.max(0, Math.round(n));
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  /* ------------------------------------------------------------------- heave */
  function heave(t) {
    var n = Math.min(HEAVES - 1e-6, Math.max(0, t) * HEAVES);
    var idx = Math.floor(n), u = n - idx, step, recoil, slam;
    if (u < HEAVE_WIND) { step = 0; recoil = easeInOut(u / HEAVE_WIND); slam = 0; }
    else if (u < HEAVE_SLAM) {
      var k = (u - HEAVE_WIND) / (HEAVE_SLAM - HEAVE_WIND);
      step = easeOut(k); recoil = 1 - easeOut(k); slam = 1 - k;
    } else { step = 1; recoil = 0; slam = 0; }
    var done = 0;
    for (var i = 0; i < idx; i++) done += HEAVE_W[i];
    return { idx: idx, u: u, step: step, recoil: recoil, slam: slam,
             wall: done + HEAVE_W[idx] * step };
  }

  /* how far the lowest corner of a W x H box drops below its transform-origin
     when rotated about the bottom-centre. CSS rotate is clockwise-positive and
     screen y grows downward. */
  function bboxSink(W, H, deg) {
    var r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    var pts = [[-W / 2, 0], [W / 2, 0], [-W / 2, -H], [W / 2, -H]];
    var max = -1e9;
    for (var i = 0; i < 4; i++) {
      var y = pts[i][0] * s + pts[i][1] * c;
      if (y > max) max = y;
    }
    return max;
  }

  /* ---------------------------------------------------------------- coin rule
     The brief: the higher-ranked seat takes the lower-ranked seat's coins if it
     wins; if the lower-ranked seat wins it doubles, funded from the higher. Both
     branches move the SAME amount — the underdog's balance — so the stake is just
     "what the underdog holds". The cap is reported, never hidden. */
  function settle(fav, dog, dogWins) {
    var stake = dog.coins;
    var paid = dogWins ? Math.min(stake, fav.coins) : stake;
    return {
      stake: stake, paid: paid,
      favBefore: fav.coins, dogBefore: dog.coins,
      favAfter: dogWins ? fav.coins - paid : fav.coins + paid,
      dogAfter: dogWins ? dog.coins + paid : dog.coins - paid,
      capped: dogWins && paid < stake
    };
  }

  /* ------------------------------------------------------------------- audio */
  var AC = null, CATCHUP = false, SOUND = true;
  function ac() {
    if (!SOUND) return null;
    try {
      if (!AC) { var C = window.AudioContext || window.webkitAudioContext; if (!C) return null; AC = new C(); }
      if (AC.state === "suspended") AC.resume();
      return AC;
    } catch (e) { return null; }
  }
  function tone(freq, dur, type, gain, slideTo) {
    if (CATCHUP) return;
    var c = ac(); if (!c) return;
    var o = c.createOscillator(), g = c.createGain();
    o.type = type || "sine"; o.frequency.value = freq;
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), c.currentTime + dur);
    // gain is not divided by the playback rate: slowing the picture must not make
    // the hit quieter, only longer
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(gain || .2, c.currentTime + .012);
    g.gain.exponentialRampToValueAtTime(.0001, c.currentTime + dur);
    o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + dur + .02);
  }
  function noise(dur, gain, hz) {
    if (CATCHUP) return;
    var c = ac(); if (!c) return;
    var n = Math.floor(c.sampleRate * dur), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.2);
    var s = c.createBufferSource(); s.buffer = b;
    var f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = hz || 900;
    var g = c.createGain(); g.gain.value = gain || .3;
    s.connect(f); f.connect(g); g.connect(c.destination); s.start();
  }
  var SFX = {
    whoosh: function () { noise(.42, .18, 1800); tone(260, .3, "sine", .06, 130); },
    drop:   function () { tone(120, .34, "sine", .45, 42); noise(.3, .45, 700); },
    tick:   function () { tone(880, .07, "square", .1); },
    grip:   function () { noise(.14, .3, 2400); tone(300, .1, "square", .08); },
    shove:  function () { tone(180, .26, "sawtooth", .16, 320); noise(.22, .2, 1400); },
    grind:  function () { noise(.9, .1, 2600); },
    slam:   function () { tone(78, .62, "sine", .7, 30); noise(.6, .7, 520); },
    coin:   function (i) { tone(1180 + i * 46, .1, "triangle", .09); },
    win:    function () { [0, 140, 280, 520].forEach(function (d, i) { setTimeout(function () { tone([523, 659, 784, 1047][i], .34, "triangle", .18); }, d); }); },
    lose:   function () { [0, 170].forEach(function (d, i) { setTimeout(function () { tone([330, 247][i], .42, "sawtooth", .14); }, d); }); }
  };

  /* --------------------------------------------------------------- the overlay */
  var root = null, stage = null, E = {}, fxLayer = null, shakeEl = null;
  var curKey = [null, null], warnedNaN = false;

  var MARKUP = ''
    + '<div id="wpStage">'
    + '  <div class="wp-felt"><div class="wp-felt-glow"></div></div>'
    + '  <div class="wp-floor"></div>'
    /* the avatars now ship as pre-rendered film, ONE HALF PER SEAT: the left
       video carries seat a and the right video carries seat b (mirrored), so
       the same ninja footage plays on both sides of the screen and the drawn
       wall stays the real, sliding wall in the middle. */
    + '  <video class="wp-film" id="wpFilmL" muted playsinline preload="auto"></video>'
    + '  <video class="wp-film" id="wpFilmR" muted playsinline preload="auto"></video>'
    + '  <div id="wpShake">'
    + '    <img class="wp-fighter" id="wpFA" alt="">'
    + '    <img class="wp-fighter" id="wpFB" alt="">'
    + '    <div id="wpWall"><div class="wp-slab"><div class="wp-cracks"></div>'
    + '      <i class="wp-seam l"></i><i class="wp-seam r"></i></div></div>'
    + '    <div class="wp-rank r1" id="wpRankA"></div>'
    + '    <div class="wp-rank r2" id="wpRankB"></div>'
    + '    <div class="wp-plate" id="wpPlateA"><span class="pn" id="wpNameA"></span>'
    + '      <span class="pc"><span>🪙</span><b id="wpCoinsA">0</b><small id="wpTeamA"></small></span></div>'
    + '    <div class="wp-plate" id="wpPlateB"><span class="pn" id="wpNameB"></span>'
    + '      <span class="pc"><span>🪙</span><b id="wpCoinsB">0</b><small id="wpTeamB"></small></span></div>'
    + '  </div>'
    + '  <div id="wpFx"></div>'
    + '  <div class="wp-banner" id="wpBanner"><span class="bk">POST MATCH</span><span class="bt">WALL PUSH</span></div>'
    + '  <div class="wp-next" id="wpNext"><b></b><span></span></div>'
    + '  <div class="wp-meter a" id="wpMeterA"><div class="mt"><span id="wpSideA">PUSH POWER</span><span id="wpPctA">100%</span></div>'
    + '    <div class="mtrack"><div class="mfill" id="wpFillA"></div></div></div>'
    + '  <div class="wp-meter b" id="wpMeterB"><div class="mt"><span id="wpSideB">PUSH POWER</span><span id="wpPctB">100%</span></div>'
    + '    <div class="mtrack"><div class="mfill" id="wpFillB"></div></div></div>'
    + '  <div class="wp-ledger" id="wpLedger">'
    + '    <h3>COIN SETTLEMENT</h3><p class="vd" id="wpVerdict">—</p>'
    + '    <div class="lrow"><div class="lcell"><small>STAKE</small><b id="wpStake">—</b></div>'
    + '      <div class="lcell mid"><span class="arrow">➜</span></div>'
    + '      <div class="lcell"><small>WINNER RECEIVES</small><b id="wpWin">—</b></div></div>'
    + '    <div class="lrow"><div class="lcell"><small id="wpLblL">BEFORE</small><b id="wpL">—</b></div>'
    + '      <div class="lcell mid"><small>AFTER THE PUSH</small></div>'
    + '      <div class="lcell" style="text-align:right"><small id="wpLblR">BEFORE</small><b id="wpR">—</b></div></div>'
    + '    <p class="wp-note" id="wpNote"></p></div>'
    + '</div>'
    + '<button id="wpSkip" type="button">SKIP ▶</button>';

  function build() {
    if (root) return;
    root = document.createElement("div");
    root.id = "wpOverlay";
    root.innerHTML = MARKUP;
    document.body.appendChild(root);
    stage = root.querySelector("#wpStage");
    fxLayer = root.querySelector("#wpFx");
    shakeEl = root.querySelector("#wpShake");
    ["FA","FB","Wall","RankA","RankB","PlateA","PlateB","NameA","NameB","CoinsA","CoinsB",
     "TeamA","TeamB","Banner","Next","MeterA","MeterB","SideA","SideB","PctA","PctB","FillA","FillB",
     "Ledger","Verdict","Stake","Win","LblL","LblR","L","R","Note","Skip","FilmL","FilmR"].forEach(function (k) {
      E[k] = root.querySelector("#wp" + k);
    });

     /* A key with no element behind it used to throw the moment anything
        touched it, which took the whole post-match down before it could even
        report ready. Anything unresolved now gets a stub that swallows reads
        and writes, and says so, so a neglected id degrades instead of killing
        the run. */
     Object.keys(E).forEach(function (k) {
       if (E[k]) return;
       console.warn("wall-push: markup has no #wp" + k + " - using a stub");
       var noop = function () {};
       E[k] = {
         textContent: "", className: "", innerHTML: "", value: "",
         style: { setProperty: noop, removeProperty: noop },
         classList: { add: noop, remove: noop, toggle: noop, contains: function () { return false; } },
         addEventListener: noop, removeEventListener: noop, appendChild: noop,
         insertAdjacentHTML: noop, remove: noop, setAttribute: noop, focus: noop,
         querySelector: function () { return null; },
         querySelectorAll: function () { return []; },
         getBoundingClientRect: function () { return { left: 0, top: 0, width: 0, height: 0, bottom: 0, right: 0 }; },
         parentNode: { classList: { add: noop, remove: noop, toggle: noop } }
       };
     });
    E.Skip.addEventListener("click", function () { if (abort) abort(); });
    window.addEventListener("resize", fit, { passive: true });
    if (window.visualViewport) window.visualViewport.addEventListener("resize", fit, { passive: true });
    fit();
  }
  function fit() {
    if (!root) return;
    var s = Math.min(window.innerWidth / 1600, window.innerHeight / 900);
    root.style.setProperty("--wp-scale", s.toFixed(4));
  }

  /* --------------------------------------------------------------------- FX */
  function spawn(el, ms) {
    fxLayer.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, ms + 260);
  }
  function ring(x, y, color) {
    var d = document.createElement("div"); d.className = "wp-ring";
    d.style.left = x + "px"; d.style.top = y + "px"; d.style.borderColor = color;
    d.style.animation = "wpRing calc(" + (620 / RATE) + "ms) ease-out forwards";
    spawn(d, 620 / RATE);
  }
  function spark(x, y, n) {
    if (!FX.spark) return;
    for (var i = 0; i < n; i++) {
      var d = document.createElement("div"); d.className = "wp-spark";
      d.style.left = (x + Math.random() * 40 - 20) + "px";
      d.style.top = (y + Math.random() * 40 - 20) + "px";
      var ms = (260 + Math.random() * 220) / RATE;
      d.style.animation = "wpSpark " + ms + "ms ease-out forwards";
      spawn(d, ms);
    }
  }
  function debris(x, y, dir, n) {
    if (!FX.debris) return;
    for (var i = 0; i < n; i++) {
      var d = document.createElement("div"); d.className = "wp-shard";
      d.style.left = (x + (Math.random() * 70 - 35)) + "px";
      d.style.top = (y + (Math.random() * 180 - 90)) + "px";
      d.style.setProperty("--dx", (dir * (60 + Math.random() * 260)).toFixed(0) + "px");
      d.style.setProperty("--dy", (-40 + Math.random() * 230).toFixed(0) + "px");
      d.style.setProperty("--dr", (Math.random() * 720 - 360).toFixed(0) + "deg");
      var ms = (620 + Math.random() * 420) / RATE;
      d.style.animation = "wpShard " + ms + "ms cubic-bezier(.2,.7,.4,1) forwards";
      spawn(d, ms);
    }
  }
  function dust(x, y, dir, n, scale) {
    if (!FX.dust) return;
    for (var i = 0; i < n; i++) {
      var d = document.createElement("div"); d.className = "wp-puff";
      var sz = (70 + Math.random() * 120) * (scale || 1);
      d.style.width = sz + "px"; d.style.height = sz + "px";
      d.style.left = (x + (Math.random() * 80 - 40)) + "px";
      d.style.top = (y + (Math.random() * 26 - 13)) + "px";
      d.style.setProperty("--dx", (dir * (30 + Math.random() * 150)).toFixed(0) + "px");
      d.style.setProperty("--dy", (-20 - Math.random() * 70).toFixed(0) + "px");
      d.style.setProperty("--ds", (1.5 + Math.random() * 1.4).toFixed(2));
      var ms = (620 + Math.random() * 500) / RATE;
      d.style.animation = "wpPuff " + ms + "ms ease-out forwards";
      spawn(d, ms);
    }
  }
  function streaks(x, y, dir, n) {
    if (!FX.debris) return;
    for (var i = 0; i < n; i++) {
      var d = document.createElement("div"); d.className = "wp-streak";
      var w = 90 + Math.random() * 180;
      d.style.width = w + "px";
      d.style.left = (dir > 0 ? x : x - w) + "px";
      d.style.top = (y + Math.random() * 120 - 60) + "px";
      d.style.setProperty("--dx", (dir * (70 + Math.random() * 160)).toFixed(0) + "px");
      var ms = (250 + Math.random() * 220) / RATE;
      d.style.animation = "wpStreak " + ms + "ms ease-out forwards";
      spawn(d, ms);
    }
  }
  function skid(x, y, dir) {
    if (!FX.dust) return;
    for (var i = 0; i < 3; i++) {
      var d = document.createElement("div"); d.className = "wp-mark";
      var w = 60 + i * 34;
      d.style.setProperty("--mw", w + "px");
      d.style.left = (dir > 0 ? x : x - w) + "px";
      d.style.top = (y + i * 5) + "px";
      var ms = (700 + i * 90) / RATE;
      d.style.animation = "wpMark " + ms + "ms ease-out forwards";
      spawn(d, ms);
    }
  }
  function sweat(x, y, n) {
    if (!FX.dust) return;
    for (var i = 0; i < n; i++) {
      (function (i) {
        setTimeout(function () {
          var d = document.createElement("div"); d.className = "wp-sweat";
          d.style.left = (x + (Math.random() * 44 - 22)) + "px";
          d.style.top = (y + Math.random() * 20) + "px";
          d.style.setProperty("--dx", (Math.random() * 40 - 20).toFixed(0) + "px");
          var ms = 900 / RATE;
          d.style.animation = "wpSweat " + ms + "ms ease-in forwards";
          spawn(d, ms);
        }, (i * 130) / RATE);
      })(i);
    }
  }
  function coins(fromX, fromY, toX, toY, n) {
    if (!FX.coins) return;
    for (var i = 0; i < n; i++) {
      (function (i) {
        setTimeout(function () {
          var d = document.createElement("div"); d.className = "wp-coin"; d.textContent = "🪙";
          d.style.left = (fromX + Math.random() * 40 - 20) + "px";
          d.style.top = fromY + "px";
          d.style.setProperty("--dx", (toX - fromX + (Math.random() * 90 - 45)).toFixed(0) + "px");
          d.style.setProperty("--dy", (toY - fromY + (Math.random() * 70 - 35)).toFixed(0) + "px");
          var ms = (620 + Math.random() * 260) / RATE;
          d.style.animation = "wpCoin " + ms + "ms cubic-bezier(.25,.6,.35,1) forwards";
          spawn(d, ms);
          /* no blip per coin: the supplied coin cue carries the payout, and a
             synthesised chime on every other coin was talking over it */
        }, (i * 62) / RATE);
      })(i);
    }
  }
  function floatNum(x, y, text, cls) {
    var d = document.createElement("div");
    d.className = "wp-float " + cls; d.textContent = text;
    d.style.left = x + "px"; d.style.top = y + "px";
    var ms = 1250 / RATE;
    d.style.animation = "wpFloat " + ms + "ms ease-out forwards";
    spawn(d, ms);
  }
  function glow(x, y, r, color, ms) {
    if (!FX.dust) return;
    var d = document.createElement("div"); d.className = "wp-glow";
    d.style.left = (x - r) + "px"; d.style.top = (y - r) + "px";
    d.style.width = d.style.height = (r * 2) + "px";
    d.style.background = "radial-gradient(circle," + color + " 0,transparent 68%)";
    d.style.animation = "wpGlow " + (ms || 900) / RATE + "ms ease-out forwards";
    spawn(d, ms || 900);
  }
  var shake = { mag: 0, start: 0, end: 0 };
  function kick(mag, ms) {
    if (!FX.shake) return;
    shake.mag = mag; shake.start = performance.now(); shake.end = shake.start + ms / RATE;
  }
  function stopShake() { shake.mag = 0; shake.end = 0; if (shakeEl) shakeEl.style.transform = ""; }

  /* ------------------------------------------------------------------- state */
  var RATE = 1, FX = { shake: true, debris: true, dust: true, spark: true, coins: true, sound: true };
  var run = null, abort = null, sprites = {}, aspect = [1, 1];
  var phaseAt = function (ms) {
    var acc = 0;
    for (var i = 0; i < PH.length; i++) {
      if (ms < acc + PH[i].ms || i === PH.length - 1)
        return { k: PH[i].k, t: clamp((ms - acc) / PH[i].ms, 0, 1) };
      acc += PH[i].ms;
    }
  };

  /* ------------------------------------------------------------------- render */
  /* The recorded cues live in game/audio-cues.js, which also owns mute and
     volume, so this just defers to it rather than keeping a second opinion
     about how loud anything should be. */
  function cue(name) {
    if (!SOUND) return;
    try { window.ChampCues?.play?.(name); } catch (e) { /* audio unavailable */ }
  }

  function paramsFor(k, t, isLoser) {
    var e = easeOut(t), io = easeInOut(t);
    switch (k) {
      /* Lean angles are deliberately modest: the sprites are already painted in a
         pushing pose, and because a rigid rotation about the feet is compensated
         back onto the floor, every extra degree also lifts the body. */
      case "setup":  return { lean: lerp(0, 1.2, e), squash: 0, advance: 0, entry: lerp(150, 0, e) };
      case "ready":  return { lean: lerp(1.2, -2.6, io), squash: lerp(0, .05, io), advance: lerp(0, -2, io), entry: 0 };
      case "push": {
        var hv = heave(t);
        var amp = isLoser ? 20 : 28;
        return {
          lean: isLoser ? lerp(-2.6, -1.2, t) : lerp(-2.6, 5, e),
          squash: (isLoser ? lerp(.05, .09, t) : lerp(.05, -.02, e)) + hv.slam * .055,
          advance: 0,
          entry: 0,                                   // MUST be present: see the header note
          gap: -hv.recoil * amp
        };
      }
      /* STANDOFF: both fighters lean on the slab for as long as the guessing
         lasts, so this pose has no timeline at all. The side that is winning the
         contest drives harder and the other is pressed back onto its heels -
         which is the whole visual feedback loop for a correct answer. */
      case "live":
        return isLoser
          ? { lean: -1.8, squash: .06, advance: -4, entry: 0, gap: 0 }
          : { lean: 3.4, squash: -.01, advance: 4, entry: 0, gap: 0 };

      case "break":
        return isLoser ? { lean: -2.2, squash: .09, advance: -6, entry: 0 }
                       : { lean: 5.5, squash: -.03, advance: 9, entry: 0 };
      case "impact":
        return isLoser ? { lean: lerp(-2.2, -3, e), squash: lerp(.09, .04, e), advance: lerp(-6, -10, e), entry: 0 }
                       : { lean: 5.5, squash: -.02, advance: 9, entry: 0 };
      default:
        return isLoser ? { lean: -3, squash: .04, advance: -10, entry: 0 }
                       : { lean: 2.6, squash: -.01, advance: 6, entry: 0 };
    }
  }

  function render(ms, adv, prog) {
    var wall = E.Wall;
    var wallX = S.CENTER, wallRot = 0, wallY = 0;

    if (prog.k === "live") {
      /* STANDOFF. The slab sits wherever the answers have shoved it - `lead` is
         that distance in px, `jolt` the momentary kick that lands with a correct
         answer. The idle tremble stays, because it is the thing that says the two
         of them are still leaning on the slab rather than posing next to it. */
      wallX = S.CENTER + (prog.lead || 0) + Math.sin(ms / 38) * 1.5 + (prog.jolt || 0);
      wallRot = -(wallX - S.CENTER) * .030;
    } else if (prog.k === "setup") {
      var drop = Math.min(1, prog.t / .86);
      wallY = -150 * (1 - drop * drop);
    } else if (prog.k === "ready") {
      wallX = S.CENTER + Math.sin(ms / 90) * 1.4;
    } else if (prog.k === "push") {
      /* the slab holds while they load, trembles hard under the strain, then takes
         one jump per heave. A smooth drift is what made this look like a camera
         pan rather than a push. */
      var hv = heave(prog.t);
      var trem = (1.6 + hv.recoil * 5.5) * Math.sin(ms / 38) + hv.recoil * 2.5 * Math.sin(ms / 11);
      wallX = S.CENTER + adv * (hv.wall * S.RANGE * 0.9 + trem);
      wallRot = -(wallX - S.CENTER) * .030;
    } else if (prog.k === "break") {
      wallX = S.CENTER + adv * lerp(S.RANGE * .9, S.FULL, easeOut(prog.t));
      // overshoot decaying to zero, so the IMPACT pose below is reached without a snap
      wallX += adv * Math.sin(prog.t * Math.PI) * 14 * (1 - prog.t);
      wallRot = -(wallX - S.CENTER) * .044;
    } else {
      wallX = S.CENTER + adv * S.FULL;
      wallRot = -(wallX - S.CENTER) * .044 * (prog.k === "impact" ? (1 - .6 * prog.t) : .4);
    }

    wall.style.setProperty("--wx", wallX.toFixed(2) + "px");
    wall.style.setProperty("--wrot", wallRot.toFixed(3) + "deg");
    wall.style.setProperty("--wy", wallY.toFixed(2) + "px");

    var faceL = wallX - S.WALL_HW, faceR = wallX + S.WALL_HW;
    var H = SIZE, geo = [];

    for (var i = 0; i < 2; i++) {
      var pushDir = i === 0 ? 1 : -1;
      var isLoser = (i === 0) === (adv < 0);
      var el = i === 0 ? E.FA : E.FB;
      var key = i === 0 ? run.a.key : run.b.key;
      var W = H * aspect[i];

      /* only touch src on a change. Resolving through BODIES (not a leftover map)
         matters: a stale lookup set src to the literal string "undefined", the
         image never decoded, and both fighters were invisible — while every other
         number in the render pass was perfectly correct. */
      if (curKey[i] !== key) { curKey[i] = key; el.setAttribute("src", BODIES[key]); }
      el.style.height = H + "px";

      var P = paramsFor(prog.k, prog.t, isLoser);

      var knock = 0, fallT = 0, lift = 0;
      if (isLoser) {
        if (prog.k === "impact") {
          knock = easeOut(prog.t) * S.KNOCK;
          fallT = clamp((prog.t - .34) / .66, 0, 1);
          lift = Math.sin(prog.t * Math.PI) * 14;
        } else if (prog.k === "result" || prog.k === "settle") {
          knock = S.KNOCK; fallT = 1; lift = 3;
        }
      }

      /* Every field is defaulted. This is the line that once produced
         translate(NaNpx,...) and silently froze both fighters for a whole
         contest because a phase object was missing a field. */
      var dxLean = (P.advance || 0) + (P.gap || 0) - knock;
      var dx = pushDir * (dxLean + (i === 0 ? -(P.entry || 0) : (P.entry || 0)));

      var strainR = 0, strainY = 0;
      if (prog.k === "push" || prog.k === "break") {
        strainR = Math.sin(ms / 26) * 0.7;
        strainY = Math.sin(ms / 33) * 1.5;
      }
      var rot = pushDir * (P.lean || 0) + strainR - 74 * pushDir * easeOut(fallT);
      var sy = 1 - (P.squash || 0), sx = 1 + (P.squash || 0) * 0.5;
      /* keep the lowest point of the rotated body exactly on the floor */
      var dy = strainY - lift - bboxSink(W * sx, H * sy, rot);

      var base = i === 0
        ? (faceL + CONTACT - W)                 // front edge (the fingertips) on the left face
        : (faceR - CONTACT);                    // mirrored, so its front edge is the left edge

      el.style.left = base.toFixed(1) + "px";
      var tf = "translate(" + dx.toFixed(2) + "px," + dy.toFixed(2) + "px)"
        + " rotate(" + rot.toFixed(2) + "deg) scale(" + sx.toFixed(3) + "," + sy.toFixed(3) + ")"
        + " scaleX(" + (i === 1 ? -1 : 1) + ")";
      /* a NaN in a CSS value makes the browser drop the whole declaration with no
         error at all, so refuse it and say so */
      if (tf.indexOf("NaN") !== -1) {
        if (!warnedNaN) { warnedNaN = true; console.warn("wall-push: refused a NaN transform: " + tf); }
      } else {
        el.style.transform = tf;
      }
      el.style.opacity = (prog.k === "setup") ? clamp(prog.t * 2.6, 0, 1).toFixed(2) : 1;

      geo.push({
        pushDir: pushDir, isLoser: isLoser, W: W, H: H, cx: base + W / 2,
        handX: i === 0 ? faceL : faceR,
        handY: S.FLOOR - H * (1 - 0.32)           // hands sit about a third down the sprite
      });

      var plate = i === 0 ? E.PlateA : E.PlateB;
      var rank = i === 0 ? E.RankA : E.RankB;
      plate.style.left = (base + W / 2 - 160) + "px";
      rank.style.left = (base + W / 2) + "px";
      rank.style.top = (S.FLOOR - H - 34) + "px";
    }

    if (shake.mag > 0) {
      var now = performance.now();
      if (now < shake.end) {
        var m = shake.mag * (1 - (now - shake.start) / (shake.end - shake.start));
        shakeEl.style.transform = "translate(" + ((Math.random() * 2 - 1) * m).toFixed(2) + "px,"
                                                 + ((Math.random() * 2 - 1) * m).toFixed(2) + "px)";
      } else { shake.mag = 0; shakeEl.style.transform = ""; }
    }
    return geo;
  }

  /* ------------------------------------------------------------------- events */
  function events(ms, e, geo) {
    var fav = e.fav, dog = e.dog, dogWins = e.dogWins;
    var adv = dogWins ? -1 : 1;
    var loser = geo[adv < 0 ? 0 : 1] || geo[0];
    var winner = geo[adv > 0 ? 0 : 1] || geo[1];

    if (ms >= 0 && !e.f_setup) {
      e.f_setup = 1;
      E.Banner.classList.add("on");
      SFX.whoosh();
      setTimeout(function () { E.Banner.classList.remove("on"); }, 1500 / RATE);
    }
    /* AT.setup is 0 — the phase's START. The landing is 86% THROUGH the phase,
       which is its DURATION times .86. */
    if (ms >= PH[0].ms * .86 && !e.f_land) {
      e.f_land = 1;
      E.Wall.classList.add("cracked");
      dust(S.CENTER, S.FLOOR - 6, 0, 10);
      dust(S.CENTER, S.FLOOR - 6, -1, 5);
      dust(S.CENTER, S.FLOOR - 6, 1, 5);
      kick(11, 260);
      SFX.drop();
    }
    if (ms >= AT.ready && !e.f_ready) {
      e.f_ready = 1;
      for (var i = 0; i < 3; i++) setTimeout(function () { SFX.tick(); }, (i * 300) / RATE);
    }
    if (ms >= AT.push && !e.f_push) {
      e.f_push = 1;
      E.Wall.classList.add("straining");
      SFX.shove(); SFX.grind(); SFX.grip();
      geo.forEach(function (g) { ring(g.handX, g.handY, "#ffffff"); spark(g.handX, g.handY, 4); });
    }
    if (ms >= AT.break && !e.f_break) { e.f_break = 1; E.Wall.classList.remove("straining"); }
    if (ms >= AT.impact && !e.f_impact) {
      e.f_impact = 1;
      E.Wall.classList.add("shattered");
      var face = S.CENTER + adv * S.FULL - adv * S.WALL_HW;
      kick(26, 460);
      ring(face, 560, "#ffffff");
      ring(face, 560, adv < 0 ? "#39a1ff" : "#ff4d62");
      debris(face, 560, adv, 18);
      dust(loser.cx, S.FLOOR - 4, adv, 12);
      streaks(loser.cx, 560, adv, 5);
      skid(loser.cx, S.FLOOR + 2, adv);
      SFX.slam();
      floatNum(loser.cx, 470, "−" + fmt(e.st.paid), "minus");
    }
    if (ms >= AT.result && !e.f_result) {
      e.f_result = 1;
      kick(12, 300);
      ring(winner.cx, 520, "#ffe9a8");
      glow(winner.cx, S.FLOOR - winner.H * 0.7, 155, "rgba(255,207,37,.55)", 1100);
      dust(winner.cx, S.FLOOR - 4, 0, 6);
      floatNum(winner.cx, 452, "+" + fmt(e.st.paid), "plus");
      sweat(loser.cx, S.FLOOR - loser.H * 0.92, 7);
      coins(loser.cx, S.FLOOR - 200, winner.cx, S.FLOOR - 200, 14);
      SFX.win(); SFX.lose();
      setTimeout(function () {
        if (!run || run.tok !== e.tok) return;
        var loseEl = dogWins ? E.CoinsA : E.CoinsB;
        var winEl = dogWins ? E.CoinsB : E.CoinsA;
        loseEl.textContent = fmt(0); winEl.textContent = fmt(0);
        loseEl.parentNode.classList.add("drain");
        winEl.parentNode.classList.add("gain");
        countUp(loseEl, dogWins ? e.st.favAfter : e.st.dogAfter, 620 / RATE, e.tok);
        countUp(winEl, dogWins ? e.st.dogAfter : e.st.favAfter, 620 / RATE, e.tok);
      }, 340 / RATE);
    }
    if (ms >= AT.settle && !e.f_settle) { e.f_settle = 1; ledger(e); }
    if (ms >= TOTAL && !e.f_done) { e.f_done = 1; run.done = true; }
  }

  function countUp(el, to, ms, tok) {
    var t0 = performance.now();
    (function step() {
      if (!run || run.tok !== tok) return;
      var t = clamp((performance.now() - t0) / ms, 0, 1);
      el.textContent = fmt(to * easeOut(t));
      if (t < 1) requestAnimationFrame(step);
    })();
  }

  function ledger(e) {
    var st = e.st, dogWins = e.dogWins;
    E.Verdict.textContent = dogWins
      ? (st.capped ? e.dogLabel + " TAKES IT — PAYOUT CAPPED"
                   : e.dogLabel + " TAKES IT — THE UNDERDOG DOUBLES")
      : e.favLabel + " HOLDS THE WALL";
    E.Verdict.className = "vd " + (dogWins ? "lose" : "win");
    E.Stake.textContent = fmt(st.stake);
    E.Win.textContent = fmt(st.paid);
    E.LblL.textContent = e.favLabel + " · BEFORE";
    E.LblR.textContent = e.dogLabel + " · BEFORE";
    E.L.textContent = fmt(st.favBefore) + "  ➜  " + fmt(st.favAfter);
    E.R.textContent = fmt(st.dogBefore) + "  ➜  " + fmt(st.dogAfter);
    E.Note.innerHTML = st.capped
      ? "The underdog held <b>" + fmt(st.stake) + "</b> but the favourite only had <b>" + fmt(st.favBefore)
        + "</b>, so the payout is capped at <b>" + fmt(st.paid) + "</b> and the underdog does <b>not</b> double."
      : "The stake is the underdog's balance (<b>" + fmt(st.stake) + "</b>) and the winner always takes it"
        + (dogWins ? " — so the underdog doubles, funded by the favourite." : " — so the favourite takes the lot.");
    E.Ledger.classList.add("on");
  }

  /* -------------------------------------------------------------- one duel run */
  function runDuel(duel, onFinished) {
    var tok = {};
    var fav = { coins: duel.a.coins, key: duel.a.key }, dog = { coins: duel.b.coins, key: duel.b.key };
    var dogWins = duel.winner === "a" ? false : duel.winner === "b" ? true : (Math.random() < 0.5); /* the clipart contest hands the verdict in as duel.winner; only a duel that arrives unjudged still flips a coin */
    var e = {
      tok: tok, fav: fav, dog: dog, dogWins: dogWins,
      favRank: duel.rankA, dogRank: duel.rankB,
      favLabel: duel.labelA || ("TOP " + duel.rankA),
      dogLabel: duel.labelB || ("TOP " + duel.rankB),
      st: settle(fav, dog, dogWins)
    };

    E.NameA.textContent = duel.a.name; E.NameB.textContent = duel.b.name;
    E.TeamA.textContent = duel.a.team || ""; E.TeamB.textContent = duel.b.team || "";
    E.CoinsA.textContent = fmt(fav.coins); E.CoinsB.textContent = fmt(dog.coins);
    ["CoinsA", "CoinsB"].forEach(function (k) { E[k].parentNode.classList.remove("drain", "gain"); });
    E.Ledger.classList.remove("on");
    E.Verdict.textContent = "—";
    E.RankA.textContent = "TOP " + duel.rankA;
    E.RankB.textContent = "TOP " + duel.rankB;
    E.RankA.className = "wp-rank r1";
    E.RankB.className = "wp-rank r2";
    E.MeterA.classList.remove("dying"); E.MeterB.classList.remove("dying");
    E.FillA.style.width = "100%"; E.FillB.style.width = "100%";
    E.PctA.textContent = "100%"; E.PctB.textContent = "100%";
    E.Wall.classList.remove("cracked", "shattered", "straining");
    fxLayer.innerHTML = "";
    stopShake();
    curKey = [null, null];

    run = { tok: tok, a: duel.a, b: duel.b, done: false, adv: dogWins ? -1 : 1 };

    var pushSpan = PH[2].ms, geo = [];
    function loop() {
      if (run.tok !== tok) return;
      var ms = (performance.now() - run.t0) * RATE;

      if (ms >= AT.push && ms < AT.break) {
        /* the bars drop in three steps, one per heave, so the meters read the same
           events the fighters and the slab are performing */
        var hv = heave((ms - AT.push) / pushSpan);
        var losing = 1 - hv.wall;
        var sa = run.adv > 0 ? 1 : losing, sb = run.adv > 0 ? losing : 1;
        E.FillA.style.width = (sa * 100).toFixed(0) + "%"; E.PctA.textContent = (sa * 100).toFixed(0) + "%";
        E.FillB.style.width = (sb * 100).toFixed(0) + "%"; E.PctB.textContent = (sb * 100).toFixed(0) + "%";
        /* one hit per heave, fired on the slam rather than on a timer */
        if (hv.u >= HEAVE_WIND && hv.idx > (e.lastSlam == null ? -1 : e.lastSlam)) {
          e.lastSlam = hv.idx;
          geo.forEach(function (g) {
            ring(g.handX, g.handY, "#ffffff");
            spark(g.handX, g.handY, 5);
            dust(g.cx, S.FLOOR - 6, g.pushDir, 4, .7);
          });
          kick(9, 220);
          SFX.grip();
        }
      }
      if (ms >= AT.push + pushSpan * .66 && !e.f_meterdie) {
        e.f_meterdie = 1;
        (run.adv > 0 ? E.MeterB : E.MeterA).classList.add("dying");
      }

      geo = render(ms, run.adv, phaseAt(ms));
      events(ms, e, geo);
      if (!run.done) requestAnimationFrame(loop);
      else onFinished({ rankA: duel.rankA, rankB: duel.rankB, winnerRank: dogWins ? duel.rankB : duel.rankA,
                        st: e.st, dogWins: dogWins });
    }
    run.t0 = performance.now();
    loop();
  }

  /* ---------------------------------------------------------------- the module
     Callers name the character ('boy' / 'girl') rather than passing a path, so
     there is no chance of a path comparison silently mapping a seat onto the
     wrong body. Sprite URLs and aspects are resolved here. */
  var BODIES = {
    boy:  "assets/wallpush/boy-body.png",
    girl: "assets/wallpush/girl-body.png"
  };

  /* The film beats live out here, not inside the renderer, because the standoff
     gate below needs them too. They used to be local to liveMount(), which meant
     the gate only ever knew about the two body sprites: a duel between two newer
     avatars found no sprites to load and silently skipped the whole wall push.
     A seat is drawable if it has a sprite OR a clip. */
  var FILM = {
    "ninja": {
      shove:   "assets/wallpush/ninja-shove.mp4",
      defense: "assets/wallpush/ninja-defense.mp4",
      kick:    "assets/wallpush/ninja-kick.mp4",
      fall:    "assets/wallpush/ninja-fall.mp4"
    },
    "pumpkin-boy":  { shove: "assets/wallpush/pumpkin-boy-push.mp4", kick: "assets/wallpush/pumpkin-boy-break.mp4" },
    "boy":          { shove: "assets/wallpush/pumpkin-boy-push.mp4", kick: "assets/wallpush/pumpkin-boy-break.mp4" },
    "pumpkin-girl": { shove: "assets/wallpush/pumpkin-boy-push.mp4", kick: "assets/wallpush/pumpkin-boy-break.mp4" },
    "girl":         { shove: "assets/wallpush/pumpkin-boy-push.mp4", kick: "assets/wallpush/pumpkin-boy-break.mp4" }
  };
  var FILM_FALLBACK = "pumpkin-boy";

  function canDraw(key) {
    return !!(BODIES[key] || FILM[key] || FILM[FILM_FALLBACK]);
  }

  /* every clip the duel can play, for the offline warm-up list */
  function allFilmSrcs() {
    var out = [];
    Object.keys(FILM).forEach(function (k) {
      Object.keys(FILM[k]).forEach(function (b) {
        if (out.indexOf(FILM[k][b]) < 0) out.push(FILM[k][b]);
      });
    });
    return out;
  }

  /* start loading a seat's clips without playing them, so the first beat is
     already decoded when the guess lands. Fire and forget. */
  function warmFilm(keys) {
    (keys || []).forEach(function (k) {
      var c = FILM[k] || FILM[FILM_FALLBACK];
      if (!c) return;
      Object.keys(c).forEach(function (b) {
        var v = document.createElement("video");
        v.muted = true; v.preload = "auto";
        v.src = c[b];
        v.load();
      });
    });
  }

  var loaded = {};                                  // key -> true once decoded

  function preloadBodies(keys, done) {
    var need = keys.filter(function (k, i) { return BODIES[k] && keys.indexOf(k) === i; });
    var got = 0, total = need.length;
    if (!total) { done(false); return; }
    need.forEach(function (k) {
      var img = new Image();
      img.onload = function () {
        // the aspect is read from the file, so re-exporting a sprite at a
        // different size needs no code change
        aspectByKey[k] = img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;
        loaded[k] = true;
        if (++got === total) done(true);
      };
      img.onerror = function () { if (++got === total) done(false); };
      img.src = BODIES[k];
    });
  }
  var aspectByKey = {};

  /* ---------------------------------------------------------------- standoff
     The combined screen. Where the reel above plays a fixed timeline, the
     standoff is driven entirely from outside: the clipart contest calls `steps`
     on every correct answer, `knock` once somebody has two, and `teardown` when
     the pair is done. It reuses the same rig, the same floor compensation and the
     same FX as the reel, so the two cannot drift apart in look. */
  function liveMount(duel, hooks) {
    var tok = {};
    var fav = { coins: duel.a.coins, key: duel.a.key };
    var dog = { coins: duel.b.coins, key: duel.b.key };
    var e = { tok: tok, fav: fav, dog: dog, dogWins: false,
              favRank: duel.rankA, dogRank: duel.rankB,
              /* what the verdict and the coin card call each side - a final
                 between two pair-winners has no TOP 1 to be one of */
              favLabel: duel.labelA || ("TOP " + duel.rankA),
              dogLabel: duel.labelB || ("TOP " + duel.rankB),
              st: null };

    E.NameA.textContent = duel.a.name; E.NameB.textContent = duel.b.name;
    /* the two push-power rails carry the avatars' names, so the band across
       the top reads as the matchup rather than saying PUSH POWER twice */
    E.SideA.textContent = duel.a.name;
    E.SideB.textContent = duel.b.name;
    E.TeamA.textContent = duel.a.team || ""; E.TeamB.textContent = duel.b.team || "";
    E.CoinsA.textContent = fmt(fav.coins); E.CoinsB.textContent = fmt(dog.coins);
    ["CoinsA", "CoinsB"].forEach(function (k) { E[k].parentNode.classList.remove("drain", "gain"); });
    E.Ledger.classList.remove("on");
    E.Verdict.textContent = "—";
    /* The chips over the fighters and the headline both name the avatars, not
       their seeds. A seed is data about which play-off this is, and it already
       says so in the verdict and the coin card; pinned above a fighter it just
       read as a label attached to nobody in particular. */
    E.RankA.textContent = duel.a.name;
    E.RankB.textContent = duel.b.name;
    E.RankA.className = "wp-rank name r1";
    E.RankB.className = "wp-rank name r2";
    E.Banner.querySelector(".bk").textContent = duel.title || "GUESS THE CLIPART";
    E.Banner.querySelector(".bt").textContent = duel.a.name + " vs " + duel.b.name;
    E.Banner.classList.add("on");
    E.MeterA.classList.remove("dying"); E.MeterB.classList.remove("dying");
    E.FillA.style.width = "100%"; E.FillB.style.width = "100%";
    E.PctA.textContent = "100%"; E.PctB.textContent = "100%";
    E.Wall.classList.remove("cracked", "shattered", "straining", "wp-break-a", "wp-break-b");
    fxLayer.innerHTML = "";
    stopShake();
    curKey = [null, null];

    run = { tok: tok, a: duel.a, b: duel.b, done: false, adv: 1 };
    var st = { lead: 0, target: 0, joltDir: 1, joltUntil: 0, raf: 0, geo: null, paused: false, dead: false };

    function frame() {
      if (st.dead) return;
      if (!run || run.tok !== tok) return;
      var now = performance.now();
      st.lead += (st.target - st.lead) * .2;
      if (Math.abs(st.target - st.lead) < .4) st.lead = st.target;
      st.raf = requestAnimationFrame(frame);
      if (st.paused) return;                  // the knockout owns the screen now
      var jolt = 0;
      if (now < st.joltUntil) {
        var u = 1 - (st.joltUntil - now) / 280;
        jolt = Math.sin(u * Math.PI) * .9 * st.joltDir;
      }
      /* adv follows the slab, so the side being driven back is the one who
         reads as losing ground - the same field the reel derives from the verdict */
      run.adv = st.target < 0 ? -1 : 1;
      st.geo = render(now, run.adv, { k: "live", t: 0, lead: st.lead, jolt: jolt });
    }

    /* one step per correct answer, and the corner sits at two, so both a 2-0 and
       a 2-1 finish end with the slab fully driven into the loser's side */
    function steps(n) {
      if (st.dead) return;
      var want = clamp(n, -2, 2) * (S.FULL / 2);
      /* Which cue plays follows the slab's TRAVEL, not the answerer: every
         correct answer is a push for whoever made it, so keying off the
         answerer alone would leave the brake sound unused. Driving the slab
         further from the centre is a push; bringing it back toward the side it
         came from is a brake. */
      var shoving = Math.abs(want) > Math.abs(st.target) + 1;
      st.joltDir = n < 0 ? -1 : 1;
      st.target = want;
      st.joltUntil = performance.now() + 280;
      if (st.geo) {
        st.geo.forEach(function (g) {
          if (g.pushDir === st.joltDir) { ring(g.handX, g.handY, "#ffffff"); spark(g.handX, g.handY, 3); }
        });
      }
      kick(7, 200);
      cue(shoving ? "push" : "brake");
    }

    /* the meters read 'how much of the wall you still hold': every answer the
       other side lands costs you half of it */
    function charge(a, b) {
      if (st.dead) return;
      var pa = clamp(100 - Math.max(0, b - a) * 50, 0, 100);
      var pb = clamp(100 - Math.max(0, a - b) * 50, 0, 100);
      E.FillA.style.width = pa + "%"; E.PctA.textContent = pa + "%";
      E.FillB.style.width = pb + "%"; E.PctB.textContent = pb + "%";
      E.MeterA.classList.toggle("dying", pa <= 50);
      E.MeterB.classList.toggle("dying", pb <= 50);
    }

    function knock(side, done) {
      if (st.dead) return;
      var adv = side === "a" ? 1 : -1;
      e.dogWins = adv < 0;
      e.st = settle(fav, dog, e.dogWins);
      run.adv = adv;
      st.paused = true;                    // the live loop yields to this
      st.lead = st.target = adv * S.FULL;
      st.joltUntil = 0;
      render(performance.now(), adv, { k: "live", t: 0, lead: st.lead, jolt: 0 });
      E.Wall.classList.add("shattered");
      E.FillA.style.width = (adv > 0 ? 100 : 0) + "%"; E.PctA.textContent = (adv > 0 ? 100 : 0) + "%";
      E.FillB.style.width = (adv < 0 ? 100 : 0) + "%"; E.PctB.textContent = (adv < 0 ? 100 : 0) + "%";
      (adv > 0 ? E.MeterB : E.MeterA).classList.add("dying");
      kick(26, 460);
      var face = S.CENTER + adv * S.FULL - adv * S.WALL_HW;
      ring(face, 560, "#ffffff");
      ring(face, 560, adv < 0 ? "#39a1ff" : "#ff4d62");
      debris(face, 560, adv, 18);
      var loser = st.geo ? st.geo[adv < 0 ? 0 : 1] : null;
      if (loser) {
        dust(loser.cx, S.FLOOR - 4, adv, 12);
        streaks(loser.cx, 560, adv, 5);
        skid(loser.cx, S.FLOOR + 2, adv);
        sweat(loser.cx, S.FLOOR - loser.H * .92, 6);
      }
      /* the fall's own cue fires where the fall starts, in the runner below */

      var seq = [["break", 300], ["impact", 520], ["result", 1050], ["settle", 420]], i = 0;
      (function step() {
        if (st.dead || !run || run.tok !== tok) return;
        if (i >= seq.length) {
          /* the payout gets its own beat before the receipt: coins fly, both
             sides show their + and -, and then the card itemises it */
          try {
            award(side, function () { ledger(e); if (done) done(); });
          } catch (err) {
            console.warn("wall-push: payout animation failed", err);
            ledger(e); if (done) done();
          }
          return;
        }
        var ph = seq[i++], t0 = performance.now();
        /* the loser is driven back and begins to topple during impact, which is
           the moment being scored - not the shatter that precedes it */
        if (ph[0] === "impact") cue("fall");
        (function sub() {
          if (st.dead || !run || run.tok !== tok) return;
          var t = clamp((performance.now() - t0) / (ph[1] / RATE), 0, 1);
          st.geo = render(performance.now(), adv, { k: ph[0], t: t });
          if (t < 1) requestAnimationFrame(sub); else step();
        })();
      })();
    }

    /* ------------------------------------------------------------ the payout
       The winner's gain is performed, not printed. Coins leave the loser and
       land on the winner, both sides show their own + or -, and a badge over
       the arena counts the stake up and escalates as it grows - WIN, then BIG
       WIN, then SUPER WIN. Every number here comes from settle(), so the
       animation cannot show a payout that the coin card disagrees with. */
    function award(side, done) {
      var st2 = e.st || settle(fav, dog, side === "b");
      var paid = st2.paid;
      var winner = side === "a" ? duel.a : duel.b;
      var loser = side === "a" ? duel.b : duel.a;
      var ge = st.geo || [];
      var wG = ge[side === "a" ? 0 : 1] || { cx: side === "a" ? 520 : 1080, H: 380 };
      var lG = ge[side === "a" ? 1 : 0] || { cx: side === "a" ? 1080 : 520, H: 380 };

      var el = document.createElement("div");
      el.className = "wp-award";
      el.innerHTML =
        /* no WIN / BIG WIN / SUPER WIN here: that ladder is for the one pop-up
           that closes the whole post-match, not for each round's payout */
        '<div class="wa-card">' +
          '<div class="wa-ribbon"><span class="wa-num" data-x="num">0</span></div>' +
          '<div class="wa-row">' +
            '<span class="wa-delta plus">' + winner.name + '<b data-x="wa">+0</b></span>' +
            '<span class="wa-tag" data-x="tag">takes the wall</span>' +
            '<span class="wa-delta minus"><b data-x="lo">-0</b>' + loser.name + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="wa-skip">Tap to skip</div>';

      root.classList.add("awarding");
      stage.appendChild(el);

      var ref = {};
      el.querySelectorAll("[data-x]").forEach(function (n) { ref[n.dataset.x] = n; });

      var COUNT_MS = 1500, HOLD_MS = 700, BURST_MS = 420;
      var live = { dead: false, skip: false, raf: 0 };
      var t0 = performance.now();

      function paint(v) {
        ref.num.textContent = fmt(Math.round(v));
      }
      paint(0);
      ref.wa.textContent = "+" + fmt(paid);
      ref.lo.textContent = "-" + fmt(paid);

      if (paid <= 0) {
        /* nothing to perform: the loser finished on zero, and flying coins in
           from nowhere would be lying about the payout */
        ref.tag.textContent = loser.name + " finished on 0 coins";
      } else {
        /* the grid throwing the coins back at the player who won them */
        cue("coins");
        /* three waves, loser to winner, so the transfer reads as a transfer */
        [[120, 5], [430, 6], [760, 5]].forEach(function (w) {
          window.setTimeout(function () {
            if (live.dead || st.dead) return;
            coins(lG.cx, S.FLOOR - lG.H * .62, wG.cx, S.FLOOR - wG.H * .62, w[1]);
          }, w[0]);
        });
        /* and the room showers the winner from both edges, the way a payout
           does in a match-3 */
        [[300, 40, 6], [300, 1560, 6], [920, 120, 8], [920, 1480, 8]].forEach(function (w) {
          window.setTimeout(function () {
            if (live.dead || st.dead) return;
            coins(w[1], 210, 800, 430, w[2]);
          }, w[0]);
        });
        /* no floating + and - over the fighters: the badge below already
           names both sides with their own figure, and a third copy floated
           up straight through the headline */
      }

      function frame() {
        if (live.dead) return;
        if (!live.skip) paint(paid * easeOut(clamp((performance.now() - t0) / COUNT_MS, 0, 1)));
        live.raf = requestAnimationFrame(frame);
      }
      live.raf = requestAnimationFrame(frame);

      function close() {
        if (st.dead) return;
        root.classList.remove("awarding");
        el.remove();
        if (done) done();
      }
      function finish() {
        if (live.dead) return;
        live.dead = true;
        cancelAnimationFrame(live.raf);
        window.clearTimeout(live.timer);
        paint(paid);
        glow(800, 330, 320, "rgba(255,207,37,.42)", 900);
        if (paid > 0) { kick(9, 260); ring(800, 330, "#ffe9a8"); }
        window.setTimeout(close, BURST_MS);
      }
      live.timer = window.setTimeout(finish, COUNT_MS + HOLD_MS);
      el.addEventListener("click", function () { live.skip = true; finish(); });
    }
    function teardown() {
      st.dead = true;
      if (st.raf) cancelAnimationFrame(st.raf);
      run = null;
      abort = null;
      root.classList.remove("on");
      root.classList.remove("standoff");
      fxLayer.innerHTML = "";
      stopShake();
    }

    abort = function () { if (hooks.onSkip) hooks.onSkip(); };
    root.classList.add("standoff");
    root.classList.add("on");
    fit();
    st.raf = requestAnimationFrame(frame);

    /* what settle() worked out, for a caller that has to move real balances */
    function result() {
      if (!e.st) return null;
      return { paid: e.st.paid, capped: e.st.capped,
               a: { before: e.st.favBefore, after: e.st.favAfter },
               b: { before: e.st.dogBefore, after: e.st.dogAfter } };
    }

    /* ------------------------------------------------------------- the film --
       The avatars ship as pre-rendered clips, so the arena picture is film now
       rather than two puppeted <img> sprites. The clipart contest drives it: a
       correct answer calls steps() and film(), and the answer that reaches NEED
       calls breaker(), which plays the wall giving way and drops the loser's
       seat. Everything here degrades to the old DOM duel if a clip is missing. */
    /* Battles are cut out of one clip per fighter, as three beats:
         shove -> any correct answer
         kick  -> the answer that takes the wall
         fall  -> the loser going down
       Both seats share the same fighter: seat b is the MIRROR of seat a, so a
       right-hand player shoves leftwards and gets knocked to the right using the
       very same footage. Nothing is drawn twice.
       shove and kick fall back to the canonical clip so every avatar animates
       something while the rest of the set is still being generated. `fall`
       deliberately does NOT fall back — see breaker(). */
    /* Two half-screen video layers, one per seat. Every clip is shot from the
       left seat's point of view (ninja on the LEFT, pushing RIGHT), so:
         - seat a (left)  plays its clip as-is on the LEFT half
         - seat b (right) plays the SAME footage mirrored on the RIGHT half
       The baked-in wall of each clip lands near its half's inner edge, so the two
       baked walls meet where the real drawn slab stands — the slab stays visible
       between the halves and slides with steps(), exactly as before. */
    var filmL = E.FilmL, filmR = E.FilmR;

    function seatFilmEl(side) { return side === "b" ? filmR : filmL; }

    function showFilm(key, which, side, onDone) {
      var el = seatFilmEl(side);
      if (!el) return false;
      var c = FILM[key];
      if ((!c || !c[which]) && which !== "fall") c = FILM[FILM_FALLBACK];
      if (!c || !c[which]) return false;
      var src = c[which];
      /* seat b is always the mirrored half — it plays the same left-shot footage
         flipped, so both sides of the screen show the same character */
      if (side === "b") el.classList.add("mirror");
      else el.classList.remove("mirror");
      /* always reassign, never leave a stale handler from the previous clip */
      el.onended = onDone || null;
      el.loop = false;
      if (el.getAttribute("data-src") !== src) {
        el.setAttribute("data-src", src);
        el.src = src;
        el.load();
      }
      if (stage) stage.classList.add("film");
      /* never poke currentTime before metadata exists: that stranded the element
         in NETWORK_LOADING at readyState 0 and the arena rendered black */
      var go = function () {
        try { el.currentTime = 0; } catch (err) {}
        var p = el.play();
        if (p && p.catch) p.catch(function () { /* autoplay blocked; still shows */ });
      };
      if (el.readyState >= 2) go();
      else el.addEventListener("loadeddata", go, { once: true });
      return true;
    }

    /* The side that is NOT performing this beat plays its defense clip: the
       opponent braced against the wall slides back a little as it is shoved.
       Mirrored to that seat like everything else. Returns false when no
       defense clip exists, so callers can carry on regardless. */
    function defenseFilm(side) {
      var seat = (side === "b" ? duel.b : duel.a) || {};
      return showFilm(seat.key, "defense", side);
    }

    /* one correct answer: that seat shoves the wall one step while the OTHER
       seat's defense clip plays — both sides of the screen animate at once. */
    function film(side) {
      var seat = (side === "b" ? duel.b : duel.a) || {};
      var oppSide = side === "b" ? "a" : "b";
      var pushed = showFilm(seat.key, "shove", side);
      if (pushed) defenseFilm(oppSide);
      return pushed;
    }

    /* the winning answer: the winner's final blow on their half, the LOSER's
       fall on the other half — both halves at once, no pause between them.
       The fall belongs to the losing seat and is mirrored to it, so the body
       is thrown AWAY from the wall rather than into it. The real slab gives
       way in sync: cracks spread, then it shatters toward the loser's side
       and drops out of the frame. */
    function breaker(side) {
      var winner = (side === "b" ? duel.b : duel.a) || {};
      var loser = (side === "b" ? duel.a : duel.b) || {};
      var loserSide = side === "b" ? "a" : "b";
      /* the wall cracks first, then shatters toward the losing side */
      if (E.Wall && E.Wall.classList) {
        E.Wall.classList.add("cracked");
        setTimeout(function () {
          if (!E.Wall || !E.Wall.classList) return;
          E.Wall.classList.remove("cracked", "straining");
          E.Wall.classList.add("shattered", "wp-break-" + loserSide);
        }, 620);
      }
      if (!showFilm(winner.key, "kick", side)) return false;
      /* the loser's fall starts right away on its own half; the plate-drop class
         still lands after the kick so the HUD matches the film */
      var fell = showFilm(loser.key, "fall", loserSide);
      if (stage) stage.classList.add(side === "b" ? "film-fall-a" : "film-fall-b");
      return fell || true;
    }

    return { root: root, stage: stage, duel: duel, steps: steps, charge: charge,
             knock: knock, award: award, result: result, teardown: teardown,
             film: film, breaker: breaker };
  }

  /* duels: [{ rankA, rankB, a:{name,coins,team,key}, b:{...} }, ...]
     opts:  { onReady(handle|null), onSkip, sound }
     Hands back a handle only when the sprites decoded - an armless silhouette
     cannot read as a push, so the caller is told to fall back instead. */
  function standoff(duel, opts) {
    opts = opts || {};
    SOUND = opts.sound !== false;
    RATE = 1;
    FX.shake = opts.shake !== false;  FX.debris = opts.debris !== false;
    FX.dust = opts.dust !== false;    FX.spark = opts.spark !== false;
    FX.coins = opts.coins !== false;
    build();
    var ready = opts.onReady || function () {};
    preloadBodies([duel.a.key, duel.b.key], function (ok) {
      /* Only refuse when NEITHER seat can be drawn. A film-enabled avatar ships
         no body sprite, so bailing on !ok alone skipped the entire standoff for
         every avatar outside the original boy/girl pair. */
      if (!ok && !canDraw(duel.a.key) && !canDraw(duel.b.key)) {
        console.warn("wall-push: nothing to draw for " + duel.a.key + "/" + duel.b.key);
        ready(null);
        return;
      }
      aspect = [aspectByKey[duel.a.key] || 1, aspectByKey[duel.b.key] || 1];
      /* warm the clips for these two seats while the standoff plays: the first
         shove must not stall on a cold video decode */
      warmFilm([duel.a.key, duel.b.key]);
      ready(liveMount(duel, opts));
    });
  }

  window.ChampWallPush = {
    /* duels: [{ rankA, rankB, a:{name,coins,team,key}, b:{...} }, ...] */
    play: function (duels, opts) {
      opts = opts || {};
      SOUND = opts.sound !== false;
      RATE = opts.rate || 1;
      FX.shake = opts.shake !== false;  FX.debris = opts.debris !== false;
      FX.dust = opts.dust !== false;    FX.spark = opts.spark !== false;
      FX.coins = opts.coins !== false;

      var done = opts.onDone || function () {};
      /* a player with reduced motion on should not be made to sit through 6.5s of
         animation twice, so the duel is skipped entirely rather than slowed */
      var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!duels || !duels.length || reduced) { done([]); return; }

      build();

      /* Load both bodies BEFORE showing anything. A missing sprite would fall back
         to an armless silhouette, which cannot read as a push at all, so refuse to
         present that — just hand back to the game. */
      preloadBodies([duels[0].a.key, duels[0].b.key], function (ok) {
        /* same rule as the standoff: the film can carry a seat with no sprite */
        if (!ok && !canDraw(duels[0].a.key) && !canDraw(duels[0].b.key)) {
          console.warn("wall-push: nothing to draw, skipping the duel"); done([]); return;
        }
        aspect = [aspectByKey[duels[0].a.key] || 1, aspectByKey[duels[0].b.key] || 1];

        var idx = 0, results = [], closed = false;
        root.classList.add("on");
        fit();

        function finish() {
          if (closed) return;
          closed = true;
          abort = null;
          run = null;
          root.classList.remove("on");
          fxLayer.innerHTML = "";
          stopShake();
          done(results);
        }
        function next() {
          if (idx >= duels.length) { finish(); return; }
          var d = duels[idx];
          /* the callout between matches, so it is obvious this is a series */
          if (idx > 0) {
            E.Next.querySelector("b").textContent = "NEXT";
            E.Next.querySelector("span").textContent = "TOP " + d.rankA + " vs TOP " + d.rankB;
            E.Next.classList.add("on");
            setTimeout(function () { E.Next.classList.remove("on"); }, 1400 / RATE);
          }
          runDuel(d, function (res) {
            results.push(res);
            idx++;
            setTimeout(next, 900 / RATE);
          });
        }
        abort = finish;                            // the SKIP control
        next();
      });
    },
    standoff: standoff,
    spriteFor: function (key) { return BODIES[key]; }
  };
})();
