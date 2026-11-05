import { store } from '../store.js';
import { SEASON } from '../data.js';
import { icon, esc, toast } from '../ui.js';
import { go } from '../nav.js';

export default {
  title: 'Welcome',
  crumb: 'Welcome',
  nav: 'home',

  render() {
    const el = document.createElement('div');
    el.className = 'screen screen--welcome';

    el.innerHTML = `
      <div class="welcome">
        <div class="welcome__copy">
          <span class="eyebrow">Season ${esc(SEASON.id)} · ${esc(SEASON.name)}</span>
          <h1 style="font-size:var(--fs-3xl)">Take a seat.<br>The table is set.</h1>
          <p class="hero__lede" style="max-width:46ch">
            Four seats. Seven cards each. Match the colour or the word, and the last hand
            standing takes the pot.
          </p>
          <div class="row" style="gap:var(--s-5);flex-wrap:wrap;font-size:var(--fs-xs);color:var(--muted)">
            <span class="row" style="gap:6px">${icon('check')} No download</span>
            <span class="row" style="gap:6px">${icon('check')} Plays in landscape or portrait</span>
            <span class="row" style="gap:6px">${icon('check')} Works offline as a guest</span>
          </div>
          <div class="hero__cards" style="height:auto;min-height:0;padding:var(--s-4) 0 0">
            <div class="hcard hcard--wild" style="--tilt:-10deg">W</div>
            <div class="hcard hcard--ruby" style="--tilt:-4deg">+2</div>
            <div class="hcard hcard--jade" style="--tilt:4deg">A</div>
            <div class="hcard hcard--azure" style="--tilt:10deg">Z</div>
          </div>
        </div>

        <section class="panel panel--ornate welcome__card">
          <div>
            <span class="eyebrow">Enter</span>
            <h2 style="margin-top:var(--s-2);font-size:var(--fs-xl)">Pick a name</h2>
            <p class="muted" style="font-size:var(--fs-sm);margin-top:6px">
              A guest seat is created on this device and can be claimed by an account later.
            </p>
          </div>

          <div class="field">
            <label for="w-name">Display name</label>
            <input class="input" id="w-name" maxlength="18" placeholder="e.g. Champ" autocomplete="nickname"
                   value="${esc(store.state.player.name === 'Guest' ? '' : store.state.player.name)}">
          </div>

          <button class="btn btn--primary btn--lg btn--block" type="button" data-guest>
            ${icon('play')} Continue as guest
          </button>

          <div class="welcome__or">or</div>

          <button class="btn btn--ghost btn--block" type="button" data-login>
            ${icon('mail')} Log in with email
          </button>

          <p class="muted" style="font-size:var(--fs-2xs);line-height:1.6">
            Accounts are local to this browser until the game server is reachable. Nothing is sent anywhere today.
          </p>
        </section>
      </div>
    `;

    const nameInput = el.querySelector('#w-name');

    el.querySelector('[data-guest]').addEventListener('click', () => {
      const name = nameInput.value.trim() || 'Guest';
      store.signIn(name);
      toast(`Welcome, ${name}.`, 'good');
      go('home');
    });

    el.querySelector('[data-login]').addEventListener('click', () => {
      toast('Email sign-in is not wired to a server yet — continue as a guest.', 'info', 4200);
    });

    nameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') el.querySelector('[data-guest]').click();
    });

    return el;
  }
};
