/* ===========================================================================
   The in-round client, unchanged.
   The table is served by wild-play.html, which owns its own socket, seats and
   round state. The lobby hands off to it in a full-screen frame and takes the
   player back when it closes — no rewrite of the game itself.
   =========================================================================== */

import { GAME_CLIENT } from './api.js';
import { icon, toast } from './ui.js';

let frame = null;
let lastFocus = null;

export function openGame(label = 'Champ Word · live table') {
  if (frame) return;
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
    <iframe src="${GAME_CLIENT}" title="${label}" allow="autoplay; fullscreen"></iframe>
  `;

  document.body.append(frame);
  document.body.style.overflow = 'hidden';

  const exit = () => closeGame();
  frame.querySelector('[data-exit]').addEventListener('click', exit);

  document.addEventListener('keydown', escapeOnce);
  frame.querySelector('[data-exit]').focus();

  function escapeOnce(event) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeGame();
  }

  frame._escape = escapeOnce;
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
  // The table is a real page in this deployment; whether a multiplayer server
  // answers is a separate question the play screen reports honestly.
  return true;
}

export function warnOffline() {
  toast('No game server is answering — this opens the table client anyway.', 'bad', 4200);
}
