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
  // /wild-play.html, not /wild.html. /wild.html became the arcade demo page, which has
  // no socket by design — asserted in the test below — and every assertion here is about
  // a page that plays. Pointing this at the demo would mean either dropping the
  // assertions or pretending the demo can reach a server. The playable client moved, so
  // this follows it; that it is still served at all is asserted below too.
  const wild = await get("/wild-play.html");

  assert.equal(wild.result, "served");
  assert.match(wild.text, /new WebSocket/);
  assert.match(wild.text, /find_match/, "the card table enters matchmaking");
  assert.match(wild.text, /round_view/, "the card table reads the per-seat view");
  assert.doesNotMatch(wild.text, new RegExp(LEGACY_MARKER));
});

test("the card table walks its seats in the order they sit around the table", async () => {
  // The playable client again: the seat ring is what decides which plate the turn moves
  // to next, and the arcade demo has no seat ring to walk.
  const wild = await get("/wild-play.html");

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

test("the playable table carries the arcade HUD, wired to the events that drive it", async () => {
  // The arcade chrome is skinned onto the client that plays, and three things have to
  // hold together or it is decoration rather than a HUD: the markup is there, it is
  // driven by the server's own events instead of a timer or a mock pipeline, and the
  // strike restates the stage fit.
  const wild = await get("/wild-play.html");
  assert.equal(wild.result, "served");
  assert.match(wild.text, /id="unoCalloutOverlay"/, "the banner needs its overlay");
  assert.match(wild.text, /id="shockwaveLayer"/, "the penalty rim needs its layer");

  // Driven by what the server actually sends. uno_called carries the seat that called
  // it, and a card_drawn with a count above one is every penalty there is — the +2, the
  // +4, and being caught holding one card. A voluntary single draw must not fire it, so
  // the guard is asserted alongside the call rather than instead of it.
  assert.match(
    wild.text,
    /case "uno_called": \{[\s\S]{0,200}triggerUnoDeclarationBanner\(/,
    "the banner must hang off the real uno_called event"
  );
  assert.match(
    wild.text,
    /if \(\(payload\.count \|\| 1\) > 1\) \{[\s\S]{0,400}triggerProfessionalPenaltyStrike\(/,
    "the strike must hang off a real multi-card draw, and not off a single one"
  );

  // The one that silently breaks the whole table. #game is positioned by
  // `translate(-50%,-50%) scale(var(--s))` to fit the 1600x900 stage to the window, and
  // an animation on `transform` REPLACES that value rather than adding to it — keyframes
  // written against a bare transform throw the entire table into the top-left corner for
  // the length of the strike. So each frame has to restate the centring and the fit, and
  // losing either half is the bug this asserts against.
  const strike = wild.text.match(/@keyframes aaa-camera-strike \{[\s\S]*?\n\}/);
  assert.ok(strike, "the strike keyframes must exist");
  assert.match(strike[0], /translate\(-50%, -50%\)/, "every frame must restate the centring");
  assert.match(strike[0], /scale\(var\(--s, 1\)\)/, "every frame must restate the stage fit");

  // Skinned onto the one clock and the one banner, not bolted on beside them: a second
  // #timerPill would be a second thing claiming to be the turn clock.
  assert.equal((wild.text.match(/id="timerPill"/g) || []).length, 1, "there is one clock");
  assert.equal((wild.text.match(/id="unoBanner"/g) || []).length, 1, "there is one banner");
});

test("the Go Wild page is the arcade demo, and the playable client is still served", async () => {
  // /wild.html is the arcade demo: its own layout, its own mock data, its own deal. It
  // has no socket, which is the one thing a card table cannot do without — so the page
  // that can actually be played is /wild-play.html. Both facts are asserted here rather
  // than left implicit, including that the playable client has not quietly gone away.
  const demo = await get("/wild.html");
  const playable = await get("/wild-play.html");

  assert.equal(demo.result, "served");
  assert.match(demo.text, /localHandMock/, "the demo runs on its own mock pipeline");
  assert.doesNotMatch(demo.text, /new WebSocket/, "the demo has no socket, by design");

  assert.equal(playable.result, "served");
  assert.match(playable.text, /new WebSocket/, "the playable client must stay served");
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
