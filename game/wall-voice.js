/* ===========================================================================
   WALL VOICE — the fight's announcer
   ---------------------------------------------------------------------------
   A character voice that reads the fight's shout text aloud during the wall
   push: the hype calls, the bot taunts, the sudden-death cries.

   WHY NOT speechSynthesis ALONE
   The default voices sound like a desktop assistant, not like a fighter, and
   what is installed changes from phone to phone. So the default path here is a
   tiny synthesised voice: a buzzy, pitched formant source that behaves like a
   cartoon ninja — each call is spoken as syllables (rough vowel formants +
   consonant noise bursts), pitch-bent by punctuation, and the whole thing is
   pitched high and snappy, like a masked fighter barking through a scarf.
   speechSynthesis is only the fallback (same text, rate 1.15, pitch 1.7) for
   when WebAudio is unavailable — and even then it is high-pitched to stay in
   character.
   =========================================================================== */
(function () {
  "use strict";
  if (window.WallVoice) return;

  /* ------------------------------------------------------------ voice shape */
  var PITCH = 1.55;        /* global pitch multiplier - the "ninja" register  */
  var SPEED = 1.18;        /* syllables fly: a shout, not a lecture           */
  var GAP = 0.055;         /* seconds between syllables                       */
  var RATE = 0.62;         /* master loudness of the voice                    */

  /* Rough vowel formants (Hz). Real vowels are two resonances; these pairs are
     tuned by ear to stay intelligible through the buzzy source. */
  var VOWELS = {
    a: [800, 1200], e: [500, 1900], i: [330, 2500],
    o: [480, 850], u: [340, 800], y: [330, 2200]
  };
  /* consonant manners the shouter actually needs */
  var STOPS = "ptkbdg";          /* a noise burst, then a beat of silence    */
  var FRICS = "sfzhcvxj";        /* a longer band of hiss                    */
  var NASALS = "mn";             /* hum through the nose                     */

  var ctx = null, lastText = "", lastAt = 0;

  function ac() {
    if (ctx) return ctx.state === "suspended" ? (ctx.resume(), ctx) : ctx;
    try {
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      ctx = new C();
      return ctx;
    } catch (e) { return null; }
  }

  function muted() {
    try { return !!(window.ChampCues && window.ChampCues.muted && window.ChampCues.muted()); }
    catch (e) { return false; }
  }

  /* one voiced syllable: a sawtooth at the base pitch, bent down through the
     syllable, through two bandpass formants - a vowel. */
  function syllable(c, t0, dur, f0, vowel) {
    var a = ac(); if (!a) return;
    var fm = VOWELS[vowel] || VOWELS.a;

    var osc = a.createOscillator(); osc.type = "sawtooth";
    osc.frequency.setValueAtTime(f0, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(60, f0 * 0.72), t0 + dur);

    var g = a.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(RATE, t0 + 0.02);
    g.gain.setValueAtTime(RATE, t0 + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);

    var f1 = a.createBiquadFilter(); f1.type = "bandpass"; f1.Q.value = 5;
    f1.frequency.value = fm[0];
    var f2 = a.createBiquadFilter(); f2.type = "bandpass"; f2.Q.value = 6;
    f2.frequency.value = fm[1];
    var mix = a.createGain(); mix.gain.value = 0.55;

    osc.connect(g); g.connect(f1); f1.connect(mix); g.connect(f2); f2.connect(mix);
    mix.connect(a.destination);
    osc.start(t0); osc.stop(t0 + dur + 0.03);

    if (STOPS.indexOf(c) >= 0) burst(a, t0, 0.03, 2600, RATE * 0.8);
    else if (FRICS.indexOf(c) >= 0) burst(a, t0, Math.min(0.09, dur * 0.4), 3400, RATE * 0.5);
    else if (NASALS.indexOf(c) >= 0) g.gain.setValueAtTime(RATE * 0.8, t0 + dur * 0.5);
  }

  /* an unvoiced noise burst: consonants, the "k!" in a shout */
  function burst(a, t0, dur, hz, gain) {
    var n = Math.max(1, Math.floor(a.sampleRate * dur));
    var b = a.createBuffer(1, n, a.sampleRate), d = b.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var s = a.createBufferSource(); s.buffer = b;
    var f = a.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = hz; f.Q.value = 1.2;
    var g = a.createGain(); g.gain.value = gain;
    s.connect(f); f.connect(g); g.connect(a.destination);
    s.start(t0);
  }

  /* split a shout into syllables the way it is shouted: CV chunks, vowels
     carrying the pitch, punctuation bending the phrase. */
  function plan(text) {
    var words = String(text || "").toLowerCase().replace(/[^a-z0-9\s!?'-]/g, "").split(/\s+/).filter(Boolean);
    var out = [];
    words.forEach(function (w, wi) {
      var chunks = w.match(/[^aeiouy]*[aeiouy]+(?:[^aeiouy]*(?=[^aeiouy][aeiouy])|[^aeiouy]*$)/g) || [w];
      chunks.forEach(function (ch, ci) {
        var m = ch.match(/^([^aeiouy]*)[aeiouy]*([aeiouy])[aeiouy]*(.*)$/);
        var cons = m ? m[1] : "", vowel = m ? m[2] : "a", tail = m ? m[3] : "";
        out.push({
          c: cons.charAt(cons.length - 1) || "",
          v: vowel,
          end: wi === words.length - 1 && ci === chunks.length - 1,
          bang: /!/.test(w),
          tail: tail
        });
      });
    });
    return out;
  }

  function speakSynth(text) {
    var a = ac(); if (!a) return false;
    if (a.state === "suspended") { try { a.resume(); } catch (e) {} }
    var syl = plan(text);
    if (!syl.length) return false;
    /* shout contour: starts high, ends higher if the line ends in a bang */
    var base = 128 * PITCH;
    var t = a.currentTime + 0.02;
    syl.forEach(function (s, i) {
      var u = i / Math.max(1, syl.length - 1);
      var f0 = base * (1.06 - 0.1 * u) * (s.bang ? 1.12 : 1) * (0.94 + Math.random() * 0.12);
      var dur = (0.13 + Math.random() * 0.05) / SPEED;
      syllable(s.c, t, dur, f0, s.v);
      t += dur + GAP / SPEED;
      if (s.end && s.bang) t += 0.07;                    /* a beat on the bang */
    });
    return true;
  }

  function speakTTS(text) {
    try {
      var S = window.speechSynthesis;
      if (!S) return false;
      var u = new SpeechSynthesisUtterance(String(text).replace(/[🔥👑🥇🪙]/g, ""));
      u.rate = 1.15; u.pitch = 1.7; u.volume = 0.9;
      S.speak(u);
      return true;
    } catch (e) { return false; }
  }

  /* ------------------------------------------------------------ the module */
  window.WallVoice = {
    /* say a line of fight text. Skips duplicates fired within 900ms (a burst of
       calls all quoting the same shout would stack into mush), and stays
       perfectly quiet when the game's sound is muted. */
    say: function (text) {
      var line = String(text || "").trim();
      if (!line) return false;
      var now = Date.now();
      if (line === lastText && now - lastAt < 900) return false;
      lastText = line; lastAt = now;
      if (muted()) return false;
      if (speakSynth(line)) return true;
      return speakTTS(line);
    },
    /* stop anything pending (a duel ended mid-shout) */
    hush: function () {
      try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {}
      lastText = ""; lastAt = 0;
    }
  };
})();
