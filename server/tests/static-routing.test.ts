import test from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { serveStatic } from "../static.js";

/**
 * Regression tests for static routing.
 *
 * These exist because of a specific bug: the server served `index.html` at `/`.
 * That file is the legacy Firebase-era client — 533 KB — and every visitor to the
 * root received a page that could not reach the server. The backend was healthy
 * and the game was unplayable. That is the failure these tests exist to prevent.
 *
 * The root is the home page again, because the home page can reach a game now:
 * its mode cards launch Classic or Go Wild into an overlay, and the overlay is
 * what holds the WebSocket client. So what is asserted here is not "the root is a
 * particular file" but the two things that make it a working front door — the
 * launcher is present, and every game it can open actually speaks the protocol.
 *
 * Asserting on `find_match` was the old test for a playable page, and it is no
 * longer the right one: the classic client is a two-player room-code game that
 * sends `create_room` / `join_room` / `start_round` / `submit_word` and never
 * sends `find_match` at all. A page that cannot reach the server is caught by
 * looking for its WebSocket, and each game is then checked for its own opening
 * message — which is the property that was actually being protected.
 */

/** Marker unique to the legacy page's <title>. */
const LEGACY_MARKER = "V38 Polished Mobile Landscape";

interface Captured {
  status?: number;
  body?: Buffer;
}

function fakeResponse(): { response: ServerResponse; captured: Captured } {
  const captured: Captured = {};
  const response = {
    writeHead(status: number) {
      captured.status = status;
      return response;
    },
    end(chunk?: Buffer | string) {
      if (chunk !== undefined) {
        captured.body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      }
      return response;
    }
  };
  return { response: response as unknown as ServerResponse, captured };
}

async function get(url: string): Promise<{ result: string; status?: number; text: string }> {
  const { response, captured } = fakeResponse();
  const request = { method: "GET", url } as unknown as IncomingMessage;
  const result = await serveStatic(request, response);
  return { result, status: captured.status, text: captured.body?.toString("utf8") ?? "" };
}

test("the root serves the home page, and the home page can reach a game", async () => {
  const root = await get("/");

  assert.equal(root.result, "served");
  assert.equal(root.status, 200);
  assert.match(root.text, new RegExp(LEGACY_MARKER), "the root is the home page");
  // The launcher is what stops the home page being the dead end it once was.
  assert.match(root.text, /openChampProGame/, "the root must carry the game launcher");
  assert.match(root.text, /wild\.html/, "the Go Wild entry must point at the card table");
});

test("/index.html serves the same page as the root", async () => {
  const root = await get("/");
  const index = await get("/index.html");

  assert.equal(index.result, "served");
  assert.equal(index.text, root.text);
});

test("the classic client is served and can reach the server", async () => {
  const classic = await get("/classic.html");

  assert.equal(classic.result, "served");
  assert.match(classic.text, /new WebSocket/, "a client that cannot reach the server is not a game");
  assert.match(classic.text, /create_room/, "the classic game opens with a room");
  assert.doesNotMatch(classic.text, new RegExp(LEGACY_MARKER), "the classic client is not the legacy page");
});

test("the card table is served and can reach the server", async () => {
  const wild = await get("/wild.html");

  assert.equal(wild.result, "served");
  assert.match(wild.text, /new WebSocket/);
  assert.match(wild.text, /find_match/, "the card table enters matchmaking");
  assert.match(wild.text, /round_view/, "the card table reads the per-seat view");
  assert.doesNotMatch(wild.text, new RegExp(LEGACY_MARKER));
});

test("the card table walks its seats in the order they sit around the table", async () => {
  const wild = await get("/wild.html");

  // The plates are laid out near-left (the viewer), left, far, right. The seat
  // ring has to be listed in that same order, because it decides both where each
  // player is drawn and which plate the turn moves to next. Listed in any other
  // order the highlight hops across the table instead of walking it.
  assert.match(
    wild.text,
    /const SEAT_SLOTS = \["left", "top", "right"\];/,
    "the seat ring must run clockwise: left, far, right"
  );
});

test("the legacy address still resolves to the home page", async () => {
  const root = await get("/");
  const legacy = await get("/legacy.html");

  assert.equal(legacy.result, "served");
  assert.equal(legacy.text, root.text, "links handed out before the routing change keep working");
});

test("asset paths referenced by the served clients resolve", async () => {
  // The home page is the legacy page: it brings its images in through CSS and
  // through script, not through `src=`, so scanning it finds nothing to check.
  // The game clients do name their assets directly, and a wrong path there is a
  // missing picture on the board — so every served client is checked, and the
  // count is asserted at the end so this can never quietly pass on nothing.
  const clients = ["/", "/classic.html", "/wild.html"];
  let checked = 0;

  for (const path of clients) {
    const page = await get(path);
    assert.equal(page.result, "served", `${path} must be served`);

    // Only real asset paths. A `src="` also occurs inside scripts as a string
    // being concatenated — `'<img src="' + u + '">'` — and that is not a path the
    // page ever requests, so it must not be read as a broken reference.
    const refs = [...page.text.matchAll(/src="([^"]+)"/g)]
      .map((match) => match[1] ?? "")
      .filter((ref) => /^[\w./-]+\.(png|jpe?g|webp|gif|svg|css|js|mjs|mp3|wav|json)$/i.test(ref));

    for (const ref of refs) {
      const asset = await get(`/${ref.replace(/^\.?\//, "")}`);
      assert.equal(asset.result, "served", `${path} references ${ref}, which must be served`);
      checked += 1;
    }
  }

  assert.ok(checked > 0, "at least one client must reference a local asset, or this guards nothing");
});

test("a missing file is a 404, and path traversal never serves a file", async () => {
  assert.equal((await get("/definitely-missing.html")).result, "not_found");

  for (const attempt of ["/../etc/passwd", "/%2e%2e/%2e%2e/etc/passwd", "/..%2f..%2fetc/passwd"]) {
    const escaped = await get(attempt);
    assert.notEqual(escaped.result, "served", `${attempt} must not be served`);
    assert.doesNotMatch(escaped.text, /root:x:/, `${attempt} must not leak /etc/passwd`);
  }
});

test("non-GET requests are refused", async () => {
  const { response } = fakeResponse();
  const request = { method: "POST", url: "/" } as unknown as IncomingMessage;
  assert.equal(await serveStatic(request, response), "not_found");
});
