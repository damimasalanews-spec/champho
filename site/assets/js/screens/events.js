import { store } from '../store.js';
import { MISSIONS_DAILY, MISSIONS_WEEKLY, EVENTS, SEASON } from '../data.js';
import { icon, esc, compact, toast, progressBar } from '../ui.js';
import { go } from '../nav.js';

function missionRow(mission, claimed) {
  const done = mission.progress >= mission.goal;
  return `
    <div class="mission" data-mission="${esc(mission.id)}">
      <span class="mission__icon">${icon(mission.icon)}</span>
      <div class="mission__text">
        <b>${esc(mission.name)}</b>
        <small>${esc(mission.detail)} · ${mission.progress}/${mission.goal}</small>
        ${progressBar(mission.progress, mission.goal, { thin: true, jade: done, label: `${mission.name} progress` })}
      </div>
      <div style="display:grid;gap:6px;justify-items:end">
        <span class="mission__reward">${icon('coin')} ${compact(mission.reward)}</span>
        ${claimed
          ? `<span class="pill pill--jade">Claimed</span>`
          : `<button class="btn btn--sm ${done ? 'btn--primary' : 'btn--quiet'}" type="button"
                     data-claim="${esc(mission.id)}" data-reward="${mission.reward}" ${done ? '' : 'disabled'}>
               ${done ? 'Claim' : 'In progress'}
             </button>`}
      </div>
    </div>`;
}

export default {
  title: 'Events & missions',
  crumb: 'Events',
  nav: 'events',

  render() {
    const { claimedMissions } = store.state;
    const el = document.createElement('div');
    el.className = 'screen screen--events';

    el.innerHTML = `
      <div class="page-head">
        <div class="page-head__text">
          <span class="eyebrow">Season ${esc(SEASON.id)} · ${esc(SEASON.name)}</span>
          <h1>Play more. Unlock more.</h1>
          <p>Missions pay coins and season XP. Daily doors reset at midnight UTC, weekly doors on Monday.</p>
        </div>
        <div class="pill pill--gold">${SEASON.daysLeft} days left in the season</div>
      </div>

      <div class="home-grid" style="margin-top:0">
        <div class="stack">
          <section class="panel reveal">
            <div class="panel__head">
              <h2>Today's missions</h2>
              <span class="pill">${MISSIONS_DAILY.filter((m) => m.progress >= m.goal).length}/${MISSIONS_DAILY.length} done</span>
            </div>
            <div class="panel__body panel__body--tight" style="display:grid;gap:var(--s-2)">
              ${MISSIONS_DAILY.map((m) => missionRow(m, claimedMissions.includes(m.id))).join('')}
            </div>
          </section>

          <section class="panel reveal">
            <div class="panel__head">
              <h2>Weekly challenges</h2>
              <span class="pill">Resets Monday</span>
            </div>
            <div class="panel__body panel__body--tight" style="display:grid;gap:var(--s-2)">
              ${MISSIONS_WEEKLY.map((m) => missionRow(m, claimedMissions.includes(m.id))).join('')}
            </div>
          </section>
        </div>

        <div class="stack">
          <section class="panel reveal">
            <div class="panel__head"><h2>Live events</h2></div>
            <div class="panel__body stack">
              ${EVENTS.map((event) => `
                <article class="event-card" style="--ev:${event.glow};min-height:0">
                  <span class="event-card__crest">${icon(event.icon)}</span>
                  <span class="pill ${event.badge === 'LIVE' ? 'pill--live' : ''}">${esc(event.badge)}</span>
                  <h3 style="font-size:var(--fs-lg)">${esc(event.name)}</h3>
                  <p class="muted" style="font-size:var(--fs-xs)">${esc(event.sub)}</p>
                </article>`).join('')}
            </div>
          </section>

          <section class="panel reveal">
            <div class="panel__head"><h2>Season progress</h2></div>
            <div class="panel__body stack">
              <div class="meter">
                <div class="meter__label"><span>Tier rewards</span><b>${compact(store.state.player.seasonXp)} / 7,200 XP</b></div>
                ${progressBar(store.state.player.seasonXp, 7200, { jade: true, label: 'Season XP' })}
              </div>
              <button class="btn btn--ghost btn--block" type="button" data-pass>
                ${icon('gift')} Open the season track
              </button>
            </div>
          </section>
        </div>
      </div>
    `;

    el.querySelectorAll('[data-claim]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.claim;
        const reward = Number(btn.dataset.reward) || 0;
        if (!store.claimMission(id)) return;
        store.addCoins(reward);
        toast(`Mission claimed — +${compact(reward)} coins`, 'good');
        btn.outerHTML = '<span class="pill pill--jade">Claimed</span>';
      });
    });

    el.querySelector('[data-pass]').addEventListener('click', () => go('pass'));

    return el;
  }
};
