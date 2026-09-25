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

  // Scale by HEIGHT, so the board can never leave a band top or bottom — and from the
  // SAFE box inside the frame, not from the window, because on a notched phone held
  // sideways the two differ by the device's insets and the board belongs inside them.
  assert.ok(/const scale = Math\.min\(box\.safeW \/ STAGE_W,\s*box\.safeH \/ STAGE_H\)/.test(html),
    "the scale must come from the safe box's height over the board height");
  assert.ok(/Math\.max\(STAGE_W,\s*box\.safeW \/ usable\)/.test(html),
    "the width must be at least 1920 and otherwise as wide as the screen needs");
  assert.ok(/setProperty\('--stage-w'/.test(html), "the computed width must reach the stylesheet");
  // …and the board is centred in the safe box, which on an inset screen is not the
  // screen's centre: the shift has to be published too, or the board sits under the notch.
  assert.ok(/setProperty\('--stage-shift-x'/.test(html) && /setProperty\('--stage-shift-y'/.test(html),
    "the safe-area shift must reach the stylesheet");
  assert.ok(/paddingLeft/.test(html) && /clientWidth/.test(html),
    "the insets must be measured off the frame, not assumed to be zero");

  // The throw aims in board pixels, and the board's width now varies, so the conversion
  // has to come off the height — dividing by the fixed 1920 would mis-scale it by
  // however much wider the board had become.
  assert.ok(/scale:\s*r\.height\s*\/\s*STAGE_H/.test(html),
    "the aim conversion must derive the scale from the board's height");
  assert.ok(/stageW:\s*stage\.width/.test(html) && /a\.stageW/.test(html),
    "the throw's camera must pan across the board's live width, not the spec's 1920");
});

test("the page that hosts the game cannot paint a band of its own beside it", async () => {
  const html = await readFile(resolve(ROOT, "index.html"), "utf8");

  // The installed app opens the table in a full-screen iframe over index.html, and
  // index.html's own document background is a flat blue — style-part-*.css sets
  // `html,body{background:#079bd3!important}` for the V38 home artwork. On a phone held
  // sideways with a notch, iOS lays the page out inside the safe area and paints the strips
  // either side of it with that document colour: two constant ~45px blue bars down the whole
  // screen. That is what the player kept reporting, and no change inside the game could ever
  // remove it, because it is painted outside the page the game is drawn in.
  assert.ok(/viewport-fit=cover/.test(html),
    "index.html does not claim the whole screen, so the device still paints strips beside it");
  assert.ok(/body\.game-open\{[^}]*background:\s*#0d3807/.test(html),
    "nothing repaints the document background while the game is open: the home artwork's blue shows through in those strips");

  // And the game has to be told where those strips are, or the board ends up under the
  // notch once the host does cover the whole screen: env() resolves to 0 inside an iframe,
  // so the host measures the insets and posts them with the profile.
  assert.ok(/champSafeArea/.test(html), "the host never posts the insets it can measure");
  assert.ok(/padding:env\(safe-area-inset-top\)/.test(html), "the host's probe reads no insets at all");

  const wild = await readFile(resolve(ROOT, "wild.html"), "utf8");
  assert.ok(/data\.champSafeArea/.test(wild), "the game ignores the insets the host sends");
  assert.ok(/hostInsets/.test(wild), "the game receives the insets but keeps no copy of them");
});

test("the plate is pushed in until the FELT reaches the frame's edges", async () => {
  const css = await sheet();
  const frame = ruleFor(css, ".viewport-frame");

  // `cover` fills the frame at every aspect, but on anything wider than the plate's 3:2 it
  // fills by WIDTH, and the island does not reach the plate's own edges except at its
  // widest row. That leaves a band of flat water down each side — the blue the player
  // reports. It cannot be fixed by one fixed zoom behind one aspect-ratio threshold: the
  // 142%/181 case that used to be here left 16:9 and 3:2 — desktops, laptops and 16:9
  // phones, the commonest screens of all — on plain cover, which is the band exactly.
  assert.ok(!/min-aspect-ratio/.test(css),
    "a fixed zoom behind an aspect-ratio threshold is back; it cannot cover every shape");
  assert.ok(/background-origin:\s*border-box/.test(frame),
    "the plate must cover the frame's safe-area padding too, or the felt fallback seams there");

  const html = await readFile(resolve(ROOT, "wild.html"), "utf8");
  assert.ok(/<script src="game\/scene-fill\.js"><\/script>/.test(html),
    "wild.html never loads the fill solver, so the plate is left at cover");
  assert.ok(html.indexOf("game/scene-fill.js") < html.indexOf("function applyStageScale"),
    "the solver must be loaded before the code that calls it (classic scripts run in order)");
  assert.ok(/fill\.fillZoom\(box\.w, box\.h\)/.test(html),
    "the fill is not solved for the frame it has to fill");
  assert.ok(/frame\.style\.backgroundSize/.test(html),
    "the solved zoom never reaches the element");
  assert.ok(/zoom \? \(zoom \* 100\) \+ '% auto' : 'cover'/.test(html),
    "a shape with no solution must fall back to cover, which still fills the frame");
});

test("fillZoom really covers the felt, on every screen shape", async () => {
  // The solver is a plain script, so the table of measured felt spans can be handed to
  // this test directly, and the invariant it claims can be CHECKED rather than trusted.
  // Imported through a URL rather than a literal specifier: it is a browser script with no
  // types, and a literal would be a TypeScript module-resolution error, not a test.
  await import(new URL("../../game/scene-fill.js", import.meta.url).href);
  const fill = (globalThis as { ChampWordSceneFill?: Record<string, any> }).ChampWordSceneFill;
  assert.ok(fill && typeof fill.fillZoom === "function", "game/scene-fill.js exports nothing");

  const { ISLAND_LO: LO, ISLAND_HI: HI, PLATE_W, PLATE_H, STEP } = fill as {
    ISLAND_LO: number[]; ISLAND_HI: number[]; PLATE_W: number; PLATE_H: number; STEP: number;
  };
  assert.equal(LO.length, HI.length, "the two felt spans are different lengths");
  assert.ok(LO.length >= 60, "the spans are too coarsely sampled to be the island's taper");

  const shapes: Array<[string, number, number]> = [
    ["phone 2.16:1 (the reported one)", 1441, 666], ["the 1536x709 canvas", 1536, 709],
    ["16:9 desktop", 1920, 1080], ["16:9 laptop", 1280, 720], ["16:10", 1440, 900],
    ["3:2", 1536, 1024], ["4:3 tablet", 1024, 768], ["iPad Pro 11", 1194, 834],
    ["21:9 ultrawide", 2560, 1080], ["5:4", 1280, 1024], ["square", 900, 900],
    ["very wide", 2400, 700], ["small phone", 568, 320]
  ];

  for (const [name, w, h] of shapes) {
    const z = fill.fillZoom(w, h) as number | null;
    assert.ok(z && z >= 1, `${name}: no zoom found for ${w}x${h}`);

    // Re-derive what that zoom actually shows, and check the felt on every row of it.
    const scale = (z * w) / PLATE_W;
    const top = PLATE_H / 2 - h / 2 / scale, bottom = PLATE_H / 2 + h / 2 / scale;
    const i0 = Math.floor(top / STEP), i1 = Math.floor(bottom / STEP);
    const needLeft = PLATE_W / 2 - PLATE_W / (2 * z);
    const needRight = PLATE_W / 2 + PLATE_W / (2 * z);
    assert.ok(i0 >= 0 && i1 + 1 < LO.length, `${name}: the visible slice leaves the plate`);

    // Between two samples the span is read pessimistically, which is what the solver does.
    for (let i = i0; i <= i1; i++) {
      const lo = Math.max(LO[i]!, LO[i + 1]!);
      const hi = Math.min(HI[i]!, HI[i + 1]!);
      assert.ok(lo >= 0 && lo < needLeft,
        `${name}: row ${i * STEP} starts its felt at column ${lo}, but the frame's left edge is at ${needLeft.toFixed(0)} — water would show there`);
      assert.ok(hi > needRight,
        `${name}: row ${i * STEP} ends its felt at column ${hi}, but the frame's right edge is at ${needRight.toFixed(0)} — water would show there`);
    }
  }

  // And the shapes the old threshold left on plain cover must now genuinely be pushed in,
  // or the band is still there on a 16:9 laptop.
  assert.ok((fill.fillZoom(1920, 1080) as number) > 1.4,
    "16:9 is barely zoomed; plain cover leaves the water band down the sides");
  assert.ok((fill.fillZoom(1441, 666) as number) >= 1.35,
    "the reported 2.16:1 shape is barely zoomed");
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
