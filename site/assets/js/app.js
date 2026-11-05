/* ===========================================================================
   CHAMP WORD — lobby bootstrap
   Wires the shell (rail, tabbar, topbar, wallet, account) to the router and to
   the one store. Screens are plain modules: { title, crumb, nav, render() }.
   =========================================================================== */

import { store } from './store.js';
import { server, cancelQueue } from './api.js';
import { icon, hydrateIcons, avatarMarkup, compact, initials, toast, dialog } from './ui.js';
import { NOTIFICATIONS, SEASON } from './data.js';
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
  onRendered(route) {
    syncShell();
    if (route === 'welcome') document.getElementById('app')?.setAttribute('data-nav', '');
  }
});

/* --- shell ---------------------------------------------------------------- */

function syncShell() {
  const { player } = store.state;

  document.querySelectorAll('[data-player-name]').forEach((n) => { n.textContent = player.name; });
  document.querySelectorAll('[data-player-level]').forEach((n) => { n.textContent = `Level ${player.level}`; });
  document.querySelectorAll('[data-coins]').forEach((n) => { n.textContent = compact(player.coins); });
  document.querySelectorAll('[data-gems]').forEach((n) => { n.textContent = String(player.gems); });

  document.querySelectorAll('[data-avatar]').forEach((slot) => {
    const size = slot.dataset.avatar;
    slot.className = `avatar ${size ? `avatar--${size}` : ''}`.trim();
    slot.innerHTML = player.photo
      ? `<img src="${player.photo}" alt="" loading="lazy" decoding="async">`
      : initials(player.name);
  });

  const dot = document.querySelector('[data-notif-dot]');
  if (dot) dot.hidden = store.state.notificationsRead || !NOTIFICATIONS.some((n) => n.unread);
}

document.querySelectorAll('[data-wallet]').forEach((btn) => {
  btn.addEventListener('click', () => go('shop'));
});

document.querySelector('[data-notifications]')?.addEventListener('click', () => {
  dialog({
    title: 'Notifications',
    body: `
      <div style="display:grid;gap:var(--s-2)">
        ${NOTIFICATIONS.map((note) => `
          <article class="row" style="align-items:flex-start;padding:var(--s-3);border:1px solid var(--line);border-radius:var(--r-md);background:rgb(244 239 227 / .03)">
            <span class="mode__icon" style="width:34px;height:34px">${icon(note.kind === 'reward' ? 'gift' : note.kind === 'social' ? 'users' : 'cards')}</span>
            <span style="display:grid;gap:2px">
              <b style="font-size:var(--fs-sm)">${note.title}</b>
              <span class="muted" style="font-size:var(--fs-xs)">${note.body}</span>
              <span class="dim" style="font-size:var(--fs-2xs);letter-spacing:.06em">${note.when}</span>
            </span>
            ${note.unread ? '<span class="badge-dot" style="margin-left:auto">1</span>' : ''}
          </article>`).join('')}
      </div>`,
    actions: [{ label: 'Mark all read', variant: 'primary', onClick: () => { store.markNotificationsRead(); syncShell(); } }]
  });
});

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

/* --- cross-screen refreshes ---------------------------------------------- */

document.addEventListener('store:refresh', () => router.refresh());
document.addEventListener('route:refresh', () => router.refresh());

store.subscribe(() => syncShell());

/* --- server status ------------------------------------------------------- */

server.onStatus((status) => {
  document.body.dataset.server = status;
  const pill = document.querySelector('[data-conn-pill]');
  if (pill) {
    pill.textContent = status === 'online' ? 'Online' : status === 'offline' ? 'Offline' : 'Unknown';
  }
});

/* --- boot ---------------------------------------------------------------- */

hydrateIcons();
syncShell();
router.start();

// Probe once, quietly: the lobby is usable either way, this only decides
// whether the queue is real.
server.probe().then((result) => {
  if (!result.ok) return;
  toast('Connected to the game server.', 'good', 2400);
});

window.addEventListener('pagehide', () => cancelQueue());

// Keep the season line honest without a server ping.
console.info(`Champ Word · lobby build 4.0 · season ${SEASON.id} ${SEASON.name}`);
