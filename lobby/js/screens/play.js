import { store } from '../store.js';
import { MODES, SEASON } from '../data.js';
import { icon, esc, avatarMarkup, toast, progressBar } from '../ui.js';
import { go } from '../nav.js';
import { server, findMatch, cancelQueue } from '../api.js';
import { openGame } from '../gameframe.js';

const TITLES = {
  classic: { title: 'Word UNO · Classic', sub: '2v2 or 4v4 · seven cards', icon: 'cards', client: 'game/', team: true },
  // wild-play.html, not go-wild-2v2-finished.html: only the former has a socket.
  wild: { title: 'Go Wild', sub: '7×6 2v2 or 4v4 grid · 30 words', icon: 'flame', client: 'wild-play.html', team: true }
};

export default {
  title: 'Play',
  crumb: 'Play',
  nav: 'play',

  render(param = 'classic') {
    const mode = TITLES[param] ? param : 'classic';
    const meta = TITLES[mode];
    const { player } = store.state;

    const el = document.createElement('div');
    el.className = 'screen screen--play';

    el.innerHTML = `
      <div class="page-head">
        <div class="page-head__text">
          <span class="eyebrow">Season ${esc(SEASON.id)} · ${esc(SEASON.name)}</span>
          <h1>${esc(meta.title)}</h1>
          <p>${esc(meta.sub)}. The table fills from the queue, then the round starts on the server's clock.</p>
        </div>
        <div class="segmented" role="tablist" aria-label="Mode">
          <button role="tab" data-mode="classic" aria-selected="${mode === 'classic'}">Classic</button>
          <button role="tab" data-mode="wild" aria-selected="${mode === 'wild'}">Go Wild</button>
        </div>
      </div>

      <div class="play-layout">
        <div class="stack">
          <section class="queue reveal" data-queue aria-live="polite">
            <div class="queue__ring" aria-hidden="true"></div>
            <h2 data-queue-title style="font-size:var(--fs-xl)">Ready when you are</h2>
            <p class="muted" data-queue-text style="font-size:var(--fs-sm)">
              ${player.name}, pick a table of four or eight seats; bots take any that stay empty.
            </p>

            <div class="formats" role="group" aria-label="Table size"><button class="format is-on" type="button" data-format="2" aria-pressed="true">2v2<small>4 seats</small></button><button class="format" type="button" data-format="4" aria-pressed="false">4v4<small>8 seats</small></button></div><div class="queue__seats" data-seats>
              <div class="seat seat--filled">
                <span class="seat__slot">${avatarMarkup(player, 'sm')}</span>
                <span>You</span>
              </div>
              ${[1, 2, 3].map((n) => `
                <div class="seat" data-seat="${n}">
                  <span class="seat__slot">${icon('user')}</span>
                  <span>Seat ${n + 1}</span>
                </div>`).join('')}
            </div>

            <div class="row" style="justify-content:center;gap:var(--s-3)">
              <button class="btn btn--primary btn--lg" type="button" data-find>${icon('play')} Find a table</button>
              <button class="btn btn--quiet btn--lg" type="button" data-cancel hidden>Cancel queue</button>
            </div>

            <p class="muted" style="font-size:var(--fs-2xs);letter-spacing:.08em;text-transform:uppercase" data-mode-note>
              ${server.status === 'offline' ? 'Demo queue — no server answering' : 'Live matchmaking'}
            </p>
          </section>

          <section class="panel reveal">
            <div class="panel__head"><h2>Other tables</h2></div>
            <div class="panel__body" style="display:grid;gap:var(--s-3)">
              ${MODES.filter((m) => m.id !== mode).map((m) => `
                <button class="room-row" type="button" data-other="${m.id}">
                  <span class="mode__icon" style="width:38px;height:38px">${icon(m.icon)}</span>
                  <span class="room-row__name"><b>${esc(m.title)}</b><small>${esc(m.sub)}</small></span>
                  <span class="link">${icon('arrow')}</span>
                </button>`).join('')}
            </div>
          </section>
        </div>

        <div class="stack">
          <section class="panel reveal">
            <div class="panel__head"><h2>Your table form</h2><span class="pill">${player.streak} streak</span></div>
            <div class="panel__body stack">
              <div class="row" style="gap:6px">
                ${['W', 'W', 'L', 'W', 'W'].map((r, i) => `
                  <span class="pill" style="background:${r === 'W' ? 'rgb(111 214 176 / .14)' : 'rgb(213 80 92 / .14)'};
                              color:${r === 'W' ? '#0b6b3f' : '#a1192c'};border-color:transparent;
                              min-width:34px;justify-content:center">${r}</span>`).join('')}
                <span class="muted" style="font-size:var(--fs-2xs);margin-left:auto">Last 5</span>
              </div>
              <div class="meter">
                <div class="meter__label"><span>Season ${esc(SEASON.name)}</span><b>${player.seasonXp} XP</b></div>
                ${progressBar(player.seasonXp, 7200, { jade: true, thin: true, label: 'Season progress' })}
              </div>
              <div class="stat-grid" style="grid-template-columns:repeat(2,1fr)">
                <div class="stat"><span class="stat__label">Wins</span><span class="stat__value">${player.wins}</span></div>
                <div class="stat"><span class="stat__label">Games</span><span class="stat__value">${player.games}</span></div>
              </div>
            </div>
          </section>

          <section class="panel reveal">
            <div class="panel__head"><h2>How a round runs</h2></div>
            <div class="panel__body" style="display:grid;gap:var(--s-3);font-size:var(--fs-sm);color:var(--ink-2)">
              <p><b style="color:#8a5c00">1.</b> The server deals seven cards to each seat and starts the clock.</p>
              <p><b style="color:#8a5c00">2.</b> Play a card that matches the top card's colour or word.</p>
              <p><b style="color:#8a5c00">3.</b> No legal card? Draw one, and the turn passes.</p>
              <p><b style="color:#8a5c00">4.</b> Empty your hand to take the pot, less your own stake.</p>
            </div>
          </section>
        </div>
      </div>
    `;

    /* --- queue state machine --------------------------------------------- */

    const panel = el.querySelector('[data-queue]');
    const title = el.querySelector('[data-queue-title]');
    const text = el.querySelector('[data-queue-text]');
    const findBtn = el.querySelector('[data-find]');
    const cancelBtn = el.querySelector('[data-cancel]');
    const note = el.querySelector('[data-mode-note]');
    let seats = [...el.querySelectorAll('[data-seat]')];
    let phase = 'idle'; // idle | searching | found
    let found = null;

    /* --- 2v2 or 4v4 ------------------------------------------------------- */
  let teamSize = 2;

  const seatsBox = el.querySelector('[data-seats]');
  const sizeLabel = () => `${teamSize * 2} seats`;

  function paintSeats() {
    seatsBox.innerHTML = `
      <div class="seat seat--filled">
        <span class="seat__slot">${avatarMarkup(player, 'sm')}</span>
        <span>You</span>
      </div>
      ${Array.from({ length: teamSize * 2 - 1 }, (_, i) => `
        <div class="seat" data-seat="${i + 1}">
          <span class="seat__slot">${icon('user')}</span>
          <span>Seat ${i + 2}</span>
        </div>`).join('')}`;
    seats = [...el.querySelectorAll('[data-seat]')];
    setSeats(0);
  }

  el.querySelectorAll('[data-format]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (phase === 'searching') return;
      teamSize = Number(btn.dataset.format) === 4 ? 4 : 2;
      el.querySelectorAll('[data-format]').forEach((other) => {
        const on = other === btn;
        other.classList.toggle('is-on', on);
        other.setAttribute('aria-pressed', String(on));
      });
      paintSeats();
      title.textContent = 'Ready when you are';
      text.textContent = `${player.name}, the queue fills a ${teamSize}v${teamSize} table of ${teamSize * 2} seats: you plus ${teamSize * 2 - 1}, bots if no one answers.`;
      Note(`Classic ${teamSize}v${teamSize}`);
    });
  });

  paintSeats();
  function setSeats(filled) {
      seats.forEach((seat, i) => seat.classList.toggle('seat--filled', i < filled));
    }

    function toIdle(message = 'Ready when you are') {
      phase = 'idle';
      found = null;
      panel.classList.remove('is-queued');
      title.textContent = message;
      text.textContent = `${store.state.player.name}, pick a table of four or eight seats; bots take any that stay empty.`;
      findBtn.hidden = false;
      findBtn.disabled = false;
      findBtn.innerHTML = `${icon('play')} Find a table`;
      cancelBtn.hidden = true;
      setSeats(0);
    }

    el.querySelectorAll('[data-mode]').forEach((tab) => {
      tab.addEventListener('click', () => go(`play/${tab.dataset.mode}`));
    });

    el.querySelectorAll('[data-other]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = MODES.find((m) => m.id === btn.dataset.other);
        if (!target) return;
        if (target.game) openGame(`${target.title} · ${target.sub}`, target.game);
        else if (target.route) go(target.route);
      });
    });

    findBtn.addEventListener('click', async () => {
      if (phase === 'found' && found) {
        openGame(`${meta.title} · Room ${found.roomId}`, meta.client);
        return;
      }
      if (phase !== 'idle') return;

      phase = 'searching';
      findBtn.hidden = true;
      cancelBtn.hidden = false;
      title.textContent = 'Searching the hall';
      text.textContent = 'Filling three seats at a table of your rating.';

      Note(server.status === 'online' ? 'Live matchmaking' : 'Demo queue — no server answering');

      const result = await findMatch({
        displayName: store.state.player.name,
        teamSize,
        onState(state) {
          if (state === 'queued') {
            let filled = 0;
            const tick = setInterval(() => {
              filled = Math.min(teamSize * 2 - 1, filled + 1);
              setSeats(filled);
              if (filled >= teamSize * 2 - 1) clearInterval(tick);
            }, 700);
          }
          if (state === 'found') {
            setSeats(teamSize * 2 - 1);
            title.textContent = 'Table found';
            text.textContent = 'The table is being dealt.';
          }
        }
      });

      if (!el.isConnected) return;

      // No table. Say so, and let the button start another search. The lobby
      // used to invent a room code here so the screen always "worked"; a player
      // then sat at a table that no one else could ever join.
      if (result.mode === 'offline') {
        phase = 'idle';
        found = null;
        setSeats(0);
        findBtn.hidden = false;
        findBtn.disabled = false;
        cancelBtn.hidden = true;

        if (result.reason === 'queue-timeout') {
          findBtn.innerHTML = `${icon('refresh')} Try again`;
          title.textContent = 'No one else is queued';
          text.textContent = 'Nobody joined the queue in 25 seconds. Press Try again to rejoin it.';
          Note('Queue empty');
          toast('The queue is empty right now.', 'bad', 4200);
          return;
        }

        // No server at all. The local table ships with three bots of its own
        // (game/game.js: BOT_KIT, S.botPlans), so a player with no opponent and
        // no server still gets a dealt hand instead of an error. This replaces
        // the primary button rather than adding a second one beside it.
        const bots = findBtn.cloneNode(false);
        bots.innerHTML = `${icon('users')} Play with bots`;
        bots.addEventListener('click', () => openGame('Champ Word · house bots', 'game/'));
        findBtn.replaceWith(bots);

        title.textContent = 'Nobody else is here yet';
        text.textContent = 'The server is offline, so the house deals this one — three bots take the empty seats.';
        Note('Bots');
        toast('Offline — sitting you down against the house bots.', 'good', 4200);
        return;
      }

      found = result;
      phase = 'found';
      setSeats(teamSize * 2 - 1);
      panel.classList.add('is-queued');
      title.textContent = 'Table found';
      text.textContent = `Room ${result.roomId} · seat ${result.seatNumber}. The table is dealt on the server.`;
      cancelBtn.hidden = true;
      findBtn.hidden = false;
      findBtn.disabled = false;
      findBtn.innerHTML = `${icon('cards')} Enter table`;

      if (result.degraded === 'offline') {
        toast('No server is answering, so this is a demo queue.', 'info', 4200);
      } else if (result.degraded) {
        toast(`Server said “${result.degraded}” — showing a demo table.`, 'bad', 4200);
      } else {
        toast(`Table ${result.roomId} is ready.`, 'good');
      }
    });

    function Note(value) {
      note.textContent = value;
    }

    cancelBtn.addEventListener('click', () => {
      cancelQueue();
      toIdle('Queue cancelled');
      toast('You left the queue.', 'info');
    });

    // Leaving the screen must not leave a socket listening.
    el.addEventListener('screen:teardown', () => cancelQueue());

    return el;
  }
};
