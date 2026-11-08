/* ===========================================================================
   CHAMP WORD — lobby bootstrap
   The chrome is a game HUD: profile block, wallet, free pass on top; an icon
   dock at the bottom. Everything here keeps those two strips in sync with the
   store. Screens are plain modules: { title, nav, render() }.
   =========================================================================== */

import { store } from './store.js';
import { server, cancelQueue } from './api.js';
import { icon, hydrateIcons, avatarMarkup, compact, initials, toast, dialog } from './ui.js';
import { NOTIFICATIONS, SEASON, DAILY_REWARDS } from './data.js';
import { createRouter } from './router.js';
import { go } from './nav.js';

import home from './screens/home.js';
import play from './screens/play.js';
import shop from './screens/shop.js';
import events from './screens/events.js';
import pass from './screens/pass.js';
import ranks from './screens/ranks.js';
import profile from './screens/profile.js';
import social from './screens/social.js';
import settings from './screens/settings.js';
import room from './screens/room.js';
import welcome from './screens/welcome.js';

const routes = { home, play, shop, events, pass, ranks, profile, social, settings, room, welcome };

const view = document.getElementById('main');

const router = createRouter({
  routes,
  fallback: 'home',
  view,
  onRendered() {
    syncShell();
  }
});

/* --- shell ---------------------------------------------------------------- */

function paint(slot, player) {
  const size = slot.dataset.avatar;
  slot.className = `avatar ${size ? `avatar--${size}` : ''}`.trim();
  slot.innerHTML = player.photo
    ? `<img src="${player.photo}" alt="" loading="lazy" decoding="async">`
    : initials(player.name);
}

/** Time until the daily reward resets, in the dock's small pill. */
function dailyTimer() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const mins = Math.max(0, Math.round((midnight - now) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

function syncShell() {
  const { player, daily, claimedTiers } = store.state;

  document.querySelectorAll('[data-player-name]').forEach((n) => { n.textContent = player.name; });
  document.querySelectorAll('[data-player-score]').forEach((n) => {
    n.textContent = player.trophies.toLocaleString('en-US');
  });
  document.querySelectorAll('[data-level]').forEach((n) => { n.textContent = `Lv ${player.level}`; });
  document.querySelectorAll('[data-coins]').forEach((n) => { n.textContent = compact(player.coins); });
  document.querySelectorAll('[data-gems]').forEach((n) => { n.textContent = String(player.gems); });

  const pct = Math.max(0, Math.min(100, Math.round((player.xp / player.xpMax) * 100)));
  document.querySelectorAll('[data-xp-bar]').forEach((n) => { n.style.width = `${pct}%`; });

  const passPct = Math.round((claimedTiers.length / 10) * 100);
  document.querySelectorAll('[data-pass-bar]').forEach((n) => { n.style.width = `${passPct}%`; });
  document.querySelectorAll('[data-pass-text]').forEach((n) => {
    n.textContent = `${claimedTiers.length} / 10`;
  });

  document.querySelector('[data-daily-timer]')?.replaceChildren(document.createTextNode(dailyTimer()));

  document.querySelectorAll('[data-avatar]').forEach((slot) => paint(slot, player));

  // the free-reward badge disappears once today's reward is taken
  const claimedToday = daily.claimed.includes(daily.today);
  const rewardsBtn = document.querySelector('.dock__item [data-rewards], .dock__item[data-rewards]');
  rewardsBtn?.parentElement?.querySelector('.dock__dot')?.toggleAttribute('hidden', claimedToday);
  document.querySelector('.rewards__dot')?.toggleAttribute('hidden', claimedToday);
}

/* --- wallet --------------------------------------------------------------- */

const TOP_UPS = {
  coins: [
    { label: '1,200', amount: 1200, price: '₹ 89' },
    { label: '6,500', amount: 6500, price: '₹ 429' },
    { label: '14,000', amount: 14000, price: '₹ 899' }
  ],
  gems: [
    { label: '30', amount: 30, price: '₹ 149' },
    { label: '90', amount: 90, price: '₹ 429' },
    { label: '220', amount: 220, price: '₹ 949' }
  ]
};

document.querySelectorAll('[data-buy]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const kind = btn.dataset.buy;
    const packs = TOP_UPS[kind];
    dialog({
      title: kind === 'coins' ? 'Get coins' : 'Get diamonds',
      body: `
        <p class="muted" style="font-size:var(--fs-sm)">Top-ups are demo-only until the payment service is wired to the game server.</p>
        <div style="display:grid;gap:var(--s-2);margin-top:var(--s-4)">
          ${packs.map((pack) => `
            <button class="room-row" type="button" data-pack="${pack.amount}">
              <span class="room-row__name"><b>${pack.label} ${kind === 'coins' ? 'coins' : 'diamonds'}</b><small>${pack.price}</small></span>
              <span class="pill pill--gold">Add</span>
            </button>`).join('')}
        </div>`,
      actions: [{ label: 'Close', variant: 'quiet' }],
      onMount(dlg) {
        dlg.querySelectorAll('[data-pack]').forEach((row) => {
          row.addEventListener('click', () => {
            const amount = Number(row.dataset.pack);
            if (kind === 'coins') store.addCoins(amount); else store.addGems(amount);
            toast(`Added ${compact(amount)} ${kind === 'coins' ? 'coins' : 'diamonds'}.`, 'good');
            dlg.close();
          });
        });
      }
    });
  });
});

document.querySelector('[data-bank]')?.addEventListener('click', () => {
  dialog({
    title: 'Champ Bank',
    body: `
      <p class="muted" style="font-size:var(--fs-sm)">The bank holds a share of every pot you win. It is released at the end of the season, and it is the one balance a loss cannot touch.</p>
      <div class="stat-grid" style="margin-top:var(--s-4)">
        <div class="stat"><span class="stat__label">Banked</span><b class="stat__value">${compact(store.state.player.coins)}</b></div>
        <div class="stat"><span class="stat__label">Season</span><b class="stat__value">${SEASON.id}</b></div>
      </div>`,
    actions: [
      { label: 'Not now', variant: 'quiet' },
      { label: 'Open the store', variant: 'primary', onClick: () => go('shop') }
    ]
  });
});

/* --- free rewards --------------------------------------------------------- */

function openRewards() {
  const { daily, player } = store.state;
  const claimed = daily.claimed.includes(daily.today);

  dialog({
    title: 'Free rewards',
    body: `
      <p class="muted" style="font-size:var(--fs-sm)">One reward a day, ${daily.streak} days in a row. The streak resets if a day is missed.</p>
      <div class="daily__days" style="margin-top:var(--s-4)">
        ${DAILY_REWARDS.map((r, i) => `
          <div class="day ${daily.claimed.includes(i) ? 'day--claimed' : ''} ${i === daily.today ? 'day--today' : ''}">
            ${icon(i % 3 === 2 ? 'gem' : 'coin')}
            <b>${r.amount}</b>
            <span>Day ${i + 1}</span>
          </div>`).join('')}
      </div>
      ${claimed ? '<p class="dim" style="margin-top:var(--s-4);font-size:var(--fs-xs);text-align:center">Today\'s reward is already in the bank. Next one in ' + dailyTimer() + '.</p>' : ''}`,
    actions: claimed
      ? [{ label: 'Close', variant: 'quiet' }]
      : [{ label: 'Later', variant: 'quiet' }, {
        label: 'Claim',
        variant: 'primary',
        onClick: () => {
          const amount = store.claimDaily();
          if (amount) toast(`+${amount} coins`, 'good');
          syncShell();
        }
      }]
  });
}

document.querySelectorAll('[data-rewards]').forEach((btn) => {
  if (btn.classList.contains('rewards')) btn.addEventListener('click', openRewards);
  else btn.addEventListener('click', openRewards);
});

document.querySelector('[data-sale]')?.addEventListener('click', () => {
  go('shop');
  toast('Weekend sale is on in the store.', 'good', 2200);
});

/* --- account and news ----------------------------------------------------- */

document.querySelector('[data-account]')?.addEventListener('click', () => {
  const { player } = store.state;
  dialog({
    title: 'Your seat',
    body: `
      <div class="row" style="gap:var(--s-3);margin-bottom:var(--s-4)">
        ${avatarMarkup(player, 'lg')}
        <div style="display:grid;gap:2px">
          <b style="font-family:var(--font-display);font-size:var(--fs-lg)">${player.name}</b>
          <span class="muted" style="font-size:var(--fs-xs)">${player.title} · Level ${player.level} · ${player.league}</span>
        </div>
      </div>
      <div style="display:grid;gap:6px">
        <a class="room-row" href="#/profile" data-nav-link>${icon('user')}<span class="room-row__name"><b>Profile</b><small>Standing and collections</small></span>${icon('chevron')}</a>
        <a class="room-row" href="#/settings" data-nav-link>${icon('gear')}<span class="room-row__name"><b>Settings</b><small>Sound, privacy, connection</small></span>${icon('chevron')}</a>
        <a class="room-row" href="#/welcome" data-nav-link>${icon('logout')}<span class="room-row__name"><b>Switch seat</b><small>Back to the entry screen</small></span>${icon('chevron')}</a>
      </div>`,
    actions: [{ label: 'Close', variant: 'quiet' }],
    onMount(dlg) {
      dlg.querySelectorAll('[data-nav-link]').forEach((link) => {
        link.addEventListener('click', () => dlg.close());
      });
    }
  });
});

document.querySelector('[data-chat]')?.addEventListener('click', () => {
  dialog({
    title: 'What is new',
    body: `
      <div style="display:grid;gap:var(--s-2)">
        ${NOTIFICATIONS.map((note) => `
          <article class="row" style="align-items:flex-start;padding:var(--s-3);border:2px solid var(--line-cool);border-radius:var(--r-md);background:var(--panel-2)">
            <span class="mission__icon" style="width:34px;height:34px">${icon(note.kind === 'reward' ? 'gift' : note.kind === 'social' ? 'users' : 'cards')}</span>
            <span style="display:grid;gap:2px;flex:1">
              <b style="font-size:var(--fs-sm);color:var(--ink)">${note.title}</b>
              <span class="muted" style="font-size:var(--fs-xs)">${note.body}</span>
              <span class="dim" style="font-size:var(--fs-2xs);letter-spacing:.06em">${note.when}</span>
            </span>
            ${note.unread ? '<span class="badge-dot"></span>' : ''}
          </article>`).join('')}
      </div>`,
    actions: [{ label: 'Mark all read', variant: 'primary', onClick: () => store.markNotificationsRead() }]
  });
});

/* --- cross-screen refreshes ---------------------------------------------- */

document.addEventListener('store:refresh', () => router.refresh());
document.addEventListener('route:refresh', () => router.refresh());

store.subscribe(() => syncShell());

/* --- server status ------------------------------------------------------- */

server.onStatus((status) => {
  document.body.dataset.server = status;
});

/* --- boot ---------------------------------------------------------------- */

hydrateIcons();
syncShell();
router.start();

// The clock in the dock only needs to be right to the minute.
setInterval(syncShell, 60_000);

server.probe().then((result) => {
  if (!result.ok) return;
  toast('Connected to the game server.', 'good', 2400);
});

window.addEventListener('pagehide', () => cancelQueue());

console.info(`Champ Word · lobby build 4.1 · season ${SEASON.id} ${SEASON.name}`);
