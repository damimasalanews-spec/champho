'use strict';

/* ---------------- the Champword emote set ----------------
   Eight expressions in the same spirit as the official UNO! Mobile rabbit emoji
   set (confident, suspicious, laughing, devil, party, wide-eyed, tongue-out,
   sad) - the drawing is our own, built from SVG so it renders identically
   everywhere instead of depending on a colour-emoji font.

   Send one and it performs over the recipient's seat for EXACTLY 2s, then
   clears itself. Each expression has its own little motif, and each has its own
   sound stack built from the synth in game.js. */

const RB = { head: '#e0403a', shade: '#a8211b', line: '#6d100c', ear: '#f2c14e', earLine: '#bd8f28', eye: '#fffdf7' };

function rbEars() {
  return '<g class="rb-ears">' +
    '<path d="M43 27 C37 17 31 10 25 4" stroke="' + RB.earLine + '" stroke-width="9" fill="none" stroke-linecap="round"/>' +
    '<path d="M57 27 C63 17 69 10 75 4" stroke="' + RB.earLine + '" stroke-width="9" fill="none" stroke-linecap="round"/>' +
    '<path d="M43 27 C37 17 31 10 25 4" stroke="' + RB.ear + '" stroke-width="6" fill="none" stroke-linecap="round"/>' +
    '<path d="M57 27 C63 17 69 10 75 4" stroke="' + RB.ear + '" stroke-width="6" fill="none" stroke-linecap="round"/>' +
    '</g>';
}

function rbBody() {
  return '<ellipse cx="50" cy="90" rx="24" ry="5.5" fill="#0b1c30" opacity=".35"/>' +
    '<path class="rb-body" d="M50 23 C31 23 25 37 25 56 C25 74 30 87 50 87 C70 87 75 74 75 56 C75 37 69 23 50 23 Z" ' +
    'fill="' + RB.head + '" stroke="' + RB.line + '" stroke-width="2.4"/>' +
    /* belly in shadow, inset so it can never bleed past the outline */
    '<path d="M27.5 62 C29 75 35 85 50 85 C65 85 71 75 72.5 62 C68 71 60 75 50 75 C40 75 32 71 27.5 62 Z" ' +
    'fill="' + RB.shade + '" opacity=".5"/>' +
    '<ellipse cx="41" cy="36" rx="12.5" ry="6.5" fill="#ffffff" opacity=".2"/>' +
    '<path d="M29 40 C26.5 50 27.5 62 31 71" stroke="#ffffff" stroke-width="2.6" opacity=".22" fill="none" stroke-linecap="round"/>';
}

/* eyes: each variant returns the whites, the pupils and any brows/lids */
function rbEyes(kind) {
  const white = (cx, cy, rx, ry) => '<ellipse class="rb-eye" cx="' + cx + '" cy="' + cy + '" rx="' + rx + '" ry="' + ry + '" fill="' + RB.eye + '"/>';
  /* pupil and its glint travel together as one group, so the peek/pin/shrink
     animations move the highlight with the pupil instead of leaving it behind */
  const pupil = (cx, cy, r) => '<g class="rb-pupil">' +
    '<circle class="rb-pupil-c" cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="#2b1410"/>' +
    '<circle cx="' + (cx - r * 0.34) + '" cy="' + (cy - r * 0.4) + '" r="' + (r * 0.32) + '" fill="#ffffff" opacity=".9"/>' +
    '</g>';
  const brow = (d) => '<path class="rb-brow" d="' + d + '" stroke="' + RB.line + '" stroke-width="3.4" fill="none" stroke-linecap="round"/>';
  const lid = (d) => '<path d="' + d + '" stroke="' + RB.line + '" stroke-width="3" fill="none" stroke-linecap="round"/>';
  switch (kind) {
    case 'angry':
      return white(39, 52, 11.5, 12) + white(61, 52, 11.5, 12) + pupil(40, 53, 5) + pupil(60, 53, 5) +
        brow('M29 41 L46 48') + brow('M71 41 L54 48');
    case 'squint':
      return '<ellipse class="rb-eye" cx="39" cy="54" rx="11.5" ry="5.6" fill="' + RB.eye + '"/>' +
        '<ellipse class="rb-eye" cx="61" cy="54" rx="11.5" ry="5.6" fill="' + RB.eye + '"/>' +
        pupil(43, 54, 4.6) + pupil(66, 54, 4.6) +
        lid('M28 47 L50 47') + lid('M50 47 L72 47') + brow('M30 40 L44 44') + brow('M70 40 L56 44');
    case 'happy':
      return '<path class="rb-eye" d="M30 55 q9 -13 18 0" stroke="' + RB.line + '" stroke-width="4" fill="none" stroke-linecap="round"/>' +
        '<path class="rb-eye" d="M52 55 q9 -13 18 0" stroke="' + RB.line + '" stroke-width="4" fill="none" stroke-linecap="round"/>';
    case 'shock':
      return white(39, 51, 13, 14.5) + white(61, 51, 13, 14.5) + pupil(39, 51, 2.6) + pupil(61, 51, 2.6) +
        brow('M27 34 L46 38') + brow('M73 34 L54 38');
    case 'flat':
      /* unimpressed: heavy lids, no brows - keeps it distinct from 'shock' */
      return white(39, 53, 11.5, 9) + white(61, 53, 11.5, 9) + pupil(39, 55, 5) + pupil(61, 55, 5) +
        lid('M28 46 L50 46') + lid('M50 46 L72 46');
    case 'sad':
      /* inner ends of the brows lift, outer ends drop - the opposite slope to
         'angry', or the face just reads as grumpy */
      return white(39, 53, 11.5, 11.5) + white(61, 53, 11.5, 11.5) + pupil(39, 58, 4.6) + pupil(61, 58, 4.6) +
        brow('M29 47 L46 40') + brow('M71 47 L54 40');
    default:
      return white(39, 52, 11.5, 12.5) + white(61, 52, 11.5, 12.5) + pupil(39, 52, 5.2) + pupil(61, 52, 5.2);
  }
}

function rbMouth(kind) {
  const dark = '#380d0a';
  switch (kind) {
    case 'shout': return '<ellipse class="rb-mouth" cx="50" cy="72" rx="9.5" ry="11.5" fill="' + dark + '"/>' +
      '<rect x="43" y="62.5" width="14" height="4.5" rx="1.8" fill="#fffdf7"/>' +
      '<ellipse cx="50" cy="79" rx="5.5" ry="4" fill="#c1342c"/>';
    case 'laugh': return '<path class="rb-mouth" d="M35 65 Q50 86 65 65 Z" fill="' + dark + '"/>' +
      '<rect class="rb-teeth" x="38" y="64" width="24" height="5.5" rx="2" fill="#fffdf7"/>';
    case 'fang': return '<ellipse class="rb-mouth" cx="50" cy="70" rx="10.5" ry="9.5" fill="' + dark + '"/>' +
      '<path d="M41 65 L46 65 L43.5 72 Z" fill="#fffdf7"/><path d="M54 65 L59 65 L56.5 72 Z" fill="#fffdf7"/>';
    case 'o': return '<ellipse class="rb-mouth" cx="50" cy="71" rx="5.5" ry="6.5" fill="' + dark + '"/>';
    case 'frown': return '<path class="rb-mouth" d="M41 75 Q50 66 59 75" stroke="' + RB.line + '" stroke-width="3.2" fill="none" stroke-linecap="round"/>';
    case 'tongue': return '<ellipse class="rb-mouth" cx="50" cy="69" rx="9.5" ry="8" fill="' + dark + '"/>' +
      '<path class="rb-tongue" d="M43 72 q7 17 14 0 z" fill="#f2739b" stroke="#c2405f" stroke-width="1.6"/>';
    default: return '<path class="rb-mouth" d="M41 70 Q50 77 60 67" stroke="' + RB.line + '" stroke-width="3.2" fill="none" stroke-linecap="round"/>';
  }
}

function rbHat(tilt) {
  return '<g class="rb-hat" transform="rotate(' + (tilt || 0) + ' 50 24)">' +
    '<rect x="39" y="0" width="22" height="21" fill="#2a1d19" stroke="' + RB.line + '" stroke-width="2"/>' +
    '<rect x="39" y="12" width="22" height="5" fill="#8c3a34"/>' +
    '<rect x="30" y="19" width="40" height="6.5" rx="3.2" fill="#2a1d19" stroke="' + RB.line + '" stroke-width="2"/>' +
    '</g>';
}
function rbArms() {
  return '<g class="rb-arms">' +
    '<rect x="11" y="57" width="15" height="10.5" rx="5" fill="' + RB.shade + '" stroke="' + RB.line + '" stroke-width="2"/>' +
    '<rect x="74" y="57" width="15" height="10.5" rx="5" fill="' + RB.shade + '" stroke="' + RB.line + '" stroke-width="2"/>' +
    '</g>';
}
function rbWing() {
  return '<path class="rb-wing" d="M74 44 q16 -10 22 4 q-12 8 -22 4 z" fill="#5b2a6b" stroke="' + RB.line + '" stroke-width="2"/>';
}
/* a cupcake: iced top, sponge below, cherry on it - a bare blue box did not read
   as a cake at this size */
function rbCake(x) {
  return '<g class="rb-cake-' + (x < 50 ? '1' : '2') + '">' +
    '<rect x="' + x + '" y="73" width="19" height="13" rx="3" fill="#7fc9ea" stroke="' + RB.line + '" stroke-width="2"/>' +
    '<rect x="' + (x + 1.5) + '" y="77" width="16" height="2.4" fill="#5fb0d6"/>' +
    '<path d="M' + x + ' 74 q4.75 4.5 9.5 0 q4.75 -4.5 9.5 0 v-6 h-19 z" fill="#fff8ee" stroke="' + RB.line + '" stroke-width="2"/>' +
    '<circle cx="' + (x + 9.5) + '" cy="64" r="3.4" fill="#e0403a" stroke="' + RB.line + '" stroke-width="1.6"/>' +
    '</g>';
}
function rbCakes() {
  return '<g class="rb-cakes">' + rbCake(3) + rbCake(78) + '</g>';
}
function rbSparkles() {
  let out = '<g class="rb-sparks">';
  [[18, 22, 1], [86, 16, .8], [92, 54, .7], [8, 48, .85]].forEach((s, i) => {
    const x = s[0], y = s[1], k = s[2];
    out += '<path class="rb-spark s' + i + '" transform="translate(' + x + ' ' + y + ') scale(' + k + ')" ' +
      'd="M0 -7 L2 -2 L7 0 L2 2 L0 7 L-2 2 L-7 0 L-2 -2 Z" fill="#ffd76a" stroke="' + RB.earLine + '" stroke-width="1"/>';
  });
  return out + '</g>';
}
function rbConfetti() {
  const cols = ['#ffd76a', '#7dd3fc', '#f2739b', '#86efac', '#c4b5fd'];
  let out = '<g class="rb-confetti">';
  for (let i = 0; i < 10; i++) {
    const x = 6 + i * 9.6, y = 12 + (i % 3) * 9;
    out += '<rect class="rb-conf c' + i + '" x="' + x.toFixed(1) + '" y="' + y + '" width="4.4" height="6" rx="1.2" ' +
      'fill="' + cols[i % cols.length] + '" transform="rotate(' + (i * 37 % 90 - 45) + ' ' + x.toFixed(1) + ' ' + y + ')"/>';
  }
  return out + '</g>';
}

/* one rabbit, one expression. `look` picks the face, the props are additive. */
function rabbitSVG(look) {
  const L = look || {};
  return '<svg class="rb" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">' +
    (L.sparkles ? rbSparkles() : '') +
    (L.confetti ? rbConfetti() : '') +
    rbEars() + rbBody() + rbEyes(L.eyes) + rbMouth(L.mouth) +
    (L.arms ? rbArms() : '') +
    /* the hat is opt-out, not opt-in: an emote that wants one either sets
       hat:true or just gives it a tilt */
    (L.hat === false ? '' : rbHat(L.hatTilt)) +
    (L.wing ? rbWing() : '') +
    (L.cakes ? rbCakes() : '') +
    (L.tear ? '<path class="rb-tear" d="M60 63 q3 6 0 8 q-3 -2 0 -8 z" fill="#7dd3fc"/>' : '') +
    '</svg>';
}

const RABBIT_EMOTES = [
  { id: 'confident', name: 'Confident',  line: 'yells UNO like it owns the table', look: { eyes: 'angry', mouth: 'shout', arms: true, hatTilt: 0 } },
  { id: 'suspicious', name: 'Suspicious', line: 'is watching exactly what you drew', look: { eyes: 'squint', mouth: 'smirk', hat: false } },
  { id: 'laughing',  name: 'Laughing',   line: 'hat comes clean off', look: { eyes: 'happy', mouth: 'laugh', hatTilt: -14, sparkles: true } },
  { id: 'devil',     name: 'Devil',      line: 'brought a friend', look: { eyes: 'angry', mouth: 'fang', wing: true, hat: false } },
  { id: 'party',     name: 'Party',      line: 'cakes and confetti', look: { eyes: 'happy', mouth: 'laugh', cakes: true, confetti: true, hatTilt: 10 } },
  { id: 'wide',      name: 'Wide-eyed',  line: 'did not expect that', look: { eyes: 'shock', mouth: 'o', hat: false } },
  { id: 'tongue',    name: 'Tongue-out', line: 'is not impressed', look: { eyes: 'flat', mouth: 'tongue', hat: false } },
  { id: 'sad',       name: 'Sad',        line: 'lost by one card', look: { eyes: 'sad', mouth: 'frown', tear: true, hat: false } },
];

/* each expression gets its own 2s sound motif on top of the shared thumb */
const EMO_SFX = {
  confident: () => { [392, 523, 659].forEach((f, i) => note(f, 0.16, 'sawtooth', 0.05, i * 0.07)); whoosh(0.2, 0.05, 0.02, 620); },
  suspicious: () => { note(300, 0.11, 'triangle', 0.05, 0, 250); note(268, 0.13, 'triangle', 0.045, 0.17, 230); },
  laughing: () => [0, 1, 2, 3].forEach((i) => note(900 - i * 70, 0.1, 'triangle', 0.05, i * 0.13)),
  devil: () => { note(170, 0.55, 'sawtooth', 0.06, 0, 88); whoosh(0.5, 0.05, 0.08, 380); },
  party: () => { [523, 659, 784, 1046].forEach((f, i) => note(f, 0.12, 'sine', 0.05, i * 0.09)); whoosh(0.4, 0.05, 0.28, 2300); },
  wide: () => note(380, 0.4, 'sine', 0.06, 0, 1250),
  tongue: () => { whoosh(0.3, 0.065, 0, 1500); note(700, 0.22, 'square', 0.05, 0.1, 240); },
  sad: () => { note(392, 0.3, 'triangle', 0.05, 0, 330); note(311, 0.5, 'triangle', 0.05, 0.3, 233); },
};

const EMOTE_MS = 2000;   // the performance is exactly two seconds

/* the little send-thumb every emote shares, on top of its own motif */
function emoThumb() { note(660, 0.06, 'sine', 0.05, 0, 990); whoosh(0.16, 0.035, 0, 1600); }

/* puts the emote on stage over a seat, runs it for 2s, then takes it down */
function playRabbitEmote(targetIdx, id, quiet) {
  const emo = RABBIT_EMOTES.find((e) => e.id === id);
  const card = document.getElementById('card-' + targetIdx);
  if (!emo || !card) return;
  const host = card.querySelector('.plate') || card;
  const old = card.querySelector('.rb-stage');
  if (old) old.remove();
  const st = document.createElement('div');
  st.className = 'rb-stage rb-' + emo.id;
  st.innerHTML = rabbitSVG(emo.look) + '<span class="rb-name">' + emo.name + '</span>';
  host.appendChild(st);
  if (!quiet) emoThumb();
  if (EMO_SFX[emo.id]) EMO_SFX[emo.id]();
  clearTimeout(st._t);
  st._t = setTimeout(() => st.remove(), EMOTE_MS);
  return st;
}
