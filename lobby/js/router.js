/* ===========================================================================
   CHAMP WORD — hash router
   Real URLs, a working back button, deep links, and one place that decides
   what "you are here" means for the rail, the tabbar and the page title.
   =========================================================================== */

import { observeReveals } from './ui.js';

export function createRouter({ routes, fallback = 'home', view, onRendered }) {
  let current = null;
  let firstRun = true;

  function parse(hash = location.hash) {
    const raw = hash.replace(/^#\/?/, '').trim();
    const [path, ...rest] = raw.split('/');
    return { path: path || fallback, param: decodeURIComponent(rest.join('/')) };
  }

  function resolve(path) {
    return routes[path] ? path : fallback;
  }

  function applyNav(route) {
    const navKey = routes[route]?.nav ?? route;
    document.querySelectorAll('[data-route]').forEach((el) => {
      const isCurrent = el.dataset.route === navKey;
      if (isCurrent) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    });
    document.getElementById('app')?.setAttribute('data-nav', navKey);
  }

  function applyCrumbs(route) {
    const list = document.getElementById('crumbs');
    if (!list) return;
    const crumb = routes[route]?.crumb ?? '';
    const parts = crumb ? crumb.split(' / ') : [];
    list.innerHTML = [
      '<li><a href="#/home">Champ Word</a></li>',
      ...parts.map((part, i) => (
        i === parts.length - 1
          ? `<li aria-current="page">${part}</li>`
          : `<li>${part}</li>`
      ))
    ].join('');
  }

  async function render({ focus = true, keepScroll = false } = {}) {
    // A dialog lives outside the view, so a route change used to leave it
    // floating over the next screen with no way back.
    document.querySelectorAll('#dialog-root dialog[open]').forEach((d) => d.close());
    const { path, param } = parse();
    const route = resolve(path);
    const def = routes[route];
    if (!def) return;

    const scroll = window.scrollY;
    document.title = `${def.title} · Champ Word`;
    applyNav(route);
    applyCrumbs(route);

    // Leave animation, then swap. Both are skipped under reduced motion by CSS.
    if (current?.el) {
      current.el.dispatchEvent(new CustomEvent('screen:teardown'));
      current.el.classList.add('is-leaving');
      current.el.remove();
    }

    view.setAttribute('aria-busy', 'true');
    const el = await def.render(param);
    view.replaceChildren(el);
    view.setAttribute('aria-busy', 'false');

    current = { def, el, route, param };
    observeReveals(el);

    if (!keepScroll) window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    else window.scrollTo({ top: scroll });

    if (focus && !firstRun) {
      view.focus({ preventScroll: true });
    }
    firstRun = false;

    onRendered?.(route, param);
    document.dispatchEvent(new CustomEvent('route:rendered', { detail: { route, param } }));
  }

  function navigate(to, { replace = false } = {}) {
    const hash = `#/${to}`;
    if (location.hash === hash) return render();
    if (replace) history.replaceState(null, '', hash);
    else location.hash = hash;
    if (replace) render();
  }

  window.addEventListener('hashchange', () => render());

  return {
    start() {
      if (!location.hash) history.replaceState(null, '', `#/${fallback}`);
      render({ focus: false });
    },
    navigate,
    refresh(options) { render({ focus: false, keepScroll: true, ...options }); },
    get current() { return current; }
  };
}
