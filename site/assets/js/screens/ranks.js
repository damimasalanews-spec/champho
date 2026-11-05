import { store } from '../store.js';
import { LEADERBOARD, FRIENDS, SEASON } from '../data.js';
import { icon, esc, compact, avatarMarkup, toast } from '../ui.js';

const TABS = [
  { id: 'global', label: 'Global' },
  { id: 'friends', label: 'Friends' },
  { id: 'season', label: 'This season' }
];

export default {
  title: 'Leaderboard',
  crumb: 'Ranks',
  nav: 'ranks',

  render() {
    let tab = 'global';
    const { player } = store.state;

    const el = document.createElement('div');
    el.className = 'screen screen--ranks';

    el.innerHTML = `
      <div class="page-head">
        <div class="page-head__text">
          <span class="eyebrow">Season ${esc(SEASON.id)} · ${esc(SEASON.name)}</span>
          <h1>Climb the table</h1>
          <p>Standings are season XP. The ladder resets when the season closes.</p>
        </div>
        <div class="segmented" role="tablist" aria-label="Standing">
          ${TABS.map((t) => `<button role="tab" data-tab="${t.id}" aria-selected="${t.id === tab}">${t.label}</button>`).join('')}
        </div>
      </div>

      <div data-board></div>
    `;

    function rows() {
      if (tab === 'friends') {
        const names = new Set(FRIENDS.map((f) => f.name));
        return LEADERBOARD.filter((r) => names.has(r.name));
      }
      return LEADERBOARD;
    }

    function paint() {
      const data = rows();
      const top3 = data.slice(0, 3);
      const rest = data.slice(3);
      const myScore = player.seasonXp;
      const myRank = data.filter((r) => r.score > myScore).length + 1;

      el.querySelector('[data-board]').innerHTML = `
        ${top3.length === 3 ? `
          <section class="podium reveal">
            ${[top3[1], top3[0], top3[2]].map((row, i) => `
              <div class="podium__seat ${row.rank === 1 ? 'podium__seat--1' : ''}">
                ${avatarMarkup({ name: row.name }, row.rank === 1 ? 'lg avatar--ring' : '')}
                <span class="podium__rank">#${row.rank}</span>
                <span class="podium__name">${esc(row.name)}</span>
                <span class="podium__score">${compact(row.score)} XP</span>
              </div>`).join('')}
          </section>` : ''}

        <section class="panel reveal">
          <div class="panel__head">
            <h2>${tab === 'friends' ? 'Friends' : 'Season standings'}</h2>
            <span class="pill">${data.length} players</span>
          </div>
          <div class="panel__body panel__body--tight">
            ${data.length ? `
              <div class="rank-table">
                ${(top3.length === 3 ? rest : data).map((row) => `
                  <div class="rank-row ${row.name === player.name ? 'rank-row--me' : ''}">
                    <span class="rank-row__no">${row.rank}</span>
                    ${avatarMarkup({ name: row.name }, 'sm')}
                    <span class="rank-row__name">
                      <b>${esc(row.name)}</b>
                      <small>Lv ${row.level} · ${esc(row.league)} · ${row.wins} wins</small>
                    </span>
                    <span class="rank-row__score">${compact(row.score)}</span>
                  </div>`).join('')}
              </div>` : `<div class="empty">${icon('users')}<p>No friends on the ladder yet.</p></div>`}
          </div>
        </section>

        <div class="rank-me reveal">
          <span class="rank-row__no" style="font-size:var(--fs-md)">#${myRank}</span>
          ${avatarMarkup({ name: player.name }, 'sm avatar--ring')}
          <span class="rank-row__name">
            <b>${esc(player.name)} <span class="pill" style="margin-left:6px">You</span></b>
            <small>${esc(player.league)} · ${compact(myScore)} season XP</small>
          </span>
          <span class="rank-row__score">${compact(myScore)}</span>
        </div>
      `;
    }

    el.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        tab = btn.dataset.tab;
        el.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
        paint();
      });
    });

    paint();
    return el;
  }
};
