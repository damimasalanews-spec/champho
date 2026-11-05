import { store } from '../store.js';
import { MODES, LIVE_TABLES, SEASON, PASS_TIERS } from '../data.js';
import { icon, esc, compact, avatarMarkup, progressBar, toast, dialog } from '../ui.js';
import { go } from '../nav.js';
import { server } from '../api.js';
import { openGame } from '../gameframe.js';

/** A card either opens its own game client, or moves inside the lobby. */
function launchMode(mode) {
  if (!mode) return;
  if (mode.pending) return explainPending(mode);
  if (mode.game) openGame(`${mode.title} · ${mode.sub}`, mode.game);
  else if (mode.route) go(mode.route);
}

/** No dedicated build yet: say so instead of silently opening something else. */
function explainPending(mode) {
  dialog({
    title: mode.title,
    body: `<p>No Mercy rules are not in this build yet — the repository has no separate Fun Pack client.</p>
           <p class="muted" style="margin-top:10px">Until that build ships, this card opens the classic table.</p>`,
    actions: [
      { label: 'Not now', variant: 'quiet' },
      { label: 'Open Classic', variant: 'primary', onClick: () => openGame('Word UNO · Classic mode', 'game/') }
    ]
  });
}

export default {
  title: 'Home',
  crumb: 'Home',
  nav: 'home',

  render() {
    const { player, daily } = store.state;
    const el = document.createElement('div');
    el.className = 'screen screen--home';

    const winRate = player.games ? Math.round((player.wins / player.games) * 100) : 0;
    const xpPct = Math.round((player.xp / player.xpMax) * 100);
    const nextTier = PASS_TIERS.find((t) => !store.state.claimedTiers.includes(t.tier));
    const claimedToday = daily.claimed.includes(daily.today);

    el.innerHTML = `
      <section class="hero panel--ornate reveal">
        <div class="hero__copy">
          <span class="eyebrow">Season ${esc(SEASON.id)} · ${esc(SEASON.name)} · ${SEASON.daysLeft} days left</span>
          <h1 class="hero__title"><span>CHAMP</span><span>WORD</span></h1>
          <p class="hero__lede">
            Match by colour or by word. Four seats, one felt table, and a turn clock
            that does not wait for you.
          </p>
          <div class="hero__cta">
            <button class="btn btn--primary btn--lg" type="button" data-quick>
              ${icon('play')} Quick play
            </button>
            <a class="btn btn--ghost btn--lg" href="#/room">
              ${icon('users')} Private table
            </a>
          </div>
          <div class="hero__meta">
            <div><b>${esc(player.league)}</b><span class="muted">League</span></div>
            <div><b>${player.streak}</b><span class="muted">Win streak</span></div>
            <div><b>${winRate}%</b><span class="muted">Win rate</span></div>
          </div>
        </div>

        <div class="hero__art" aria-hidden="true">
          <div class="hero__table"></div>
          <div class="hero__seal"><span>Season</span><b>01</b><span>Word Rush</span></div>
          <div class="hero__cards">
            <div class="hcard hcard--wild" style="--tilt:-14deg;--lift:8px">W</div>
            <div class="hcard hcard--ruby" style="--tilt:-7deg;--lift:2px">I</div>
            <div class="hcard hcard--jade" style="--tilt:0deg;--lift:-4px">L</div>
            <div class="hcard hcard--azure" style="--tilt:7deg;--lift:2px">D</div>
            <div class="hcard hcard--amber" style="--tilt:14deg;--lift:8px">+4</div>
          </div>
        </div>
      </section>

      <section class="playerstrip reveal" style="margin-top:var(--s-5)">
        ${avatarMarkup(player, 'lg avatar--ring')}
        <div class="playerstrip__id">
          <span class="playerstrip__name">${esc(player.name)} <span class="pill">Lv ${player.level}</span></span>
          <span class="playerstrip__meta">${esc(player.title)} · ${compact(player.coins)} coins · ${player.gems} diamonds</span>
        </div>
        <div class="playerstrip__meter">
          ${progressBar(player.xp, player.xpMax, { thin: true, label: `Level ${player.level} progress` })}
          <div class="meter__label" style="margin-top:6px">
            <span>Level ${player.level}</span><span>${player.xp} / ${player.xpMax} XP</span>
          </div>
        </div>
        <a class="btn btn--quiet btn--sm" href="#/profile">Profile</a>
      </section>

      <section class="section">
        <div class="section__head">
          <span class="eyebrow">Choose your table</span>
          <h2>Five ways to play</h2>
        </div>
        <div class="modes">
          ${MODES.map((mode) => `
            <button class="mode mode--${mode.tone} reveal" type="button" data-mode="${mode.id}">
              <span class="mode__top">
                <span class="mode__icon">${icon(mode.icon)}</span>
                <span class="mode__text">
                  <span class="mode__title">${esc(mode.title)}</span>
                  <span class="mode__sub">${esc(mode.sub)}</span>
                </span>
              </span>
              <span class="mode__desc">${esc(mode.desc)}</span>
              <span class="mode__foot">
                <span class="link">${esc(mode.cta)} ${icon('arrow')}</span>
              </span>
            </button>`).join('')}
        </div>
      </section>

      <div class="home-grid">
        <div class="stack">
          <section class="panel reveal">
            <div class="panel__head">
              <h2>Open tables</h2>
              <span class="pill pill--live">${LIVE_TABLES.filter((t) => t.live).length} live</span>
              <div class="panel__head-actions">
                <button class="link" type="button" data-refresh>${icon('refresh')} Refresh</button>
              </div>
            </div>
            <div class="panel__body panel__body--tight">
              <div class="rooms">
                ${LIVE_TABLES.map((table) => `
                  <button class="room-row" type="button" data-join="${esc(table.id)}" data-host="${esc(table.host)}">
                    <span class="room-row__avatars">
                      ${(table.players || [table.host]).slice(0, 3).map((name) => avatarMarkup({ name }, 'sm')).join('')}
                    </span>
                    <span class="room-row__name">
                      <b>${esc(table.host)}'s table</b>
                      <small>${esc(table.mode)} · ${table.seats}/${table.cap} seats · ${compact(table.stake)} stake</small>
                    </span>
                    <span class="pill ${table.live ? 'pill--jade' : ''}">${table.live ? 'Join' : 'Full'}</span>
                  </button>`).join('')}
              </div>
            </div>
          </section>

          <section class="panel reveal">
            <div class="panel__head">
              <h2>Daily reward</h2>
              <span class="pill">${daily.streak}-day streak</span>
            </div>
            <div class="panel__body">
              <div class="daily">
                <div class="daily__days">
                  ${Array.from({ length: 7 }, (_, i) => {
                    const state = daily.claimed.includes(i) ? 'claimed' : i === daily.today ? 'today' : '';
                    return `<div class="day ${state ? `day--${state}` : ''}">
                      <span>D${i + 1}</span><b>${100 + i * 50}</b>
                    </div>`;
                  }).join('')}
                </div>
                <div class="row" style="margin-top:var(--s-2)">
                  <p class="muted" style="font-size:var(--fs-xs)">
                    ${claimedToday ? 'Today is claimed. The next door opens tomorrow.' : `Day ${daily.today + 1} is ready to open.`}
                  </p>
                  <button class="btn ${claimedToday ? 'btn--quiet' : 'btn--primary'} btn--sm" type="button" data-claim ${claimedToday ? 'disabled' : ''}>
                    ${icon('gift')} ${claimedToday ? 'Claimed' : 'Claim reward'}
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>

        <div class="stack">
          <section class="panel reveal">
            <div class="panel__head"><h2>Progress</h2></div>
            <div class="panel__body stack">
              <div class="meter">
                <div class="meter__label"><span>Level ${player.level}</span><b>${xpPct}%</b></div>
                ${progressBar(player.xp, player.xpMax, { thin: true, label: 'Level progress' })}
              </div>
              <div class="meter">
                <div class="meter__label"><span>Season ${esc(SEASON.name)}</span><b>${compact(player.seasonXp)} XP</b></div>
                ${progressBar(player.seasonXp, 7200, { thin: true, jade: true, label: 'Season progress' })}
              </div>
              ${nextTier ? `
                <div class="row" style="padding-top:var(--s-2);border-top:1px solid var(--line-cool)">
                  <span class="mode__icon" style="width:36px;height:36px">${icon(nextTier.icon)}</span>
                  <span style="display:grid;gap:2px">
                    <small class="muted" style="font-size:var(--fs-2xs);letter-spacing:.1em;text-transform:uppercase">Next reward · tier ${nextTier.tier}</small>
                    <b style="font-size:var(--fs-sm)">${esc(nextTier.name)}</b>
                  </span>
                </div>` : ''}
              <a class="link" href="#/pass">Open the season track ${icon('arrow')}</a>
            </div>
          </section>

          <section class="panel reveal">
            <div class="panel__head"><h2>Shortcuts</h2></div>
            <div class="panel__body">
              <div class="quick">
                <a class="tile" href="#/shop">${icon('shop')}<b>Style store</b><small>Frames, effects, characters</small></a>
                <a class="tile" href="#/ranks">${icon('trophy')}<b>Ladder</b><small>Season standings</small></a>
                <a class="tile" href="#/social">${icon('users')}<b>Social</b><small>Friends and parties</small></a>
                <a class="tile" href="#/events">${icon('sparkle')}<b>Missions</b><small>Daily and weekly</small></a>
              </div>
            </div>
          </section>
        </div>
      </div>

      <footer class="footnote">
        <span>Champ Word · Season ${esc(SEASON.id)}</span>
        <span>Build 4.0 · lobby rewrite</span>
        <span id="server-state">Server: checking…</span>
      </footer>
    `;

    /* --- behaviour ------------------------------------------------------- */

    // Quick play is the classic table, which is what the deployed home opens.
    el.querySelector('[data-quick]').addEventListener('click', () => {
      openGame('Word UNO · Classic mode', 'game/');
    });

    el.querySelectorAll('[data-mode]').forEach((btn) => {
      btn.addEventListener('click', () => launchMode(MODES.find((m) => m.id === btn.dataset.mode)));
    });

    el.querySelectorAll('[data-join]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (server.status === 'online') {
          openGame(`Table ${btn.dataset.join}`);
          return;
        }
        dialog({
          title: `Table ${btn.dataset.join}`,
          body: `<p>${esc(btn.dataset.host)}'s table is a demo listing. The multiplayer server is not answering right now, so this seat cannot be filled from here.</p>
                 <p style="margin-top:10px" class="muted">The lobby still works end to end — start a queue from <b>Play</b> to see it run.</p>`,
          actions: [{ label: 'Got it', variant: 'primary' }]
        });
      });
    });

    const claimBtn = el.querySelector('[data-claim]');
    claimBtn?.addEventListener('click', () => {
      const reward = store.claimDaily();
      if (reward) toast(`Daily reward claimed — +${reward} coins`, 'good');
      document.dispatchEvent(new CustomEvent('store:refresh'));
    });

    el.querySelector('[data-refresh]').addEventListener('click', async (event) => {
      const btn = event.currentTarget;
      btn.disabled = true;
      await server.probe();
      paintServerState(el);
      btn.disabled = false;
      toast(server.status === 'online' ? 'Table list refreshed from the server.' : 'Server unreachable — showing demo tables.', server.status === 'online' ? 'good' : 'info');
    });

    paintServerState(el);

    return el;
  }
};

function paintServerState(root) {
  const node = root.querySelector('#server-state');
  if (!node) return;
  const map = {
    online: ['Server: online', 'var(--jade)'],
    offline: ['Server: offline · demo data', 'var(--ruby)'],
    unknown: ['Server: checking…', 'var(--muted)']
  };
  const [label, colour] = map[server.status] ?? map.unknown;
  node.textContent = label;
  node.style.color = colour;
}
