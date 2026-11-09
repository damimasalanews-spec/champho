import { store } from '../store.js';
import { SHOP_ITEMS, PASS_TIERS, SEASON } from '../data.js';
import { icon, esc, compact, avatarMarkup, toast, dialog, progressBar } from '../ui.js';
import { go } from '../nav.js';

const MEDALS = [
  { name: 'First blood', icon: 'swords', got: true },
  { name: 'Streak x7', icon: 'flame', got: true },
  { name: 'Season 01', icon: 'crown', got: true },
  { name: '100 tables', icon: 'cards', got: true },
  { name: 'Wild caller', icon: 'sparkle', got: true },
  { name: 'Top 100', icon: 'trophy', got: false },
  { name: 'Perfect hand', icon: 'star', got: false },
  { name: 'Night shift', icon: 'clock', got: false },
  { name: 'Host', icon: 'users', got: false }
];

export default {
  title: 'Profile',
  crumb: 'Profile',
  nav: 'profile',

  render() {
    const { player, equipped, claimedTiers } = store.state;
    const owned = SHOP_ITEMS.filter((item) => store.state.owned.includes(item.id));
    const wornAvatar = SHOP_ITEMS.find((i) => i.id === equipped.characters);
    const wornFrame = SHOP_ITEMS.find((i) => i.id === equipped.frames);
    const nextTier = PASS_TIERS.find((t) => !claimedTiers.includes(t.tier));

    const el = document.createElement('div');
    el.className = 'screen screen--profile';

    el.innerHTML = `
      <div class="page-head">
        <div class="page-head__text">
          <span class="eyebrow">Player card</span>
          <h1>Your profile</h1>
          <p>Identity, standings and the cosmetics other seats see at the table.</p>
        </div>
        <a class="btn btn--quiet btn--sm" href="#/settings">${icon('gear')} Settings</a>
      </div>

      <section class="profile-card reveal">
        <div class="profile-card__row">
          ${avatarMarkup(player, 'xl avatar--ring')}
          <div class="profile-card__id">
            <span class="profile-card__name">${esc(player.name)} <span class="muted" style="font-size:var(--fs-md)">${esc(player.tag)}</span></span>
            <div class="profile-card__tags">
              <span class="pill pill--gold">${esc(player.title)}</span>
              <span class="pill">${esc(player.league)} league</span>
              <span class="pill">Highest ${esc(player.highest)}</span>
            </div>
            <button class="link" type="button" data-copy style="justify-self:start;margin-top:4px">
              ${icon('copy')} ID ${esc(player.playerId)}
            </button>
          </div>
          <div class="profile-card__actions">
            <button class="btn btn--primary btn--sm" type="button" data-rename>${icon('edit')} Rename</button>
            <button class="btn btn--quiet btn--sm" type="button" data-share>${icon('share')} Share card</button>
          </div>
        </div>

        <div class="meter" style="max-width:560px">
          <div class="meter__label"><span>Level ${player.level}</span><b>${player.xp} / ${player.xpMax} XP</b></div>
          ${progressBar(player.xp, player.xpMax, { label: 'Level progress' })}
        </div>
      </section>

      <section class="section">
        <div class="section__head"><h2>Standing</h2><span class="muted" style="font-size:var(--fs-xs)">Season ${esc(SEASON.id)}</span></div>
        <div class="stat-grid">
          <div class="stat"><span class="stat__label">Trophies</span><span class="stat__value">${compact(player.trophies)}</span></div>
          <div class="stat"><span class="stat__label">Total wins</span><span class="stat__value">${compact(player.wins)}</span></div>
          <div class="stat"><span class="stat__label">Games</span><span class="stat__value">${compact(player.games)}</span></div>
          <div class="stat"><span class="stat__label">Best streak</span><span class="stat__value">${player.streak}</span></div>
          <div class="stat"><span class="stat__label">Biggest win</span><span class="stat__value">${compact(player.biggestWin)}</span></div>
          <div class="stat"><span class="stat__label">Likes</span><span class="stat__value">${compact(player.likes)}</span></div>
        </div>
      </section>

      <div class="home-grid">
        <div class="stack">
          <section class="panel reveal">
            <div class="panel__head">
              <h2>Medals</h2>
              <span class="pill">${MEDALS.filter((m) => m.got).length} / ${MEDALS.length}</span>
            </div>
            <div class="panel__body">
              <div class="medals">
                ${MEDALS.map((m) => `
                  <div class="medal ${m.got ? '' : 'medal--locked'}" title="${esc(m.name)}">
                    <span class="medal__disc">${icon(m.got ? m.icon : 'lock')}</span>
                    <span>${esc(m.name)}</span>
                  </div>`).join('')}
              </div>
            </div>
          </section>

          <section class="panel reveal">
            <div class="panel__head">
              <h2>Collection</h2>
              <a class="link" href="#/shop">Style store ${icon('arrow')}</a>
            </div>
            <div class="panel__body" style="display:grid;gap:var(--s-3)">
              ${[['Character', wornAvatar], ['Frame', wornFrame], ['Effect', null]].map(([label, item]) => `
                <div class="row" style="padding:var(--s-2) 0;border-bottom:1px solid var(--line-cool)">
                  <span class="mode__icon" style="width:38px;height:38px">${icon(item ? item.icon : 'sparkle')}</span>
                  <span style="display:grid;gap:1px">
                    <small class="muted" style="font-size:var(--fs-2xs);letter-spacing:.1em;text-transform:uppercase">${label}</small>
                    <b style="font-size:var(--fs-sm)">${item ? esc(item.name) : 'Nothing equipped'}</b>
                  </span>
                  <span class="pill" style="margin-left:auto">${item ? esc(item.rarity) : '—'}</span>
                </div>`).join('')}
              <p class="muted" style="font-size:var(--fs-xs)">${owned.length} items owned · ${nextTier ? `tier ${nextTier.tier} unlocks ${esc(nextTier.name)}` : 'every tier claimed'}</p>
            </div>
          </section>
        </div>

        <div class="stack">
          <section class="panel reveal">
            <div class="panel__head"><h2>Account</h2></div>
            <div class="panel__body" style="display:grid;gap:var(--s-3)">
              <div class="row"><span class="muted" style="font-size:var(--fs-xs)">Player ID</span><b class="num" style="margin-left:auto;font-size:var(--fs-xs)">${esc(player.playerId)}</b></div>
              <div class="row"><span class="muted" style="font-size:var(--fs-xs)">Session</span><b style="margin-left:auto;font-size:var(--fs-xs)">Browser · this device</b></div>
              <div class="row"><span class="muted" style="font-size:var(--fs-xs)">Charisma</span><b style="margin-left:auto;font-size:var(--fs-xs)">${player.charisma}</b></div>
              <div class="row"><span class="muted" style="font-size:var(--fs-xs)">Achievements</span><b style="margin-left:auto;font-size:var(--fs-xs)">${player.achievements}</b></div>
              <button class="btn btn--quiet btn--block" type="button" data-signout>${icon('logout')} Sign out</button>
            </div>
          </section>

          <section class="panel reveal">
            <div class="panel__head"><h2>Play next</h2></div>
            <div class="panel__body" style="display:grid;gap:var(--s-2)">
              <a class="room-row" href="#/play/classic">
                <span class="mode__icon" style="width:38px;height:38px">${icon('cards')}</span>
                <span class="room-row__name"><b>Classic table</b><small>Four seats · ranked</small></span>
                <span class="link">${icon('arrow')}</span>
              </a>
              <a class="room-row" href="#/play/wild">
                <span class="mode__icon" style="width:38px;height:38px">${icon('flame')}</span>
                <span class="room-row__name"><b>Go Wild</b><small>2v2 · teams</small></span>
                <span class="link">${icon('arrow')}</span>
              </a>
            </div>
          </section>
        </div>
      </div>
    `;

    el.querySelector('[data-copy]').addEventListener('click', () => {
      const id = player.playerId;
      const done = () => toast('Player ID copied.', 'good');
      const fallback = () => {
        const ta = document.createElement('textarea');
        ta.value = id;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;opacity:0';
        document.body.append(ta);
        ta.select();
        try { document.execCommand('copy'); done(); }
        catch { toast(`Your ID is ${id}`, 'info'); }
        ta.remove();
      };
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(id).then(done, fallback);
      else fallback();
    });
    el.querySelector('[data-share]').addEventListener('click', async () => {
      const text = `${player.name} ${player.tag} · ${player.league} league, ${compact(player.trophies)} trophies on Champ Word.`;
      // Web Share is unavailable on desktop Chrome and rejects outside a user
      // gesture, so a rejection must still produce visible feedback.
      try {
        if (navigator.share) {
          await navigator.share({ title: 'Champ Word', text });
          return;
        }
      } catch {
        /* fall through to the clipboard */
      }
      try {
        await navigator.clipboard.writeText(text);
        toast('Player card copied to the clipboard.', 'good');
      } catch {
        toast(text, 'info');
      }
    });
    el.querySelector('[data-rename]').addEventListener('click', () => {
      dialog({
        title: 'Rename your seat',
        body: `
          <div class="field">
            <label for="rename-input">Display name</label>
            <input class="input" id="rename-input" maxlength="18" value="${esc(player.name)}" autocomplete="off">
            <span class="field__hint">Up to 18 characters. Other seats see this at the table.</span>
          </div>`,
        actions: [
          { label: 'Cancel', variant: 'quiet' },
          {
            label: 'Save',
            variant: 'primary',
            onClick: () => {
              const input = document.getElementById('rename-input');
              if (!store.rename(input?.value)) {
                toast('That name is empty.', 'bad');
                return false;
              }
              toast('Name updated.', 'good');
              document.dispatchEvent(new CustomEvent('store:refresh'));
              return true;
            }
          }
        ],
        onMount(dlg) {
          const input = dlg.querySelector('#rename-input');
          input.focus();
          input.select();
        }
      });
    });

    el.querySelector('[data-signout]').addEventListener('click', () => {
      store.signOut();
      toast('Signed out. You are playing as a guest.', 'info');
      go('welcome');
    });

    return el;
  }
};
