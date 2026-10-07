/* ===========================================================================
   RECORDED CUES
   ---------------------------------------------------------------------------
   The arena's own sound effects are synthesised at runtime. These cannot be, so
   they are files:

     throwWord  a word being thrown at the grid, before it dances
     bounce     the ball the dancing word bounces on
     coins      the grid throwing coins back at a player
     yeah       the player's own reaction as those coins land
     push       a correct answer driving the slab at the opponent
     brake      a shove bringing the slab back toward its own side
     kick       the deciding blow landing on the wall
     fall       the losing avatar going down at the end of a duel
     superWin   the pop-up that closes the post-match
     music      the loop under the wall push, first round to last

   Every supplied file arrived carrying more than the game wants, so each is cut to
   its content and peak-normalised to about -2 dBFS. That normalisation is what
   makes the single VOLUME map below mean anything across sounds that were
   recorded at wildly different levels:

     wordsthrow1  the sound is only ~0.5s long, but it sat behind 0.36s of digital
                  silence and a 0.54s tail, and its loudest sample was -16.4 dB.
                  Cut to 0.65s and lifted 18 dB. It replaces word-throw.mp3, which
                  stays on disk unreferenced: a client still holding a cached
                  audio-cues.js would otherwise 404 into silence.
     coins        cut to 1.25s. The coin flight is over in 0.94s
                  (FLIGHT_MS 720 + POP_MS 220), so the old 1.9s ring outlasted
                  every coin on screen.
     yeah         a voice peaking at 0.0 dBFS - already hard against the ceiling -
                  with a click in front and a 0.7s near-silent tail. Cut to 1.03s
                  so it lands with the shower it reacts to.
     superWin     cut to 2.6s: covers the badge build without outlasting it.

   The coin beat now carries two of them at once, the jingle and the reaction, so
   the note on VOLUME below matters. Both ends of every cut are faded, so none of
   them can click.

   Mute follows the game's own speaker button rather than keeping a second
   opinion, so the one control governs every sound in the page.
   =========================================================================== */
(() => {
  "use strict";
  if (window.ChampCues) return;

  const FILES = {
    throwWord: "assets/audio/wordsthrow1.mp3",
    coins: "assets/audio/coins.mp3",
    yeah: "assets/audio/yeah.mp3",
    superWin: "assets/audio/super-win.mp3",
    bounce: "assets/audio/bounce.mp3",
    music: "assets/audio/music.mp3",
    push: "assets/audio/push.mp3",
    brake: "assets/audio/brake.mp3",
    kick: "assets/audio/kick.mp3",
    fall: "assets/audio/fall.mp3",
    /* the one emoji's own laugh, recorded by the player (game/emoji/) */
    haha: "game/emoji/haha-sound.mp3"
  };
  /* The mix, now that every file peaks at the same level. The coin beat plays
     coins and yeah together and the two peaks can land on the same frame, so
     coins gives up about 1 dB to the voice reacting to it - without that the
     pair sums past full scale. yeah sits just above the jingle, because a voice
     has to be a little forward of the bed it plays over to be heard AS a voice.
     throwWord gains ~1 dB: it is peak-matched to the cue it replaces, but it is
     a more transient sound, so its average energy is lower.

     bounce replaces danceTick. Its average energy is low (-26.8 dB against the
     family's -20 to -24) because a ball spends most of its time in the air being
     silent, so it is levelled on peak, where it matches yeah. The letters are
     animated from its measured impacts, so the last few near-inaudible hops are
     near-invisible too, by construction rather than by taste.

     Every cue in FILES must have a level here: a missing key does not fail, it
     falls back to full volume. fix-volume-map.py asserts the two agree.

     music is the odd one out: it is a bed, not an event, so it is set against
     the effects rather than peak-matched to them. At 0.36 its peaks land about
     9 dB under push and fall, which is where a background loop stops competing
     with the hits it plays under. */
  const VOLUME = { throwWord: 0.55, coins: 0.55, yeah: 0.66, superWin: 0.75,
                   bounce: 0.68, push: 0.8, brake: 0.75, kick: 0.8, fall: 0.85,
                   music: 0.36, haha: 0.8 };

  const cache = {};

  function muted() {
    try {
      const c = window.__champCoins;
      return !!(c && typeof c.isMuted === "function" && c.isMuted());
    } catch (e) { return false; }
  }

  /* One element per cue, rewound on use. Nothing ever needs two of the SAME cue
     at once - a throw is a keypress, a coin run is a beat - so a pool would be
     bookkeeping for a case that does not arise. coins and yeah do overlap, but
     deliberately and as separate names, so they are separate elements. */
  function element(name) {
    if (cache[name]) return cache[name];
    const a = new Audio(FILES[name]);
    a.preload = "auto";
    /* A cue added to FILES without a level here used to fall through to
       full volume, which is not a neutral default - it is the loudest this
       cue can be. Silent when it happens, so it says so now. */
    if (VOLUME[name] === undefined) console.warn("audio-cues: no VOLUME for '" + name + "' - playing it at full level");
    a.volume = VOLUME[name] === undefined ? 1 : VOLUME[name];
    cache[name] = a;
    return a;
  }

  function play(name) {
    if (!FILES[name] || muted()) return false;
    try {
      const a = element(name);
      a.currentTime = 0;
      const p = a.play();
      /* rejected until the page has had a gesture, or with no audio device -
         neither is worth a console error */
      if (p && p.catch) p.catch(() => {});
      return true;
    } catch (e) { return false; }
  }

  /* one front door for every cue, recorded or synthesised: callers say "crack"
     and do not have to know whether the sound came from a file. The synth names
     are checked first, then the file map. */
  function playAny(name) {
    if (playSynth(name)) return true;
    return play(name);
  }

  /* ------------------------------------------------------------------- loop
     Music is the one cue that is not a one-shot: it runs for as long as the wall
     push does. `looping` is what the mute toggle reaches through, and a repeat
     call is deliberately NOT rewound - loop("music") while it is already playing
     must not restart the track in the middle of a round. */
  const looping = [];

  function loop(name) {
    if (!FILES[name] || muted()) return false;
    try {
      const a = element(name);
      a.loop = true;
      if (name === "music") { try { a.playbackRate = heatLevel; } catch (e) {} }
      if (looping.indexOf(name) < 0) looping.push(name);
      if (a.paused) {
        a.currentTime = 0;
        const p = a.play();
        /* rejected until the page has had a gesture, or with no audio device */
        if (p && p.catch) p.catch(() => {});
      }
      return true;
    } catch (e) { return false; }
  }

  function stop(name) {
    const i = looping.indexOf(name);
    if (i >= 0) looping.splice(i, 1);
    try {
      /* the cached element only: stopping must never CREATE a cue that was never
         played, which going through element() would do */
      const a = cache[name];
      if (!a) return false;
      a.loop = false;
      a.pause();
      a.currentTime = 0;
      return true;
    } catch (e) { return false; }
  }

  /* The mute toggle sits on the board, under the wall push overlay, so in practice
     it cannot be pressed mid-round - but the state it sets has to be true, or the
     music plays on over a page that says it is muted. */
  function syncMute() {
    looping.slice().forEach(name => {
      const a = cache[name];
      if (!a) return;
      if (muted()) a.pause();
      else if (a.paused) { const p = a.play(); if (p && p.catch) p.catch(() => {}); }
    });
  }

  /* ------------------------------------------------------------- music heat
     The final duel should sound bigger than a pair round, and the music is a
     single looped bed - so "intensified" is playbackRate. A 1.3x bed is the
     classic last-lap lift; pitch follows rate on an <audio> element, which is
     exactly the effect. heat(1) returns the bed to normal and also RESETS the
     rate of a stopped/never-played element, so the next loop() starts clean. */
  let heatLevel = 1;
  function heat(v) {
    if (v !== undefined) {
      heatLevel = v;
      const a = cache.music;
      if (a) { try { a.playbackRate = v; } catch (e) {} }
    }
    return heatLevel;
  }
  /* one sweep to find any missed looped cue (currently only music can loop) */

  function preload() {
    Object.keys(FILES).forEach(n => { try { element(n); } catch (e) {} });
  }

  /* -------------------------------------------------------------- synth cues
     Four tiny hits that exist only to make the answers physical. There are no
     files for them, so they are synthesised: a rising two-note ding for a
     correct answer, a flat descending buzz for a wrong one, a snare-like crack
     for the wall giving way, and a soft tock for the last five seconds of a
     clock. They follow the same mute switch as the files, and they silently do
     nothing when the browser has no AudioContext. */
  let synthCtx = null;
  function synth() {
    if (muted()) return null;
    try {
      if (!synthCtx) {
        const C = window.AudioContext || window.webkitAudioContext;
        if (!C) return null;
        synthCtx = new C();
      }
      if (synthCtx.state === "suspended") synthCtx.resume();
      return synthCtx;
    } catch (e) { return null; }
  }
  function blip(freq, freqEnd, dur, type, gain) {
    const c = synth();
    if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, c.currentTime);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), c.currentTime + dur);
    g.gain.setValueAtTime(0, c.currentTime);
    g.gain.linearRampToValueAtTime(gain, c.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.connect(g); g.connect(c.destination);
    o.start(); o.stop(c.currentTime + dur + 0.03);
  }
  function noiseBurst(dur, hz, gain) {
    const c = synth();
    if (!c) return;
    const n = Math.floor(c.sampleRate * dur), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 1.8);
    const s = c.createBufferSource(); s.buffer = b;
    const f = c.createBiquadFilter(); f.type = "highpass"; f.frequency.value = hz;
    const g = c.createGain(); g.gain.value = gain;
    s.connect(f); f.connect(g); g.connect(c.destination); s.start();
  }
  const SYNTH = {
    correct() { blip(620, null, 0.09, "triangle", 0.16); setTimeout(() => blip(930, null, 0.16, "triangle", 0.16), 90); },
    wrong()   { blip(220, 110, 0.28, "sawtooth", 0.12); },
    crack()   { noiseBurst(0.4, 1400, 0.28); blip(150, 60, 0.3, "square", 0.1); },
    tick()    { blip(1150, null, 0.05, "square", 0.05); },
    /* the crowd erupting: layered noise beds - a wide hiss with slow attack
       (the roar), an airy high band (whistles), two whoop sweeps up and down.
       Louder than a blip, quieter than slam, over before the next beat. */
    cheer()   { noiseBurst(0.9, 500, 0.34); blip(320, 900, 0.55, "sawtooth", 0.07); setTimeout(() => blip(880, 240, 0.5, "square", 0.05), 140); }
  };
  function playSynth(name) {
    if (!SYNTH[name] || muted()) return false;
    try { SYNTH[name](); return true; } catch (e) { return false; }
  }

  window.ChampCues = { play, loop, stop, syncMute, preload, files: FILES, muted, playAny, heat };
})();
