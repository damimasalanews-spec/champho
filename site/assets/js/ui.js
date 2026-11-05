/* ===========================================================================
   CHAMP WORD — ui primitives
   Small, dependency-free helpers shared by every screen.
   =========================================================================== */

/* --- 1. Icons -------------------------------------------------------------
   24x24, stroke-based, currentColor. Kept as path data so a screen can drop
   one in a template string without a sprite request.
   ------------------------------------------------------------------------- */

const PATHS = {
  home: '<path d="M4 11.4 12 4l8 7.4V20a1 1 0 0 1-1 1h-4.2v-5.6H9.2V21H5a1 1 0 0 1-1-1z"/>',
  play: '<path d="M8.4 5.6v12.8L19 12z" fill="currentColor" stroke="none"/>',
  shop: '<path d="M4.2 9h15.6l-1.2 10.1a1 1 0 0 1-1 .9H6.4a1 1 0 0 1-1-.9z"/><path d="M9 9V7a3 3 0 0 1 6 0v2"/>',
  sparkle: '<path d="M12 3.4 13.7 9 19 10.7 13.7 12.4 12 18l-1.7-5.6L5 10.7 10.3 9z"/><path d="M18.4 16.2l.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7z"/>',
  gift: '<path d="M4 8.6h16V12H4z"/><path d="M5.2 12v8.1h13.6V12"/><path d="M12 8.6V21"/><path d="M12 8.6S10.6 4 8.2 4a2.1 2.1 0 0 0 0 4.6z"/><path d="M12 8.6S13.4 4 15.8 4a2.1 2.1 0 0 1 0 4.6z"/>',
  trophy: '<path d="M8 4h8v4.2a4 4 0 0 1-8 0z"/><path d="M8 5.2H5v1.6A3 3 0 0 0 8 9.8"/><path d="M16 5.2h3v1.6a3 3 0 0 1-3 3"/><path d="M12 12.2V16"/><path d="M9.4 20.4h5.2L13.8 16h-3.6z"/>',
  users: '<circle cx="9.2" cy="8.2" r="3.3"/><path d="M2.9 20a6.3 6.3 0 0 1 12.6 0"/><path d="M15.9 5.4a3.1 3.1 0 0 1 0 5.8"/><path d="M17.4 14.4A5.6 5.6 0 0 1 21.2 20"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.6 21a7.4 7.4 0 0 1 14.8 0"/>',
  gear: '<circle cx="12" cy="12" r="3.1"/><path d="M19.2 14.6a1.6 1.6 0 0 0 .32 1.76l.06.06a1.9 1.9 0 1 1-2.7 2.7l-.05-.06a1.6 1.6 0 0 0-1.77-.32 1.6 1.6 0 0 0-.97 1.47V20a1.9 1.9 0 1 1-3.8 0v-.1a1.6 1.6 0 0 0-1.05-1.47 1.6 1.6 0 0 0-1.76.32l-.06.06a1.9 1.9 0 1 1-2.7-2.7l.06-.06a1.6 1.6 0 0 0 .32-1.76 1.6 1.6 0 0 0-1.47-.97H4a1.9 1.9 0 1 1 0-3.8h.1a1.6 1.6 0 0 0 1.47-1.05 1.6 1.6 0 0 0-.32-1.76l-.06-.06a1.9 1.9 0 1 1 2.7-2.7l.06.06a1.6 1.6 0 0 0 1.76.32h.08a1.6 1.6 0 0 0 .97-1.47V4a1.9 1.9 0 1 1 3.8 0v.1a1.6 1.6 0 0 0 .97 1.47 1.6 1.6 0 0 0 1.76-.32l.06-.06a1.9 1.9 0 1 1 2.7 2.7l-.06.06a1.6 1.6 0 0 0-.32 1.76v.08a1.6 1.6 0 0 0 1.47.97H20a1.9 1.9 0 1 1 0 3.8h-.1a1.6 1.6 0 0 0-1.47.97z"/>',
  coin: '<circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="4"/><path d="M12 3.6v1.6M12 18.8v1.6M3.6 12h1.6M18.8 12h1.6"/>',
  gem: '<path d="M6.4 3h11.2l3.1 6-8.7 12L3.3 9z"/><path d="M3.3 9h17.4"/><path d="M9.3 3l2.7 6 2.7-6"/><path d="M12 9v12"/>',
  bell: '<path d="M18 8.6a6 6 0 1 0-12 0c0 5.4-2 6.6-2 6.6h16s-2-1.2-2-6.6"/><path d="M10.4 19.6a2.1 2.1 0 0 0 3.2 0"/>',
  arrow: '<path d="M5 12h13"/><path d="M12.6 6.4 18.2 12l-5.6 5.6"/>',
  chevron: '<path d="M9.4 5.6 15.8 12l-6.4 6.4"/>',
  check: '<path d="M4.6 12.4 9.6 17.4 19.4 7.2"/>',
  close: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
  cards: '<rect x="7" y="6.4" width="11.4" height="14.2" rx="2"/><path d="M4.2 17V3.8h9.4"/>',
  crown: '<path d="M4 9.2 8.2 12.4 12 5.8l3.8 6.6L20 9.2l-2 10.6H6z"/>',
  plus: '<path d="M12 5.2v13.6"/><path d="M5.2 12h13.6"/>',
  sound: '<path d="M4 9.4v5.2h3l4 3.6V5.8l-4 3.6z"/><path d="M15.4 8.6a4.8 4.8 0 0 1 0 6.8"/><path d="M17.8 6.2a8 8 0 0 1 0 11.6"/>',
  music: '<path d="M9.2 18V6.4L19 4.6v11.2"/><circle cx="6.8" cy="18" r="2.4"/><circle cx="16.6" cy="15.8" r="2.4"/>',
  shield: '<path d="M12 3.2 19 6v6c0 4.4-2.9 7.4-7 8.8-4.1-1.4-7-4.4-7-8.8V6z"/><path d="M9.2 11.8 11.4 14l3.6-3.8"/>',
  clock: '<circle cx="12" cy="12" r="8.4"/><path d="M12 7.4V12l3.2 1.8"/>',
  star: '<path d="M12 3.6l2.6 5.5 6 .8-4.4 4.2 1.1 5.9-5.3-2.9-5.3 2.9 1.1-5.9L3.4 9.9l6-.8z"/>',
  flame: '<path d="M12 20.8c3.5 0 5.9-2.3 5.9-5.3 0-4-3.4-5.5-3.4-9 0-1.6-1.2-3.1-2.5-3.1 0 3-2 4.1-3.4 6.2a7 7 0 0 0-1.6 4.2c0 3.9 2.4 7 5 7z"/>',
  lock: '<rect x="5.4" y="10.6" width="13.2" height="9.6" rx="1.6"/><path d="M8.8 10.6V8a3.2 3.2 0 0 1 6.4 0v2.6"/>',
  edit: '<path d="M4 20.2h3.8L19 9 15 5 3.8 16.4z"/><path d="M13.4 6.6 17.4 10.6"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="1.8"/><path d="M15.4 5.2H6a1 1 0 0 0-1 1v9.4"/>',
  share: '<path d="M12 16.2V4.2"/><path d="M8.2 8 12 4.2 15.8 8"/><path d="M5 14v5.2a1.6 1.6 0 0 0 1.6 1.6h10.8a1.6 1.6 0 0 0 1.6-1.6V14"/>',
  logout: '<path d="M14.4 12H4.2"/><path d="M8 8 4 12l4 4"/><path d="M11.6 4h6.2a1.6 1.6 0 0 1 1.6 1.6v12.8a1.6 1.6 0 0 1-1.6 1.6h-6.2"/>',
  target: '<circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="4.2"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  calendar: '<rect x="4" y="5.6" width="16" height="14.6" rx="2"/><path d="M4 10.2h16"/><path d="M8.4 3.4v4M15.6 3.4v4"/>',
  mail: '<rect x="3.4" y="5.6" width="17.2" height="12.8" rx="2"/><path d="m3.8 7 8.2 5.6L20.2 7"/>',
  bag: '<path d="M5.6 8h12.8l1.2 12H4.4z"/><path d="M9 8V6.2a3 3 0 0 1 6 0V8"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v4.4h-4.4"/>',
  search: '<circle cx="11" cy="11" r="6.4"/><path d="m16 16 4.2 4.2"/>',
  wifi: '<path d="M4.6 9.6a11 11 0 0 1 14.8 0"/><path d="M7.6 13a7 7 0 0 1 8.8 0"/><path d="M10.6 16.4a3 3 0 0 1 2.8 0"/><circle cx="12" cy="19.4" r="1" fill="currentColor"/>',
  swords: '<path d="M4 20l5.6-5.6M14.4 9.6 20 4"/><path d="M14.6 4H20v5.4"/><path d="M9.4 14.6 20 4"/><path d="M4 9.4V4h5.4"/><path d="m4 20 4-4"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.2" fill="currentColor"/><circle cx="15" cy="15" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>'
};

export function icon(name, cls = '') {
  const body = PATHS[name] ?? PATHS.sparkle;
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

/** Replace every `[data-icon]` placeholder inside `root` with its svg. */
export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    if (el.dataset.hydrated === '1') return;
    el.innerHTML = icon(el.dataset.icon);
    el.dataset.hydrated = '1';
  });
}

/* --- 2. Formatting -------------------------------------------------------- */

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function compact(n) {
  const v = Number(n) || 0;
  if (v >= 1e6) return `${(v / 1e6).toFixed(v >= 1e7 ? 1 : 2).replace(/\.0+$/, '')}M`;
  if (v >= 1e4) return `${(v / 1e3).toFixed(1).replace(/\.0$/, '')}k`;
  return v.toLocaleString('en-US');
}

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0] || '').join('').toUpperCase() || '?';
}

export function avatarMarkup(player, size = '') {
  const cls = `avatar ${size ? `avatar--${size}` : ''}`.trim();
  if (player?.photo) {
    return `<span class="${cls}"><img src="${esc(player.photo)}" alt="" loading="lazy" decoding="async"></span>`;
  }
  return `<span class="${cls}" aria-hidden="true">${esc(initials(player?.name))}</span>`;
}

/* --- 3. Toasts ------------------------------------------------------------ */

const TOAST_ICON = { good: 'check', bad: 'close', info: 'sparkle' };

export function toast(message, kind = 'info', ms = 3200) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast toast--${kind}`;
  el.innerHTML = `${icon(TOAST_ICON[kind] ?? 'sparkle')}<span>${esc(message)}</span>`;
  host.append(el);

  const remove = () => {
    el.classList.add('is-leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 600);
  };
  setTimeout(remove, ms);
}

/* --- 4. Dialogs -----------------------------------------------------------
   Native <dialog>, so focus trapping, Esc and the backdrop come from the
   platform instead of a hand-rolled keydown handler.
   ------------------------------------------------------------------------- */

let openDialogs = 0;

export function dialog({ title, body, actions = [], onMount }) {
  const root = document.getElementById('dialog-root');
  const dlg = document.createElement('dialog');
  dlg.className = 'modal';
  dlg.setAttribute('aria-labelledby', 'dlg-title');

  dlg.innerHTML = `
    <div class="modal__head">
      <h2 id="dlg-title">${esc(title)}</h2>
      <button class="iconbtn" type="button" data-close aria-label="Close" style="margin-left:auto">${icon('close')}</button>
    </div>
    <div class="modal__body">${body}</div>
    ${actions.length ? '<div class="modal__foot"></div>' : ''}
  `;

  const foot = dlg.querySelector('.modal__foot');
  const close = () => dlg.close();

  actions.forEach((action) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn ${action.variant ? `btn--${action.variant}` : 'btn--quiet'}`;
    btn.textContent = action.label;
    btn.addEventListener('click', async () => {
      const keep = await action.onClick?.();
      if (keep !== false) close();
    });
    foot?.append(btn);
  });

  dlg.querySelector('[data-close]').addEventListener('click', close);
  dlg.addEventListener('click', (event) => {
    // click on the backdrop (the dialog element itself, outside its content)
    if (event.target === dlg) close();
  });
  dlg.addEventListener('close', () => {
    openDialogs = Math.max(0, openDialogs - 1);
    dlg.remove();
  });

  root.append(dlg);
  openDialogs += 1;
  dlg.showModal();
  onMount?.(dlg);
  return dlg;
}

export function confirmDialog({ title, body, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    const dlg = dialog({
      title,
      body: `<p>${esc(body)}</p>`,
      actions: [
        { label: 'Cancel', variant: 'quiet', onClick: () => { answered = true; resolve(false); } },
        {
          label: confirmLabel,
          variant: danger ? 'danger' : 'primary',
          onClick: () => { answered = true; resolve(true); }
        }
      ]
    });
    dlg.addEventListener('close', () => { if (!answered) resolve(false); });
  });
}

/* --- 5. Reveal on scroll ------------------------------------------------- */

let observer;

export function observeReveals(root = document) {
  if (!('IntersectionObserver' in window)) {
    root.querySelectorAll('.reveal').forEach((el) => el.classList.add('is-in'));
    return;
  }
  observer ??= new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-in');
      observer.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

  root.querySelectorAll('.reveal:not(.is-in)').forEach((el, i) => {
    if (!el.style.getPropertyValue('--reveal-delay')) {
      el.style.setProperty('--reveal-delay', `${Math.min(i, 8) * 45}ms`);
    }
    observer.observe(el);
  });
}

/* --- 6. Small templates -------------------------------------------------- */

export function progressBar(value, max, { jade = false, thin = false, label = '' } = {}) {
  const pct = Math.max(0, Math.min(100, max ? (value / max) * 100 : 0));
  return `
    <div class="progress ${jade ? 'progress--jade' : ''} ${thin ? 'progress--thin' : ''}"
         role="progressbar" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100"
         ${label ? `aria-label="${esc(label)}"` : ''}>
      <div class="progress__fill" style="--value:${pct}%"></div>
    </div>`;
}

export function rarityClass(rarity) {
  return `r-${rarity || 'common'}`;
}
