/* ===========================================================================
   CHAMP WORD — home

   A game's front door, not an account page. The order is deliberate:

     1. one arena: the name of the game, one line of what it is, one PLAY button
     2. the five tables as posters you want to press
     3. four small chips for the things you check once a day

   What it deliberately does NOT do: no greeting block, no rows of KPI tiles, no
   "3 of 10 tiers claimed" panel, no tables-and-friends lists. Those live on the
   pass screen, the room screen and the friends screen; stacking all three here
   made the page read like a dashboard with a game attached.
   =========================================================================== */

import { MODES, SEASON, DAILY_REWARDS, PASS_TIERS, LIVE_TABLES, FRIENDS } from '../data.js';
import { icon, esc, dialog, toast } from '../ui.js';
import { go } from '../nav.js';
import { store } from '../store.js';

/** Display copy per mode; the destination still comes from data.js. */
const FACE = {
  classic: { name: 'Classic', kicker: 'UNO', meta: '4 seats · 7 cards', tone: 'ruby', route: 'play/classic' },
  wild: { name: 'Go Wild', kicker: '+2 · +4', meta: '2v2 word grid', tone: 'violet', route: 'play/wild' },
  fun: { name: 'Fun Pack', kicker: 'No mercy', meta: 'Stacking · forced draws', tone: 'jade', route: null },
  contest: { name: 'Contest', kicker: 'Ranked', meta: 'Season 01 ladder', tone: 'gold', route: 'ranks' },
  friends: { name: 'Friends', kicker: 'Private', meta: 'Room code · free', tone: 'azure', route: 'room' }
};

function tile(mode) {
  const face = FACE[mode.id] ?? { name: mode.title, kicker: mode.sub ?? '', meta: '', tone: 'azure', route: null };
  return `
    <button class="tile tile--${face.tone}" type="button" data-mode="${esc(mode.id)}"
            aria-label="${esc(mode.title)} — ${esc(mode.sub)}">
      <span class="tile__ico">${icon(mode.icon ?? 'cards')}</span>
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
      <span class="chip__ico chip__ico--gold">${icon('chest')}</span>
      <span class="chip__text"><b>Daily reward</b><small>${esc(rewardText)}</small></span>
      ${claimedToday ? '' : '<span class="chip__dot" aria-hidden="true"></span>'}
    </button>

    <a class="chip" href="#/pass">
      <span class="chip__ico chip__ico--violet">${icon('sparkle')}</span>
      <span class="chip__text"><b>Season pass</b><small>${claimedTiers.length} / ${PASS_TIERS.length} tiers</small></span>
    </a>

    <a class="chip" href="#/room">
      <span class="chip__ico chip__ico--jade">${icon('cards')}</span>
      <span class="chip__text"><b>Open tables</b><small>${tables} waiting now</small></span>
    </a>

    <a class="chip" href="#/social">
      <span class="chip__ico chip__ico--azure">${icon('users')}</span>
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
          <span class="arena__suit arena__suit--club" aria-hidden="true">♣</span>
          <span class="arena__suit arena__suit--diamond" aria-hidden="true">♦</span>
          <span class="arena__glow" aria-hidden="true"></span>

          <span class="arena__ribbon">Season ${esc(SEASON.id)} · ${esc(SEASON.name)} · ${SEASON.daysLeft} days left</span>
          <h1 class="arena__logo">Champ<span>Word</span></h1>
          <p class="arena__tag">Match the colour or the word, empty your hand, take the pot.</p>

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
