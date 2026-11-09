import { store } from '../store.js';
import { LIVE_TABLES } from '../data.js';
import { icon, esc, toast, compact, avatarMarkup, dialog } from '../ui.js';
import { server } from '../api.js';
import { openGame } from '../gameframe.js';

const CODE_LEN = 6;

export default {
  title: 'Private table',
  crumb: 'Private table',
  nav: 'play',

  render() {
    const { player } = store.state;

    const el = document.createElement('div');
    el.className = 'screen screen--room';

    el.innerHTML = `
      <div class="page-head">
        <div class="page-head__text">
          <span class="eyebrow">Private table</span>
          <h1>Have a code?</h1>
          <p>Six characters, no spaces. The code is the only thing you need to hand out.</p>
        </div>
      </div>

      <div class="home-grid" style="margin-top:0">
        <div class="stack">
          <section class="room-hero reveal">
            <span class="mode__icon" style="width:52px;height:52px">${icon('users')}</span>
            <h2 style="font-size:var(--fs-xl)">Join a table</h2>
            <p class="muted" style="font-size:var(--fs-sm);max-width:42ch">Type the code your host shared, or paste it in one go.</p>

            <div class="code-cells" data-code role="group" aria-label="Six-character room code">
              ${Array.from({ length: CODE_LEN }, (_, i) => `
                <input type="text" inputmode="text" autocomplete="off" spellcheck="false"
                       maxlength="1" aria-label="Character ${i + 1} of 6" data-index="${i}">`).join('')}
            </div>

            <button class="btn btn--primary btn--lg" type="button" data-join disabled>
              ${icon('play')} Join table
            </button>

            <p class="muted" style="font-size:var(--fs-2xs);letter-spacing:.06em;text-transform:uppercase">
              ${server.status === 'online' ? 'Server online' : 'Server offline · demo only'}
            </p>
          </section>

          <section class="panel reveal">
            <div class="panel__head">
              <h2>Or open your own</h2>
              <span class="pill">${esc(player.name)}</span>
            </div>
            <div class="panel__body stack">
              <div class="field">
                <span class="field__label">Mode</span>
                <div class="segmented" role="tablist" aria-label="Table mode" data-modes>
                  <button role="tab" aria-selected="true" data-mode="classic">Classic</button>
                  <button role="tab" aria-selected="false" data-mode="wild">Go Wild 2v2</button>
                </div>
              </div>
              <div class="field">
                <span class="field__label">Stake per seat</span>
                <div class="segmented" role="tablist" aria-label="Stake" data-stakes>
                  <button role="tab" aria-selected="true" data-stake="100">100</button>
                  <button role="tab" aria-selected="false" data-stake="250">250</button>
                  <button role="tab" aria-selected="false" data-stake="500">500</button>
                </div>
              </div>
              <button class="btn btn--ghost btn--block" type="button" data-create>
                ${icon('plus')} Create table · free to open
              </button>
              <p class="muted" style="font-size:var(--fs-xs)">
                A new table starts empty. Share its code — it fills as players accept.
              </p>
            </div>
          </section>
        </div>

        <div class="stack">
          <section class="panel reveal">
            <div class="panel__head"><h2>Tables you can see</h2><span class="pill">${LIVE_TABLES.length}</span></div>
            <div class="panel__body panel__body--tight" style="display:grid;gap:2px">
              ${LIVE_TABLES.map((table) => `
                <button class="room-row" type="button" data-open="${esc(table.id)}">
                  <span class="room-row__avatars">
                    ${(table.players || [table.host]).slice(0, 3).map((name) => avatarMarkup({ name }, 'sm')).join('')}
                  </span>
                  <span class="room-row__name">
                    <b>${esc(table.id)}</b>
                    <small>${esc(table.host)} · ${esc(table.mode)} · ${compact(table.stake)}</small>
                  </span>
                  <span class="pill ${table.live ? 'pill--jade' : ''}">${table.live ? 'Open' : 'Full'}</span>
                </button>`).join('')}
            </div>
          </section>

          <section class="panel reveal">
            <div class="panel__head"><h2>House rules</h2></div>
            <div class="panel__body" style="display:grid;gap:var(--s-3);font-size:var(--fs-sm);color:var(--ink-2)">
              <p>Private tables do not change your season rating.</p>
              <p>The stake is checked against your wallet before the deal, by the server.</p>
              <p>If a seat disconnects, its turn draws and passes until it returns.</p>
            </div>
          </section>
        </div>
      </div>
    `;

    /* --- code input ------------------------------------------------------- */

    const inputs = [...el.querySelectorAll('[data-code] input')];
    const joinBtn = el.querySelector('[data-join]');

    const code = () => inputs.map((i) => i.value).join('').toUpperCase();
    const sync = () => { joinBtn.disabled = code().length !== CODE_LEN; };

    inputs.forEach((input, index) => {
      input.addEventListener('input', () => {
        input.value = input.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 1);
        if (input.value && index < inputs.length - 1) inputs[index + 1].focus();
        sync();
      });

      input.addEventListener('keydown', (event) => {
        if (event.key === 'Backspace' && !input.value && index > 0) {
          event.preventDefault();
          inputs[index - 1].focus();
          inputs[index - 1].value = '';
          sync();
        }
        if (event.key === 'ArrowLeft' && index > 0) inputs[index - 1].focus();
        if (event.key === 'ArrowRight' && index < inputs.length - 1) inputs[index + 1].focus();
        if (event.key === 'Enter' && !joinBtn.disabled) joinBtn.click();
      });

      input.addEventListener('paste', (event) => {
        const text = (event.clipboardData?.getData('text') || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
        if (!text) return;
        event.preventDefault();
        text.slice(0, CODE_LEN).split('').forEach((char, i) => {
          if (inputs[i]) inputs[i].value = char;
        });
        inputs[Math.min(text.length, CODE_LEN - 1)].focus();
        sync();
      });
    });

    joinBtn.addEventListener('click', () => {
      const value = code();
      if (server.status === 'online') {
        openGame(`Room ${value}`);
        return;
      }
      dialog({
        title: `Room ${value}`,
        body: `<p>The code is well formed, but no matchmaking server is answering, so the seat cannot be claimed from here.</p>
               <p class="muted" style="margin-top:10px">The table client will still open — it will show its own connection state.</p>`,
        actions: [
          { label: 'Cancel', variant: 'quiet' },
          { label: 'Open the table anyway', variant: 'primary', onClick: () => openGame(`Room ${value}`) }
        ]
      });
    });

    /* --- table options ---------------------------------------------------- */

    el.querySelectorAll('[data-modes] [data-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        el.querySelectorAll('[data-modes] [data-mode]').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
      });
    });

    el.querySelectorAll('[data-stakes] [data-stake]').forEach((btn) => {
      btn.addEventListener('click', () => {
        el.querySelectorAll('[data-stakes] [data-stake]').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
      });
    });

    el.querySelector('[data-create]').addEventListener('click', () => {
      const mode = el.querySelector('[data-modes] [aria-selected="true"]')?.dataset.mode ?? 'classic';
      const stake = el.querySelector('[data-stakes] [aria-selected="true"]')?.dataset.stake ?? '250';
      const newCode = Array.from({ length: CODE_LEN }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');

      dialog({
        title: 'Table opened',
        body: `
          <p class="muted" style="font-size:var(--fs-sm)">Share this code. The table fills as seats accept.</p>
          <p style="font-family:var(--font-mono);font-size:2rem;font-weight:700;letter-spacing:.3em;color:var(--gold-hi);text-align:center;margin:var(--s-4) 0">${newCode}</p>
          <p class="muted" style="font-size:var(--fs-xs);text-align:center">${mode === 'wild' ? 'Go Wild 2v2' : 'Classic'} · ${stake} stake per seat</p>`,
        actions: [
          {
            label: 'Copy code',
            variant: 'quiet',
            onClick: () => { navigator.clipboard?.writeText(newCode); toast('Code copied.', 'good'); return false; }
          },
          { label: 'Open table', variant: 'primary', onClick: () => openGame(`Room ${newCode}`) }
        ]
      });
    });

    el.querySelectorAll('[data-open]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.open;
        dialog({
          title: `Join ${id}?`,
          body: `<p class="muted">The seat opens when the host starts the round. Today that needs the matchmaking server, which is not answering.</p>`,
          actions: [
            {
              label: 'Fill the code',
              variant: 'quiet',
              onClick: () => {
                const chars = `${id.replace(/[^a-z0-9]/gi, '').toUpperCase()}XXXXXX`.slice(0, CODE_LEN).split('');
                inputs.forEach((input, i) => { input.value = chars[i] ?? ''; });
                sync();
                inputs[0].focus();
                toast(`Code for ${id} filled in.`, 'info');
              }
            },
            { label: 'Open the table', variant: 'primary', onClick: () => openGame(`Table ${id}`) }
          ]
        });
      });
    });
    return el;
  }
};
