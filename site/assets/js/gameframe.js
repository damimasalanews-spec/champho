/* ===========================================================================
   The in-round client, unchanged.
   The table is served by wild-play.html, which owns its own socket, seats and
   round state. The lobby hands off to it in a full-screen frame and takes the
   player back when it closes.

   The frame probes the server first. Without one the round client opens on a
   dead board with "Disconnected - reload to reconnect" across it, which reads
   as a broken product rather than an absent server. When the probe fails we
   say so, and let the player open the client anyway.
   =========================================================================== */

import { GAME_CLIENT, gameUrl, server, socketUrl } from './api.js';
import { icon } from './ui.js';

let frame = null;
let lastFocus = null;

const PROBE_TIMEOUT = 2500;

/**
 * Open one of the game clients full-screen.
 * `file` is a path relative to the game directory ('game/', 'go-wild-2v2-finished.html')
 * or an absolute one; each mode card names its own client.
 */
export function openGame(label = 'Champ Word · live table', file = GAME_CLIENT) {
  if (frame) return;
  const src = gameUrl(file);
  lastFocus = document.activeElement;

  frame = document.createElement('div');
  frame.className = 'gameframe';
  frame.setAttribute('role', 'dialog');
  frame.setAttribute('aria-modal', 'true');
  frame.setAttribute('aria-label', label);
  frame.innerHTML = `
    <div class="gameframe__bar">
      <span>${icon('crown')}</span>
      <span>${label}</span>
      <button class="btn btn--quiet btn--sm" type="button" data-exit style="margin-left:auto">
        ${icon('close')} Leave table
      </button>
    </div>
    <div class="gameframe__stage" data-stage>
      <div class="gameframe__loading">Summoning the table…</div>
    </div>
  `;

  document.body.append(frame);
  document.body.style.overflow = 'hidden';

  const stage = frame.querySelector('[data-stage]');

  frame.querySelector('[data-exit]').addEventListener('click', closeGame);
  frame._escape = (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeGame();
  };
  document.addEventListener('keydown', frame._escape);
  frame.querySelector('[data-exit]').focus();

  mount();

  async function mount() {
    const reachable = await probe();
    if (!frame) return;
    if (reachable) {
      load();
    } else {
      showOffline();
    }
  }

  function load() {
    stage.innerHTML = `<iframe src="${src}" title="${label}" allow="autoplay; fullscreen"></iframe>`;
  }

  function showOffline() {
    stage.innerHTML = `
      <div class="gameframe__offline">
        <div class="offline-card">
          <span class="eyebrow">No server</span>
          <h2>The table needs a matchmaking server</h2>
          <p>The round client talks to ${socketUrl()}. Nothing is answering there right now, so it
             would open on a dead board and show a reconnect banner.</p>
          <div class="offline-card__actions">
            <button class="btn btn--primary" type="button" data-retry>Try again</button>
            <button class="btn btn--quiet" type="button" data-anyway>Open the client anyway</button>
          </div>
          <p class="muted offline-card__note">
            Start it with <code>DATABASE_URL</code> set and <code>npm run dev</code>, then press Try again.
          </p>
        </div>
      </div>`;

    stage.querySelector('[data-anyway]').addEventListener('click', load);
    stage.querySelector('[data-retry]').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const started = Date.now();
      button.disabled = true;
      button.textContent = 'Checking…';
      const reachable = await probe();
      // a refused socket fails in single-digit milliseconds, so without a
      // minimum hold the "Checking…" state is never actually seen
      const hold = Math.max(0, 420 - (Date.now() - started));
      await new Promise((done) => setTimeout(done, hold));
      if (!frame) return;
      if (reachable) load();
      else {
        button.disabled = false;
        button.textContent = 'Try again';
      }
    });
  }
}

function probe() {
  return Promise.race([
    server.probe().then((r) => Boolean(r?.ok)).catch(() => false),
    new Promise((resolve) => setTimeout(() => resolve(false), PROBE_TIMEOUT))
  ]);
}

export function closeGame() {
  if (!frame) return;
  document.removeEventListener('keydown', frame._escape);
  frame.remove();
  frame = null;
  document.body.style.overflow = '';
  lastFocus?.focus?.();
}

export function gameAvailable() {
  return server.status === 'online';
}
