/* ===========================================================================
   RECORDED CUES
   ---------------------------------------------------------------------------
   The arena's own sound effects are synthesised at runtime. These cannot be, so
   they are files:

     throwWord  a word being thrown at the grid, before it dances
     danceTick  the beat the word dances on
     coins      the grid throwing coins back at a player
     yeah       the player's own reaction as those coins land
     push       a correct answer driving the slab at the opponent
     brake      a shove bringing the slab back toward its own side
     fall       the losing avatar going down at the end of a duel
     superWin   the pop-up that closes the post-match

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
    danceTick: "assets/audio/dance-tick.mp3",
    push: "assets/audio/push.mp3",
    brake: "assets/audio/brake.mp3",
    fall: "assets/audio/avatar-fall.mp3"
  };
  /* The mix, now that every file peaks at the same level. The coin beat plays
     coins and yeah together and the two peaks can land on the same frame, so
     coins gives up about 1 dB to the voice reacting to it - without that the
     pair sums past full scale. yeah sits just above the jingle, because a voice
     has to be a little forward of the bed it plays over to be heard AS a voice.
     throwWord gains ~1 dB: it is peak-matched to the cue it replaces, but it is
     a more transient sound, so its average energy is lower. The rest are as they
     were. */
  const VOLUME = { throwWord: 0.55, coins: 0.55, yeah: 0.66, superWin: 0.75,
                   push: 0.8, brake: 0.75, fall: 0.85 };

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

  function preload() {
    Object.keys(FILES).forEach(n => { try { element(n); } catch (e) {} });
  }

  window.ChampCues = { play, preload, files: FILES, muted };
})();
