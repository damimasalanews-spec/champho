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

test("the board still fits by height, so nothing is ever cropped", async () => {
  const css = await sheet();
  const rules = rulesFor(css, ".stage");
  const joined = rules.join("\n");

  // Cover-scaling the BOARD to fill the screen would crop the timer off the top and the
  // hand off the bottom. The stage keeps a fixed 1920x1080 scaled to fit, and the scene
  // is what does the filling.
  assert.ok(/width:\s*1920px/.test(joined) && /height:\s*1080px/.test(joined),
    "the board must stay a fixed 1920x1080 so fitting by height leaves the UI uncropped");
  assert.ok(/scale\(var\(--stage-scale/.test(joined), "the board must scale to fit, not to cover");
  assert.ok(!/scale\(max\(|calc\(max\(/.test(joined),
    "a cover-style scale here would crop the board");
});
