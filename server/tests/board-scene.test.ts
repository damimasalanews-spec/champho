import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The table's scene has to reach the edges of the screen.
 *
 * The board is a fixed 16:9 scaled to fit, so on anything that is not 16:9 — which is
 * every phone — fitting it leaves bars down the left and right. That was reported as
 * "not fit to the whole mobile screen, there is a gap in left and right".
 *
 * The fix is that the illustrated scene lives on the frame (which is viewport-sized,
 * background-size: cover, so it reaches every edge) and the board is transparent over
 * it, rather than the scene living on the board itself.
 *
 * These tests exist because the failure was almost silent. The first attempt moved the
 * image to the frame but left `background-color: #3ba311` on the table — which clears
 * the image with `background: none` and then paints a solid green wall over the whole
 * screen, because the table is the full size of the board and sits on top. A check
 * that only asserts `background-image: none` passes happily while the game renders as a
 * flat green rectangle. So both halves are asserted here: the scene is on the frame,
 * AND the board carries no opaque paint of its own.
 */

const ROOT = resolve(process.cwd());

async function sheet() {
  const css = await readFile(resolve(ROOT, "game/wild-arcade.css"), "utf8");
  // Comments are stripped, and that is not tidiness. The rule that clears the table's
  // background carries a comment explaining the bug it fixes — "with `background: none`
  // followed by `background-color: #3ba311` ..." — and a scan that reads comments sees
  // that sentence as a declaration and reports the very bug the rule prevents.
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * EVERY rule for a selector, not just the last.
 *
 * A selector can be declared in several places that the cascade then merges — .stage
 * carries its geometry in one rule and its card-size variables in another, and
 * .game-table is declared three times. Asking only for the last one answers a question
 * nobody asked, and did: it reported that .game-table had no background at all when an
 * earlier rule was painting one.
 */
function rulesFor(css: string, selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...css.matchAll(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, "g"))];
  assert.ok(matches.length > 0, `no rule found for ${selector}`);
  return matches.map((m) => m[1]!);
}

/** The last rule for a selector — for when later-wins is the question. */
function ruleFor(css: string, selector: string): string {
  return rulesFor(css, selector).at(-1)!;
}

test("the scene is on the frame, covering it", async () => {
  const css = await sheet();
  const frame = ruleFor(css, ".viewport-frame");

  assert.ok(frame.includes("island-table-bg.webp"), "the frame does not carry the illustrated plate");
  assert.ok(/background-size:\s*cover/.test(frame), "the plate must cover the frame, or the bars come back");
  assert.ok(/background-position:\s*center/.test(frame), "the plate must be centred");
  assert.ok(/position:\s*fixed/.test(frame), "the frame must be viewport-sized for cover to mean the whole screen");
});

test("the board paints nothing of its own over the scene", async () => {
  const css = await sheet();
  const rules = rulesFor(css, ".game-table");

  // Across the WHOLE cascade, not one rule: .game-table is declared three times.
  assert.ok(
    rules.some((r) => /background:\s*none/.test(r)),
    "the table must not carry a background image"
  );
  assert.ok(
    !rules.some((r) => /background-image:\s*url/.test(r)),
    "the table still points at an image; the plate belongs on the frame"
  );

  // The trap. `background: none` followed by an explicit opaque background-color clears
  // the image and then paints a solid wall over the whole screen, because the table is
  // the full size of the board and sits on top of the frame. That is what shipped for
  // one revision, and it rendered as a flat green rectangle.
  for (const rule of rules) {
    const colour = rule.match(/background-color:\s*([^;]+);/);
    if (!colour) continue;
    assert.ok(
      /transparent|rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/.test(colour[1]!),
      `.game-table sets background-color: ${colour[1]!.trim()} — an opaque colour there hides the entire scene`
    );
  }
});

test("the plate itself is checked in", async () => {
  const css = await sheet();
  const frame = ruleFor(css, ".viewport-frame");
  const referenced = frame.match(/url\('([^']+)'\)/);
  assert.ok(referenced, "the frame rule names no image URL");

  // The sheet lives in game/, so the path is ../assets/... — a bare assets/ resolves to
  // game/assets/ and 404s, which would silently fall back to the flat colour.
  const path = referenced![1]!;
  assert.ok(path.startsWith("../"), `expected a ../ path from game/, got ${path}`);
  const onDisk = resolve(ROOT, "game", path);
  assert.ok(existsSync(onDisk), `${path} does not resolve to a file (looked in ${onDisk})`);
});

test("the board is as tall as the screen and as wide as it needs to be", async () => {
  const css = await sheet();
  const stage = rulesFor(css, ".stage").join("\n");

  // The board used to be a fixed 1920x1080 fitted inside the screen, which is what left
  // bands down the sides of every phone: a phone in landscape is about 2.16:1 and the
  // board is 16:9, so fitting by height can only ever fill 82% of the width. Cropping to
  // fill instead would eat the timer off the top and the hand off the bottom.
  //
  // So the height is the fixed one and the width flexes. 1080 must stay a constant.
  assert.ok(/height:\s*1080px/.test(stage), "the board's height must be the fixed 1080");
  assert.ok(/width:\s*var\(--stage-w,\s*1920px\)/.test(stage),
    "the board's width must come from --stage-w, falling back to the spec's 1920");
  assert.ok(/scale\(var\(--stage-scale/.test(stage), "the board must scale to fit the screen's height");
});

test("the board's scale and width are computed from the screen, not fixed", async () => {
  const html = await readFile(resolve(ROOT, "wild.html"), "utf8");

  // Scale by HEIGHT, so the board can never leave a band top or bottom.
  assert.ok(/window\.innerHeight\s*\/\s*STAGE_H/.test(html),
    "the scale must come from the screen height over the board height");
  assert.ok(/Math\.max\(STAGE_W,\s*window\.innerWidth\s*\/\s*usable\)/.test(html),
    "the width must be at least 1920 and otherwise as wide as the screen needs");
  assert.ok(/setProperty\('--stage-w'/.test(html), "the computed width must reach the stylesheet");

  // The throw aims in board pixels, and the board's width now varies, so the conversion
  // has to come off the height — dividing by the fixed 1920 would mis-scale it by
  // however much wider the board had become.
  assert.ok(/scale:\s*r\.height\s*\/\s*STAGE_H/.test(html),
    "the aim conversion must derive the scale from the board's height");
  assert.ok(/stageW:\s*stage\.width/.test(html) && /a\.stageW/.test(html),
    "the throw's camera must pan across the board's live width, not the spec's 1920");
});

test("the corners are anchored to the board's edges, so they reach the screen", async () => {
  const css = await sheet();

  // On a 16:9 board "left: 1735" and "right: 50" are the same pixel. On a phone, where
  // the board is wider, only the edge anchor carries the seat out to the side instead of
  // stranding it in the middle with empty felt beyond it.
  const rightSeat = rulesFor(css, ".opponent-right").join("\n");
  assert.ok(/right:\s*50px/.test(rightSeat), ".opponent-right must anchor to the right edge");
  assert.ok(/left:\s*auto/.test(rightSeat), ".opponent-right must not also be pinned from the left");

  const gear = rulesFor(css, ".arcade-settings-btn").join("\n");
  assert.ok(/right:\s*40px/.test(gear), ".arcade-settings-btn must anchor to the right edge");
  assert.ok(/left:\s*auto/.test(gear), ".arcade-settings-btn must not also be pinned from the left");

  // And nothing may be pinned to a right-hand absolute x any more — that is exactly the
  // pattern that produced the bands.
  const pins = [...css.matchAll(/^\s*left:\s*(1[0-9]{3}|[2-9][0-9]{3})px;\s*$/gm)];
  assert.deepEqual(pins.map((m) => m[0].trim()), [],
    "a right-hand element is still pinned to an absolute x instead of an edge");
});
