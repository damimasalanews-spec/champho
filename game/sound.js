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
