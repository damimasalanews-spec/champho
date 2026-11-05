import { store } from '../store.js';
import { FAQ } from '../data.js';
import { icon, esc, toast, dialog, confirmDialog } from '../ui.js';
import { go } from '../nav.js';
import { server } from '../api.js';

const GROUPS = [
  {
    title: 'Sound & effects',
    rows: [
      { key: 'sound', label: 'Sound effects', hint: 'Cards, calls and table cues' },
      { key: 'music', label: 'Music', hint: 'Ambient loop at the table' },
      { key: 'vibration', label: 'Vibration', hint: 'On supported phones only' }
    ]
  },
  {
    title: 'Display',
    rows: [
      { key: 'motion', label: 'Motion & animation', hint: 'Turn off for a static interface' }
    ]
  },
  {
    title: 'Privacy',
    rows: [
      { key: 'friendRequests', label: 'Friend requests', hint: 'Anyone can ask to be added' },
      { key: 'partyInvites', label: 'Party invites', hint: 'Friends can invite you to a table' }
    ]
  }
];

export default {
  title: 'Settings',
  crumb: 'Settings',
  nav: 'settings',

  render() {
    const { settings, player } = store.state;
    const el = document.createElement('div');
    el.className = 'screen screen--settings';

    const group = (g) => `
      <section class="panel reveal">
        <div class="panel__head"><h2>${esc(g.title)}</h2></div>
        <div class="panel__body" style="padding-top:0;padding-bottom:var(--s-2)">
          ${g.rows.map((row) => `
            <div class="switch-row">
              <span class="switch-row__text">
                <b>${esc(row.label)}</b>
                <small>${esc(row.hint)}</small>
              </span>
              <button class="switch" type="button" role="switch"
                      aria-checked="${Boolean(settings[row.key])}" aria-label="${esc(row.label)}"
                      data-toggle="${row.key}"></button>
            </div>`).join('')}
        </div>
      </section>`;

    el.innerHTML = `
      <div class="page-head">
        <div class="page-head__text">
          <span class="eyebrow">Preferences</span>
          <h1>Game settings</h1>
          <p>These are stored on this device. When the server is reachable, the account copy wins.</p>
        </div>
      </div>

      <div class="settings-grid">
        <div class="stack">
          ${GROUPS.map(group).join('')}

          <section class="panel reveal">
            <div class="panel__head">
              <h2>Connection</h2>
              <span class="pill" data-conn-pill>Checking…</span>
            </div>
            <div class="panel__body" style="padding-top:var(--s-2)">
              <div class="switch-row">
                <span class="switch-row__text">
                  <b>Use live matchmaking</b>
                  <small>When off, Play runs a local demo queue</small>
                </span>
                <button class="switch" type="button" role="switch"
                        aria-checked="${Boolean(settings.live)}" aria-label="Use live matchmaking"
                        data-toggle="live"></button>
              </div>
              <div class="row" style="padding-top:var(--s-4)">
                <button class="btn btn--quiet btn--sm" type="button" data-probe>${icon('refresh')} Test connection</button>
                <span class="muted" style="font-size:var(--fs-xs)" data-conn-text>Not tested yet</span>
              </div>
            </div>
          </section>
        </div>

        <div class="stack">
          <section class="panel reveal">
            <div class="panel__head"><h2>Account</h2></div>
            <div class="panel__body" style="display:grid;gap:var(--s-3)">
              <div class="row">
                <span class="muted" style="font-size:var(--fs-xs)">Signed in as</span>
                <b style="margin-left:auto;font-size:var(--fs-sm)">${esc(player.name)}</b>
              </div>
              <button class="btn btn--quiet btn--block" type="button" data-rename>${icon('edit')} Change display name</button>
              <button class="btn btn--quiet btn--block" type="button" data-reset>${icon('refresh')} Reset local progress</button>
              <button class="btn btn--danger btn--block" type="button" data-out>${icon('logout')} Sign out</button>
            </div>
          </section>

          <section class="panel reveal">
            <div class="panel__head"><h2>About</h2><span class="pill">Build 4.0</span></div>
            <div class="panel__body" style="display:grid;gap:var(--s-2)">
              ${FAQ.map((item) => `
                <details style="border-bottom:1px solid var(--line-cool);padding-bottom:var(--s-2)">
                  <summary style="cursor:pointer;font-size:var(--fs-sm);font-weight:600;padding:var(--s-2) 0">${esc(item.q)}</summary>
                  <p class="muted" style="font-size:var(--fs-xs);padding-bottom:var(--s-2)">${esc(item.a)}</p>
                </details>`).join('')}
              <p class="muted" style="font-size:var(--fs-2xs);letter-spacing:.06em">
                Champ Word · lobby rewrite · card table served by the original client
              </p>
            </div>
          </section>
        </div>
      </div>
    `;

    el.querySelectorAll('[data-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.toggle;
        const on = store.toggle(key);
        btn.setAttribute('aria-checked', String(on));
        if (key === 'live') {
          if (!on) toast('Live matchmaking off — Play uses the demo queue.', 'info');
          else toast('Live matchmaking on.', 'good');
        }
      });
    });

    const pill = el.querySelector('[data-conn-pill]');
    const text = el.querySelector('[data-conn-text]');

    function paintConn() {
      pill.textContent = server.status === 'online' ? 'Online' : server.status === 'offline' ? 'Offline' : 'Unknown';
      pill.className = `pill ${server.status === 'online' ? 'pill--jade' : server.status === 'offline' ? 'pill--live' : ''}`;
      text.textContent = server.status === 'online'
        ? 'A server answered the handshake.'
        : server.status === 'offline'
          ? 'No server answered within 4.5s.'
          : 'Not tested yet';
    }

    el.querySelector('[data-probe]').addEventListener('click', async (event) => {
      event.currentTarget.disabled = true;
      text.textContent = 'Testing…';
      await server.probe();
      paintConn();
      event.currentTarget.disabled = false;
    });

    el.querySelector('[data-rename]').addEventListener('click', () => {
      dialog({
        title: 'Change display name',
        body: `<div class="field"><label for="set-name">Display name</label>
               <input class="input" id="set-name" maxlength="18" value="${esc(player.name)}"></div>`,
        actions: [
          { label: 'Cancel', variant: 'quiet' },
          { label: 'Save', variant: 'primary', onClick: () => {
            const v = document.getElementById('set-name')?.value;
            if (!store.rename(v)) { toast('That name is empty.', 'bad'); return false; }
            toast('Name updated.', 'good');
            document.dispatchEvent(new CustomEvent('store:refresh'));
            return true;
          } }
        ],
        onMount(dlg) { dlg.querySelector('#set-name').focus(); }
      });
    });

    el.querySelector('[data-reset]').addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Reset local progress?',
        body: 'Coins, cosmetics, claimed tiers and preferences on this device go back to the starting values. This cannot be undone.',
        confirmLabel: 'Reset',
        danger: true
      });
      if (!ok) return;
      store.reset();
      toast('Local progress reset.', 'info');
      document.dispatchEvent(new CustomEvent('store:refresh'));
    });

    el.querySelector('[data-out]').addEventListener('click', () => {
      store.signOut();
      go('welcome');
    });

    paintConn();
    return el;
  }
};
