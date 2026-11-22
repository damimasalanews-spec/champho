/* ===========================================================================
   CHAMP WORD — home

   Red and white, with the game's own furniture in every band:

     1. ARENA   — a rack of letter tiles, the logo, one PLAY button
     2. POSTERS — the five tables, each wearing its own letter tiles
     3. STRIP   — four chips, each one a single tile with the day's business

   The art is built from the word game itself — tiles with letters and point
   values — rather than generic icons, so the page looks like the product and
   not like a dashboard that happens to be red.
   =========================================================================== */

import { MODES, SEASON, DAILY_REWARDS, PASS_TIERS, LIVE_TABLES, FRIENDS } from '../data.js';
import { icon, esc, dialog, toast } from '../ui.js';
import { go } from '../nav.js';
import { store } from '../store.js';

/** Display copy per mode; the destination still comes from data.js. */
const FACE = {
  classic: { name: 'Classic', kicker: 'UNO', meta: '2v2 or 4v4', tone: 'ruby', route: 'play/classic', art: 'un' },
  wild: { name: 'Go Wild', kicker: '+2 · +4', meta: '2v2 or 4v4 grid', tone: 'crimson', route: 'play/wild', art: 'wd' },
  fun: { name: 'Fun Pack', kicker: 'No mercy', meta: 'Stacking · forced draws', tone: 'scarlet', route: null, art: 'nm' },
  contest: { name: 'Contest', kicker: 'Ranked', meta: 'Season 01 ladder', tone: 'rose', route: 'ranks', art: 's1' },
  friends: { name: 'Friends', kicker: 'Private', meta: 'Room code · free', tone: 'blush', route: 'room', art: 'rc' }
};

/** Scrabble-ish points, so the tiles read as the real thing. */
const POINTS = { a: 1, c: 3, d: 2, e: 1, f: 4, h: 4, m: 3, n: 1, o: 1, p: 3, r: 1, s: 1, u: 1, w: 4, 1: 1 };

/**
 * A little rack of letter tiles. This is the page's only illustration, and it
 * is the game's own object: white tile, red letter, tiny point value.
 */
function wtiles(letters, size = '') {
  return `<span class="wtiles ${size}">${[...letters].map((ch, i) => `
    <i class="wtile" style="--rot:${i % 2 ? '2.5deg' : '-2deg'}">
      <b>${esc(ch.toUpperCase())}</b><s>${POINTS[ch.toLowerCase()] ?? 1}</s>
    </i>`).join('')}</span>`;
}

function tile(mode) {
  const face = FACE[mode.id] ?? { name: mode.title, kicker: mode.sub ?? '', meta: '', tone: 'ruby', route: null, art: 'w' };
  return `
    <button class="tile tile--${face.tone}" type="button" data-mode="${esc(mode.id)}"
            aria-label="${esc(mode.title)} — ${esc(mode.sub)}">
      <span class="tile__art">${wtiles(face.art, 'wtiles--md')}</span>
      <span class="tile__body">
        <span class="tile__kicker">${esc(face.kicker)}</span>
        <span class="tile__name">${esc(face.name)}</span>
        <span class="tile__meta">${esc(face.meta)}</span>
      </span>
      ${mode.pending
        ? '<span class="tile__soon">Soon</span>'
        : `<span class="tile__go">${icon('chevron')}</span>`}
    </button>`;
}

function explainPending(mode) {
  dialog({
    title: mode.title,
    body: `<p>No Mercy rules are not in this build yet — the repository has no separate Fun Pack client.</p>
           <p class="muted" style="margin-top:10px">Until that build ships, this tile opens the classic table.</p>`,
    actions: [
      { label: 'Not now', variant: 'quiet' },
      { label: 'Open Classic', variant: 'primary', onClick: () => go('play/classic') }
    ]
  });
}

/* --- the four chips ------------------------------------------------------- */

function chips() {
  const { daily, claimedTiers } = store.state;
  const claimedToday = daily.claimed.includes(daily.today);
  const reward = DAILY_REWARDS[daily.today] ?? DAILY_REWARDS[0];
  const rewardText = claimedToday
    ? 'Claimed today'
    : reward.kind === 'gems' ? `+${reward.amount} gems` : `+${reward.amount} coins`;
  const tables = LIVE_TABLES.filter((t) => t.live).length;
  const online = FRIENDS.filter((f) => f.state !== 'off').length;

  return `
    <button class="chip ${claimedToday ? 'is-done' : 'chip--ready'}" type="button" data-claim ${claimedToday ? 'disabled' : ''}>
      <span class="chip__art">${wtiles('d')}</span>
      <span class="chip__text"><b>Daily reward</b><small>${esc(rewardText)}</small></span>
      ${claimedToday ? '' : '<span class="chip__dot" aria-hidden="true"></span>'}
    </button>

    <a class="chip" href="#/pass">
      <span class="chip__art">${wtiles('p')}</span>
      <span class="chip__text"><b>Season pass</b><small>${claimedTiers.length} / ${PASS_TIERS.length} tiers</small></span>
    </a>

    <a class="chip" href="#/room">
      <span class="chip__art">${wtiles('t')}</span>
      <span class="chip__text"><b>Open tables</b><small>${tables} waiting now</small></span>
    </a>

    <a class="chip" href="#/social">
      <span class="chip__art">${wtiles('f')}</span>
      <span class="chip__text"><b>Friends</b><small>${online} online</small></span>
    </a>`;
}

/* --- screen --------------------------------------------------------------- */

export default {
  title: 'Home',
  crumb: 'Home',
  nav: 'home',

  render() {
    const el = document.createElement('div');
    el.className = 'screen screen--home';

    el.innerHTML = `
      <div class="home">

        <section class="arena">
          <span class="arena__suit arena__suit--spade" aria-hidden="true">♠</span>
          <span class="arena__suit arena__suit--heart" aria-hidden="true">♥</span>
          <span class="arena__glow" aria-hidden="true"></span>

          <span class="arena__ribbon">Season ${esc(SEASON.id)} · ${esc(SEASON.name)} · ${SEASON.daysLeft} days left</span>

          <h1 class="arena__logo">Champ<span>Word</span></h1>
          <p class="arena__tag">Match the colour or the word, empty your hand, take the pot.</p>

          <!-- a rack spelling the thing the button does -->
          <div class="arena__rack" aria-hidden="true">${wtiles('play', 'wtiles--lg')}</div>

          <div class="arena__actions">
            <button class="playbtn" type="button" data-play="classic">
              <span class="playbtn__tri" aria-hidden="true"></span>Play
            </button>
            <div class="arena__alt">
              <button type="button" data-play="wild">Go Wild 2v2 ${icon('chevron')}</button>
              <a href="#/room">Play with friends ${icon('chevron')}</a>
            </div>
          </div>
        </section>

        <section class="modes" aria-label="Ways to play">${MODES.map(tile).join('')}</section>

        <section class="strip" aria-label="Today">${chips()}</section>
      </div>`;

    /* --- wiring ---------------------------------------------------------- */

    el.querySelectorAll('[data-play]').forEach((btn) => {
      btn.addEventListener('click', () => go(`play/${btn.dataset.play}`));
    });

    el.querySelectorAll('[data-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = MODES.find((m) => m.id === btn.dataset.mode);
        if (!mode) return;
        if (mode.pending) return explainPending(mode);
        const target = FACE[mode.id]?.route ?? mode.route ?? null;
        if (target) go(target);
      });
    });

    el.querySelector('[data-claim]')?.addEventListener('click', (event) => {
      const button = event.currentTarget;
      if (button.disabled) return;
      button.disabled = true;
      const reward = store.claimDaily();
      if (!reward) return;
      toast(reward.kind === 'gems' ? `+${reward.amount} diamonds` : `+${reward.amount.toLocaleString('en-US')} coins`, 'good');
      document.dispatchEvent(new CustomEvent('route:refresh'));
    });

    return el;
  }
};
