import { MODES } from '../data.js';
import { esc, dialog } from '../ui.js';
import { go } from '../nav.js';
import { openGame } from '../gameframe.js';

/**
 * The five games, drawn as cards. Copy here is display copy — the game names
 * and their destinations come from MODES, so there is one source of truth.
 */
const FACE = {
  classic: { kicker: 'UNO', name: 'Classic<br>Mode', note: '4 seats · 7 cards' },
  wild: { kicker: '+2 · +4 · wild', name: 'Go<br>Wild', note: '2v2 word grid' },
  fun: { kicker: 'UNO', name: 'Fun<br>Pack', note: 'No mercy' },
  contest: { kicker: 'UNO contest', name: 'Contest', note: 'Season 01 ladder' },
  friends: { kicker: 'Free', name: 'Play with<br>Friends', note: 'Private table' }
};

function card(mode) {
  const face = FACE[mode.id] ?? { kicker: '', name: esc(mode.title), note: esc(mode.sub) };
  const extras = [
    mode.pending ? '<span class="gamecard__badge">Soon</span>' : '',
    mode.id === 'contest' ? '<span class="gamecard__ribbon">2026 UCS</span>' : '',
    mode.id === 'friends' ? '<span class="gamecard__tag">Free<br>Left: 20</span>' : ''
  ].join('');

  return `
    <button class="gamecard gamecard--${mode.id}" type="button" role="listitem"
            data-mode="${mode.id}"
            aria-label="${esc(mode.title)} — ${esc(mode.sub)}">
      <span class="gamecard__face">
        <span class="gamecard__kicker">${esc(face.kicker)}</span>
        <span class="gamecard__name">${face.name}</span>
        <span class="gamecard__note">${esc(face.note)}</span>
      </span>
      ${extras}
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
      { label: 'Open Classic', variant: 'primary', onClick: () => openGame('Word UNO · Classic mode', 'game/') }
    ]
  });
}

export default {
  title: 'Home',
  crumb: 'Home',
  nav: 'home',

  render() {
    const el = document.createElement('div');
    el.className = 'screen screen--home';

    el.innerHTML = `
      <div class="home">
        <span class="home__glow" aria-hidden="true"></span>
        <div class="fan" role="list" aria-label="Ways to play">
          ${MODES.map(card).join('')}
        </div>
      </div>`;

    el.querySelectorAll('[data-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = MODES.find((m) => m.id === btn.dataset.mode);
        if (!mode) return;
        if (mode.pending) return explainPending(mode);
        if (mode.game) return openGame(`${mode.title} · ${mode.sub}`, mode.game);
        if (mode.route) go(mode.route);
      });
    });

    return el;
  }
};
