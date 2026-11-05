import { store } from '../store.js';
import { FRIENDS } from '../data.js';
import { icon, esc, avatarMarkup, toast, dialog } from '../ui.js';
import { go } from '../nav.js';
import { server } from '../api.js';
import { openGame } from '../gameframe.js';

const STATE_LABEL = { on: 'Online', game: 'In a table', off: 'Offline' };

export default {
  title: 'Social',
  crumb: 'Social',
  nav: 'social',

  render() {
    const { player } = store.state;
    const el = document.createElement('div');
    el.className = 'screen screen--social';

    const online = FRIENDS.filter((f) => f.state !== 'off').length;

    el.innerHTML = `
      <div class="page-head">
        <div class="page-head__text">
          <span class="eyebrow">Friends & parties</span>
          <h1>Group up</h1>
          <p>Invite a friend to a private table, or join one already in play.</p>
        </div>
        <button class="btn btn--primary btn--sm" type="button" data-add>${icon('plus')} Add friend</button>
      </div>

      <div class="home-grid" style="margin-top:0">
        <div class="stack">
          <section class="panel reveal">
            <div class="panel__head">
              <h2>Friends</h2>
              <span class="pill pill--jade">${online} online</span>
            </div>
            <div class="panel__body panel__body--tight" data-friends></div>
          </section>
        </div>

        <div class="stack">
          <section class="panel reveal">
            <div class="panel__head">
              <h2>Your party</h2>
              <span class="pill">${player.name}</span>
            </div>
            <div class="panel__body stack">
              <div class="quick" style="grid-template-columns:repeat(2,1fr)">
                <div class="party-slot party-slot--filled">
                  ${avatarMarkup(player, 'sm avatar--ring')}
                  <b style="font-size:var(--fs-xs)">${esc(player.name)}</b>
                  <small class="muted">Leader</small>
                </div>
                ${[1, 2, 3].map((n) => `
                  <button class="party-slot" type="button" data-invite aria-label="Invite to party slot ${n}">
                    ${icon('plus')}<span>Open seat</span>
                  </button>`).join('')}
              </div>
              <div class="row" style="gap:var(--s-2)">
                <button class="btn btn--primary btn--sm" type="button" data-start>${icon('play')} Start table</button>
                <button class="btn btn--quiet btn--sm" type="button" data-leave>Leave party</button>
              </div>
              <p class="muted" style="font-size:var(--fs-xs)">
                Party seats fill with friends. Starting a table opens the round client with everyone who accepted.
              </p>
            </div>
          </section>

          <section class="panel reveal">
            <div class="panel__head"><h2>Server</h2></div>
            <div class="panel__body stack">
              <div class="row">
                <span class="status-dot" data-server-dot></span>
                <span style="font-size:var(--fs-sm)" data-server-label>Checking…</span>
                <button class="btn btn--quiet btn--sm" type="button" data-probe style="margin-left:auto">${icon('refresh')} Retry</button>
              </div>
              <p class="muted" style="font-size:var(--fs-xs)">
                Invites and party joins need the matchmaking server. The lobby itself stays usable without it.
              </p>
            </div>
          </section>
        </div>
      </div>
    `;

    const list = el.querySelector('[data-friends]');
    list.innerHTML = FRIENDS.map((friend) => `
      <div class="friend" data-friend="${esc(friend.name)}">
        ${avatarMarkup({ name: friend.name }, 'sm')}
        <span class="friend__meta">
          <b>${esc(friend.name)}</b>
          <small><span class="status-dot ${friend.state === 'on' ? 'status-dot--on' : friend.state === 'game' ? 'status-dot--game' : ''}"></span>
            ${STATE_LABEL[friend.state]} · Lv ${friend.level}</small>
        </span>
        <button class="btn btn--quiet btn--sm" type="button" data-ping="${esc(friend.name)}"
                ${friend.state === 'off' ? 'disabled' : ''}>
          ${friend.state === 'game' ? 'Join' : 'Invite'}
        </button>
      </div>`).join('');

    list.querySelectorAll('[data-ping]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const name = btn.dataset.ping;
        const friend = FRIENDS.find((f) => f.name === name);
        if (friend?.state === 'game') {
          if (server.status === 'online') openGame(`${name}'s table`);
          else toast(`${name} is in a table, but the server is not answering.`, 'bad');
          return;
        }
        toast(`Invite sent to ${name}.`, 'good');
      });
    });

    el.querySelectorAll('[data-invite]').forEach((slot) => {
      slot.addEventListener('click', () => {
        const onlineFriends = FRIENDS.filter((f) => f.state !== 'off');
        dialog({
          title: 'Invite to your party',
          body: `
            <p class="muted" style="font-size:var(--fs-sm);margin-bottom:var(--s-3)">Pick a friend. Invites expire when the table starts.</p>
            <div style="display:grid;gap:6px">
              ${onlineFriends.map((f) => `
                <button class="friend" type="button" data-pick="${esc(f.name)}">
                  ${avatarMarkup({ name: f.name }, 'sm')}
                  <span class="friend__meta"><b>${esc(f.name)}</b><small>${STATE_LABEL[f.state]}</small></span>
                  <span class="link">${icon('plus')}</span>
                </button>`).join('')}
            </div>`,
          actions: [{ label: 'Close', variant: 'quiet' }],
          onMount(dlg) {
            dlg.querySelectorAll('[data-pick]').forEach((btn) => {
              btn.addEventListener('click', () => {
                toast(`${btn.dataset.pick} invited.`, 'good');
                dlg.close();
              });
            });
          }
        });
      });
    });

    el.querySelector('[data-add]').addEventListener('click', () => {
      dialog({
        title: 'Add a friend',
        body: `
          <div class="field">
            <label for="friend-id">Player ID or name</label>
            <input class="input" id="friend-id" placeholder="e.g. 1521719913732" autocomplete="off">
            <span class="field__hint">Friend requests are sent through the server and can be turned off in Settings.</span>
          </div>`,
        actions: [
          { label: 'Cancel', variant: 'quiet' },
          { label: 'Send request', variant: 'primary', onClick: () => { toast('Friend request sent.', 'good'); } }
        ],
        onMount(dlg) { dlg.querySelector('#friend-id').focus(); }
      });
    });

    el.querySelector('[data-start]').addEventListener('click', () => {
      toast('Opening a private table for the party…', 'info');
      setTimeout(() => go('room'), 400);
    });

    el.querySelector('[data-leave]').addEventListener('click', () => toast('You left the party.', 'info'));

    const dot = el.querySelector('[data-server-dot]');
    const label = el.querySelector('[data-server-label]');

    function paintServer() {
      const online = server.status === 'online';
      dot.className = `status-dot ${online ? 'status-dot--on' : ''}`;
      label.textContent = online ? 'Matchmaking server online' : server.status === 'offline' ? 'No server answering' : 'Checking…';
    }

    el.querySelector('[data-probe]').addEventListener('click', async (event) => {
      event.currentTarget.disabled = true;
      label.textContent = 'Checking…';
      await server.probe();
      paintServer();
      event.currentTarget.disabled = false;
    });

    paintServer();
    return el;
  }
};
