import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Regression tests for the installable app.
 *
 * These exist because of a specific failure mode: a PWA does not fail loudly. A
 * manifest with a typo in an icon path, an icon whose file is a different size from
 * its declared `sizes`, a page that never registers the worker, or a precache list
 * naming a file that does not exist — none of those throw, none of them show up in
 * a browser console on the desktop, and all of them mean the game cannot be
 * installed. The only symptom is an Install button that never appears on a phone.
 *
 * So this file asserts the two halves separately: the numbers a browser reads
 * (manifest, icons, dimensions) and the wiring that delivers them (the head tags on
 * each page, the worker's own precache list).
 *
 * The offline path is deliberately NOT covered here — it needs a real browser and a
 * real network stack. What is covered is everything that can be checked from disk,
 * so a broken deploy fails here instead of on someone's phone.
 */

const ROOT = resolve(process.cwd());
const PAGES = ["index.html", "classic.html", "wild.html", "wild-play.html", "score.html"];

/** Read a PNG's real pixel dimensions out of the IHDR chunk. */
async function pngSize(path: string): Promise<{ width: number; height: number }> {
  const buffer = await readFile(path);
  assert.equal(buffer.subarray(1, 4).toString("ascii"), "PNG", `${path} is not a PNG`);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

let manifestCache: { name?: string; short_name?: string; icons?: ManifestIcon[]; [k: string]: unknown } | null = null;

async function manifest() {
  if (!manifestCache) {
    manifestCache = JSON.parse(await readFile(resolve(ROOT, "manifest.json"), "utf8"));
  }
  return manifestCache!;
}

test("the manifest is valid JSON with the fields a browser needs to install", async () => {
  const data = await manifest();

  assert.ok(data.name, "name is required for the install prompt");
  assert.ok(data.short_name, "short_name is what the home-screen label shows");
  assert.ok(String(data.short_name).length <= 12, "short_name over 12 chars is truncated on the home screen");
  assert.equal(data.start_url, "/", "the app opens at the site root");
  assert.equal(data.scope, "/");
  assert.ok(
    ["fullscreen", "standalone", "minimal-ui"].includes(String(data.display)),
    `display must be an app mode, got ${String(data.display)}`
  );
  assert.ok(data.display_override, "display_override lets Chrome go fullscreen while others fall back to standalone");
  assert.equal(data.orientation, "landscape", "the board is 16:9 and unplayable in portrait");
});

test("the manifest declares a 192 and a 512 icon, plus maskable variants", async () => {
  const data = await manifest();
  const icons = data.icons ?? [];
  assert.ok(icons.length > 0, "a manifest with no icons is not installable");

  const sizes = icons.map((icon) => icon.sizes);
  assert.ok(sizes.includes("192x192"), "Chrome requires a 192px icon");
  assert.ok(sizes.includes("512x512"), "Chrome requires a 512px icon");

  const maskable = icons.filter((icon) => (icon.purpose ?? "").split(/\s+/).includes("maskable"));
  assert.ok(maskable.length > 0, "without a maskable icon Android crops the icon into a white blob");
});

test("every icon the manifest names exists, and is the size it claims", async () => {
  const data = await manifest();

  for (const icon of data.icons ?? []) {
    const path = resolve(ROOT, icon.src.replace(/^\//, ""));
    assert.ok(existsSync(path), `manifest names ${icon.src}, which does not exist`);

    const expected = Number(icon.sizes.split("x")[0]);
    const actual = await pngSize(path);
    // A manifest that lies about an icon's size is rejected outright by Chrome, and
    // it is the single easiest thing to get wrong when icons are re-exported.
    assert.equal(actual.width, expected, `${icon.src} is ${actual.width}px but the manifest says ${expected}px`);
    assert.equal(actual.height, expected, `${icon.src} is ${actual.height}px tall but the manifest says ${expected}px`);
    assert.equal(actual.width, actual.height, `${icon.src} is not square`);
  }
});

test("the apple touch icon exists at 180px", async () => {
  const path = resolve(ROOT, "assets/icons/apple-touch-icon.png");
  assert.ok(existsSync(path), "iOS uses this one, not the manifest, for the home-screen icon");
  const size = await pngSize(path);
  assert.equal(size.width, 180);
  assert.equal(size.height, 180);
});

test("every page links the manifest and registers the worker exactly once", async () => {
  for (const page of PAGES) {
    const html = await readFile(resolve(ROOT, page), "utf8");
    const headEnd = html.indexOf("</head>");

    // Relative on purpose. All five pages live at the site root, so a relative
    // manifest.json resolves to /manifest.json on the web AND still resolves when a
    // page is opened straight off disk — which is how the arcade demo gets opened.
    // Root-absolute paths break the second case silently.
    assert.ok(/<link rel="manifest" href="manifest\.json">/.test(html), `${page} does not link the manifest`);
    assert.ok(
      html.indexOf('<link rel="manifest"') < headEnd,
      `${page} links the manifest outside <head>, which some browsers ignore`
    );

    const registrations = html.match(/src="game\/pwa\.js"/g) ?? [];
    assert.equal(registrations.length, 1, `${page} must register the worker exactly once, found ${registrations.length}`);

    const scriptAt = html.indexOf('src="game/pwa.js"');
    assert.ok(scriptAt > headEnd, `${page} loads pwa.js in the head, blocking first paint`);
    assert.ok(scriptAt < html.lastIndexOf("</body>"), `${page} loads pwa.js after </body>`);

    assert.ok(/name="theme-color"/.test(html), `${page} has no theme-color, so the status bar will not match`);
    assert.ok(/apple-mobile-web-app-capable/.test(html), `${page} is not standalone when launched from iOS`);
  }
});

test("the worker precaches only files that exist", async () => {
  const source = await readFile(resolve(ROOT, "sw.js"), "utf8");
  const block = source.match(/const SHELL_ASSETS = \[([\s\S]*?)\];/);
  assert.ok(block, "SHELL_ASSETS not found in sw.js");

  const paths = [...block![1]!.matchAll(/'([^']+)'/g)].map((match) => match[1]!);
  assert.ok(paths.length > 0, "the precache list is empty");

  for (const path of paths) {
    const onDisk = path === "/" ? "index.html" : path.replace(/^\//, "");
    assert.ok(existsSync(resolve(ROOT, onDisk)), `sw.js precaches ${path}, which does not exist`);
  }
});

test("the worker stays out of the game's network traffic", async () => {
  const source = await readFile(resolve(ROOT, "sw.js"), "utf8");

  // The socket is an upgrade request and the API is live data. Caching either one
  // produces a game that looks like it has a server fault.
  assert.ok(source.includes("request.method !== 'GET'"), "non-GET requests must pass through untouched");
  assert.ok(source.includes("startsWith('/api/')"), "the API surface must be excluded");
  assert.ok(source.includes("startsWith('/socket.io/')"), "the socket path must be excluded");
  assert.ok(source.includes("url.origin !== self.location.origin"), "cross-origin must be excluded");
  assert.ok(source.includes("url.pathname === '/sw.js'"), "a worker must never cache itself");

  // Code must not be served cache-first, or a deploy is invisible to returning players.
  assert.ok(
    /CODE_EXTENSIONS[\s\S]{0,400}networkFirst/.test(source),
    "scripts and stylesheets must be network-first"
  );
});

test("the offline fallback is self-contained", async () => {
  const path = resolve(ROOT, "offline.html");
  assert.ok(existsSync(path), "offline.html is the last resort when the cache misses too");

  const html = await readFile(path, "utf8");
  // It is served when nothing else is available, so it cannot reference anything else.
  assert.ok(!/<link[^>]+rel="stylesheet"/.test(html), "offline.html must not link a stylesheet");
  assert.ok(!/<script[^>]+src=/.test(html), "offline.html must not load an external script");
});

test("the worker and its registration script never open a socket", async () => {
  // These load on every page, including the arcade demo whose whole point is that it
  // speaks to nothing. A socket here would put one in it by the back door.
  for (const file of ["sw.js", "game/pwa.js"]) {
    const path = resolve(ROOT, file);
    assert.ok(existsSync(path), `${file} is missing`);
    const source = await readFile(path, "utf8");
    assert.ok(!/new WebSocket/.test(source), `${file} must not open a socket`);
  }
});

test("the install button is created lazily, never authored into the pages", async () => {
  // The 1920x1080 board spec fixes every element's position, and an Install button is
  // not in it. Building the button in script means it cannot add dead weight to that
  // layout on a browser that cannot install, and keeps five pages from drifting apart.
  for (const page of PAGES) {
    const html = await readFile(resolve(ROOT, page), "utf8");
    assert.ok(!/cw-install-btn/.test(html), `${page} hard-codes the install button into the markup`);
    assert.ok(!/Install this game/.test(html), `${page} hard-codes install copy`);
  }

  const source = await readFile(resolve(ROOT, "game/pwa.js"), "utf8");
  assert.ok(source.includes("createElement('button')"), "pwa.js builds the button itself");
  assert.ok(source.includes("is-visible"), "it is shown by adding a class, not by being appended");
});

test("the install button's two placements are both defined", async () => {
  const source = await readFile(resolve(ROOT, "game/pwa.js"), "utf8");

  // In-board: positioned in the stage's own pixels, clear of the settings gear and of
  // the timer. .arcade-settings-btn sits at left 1810 with width 70, so a right offset
  // of 126px puts the button's right edge 16px clear of it.
  assert.ok(/\.cw-install-btn\{[^}]*right:126px/.test(source), "the in-board placement is missing");
  assert.ok(/\.cw-install-btn\{[^}]*top:35px/.test(source), "the in-board placement must match the gear's 35px");

  // Off-board: the four pages with no stage get a viewport-pinned button.
  assert.ok(/\.cw-install-btn\.cw-fixed\{[^}]*position:fixed/.test(source), "the viewport placement is missing");

  // Hidden until offered, in both placements.
  assert.ok(/\.cw-install-btn\{[^}]*display:none/.test(source), "the button must start hidden");
  assert.ok(/\.cw-install-btn\.is-visible\{display:inline-flex\}/.test(source), "and only .is-visible may show it");

  // A touch target, not a link: 56px tall in the pinned placement.
  assert.ok(/\.cw-install-btn\.cw-fixed\{[^}]*height:56px/.test(source), "the pinned button is under 48px tall");
});

test("the install offer is suppressed for an already-installed app, and handled on iOS", async () => {
  const source = await readFile(resolve(ROOT, "game/pwa.js"), "utf8");

  // Someone who has already installed and launched from the home screen must never be
  // asked again. Both the standard query and iOS's own flag are checked.
  assert.ok(source.includes("(display-mode: standalone)"), "standalone is not detected");
  assert.ok(source.includes("navigator.standalone === true"), "the iOS standalone flag is not checked");

  // iOS never fires beforeinstallprompt — installing is a manual Share-sheet action —
  // so it needs its own path or the button simply never appears on an iPhone.
  assert.ok(/iP\(hone\|ad\|od\)/.test(source), "iOS is not detected");
  assert.ok(source.includes("Add to Home Screen"), "iOS is given no instruction");
  assert.ok(source.includes("maxTouchPoints"), "iPadOS reports itself as a Mac and needs the touch check");
});

test("the install button reaches a phone held upright, not just a desktop", async () => {
  const source = await readFile(resolve(ROOT, "game/pwa.js"), "utf8");

  // The board is 16:9 and the sheet hides it in portrait on phones, swapping in the
  // rotate veil. A button parented to the board is then inside a display:none subtree
  // — measured on an iPhone in portrait: 0x0, checkVisibility() false — which is
  // exactly when a first-time phone visitor needs it. It must be able to live in the
  // veil instead, and must follow the device as it turns.
  assert.ok(source.includes("rotate-device-card"), "no veil host for the button to move into");
  assert.ok(source.includes("cw-in-veil"), "no veil placement style");
  assert.ok(/orientation: portrait/.test(source), "the portrait case is not detected");
  assert.ok(source.includes("orientationchange"), "the button does not follow the device as it turns");

  // The button must be parented somewhere that is actually on screen.
  assert.ok(/function installHost/.test(source), "there is no host-selection step");

  // And on iOS the instructions cannot hide behind a tap: Safari is the only browser
  // that can install, and an in-app browser cannot install at all.
  assert.ok(/showInstallHint\(/.test(source), "iOS is given no instructions");
  assert.ok(source.includes("Safari"), "iOS instructions do not name Safari");
});

test("the worker's own cache writes are awaited", async () => {
  const source = await readFile(resolve(ROOT, "sw.js"), "utf8");
  const lines = source.replace(/\/\*[\s\S]*?\*\//g, "").split("\n");

  // An un-awaited cache.put is not part of what respondWith waits on: the worker can be
  // terminated the moment the response is handed over and the update is silently lost,
  // leaving a superseded file cached indefinitely.
  const unawaited = lines
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter(({ line }) => /\bcache\.put\(/.test(line) && !/await\s+cache\.put\(/.test(line) && !/return\s+cache\.put\(/.test(line));
  assert.deepEqual(unawaited, [], `un-awaited cache.put at line(s) ${unawaited.map((l) => l.n).join(", ")}`);
});

test("the worker fetches past the HTTP cache", async () => {
  const source = await readFile(resolve(ROOT, "sw.js"), "utf8");

  // Without cache: 'reload' the browser's HTTP cache — Android's WebView especially —
  // answers with a stale 200 that is indistinguishable from a fresh one, which the
  // worker then stores as current. A fixed stylesheet was deployed, verified at the
  // origin, and never reached a phone for exactly this reason.
  const runtimeFetches = source.match(/fetch\(request[^)]*\)/g) ?? [];
  assert.ok(runtimeFetches.length >= 2, `expected the runtime fetches, found ${runtimeFetches.length}`);
  for (const call of runtimeFetches) {
    assert.ok(/cache:\s*'reload'/.test(call), `a runtime fetch does not bypass the cache: ${call}`);
  }
});

test("the worker is versioned, so a bump can evict what is on a device", async () => {
  const source = await readFile(resolve(ROOT, "sw.js"), "utf8");
  const version = source.match(/const VERSION = '([^']+)'/);
  assert.ok(version, "sw.js has no VERSION constant");
  assert.ok(/caches\.delete/.test(source), "activate never deletes the previous caches");
  assert.ok(CACHES_ARE_VERSIONED(source), "the cache names must carry the version, or a bump evicts nothing");
});

function CACHES_ARE_VERSIONED(source: string): boolean {
  const names = [...source.matchAll(/const (SHELL_CACHE|CODE_CACHE|ART_CACHE) = `([^`]+)`/g)];
  return names.length >= 3 && names.every(([, , value]) => /\$\{VERSION\}/.test(value));
}

test("the page asks for a worker update rather than waiting for the browser", async () => {
  const source = await readFile(resolve(ROOT, "game/pwa.js"), "utf8");

  // The browser's own update schedule left a test device running the previous worker for
  // three visits after a deploy. An explicit update() on load is what actually makes a
  // fix land promptly.
  assert.ok(/\.update\(\)/.test(source), "registration never asks for an update check");
  assert.ok(/updateViaCache:\s*'none'/.test(source), "the update check itself may be answered from cache");
});

test("a new worker taking over reloads the page once, so a fix is actually painted", async () => {
  const source = await readFile(resolve(ROOT, "game/pwa.js"), "utf8");

  // skipWaiting + clients.claim change who controls the page without making the loaded page
  // re-fetch anything. A device that had already been sent the board fix went on painting
  // the stylesheet from before it, and reported the bug again, because nothing reloaded.
  assert.ok(/controllerchange/.test(source), "nothing reacts to the new worker taking over");
  assert.ok(/window\.location\.reload\(\)/.test(source), "the page never reloads onto the new worker");

  // …but only on an UPDATE. On a first install there was no controller, the page is already
  // fresh, and reloading it would be a second load on the slowest visit there is.
  assert.ok(/hadController/.test(source), "it reloads on first install too, for nothing");

  // …and only once per tab, or a worker that keeps being replaced becomes a reload loop.
  assert.ok(/cw-reloaded-for-worker/.test(source), "no once-per-session guard: a reload loop");
});

test("the fill solver is precached, so the zoom survives going offline", async () => {
  const source = await readFile(resolve(ROOT, "sw.js"), "utf8");
  // Without it an offline load leaves ChampWordSceneFill undefined, applySceneFill bails,
  // and the frame falls back to cover — the water band, back on the screen of anyone who
  // launched the installed app with no signal.
  assert.ok(/['"]\/game\/scene-fill\.js['"]/.test(source),
    "the worker does not precache game/scene-fill.js");
});

test("the stylesheet URL can be busted, so a stuck device is not stuck forever", async () => {
  const html = await readFile(resolve(ROOT, "wild.html"), "utf8");
  // Belt and braces alongside the worker: a changed URL is a cache miss at every layer,
  // including the ones this project does not control.
  assert.ok(/href="game\/wild-arcade\.css\?v=\d+"/.test(html),
    "the stylesheet is referenced without a version, so every cache layer can pin it");
});
