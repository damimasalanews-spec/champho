/* ===========================================================================
   RECORDED CUES
   ---------------------------------------------------------------------------
   The arena's own sound effects are synthesised at runtime. These three cannot
   be, so they are files:

     throwWord  a word being thrown at the grid, before it dances
     danceTick  the beat the word dances on
     coins      the grid throwing coins back at a player
     push       a correct answer driving the slab at the opponent
     brake      a shove bringing the slab back toward its own side
     superWin   the pop-up that closes the post-match

   Both supplied sounds arrived carrying more than the game wants. The throw is
   a 0.45s hit followed by 1.8s of silence, which as a cue would be a click and
   then nothing; the coin run is 4.7s continuous, far longer than one round's coin
   flight. So sound1 is cut to 0.55s, and sound2 is cut twice - a 1.9s cue for a
   round payout and the full run for the closing pop-up. Both ends of each cue are
   faded so they cannot click.

   Mute follows the game's own speaker button rather than keeping a second
   opinion, so the one control governs every sound in the page.
   =========================================================================== */
(() => {
  "use strict";
  if (window.ChampCues) return;

  const FILES = {
    throwWord: "assets/audio/word-throw.mp3",
    coins: "assets/audio/coins.mp3",
    superWin: "assets/audio/super-win.mp3",
    danceTick: "assets/audio/dance-tick.mp3",
    push: "assets/audio/push.mp3",
    brake: "assets/audio/brake.mp3"
  };
  /* mixed down from their originals, which are loud and slightly clipped */
  const VOLUME = { throwWord: 0.5, coins: 0.62, superWin: 0.75, danceTick: 0.4,
                   push: 0.8, brake: 0.75 };

  const cache = {};

  function muted() {
    try {
      const c = window.__champCoins;
      return !!(c && typeof c.isMuted === "function" && c.isMuted());
    } catch (e) { return false; }
  }

  /* One element per cue, rewound on use. These never overlap in practice - a
     throw is a keypress, a coin run is a beat - so a pool would be bookkeeping
     for a case that does not arise. */
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
