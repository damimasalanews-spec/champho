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
