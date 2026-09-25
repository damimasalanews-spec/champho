/* ==========================================================================
   Champ Word — service worker

   What this is for: making the site installable and keeping it playable when the
   network is gone. It is NOT a build cache and not a way to make the site load
   faster at the cost of being stale — every rule below is chosen so that a deploy
   still lands.

   The one decision that matters most: CODE IS NETWORK-FIRST, ART IS CACHE-FIRST.

   This site is deployed constantly. A service worker that serves CSS or HTML
   cache-first will hand a player the previous build long after a deploy, which is
   a far worse bug than a slow first paint. So navigations and scripts and
   stylesheets go to the network first and only fall back to the cache when the
   network fails.

   The deadline is 6s. It was 3.5s, which is fine on a desktop and not on a phone:
   the fetch expired first, the cache won, and a deploy could not reach the device
   at all. A worker is judged by whether a fix arrives, not by its first paint. Images — avatars, title plates, table art — never change once
   named, so they are served from cache immediately and refreshed in the
   background.

   Nothing here touches the game's API or its WebSocket. Non-GET requests are
   never cached, cross-origin requests are never cached, and the server's own
   endpoints are left alone: the client derives its socket URL from location.host,
   and an intercepted upgrade would break multiplayer in a way that looks like a
   server fault.
   ========================================================================== */

/* Bump this whenever a fix has to reach devices that already have the worker. Activate
   deletes every cache whose name is not in CACHES, so a bump is what evicts the old
   stylesheet from a phone that is otherwise perfectly happy serving it. v2 exists
   because v1 kept a board fix off a device — see the fetch notes below. v3 because v2
   did the same: a device reported the pre-fix board after the fix had shipped, so the
   plate's zoom (game/scene-fill.js) is being delivered under a fresh cache, and
   game/pwa.js now reloads the page once when an updated worker takes over — otherwise a
   worker that has already claimed the page can keep painting the stylesheet it cached.
   v4 alongside the stylesheet's ?v=4: the cards and avatars changed size, so the cached
   sheet has to go with them. */
const VERSION = 'v4';
const SHELL_CACHE = `champword-shell-${VERSION}`;
const CODE_CACHE = `champword-code-${VERSION}`;
const ART_CACHE = `champword-art-${VERSION}`;
const CACHES = [SHELL_CACHE, CODE_CACHE, ART_CACHE];

/* The app shell. Every path here is checked in and served from the repo root, so
   the install step can rely on all of them: cache.addAll() rejects the whole batch
   if any single URL 404s, and a rejected install means no service worker at all. */
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/classic.html',
  '/wild.html',
  '/wild-play.html',
  '/score.html',
  '/offline.html',
  '/manifest.json',
  '/game/wild-arcade.css',
  '/game/styles.css',
  '/game/scene-fill.js',
  '/game/sound.js',
  '/game/pwa.js',
  '/assets/island-table-bg.webp',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  '/assets/icons/icon-maskable-192.png',
  '/assets/icons/icon-maskable-512.png',
  '/assets/icons/apple-touch-icon.png'
];

/* Art that is worth having offline but too heavy to force on every first visit:
   ~3 MB across 49 files. These are warmed in the background after activation
   instead, so an installed app is fully offline by its second launch. */
const ART_GLOBS = [
  '/assets/avatars/',
  '/assets/frames/',
  '/assets/effects/',
  '/assets/titles/',
  '/classic-bg/'
];

const CODE_EXTENSIONS = ['.css', '.js', '.mjs', '.json', '.webmanifest'];
const ART_EXTENSIONS = ['.png', '.webp', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.mp4', '.webm'];

/**
 * Network-first with a deadline, so a dead network fails fast to the cache.
 *
 * Two details here are not style, they are the difference between a fix reaching a
 * phone and not:
 *
 * 1. `cache: 'reload'` on the fetch. Without it the request is answered by the HTTP
 *    cache — and Android's WebView in particular is happy to return a stale 200 with no
 *    way to tell it from a fresh one. That stale response was then stored by the line
 *    below as the current copy, so the worker went on serving a superseded stylesheet
 *    indefinitely. A board fix shipped, deployed, verified at the origin, and never
 *    arrived, because every layer below agreed the old file was still valid.
 *
 * 2. `await cache.put(...)`. Un-awaited, the put is not part of what respondWith is
 *    waiting on: the worker can be terminated as soon as the response is handed over,
 *    and the update is silently lost. Awaiting it keeps the cache honest.
 */
async function networkFirst(request, cacheName, timeoutMs) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetchWithTimeout(request, timeoutMs);
    if (response && response.ok && response.type === 'basic') {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    return cached ?? null;
  }
}

function fetchWithTimeout(request, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    fetch(request, { cache: 'reload' }).then(
      (response) => { clearTimeout(timer); resolve(response); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

/** Serve from cache now, refresh in the background. */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request, { cache: 'reload' }).then((response) => {
    if (response && response.ok && response.type === 'basic') {
      return cache.put(request, response.clone()).then(() => response);
    }
    return response;
  }).catch(() => null);
  return cached ?? (await network) ?? Response.error();
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Individually, not addAll: one missing file must not cost us the whole worker.
    await Promise.all(SHELL_ASSETS.map(async (url) => {
      try {
        const response = await fetch(url, { cache: 'reload' });
        if (response.ok) await cache.put(url, response);
      } catch {
        /* offline during install — the runtime rules will fill this in */
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map((name) => (CACHES.includes(name) ? null : caches.delete(name))));
    await self.clients.claim();
    warmArt();
  })());
});

/* Every art file the game can show, enumerated as a literal index because a service
   worker cannot list a directory. Generated from assets/ and classic-bg/; if art is
   added without being added here it still works online, it just is not warmed for
   offline until it is fetched once. */
const ART_INDEX = [
  "/assets/avatars/alien.webp", "/assets/avatars/classic.webp", "/assets/avatars/genie.webp",
  "/assets/avatars/ghost.webp", "/assets/avatars/knight.webp", "/assets/avatars/ninja.webp",
  "/assets/avatars/pirate.webp", "/assets/avatars/robot.webp", "/assets/avatars/scholar.webp",
  "/assets/avatars/vampire.webp", "/assets/avatars/wizard.webp", "/assets/avatars/yeti.webp",
  "/assets/effects/cosmos.webp", "/assets/effects/crystal.webp", "/assets/effects/emerald.webp",
  "/assets/effects/pearl.webp", "/assets/effects/prism.webp", "/assets/effects/royal.webp",
  "/assets/effects/silk.webp", "/assets/effects/thorn.webp", "/assets/effects/volt.webp",
  "/assets/frames/cosmos.webp", "/assets/frames/cosmos_hole.webp", "/assets/frames/crystal.webp",
  "/assets/frames/crystal_hole.webp", "/assets/frames/emerald.webp", "/assets/frames/emerald_hole.webp",
  "/assets/frames/pearl.webp", "/assets/frames/pearl_hole.webp", "/assets/frames/prism.webp",
  "/assets/frames/prism_hole.webp", "/assets/frames/royal.webp", "/assets/frames/royal_hole.webp",
  "/assets/frames/silk.webp", "/assets/frames/silk_hole.webp", "/assets/frames/thorn.webp",
  "/assets/frames/thorn_hole.webp", "/assets/frames/volt.webp", "/assets/frames/volt_hole.webp",
  "/assets/island-table-bg.webp", "/assets/titles/cosmos.webp", "/assets/titles/crystal.webp",
  "/assets/titles/emerald.webp", "/assets/titles/pearl.webp", "/assets/titles/prism.webp",
  "/assets/titles/royal.webp", "/assets/titles/silk.webp", "/assets/titles/thorn.webp",
  "/assets/titles/volt.webp", "/classic-bg/classic-scene-hd.webp", "/classic-bg/classic-table-scene.webp",
];

/* Art warm-up. Runs after activation so it never delays the first paint. Skips
   itself on a metered or data-saver connection: filling a 3 MB cache on someone's
   mobile data because they loaded a page once is not a favour. */
async function warmArt() {
  try {
    const connection = navigator.connection;
    if (connection && (connection.saveData || /2g|slow-2g/.test(connection.effectiveType || ''))) return;

    const cache = await caches.open(ART_CACHE);
    const already = await cache.keys();
    const have = new Set(already.map((request) => new URL(request.url).pathname));

    // A service worker cannot list a directory, so the art is enumerated as a literal
    // index. Only the files not already cached are fetched.
    const targets = ART_INDEX.filter((path) => !have.has(path));
    for (const path of targets) {
      try {
        const response = await fetch(path);
        if (response.ok) await cache.put(path, response);
      } catch {
        /* ignore: this is opportunistic */
      }
    }
  } catch {
    /* warm-up is best-effort by definition */
  }
}


self.addEventListener('fetch', (event) => {
  const request = event.request;

  // GET only. Everything else — including the socket handshake, which is an upgrade —
  // goes straight to the network untouched.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Cross-origin is not ours to cache, and the score console may talk to another host.
  if (url.origin !== self.location.origin) return;

  // Never touch the API surface, whatever it ends up being called.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) return;

  // Never cache the worker itself, or a broken worker could pin itself forever.
  if (url.pathname === '/sw.js') return;

  const extension = (url.pathname.match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase();

  // A navigation. Network first so a deploy is never hidden behind the cache; the
  // cached copy is the safety net, and offline.html the last resort.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const fresh = await networkFirst(request, SHELL_CACHE, 6000);
      if (fresh) return fresh;
      const cache = await caches.open(SHELL_CACHE);
      const shell = await cache.match(request);
      if (shell) return shell;
      return (await cache.match('/offline.html')) ?? Response.error();
    })());
    return;
  }

  // Code. Network first, for the same reason as navigations.
  if (CODE_EXTENSIONS.includes(extension)) {
    if (ART_GLOBS.some((glob) => url.pathname.startsWith(glob))) {
      event.respondWith(staleWhileRevalidate(request, ART_CACHE));
      return;
    }
    event.respondWith((async () => {
      const fresh = await networkFirst(request, CODE_CACHE, 6000);
      if (fresh) return fresh;
      const cache = await caches.open(CODE_CACHE);
      return (await cache.match(request)) ?? Response.error();
    })());
    return;
  }

  // Art. Cache first: these never change once named.
  if (ART_EXTENSIONS.includes(extension)) {
    event.respondWith(staleWhileRevalidate(request, ART_CACHE));
  }
});

// A page can ask a waiting worker to take over immediately.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
