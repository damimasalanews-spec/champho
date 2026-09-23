'use strict';

/* ---------------- sound (all original, synthesized) ----------------
   Split out of game.js so the emote set can be previewed and reused without
   dragging in the whole game. Everything is generated at runtime - there are no
   audio files to load, which is why a mute switch is a single flag. */

let AC = null;
let soundMuted = false;
function setSoundMuted(v) { soundMuted = !!v; }

function ac() {
  if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
  if (AC.state === 'suspended') AC.resume();
  return AC;
}

function note(freq, dur = 0.12, type = 'sine', gain = 0.05, when = 0, slideTo = null, force = false) {
  if (soundMuted && !force) return;
  try {
    const c = ac(), o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, c.currentTime + when);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + when + dur);
    g.gain.setValueAtTime(gain, c.currentTime + when);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + when + dur);
    o.connect(g).connect(c.destination);
    o.start(c.currentTime + when); o.stop(c.currentTime + when + dur + 0.02);
  } catch (e) { /* audio unavailable */ }
}

function whoosh(dur = 0.25, gain = 0.05, when = 0, freq = 1200) {
  if (soundMuted) return;
  try {
    const c = ac(), len = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq;
    const g = c.createGain(); g.gain.value = gain;
    src.connect(f).connect(g).connect(c.destination);
    src.start(c.currentTime + when);
  } catch (e) { /* audio unavailable */ }
}

/* --- Juicy Card Game Sound Synthesizers --- */

// 1. A short, high-frequency white noise ruffle for hovering or moving cards
function playCardRuffleSound() {
  if (soundMuted) return;
  // Shorter, lighter bandpass whoosh at 1800Hz to simulate cardboard rubbing air
  whoosh(0.12, 0.03, 0, 1800);
}

// 2. A snappy double-pulse analog pop that simulates a solid card hitting a tabletop
function playCardSlamSound() {
  if (soundMuted) return;
  // A rapid downward frequency slide mimicking a physical tap impact
  note(450, 0.08, 'triangle', 0.12, 0, 120);
  // A secondary micro-thud 30ms later for real physical texture
  note(220, 0.06, 'sine', 0.08, 0.03, 80);
}

/* --- Action Card Special Effects --- */

// A futuristic, ascending 3-note arpeggio that alerts everyone a color choice is happening
function playWildCardSound() {
  if (soundMuted) return;
  // Three quick, snappy sine notes climbing up in pitch
  note(400, 0.08, 'sine', 0.06, 0.00, 600);
  note(600, 0.08, 'sine', 0.06, 0.06, 800);
  note(800, 0.15, 'sine', 0.06, 0.12, 1200);
}

// A sharp, technical "de-acceleration" tone indicating a turn was blocked
function playSkipCardSound() {
  if (soundMuted) return;
  // A triangle wave sliding downwards rapidly, followed by a blunt stop
  note(600, 0.14, 'triangle', 0.08, 0, 150);
  // Add a small metallic friction noise overlaid right on top
  whoosh(0.10, 0.02, 0, 900);
}

// A chaotic, multi-layered rhythmic whoosh-cascade for forced draws (e.g., Draw 2 / Draw 4)
function playDrawCardSound() {
  if (soundMuted) return;
  // Staggered ruffles mimicking multiple cards dealing off the top of the deck rapidly
  whoosh(0.08, 0.04, 0.00, 1600);
  whoosh(0.08, 0.04, 0.05, 1400);
  whoosh(0.08, 0.04, 0.10, 1200);
  // A foundational low-end reminder that you just took damage
  note(180, 0.20, 'sine', 0.05, 0.00, 100);
}

/**
 * The turn clock, ticking.
 *
 * A dry wood-block click, one per second: high and quiet while there is time, and
 * lower and louder once the clock is nearly out, so the warning is audible without
 * the tick ever competing with the cards. Arrived with the Go Wild page's own
 * sheet; it is the one function that page needed and this file lacked.
 */
function playTimerTickSound(isUrgent = false) {
  if (soundMuted) return;
  const pitch = isUrgent ? 580 : 920;
  const gainVolume = isUrgent ? 0.08 : 0.03;
  const durTime = isUrgent ? 0.04 : 0.02;
  note(pitch, durTime, 'triangle', gainVolume, 0, pitch - 180);
}

/**
 * The colour wheel opening.
 *
 * A four-note climb that rises with the wheel as it twists open, so the choice
 * arrives with a bit of ceremony rather than as a silent menu.
 */
function playColorWheelOpenSound() {
  if (soundMuted) return;
  note(350, 0.10, 'sine', 0.05, 0.00, 450);
  note(450, 0.10, 'sine', 0.05, 0.06, 550);
  note(550, 0.10, 'sine', 0.05, 0.12, 700);
  note(700, 0.18, 'sine', 0.07, 0.18, 1100);
}
