/* ===========================================================================
   CHAMP WORD — home

   The front door: one greeting, the five tables in a single readable grid, and
   three cards that each do a job (claim today's reward, join a table, see who
   is on). Everything here is wired to a real destination — a card never opens
   nothing, and no control is a picture of a control.

   Layout rules that matter:
   - The mode grid is a GRID, not a fan. A five-card fan was 1050px wide on a
     390px screen with no scrollbar and no hint it scrolled: four of the five
     games could not be reached on a phone. Cards now reflow instead.
   - Every number comes from the store or from data.js. No figure here is
     typed twice, so the HUD, the pass screen and this page cannot disagree.
   =========================================================================== */

import { MODES, SEASON, DAILY_REWARDS, PASS_TIERS, LIVE_TABLES, FRIENDS } from '../data.js';
import { icon, esc, dialog, toast, avatarMarkup, progressBar } from '../ui.js';
import { go } from '../nav.js';
import { store } from '../store.js';

/**
 * Display copy per mode. The destination comes from MODES, so there is still
 * one source of truth for where a card goes.
 */
const FACE = {
  classic: { kicker: 'UNO · classic', name: 'Classic Mode', meta: '4 seats · 7 cards', cta: 'Open the table', tone: 'ruby', route: 'play/classic' },
  wild: { kicker: '+2 · +4 · wild', name: 'Go Wild', meta: '2v2 · 7×6 word grid', cta: 'Open the table', tone: 'violet', route: 'play/wild' },
  fun: { kicker: 'No mercy', name: 'Fun Pack', meta: 'Stacking · forced draws', cta: 'Coming soon', tone: 'jade', route: null },
  contest: { kicker: 'Ranked', name: 'Contest', meta: 'Season 01 ladder', cta: 'See the standings', tone: 'gold', route: 'ranks' },
  friends: { kicker: 'Private', name: 'With Friends', meta: 'Room code · free', cta: 'Open a room', tone: 'azure', route: 'room' }
};

/* --- helpers -------------------------------------------------------------- */

function untilMidnight() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const mins = Math.max(0, Math.round((midnight - now) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

function modeTarget(mode) {
  const face = FACE[mode.id];
  if (face?.route) return face.route;
  if (mode.route) return mode.route;
  return null;
}

/* --- cards ---------------------------------------------------------------- */

function modeCard(mode) {
  const face = FACE[mode.id] ?? {
    kicker: mode.sub ?? '',
    name: mode.title,
    meta: mode.desc ?? '',
    cta: mode.cta ?? 'Open',
    tone: 'azure',
    route: null
  };
  const flag = mode.pending ? '<span class="mode__flag">Soon</span>' : '';
  const arrow = mode.pending ? '' : icon('arrow');

  return `
    <button class="mode mode--${face.tone}" type="button" data-mode="${esc(mode.id)}"
            aria-label="${esc(mode.title)} — ${esc(mode.sub)}. ${esc(face.cta)}">
      <span class="mode__top">
        <span class="mode__ico">${icon(mode.icon ?? 'cards')}</span>
        ${flag}
      </span>
      <span class="mode__body">
        <span class="mode__kicker">${esc(face.kicker)}</span>
        <span class="mode__name">${esc(face.name)}</span>
        <span class="mode__meta">${esc(face.meta)}</span>
      </span>
      <span class="mode__cta">${esc(face.cta)}${arrow}</span>
    </button>`;
}

/** No dedicated build yet: say so instead of silently opening something else. */
function explainPending(mode) {
  dialog({
    title: mode.title,
    body: `<p>No Mercy rules are not in this build yet — the repository has no separate Fun Pack client.</p>
           <p class="muted" style="margin-top:10px">Until that build ships, this card opens the classic table.</p>`,
    actions: [
      { label: 'Not now', variant: 'quiet' },
      { label: 'Open Classic', variant: 'primary', onClick: () => go('play/classic') }
    ]
  });
}

function seasonCard(player) {
  // Both numbers are the pass screen's own, in its own units: the tier reached
  // (by season XP) and the tiers claimed. Earlier this card printed a third
  // reading — "4,860 / 1,500" — because it divided XP by the next unclaimed
  // tier. Three surfaces, three answers; the pass screen is the source.
  const xp = player.seasonXp;
  const claimed = store.state.claimedTiers.length;
  const reached = [...PASS_TIERS].reverse().find((t) => xp >= t.xp) ?? PASS_TIERS[0];
  const next = PASS_TIERS.find((t) => t.xp > xp) ?? null;

  return `
    <aside class="season" aria-label="Season progress">
      <div class="season__head">
        <span class="season__badge" aria-hidden="true">${icon('crown')}</span>
        <span class="season__title">
          <b>${esc(SEASON.name)}</b>
          <small>Season ${esc(SEASON.id)} · ${SEASON.daysLeft} days left</small>
        </span>
      </div>

      <div class="season__xp">
        <div class="season__row">
          <span>Tiers claimed</span>
          <b>${claimed} <i>/ ${PASS_TIERS.length}</i></b>
        </div>
        ${progressBar(claimed, PASS_TIERS.length, { thin: true, label: `Season pass, ${claimed} of ${PASS_TIERS.length} tiers claimed` })}
      </div>

      <div class="season__next">
        <span class="season__tier">Tier ${reached.tier}</span>
        <span class="season__next-name">${esc(next ? `Next: ${next.name}` : 'Every tier unlocked')}</span>
      </div>

      <a class="season__link" href="#/pass" data-route="pass">
        ${icon('sparkle')} Open the season pass ${icon('chevron')}
      </a>
    </aside>`;
}

function rewardWeek() {
  const { daily } = store.state;
  return DAILY_REWARDS.map((reward, i) => {
    const claimed = daily.claimed.includes(i);
    const today = i === daily.today;
    return `
      <li class="rw-day ${claimed ? 'is-claimed' : ''} ${today ? 'is-today' : ''}">
        <span class="rw-day__ico" aria-hidden="true">${icon(reward.kind === 'gems' ? 'gem' : 'coin')}</span>
        <b>${reward.amount}</b>
        <small>D${i + 1}</small>
      </li>`;
  }).join('');
}

function tablesCard() {
  return LIVE_TABLES.filter((t) => t.live).map((table) => `
    <a class="trow" href="#/room">
      <span class="trow__mode trow__mode--${table.mode === 'Go Wild' ? 'wild' : 'classic'}">${esc(table.mode)}</span>
      <span class="trow__who">
        <b>${esc(table.host)}</b>
        <small>${table.seats} of ${table.cap} seats · ${table.stake} stake</small>
      </span>
      <span class="trow__seats" aria-label="${table.seats} of ${table.cap} seats filled">
        ${Array.from({ length: table.cap }, (_, i) => `<i class="${i < table.seats ? 'is-full' : ''}"></i>`).join('')}
      </span>
      ${icon('chevron', 'trow__go')}
    </a>`).join('');
}

function friendsCard() {
  return FRIENDS.slice(0, 3).map((friend) => `
    <a class="frow" href="#/social">
      <span class="frow__avatar">
        ${avatarMarkup({ name: friend.name }, 'sm')}
        <span class="status-dot status-dot--${friend.state}" aria-hidden="true"></span>
      </span>
      <span class="frow__who">
        <b>${esc(friend.name)}</b>
        <small>${esc(friend.status)}</small>
      </span>
      <span class="frow__lv">Lv ${friend.level}</span>
    </a>`).join('');
}

/* --- screen --------------------------------------------------------------- */

export default {
  title: 'Home',
  crumb: 'Home',
  nav: 'home',

  render() {
    const { player, daily } = store.state;
    const el = document.createElement('div');
    el.className = 'screen screen--home';

    const claimedToday = daily.claimed.includes(daily.today);
    const todayReward = DAILY_REWARDS[daily.today] ?? DAILY_REWARDS[0];
    const rewardLabel = todayReward.kind === 'gems'
      ? `${todayReward.amount} diamonds`
      : `${todayReward.amount.toLocaleString('en-US')} coins`;

    el.innerHTML = `
      <div class="home">

        <section class="hero">
          <div class="hero__copy">
            <span class="eyebrow">Season ${esc(SEASON.id)} · ${esc(SEASON.name)}</span>
            <h1 class="hero__title">Welcome back,<br><span class="hero__name">${esc(player.name)}</span></h1>
            <p class="hero__lede">
              Match the colour or the word, empty your hand, and take the pot.
              ${SEASON.daysLeft} days of the season left to climb.
            </p>

            <div class="hero__cta">
              <button class="btn btn--primary btn--lg" type="button" data-play="classic">
                ${icon('play')} Play now
              </button>
              <button class="btn btn--ghost btn--lg" type="button" data-play="wild">
                ${icon('flame')} Go Wild
              </button>
            </div>

            <ul class="hero__facts">
              <li>${icon('trophy')} <b>${esc(player.league)}</b> league</li>
              <li>${icon('flame')} <b>${player.streak}</b> win streak</li>
              <li>${icon('target')} <b>${player.wins.toLocaleString('en-US')}</b> wins</li>
            </ul>
          </div>
          ${seasonCard(player)}
        </section>

        <section class="home__section" aria-labelledby="home-modes">
          <div class="section__head">
            <h2 id="home-modes">Choose a table</h2>
            <a class="link section__link" href="#/play/classic" style="margin-left:auto">
              All tables ${icon('arrow')}
            </a>
          </div>
          <div class="modes">${MODES.map(modeCard).join('')}</div>
        </section>

        <div class="dash">
          <section class="panel dash__card">
            <div class="panel__head">
              <h2>Free rewards</h2>
              <span class="pill${claimedToday ? '' : ' pill--gold'}" style="margin-left:auto">
                ${claimedToday ? 'Claimed' : 'Ready'}
              </span>
            </div>
            <div class="panel__body">
              <ul class="rw-week">${rewardWeek()}</ul>
              <p class="dash__note">
                ${daily.streak} day streak · next reward in ${untilMidnight()}
              </p>
              <button class="btn ${claimedToday ? 'btn--quiet' : 'btn--primary'} btn--block" type="button"
                      data-claim ${claimedToday ? 'disabled' : ''}>
                ${claimedToday ? 'Claimed today' : `Claim ${esc(rewardLabel)}`}
              </button>
            </div>
          </section>

          <section class="panel dash__card">
            <div class="panel__head">
              <h2>Tables open now</h2>
              <a class="link" href="#/room" style="margin-left:auto">See all</a>
            </div>
            <div class="panel__body panel__body--tight">
              <div class="tlist">${tablesCard()}</div>
              <p class="dash__note dash__note--pad">Sample listings — the live board fills from the server.</p>
            </div>
          </section>

          <section class="panel dash__card">
            <div class="panel__head">
              <h2>Friends</h2>
              <a class="link" href="#/social" style="margin-left:auto">See all</a>
            </div>
            <div class="panel__body panel__body--tight">
              <div class="flist">${friendsCard()}</div>
              <a class="dash__wide" href="#/social">
                ${icon('users')} Invite a friend to a private table ${icon('chevron')}
              </a>
            </div>
          </section>
        </div>
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
        const target = modeTarget(mode);
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
      // The HUD, this card and the dock dot all read the same state: one redraw.
      document.dispatchEvent(new CustomEvent('route:refresh'));
    });

    return el;
  }
};
