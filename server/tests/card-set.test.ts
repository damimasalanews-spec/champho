import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
/** The sheet with the notes taken out: these checks are about rules, and the notes here
    quote the very strings they are checking for. */
async function rulesOnly() {
  return (await sheet()).replace(/\/\*[\s\S]*?\*\//g, "");
}
const sheet = () => readFile(resolve(ROOT, "game/wild-arcade.css"), "utf8");

/** cards.js is a plain script: importing it for its side effect sets the global. */
async function cardSet() {
  await import(new URL("../../game/cards.js", import.meta.url).href);
  const api = (globalThis as { ChampCards?: Record<string, any> }).ChampCards;
  assert.ok(api, "game/cards.js exports nothing");
  return api as {
    cardFaceHtml: (card: Record<string, unknown>) => string;
    glyphKind: (card: Record<string, unknown>) => string;
    glyphSvg: (kind: string, cls: string) => string;
    GLYPH_BODY: Record<string, string>;
    COLOURS: string[];
  };
}

test("every card kind maps to its own symbol, whatever the deck calls it", async () => {
  const cards = await cardSet();

  // The demo table spells its actions with emoji and the networked deck spells them with
  // types; the face builder has to mean the same thing either way or the same card draws
  // as a number on one table and a symbol on another.
  const pairs: Array<[Record<string, unknown>, string]> = [
    [{ type: "skip" }, "skip"], [{ value: "🚫" }, "skip"],
    [{ type: "reverse" }, "reverse"], [{ value: "🔁" }, "reverse"],
    [{ type: "draw2" }, "draw2"], [{ value: "+2" }, "draw2"],
    [{ type: "discard_all" }, "discard_all"], [{ value: "ALL" }, "discard_all"],
    [{ type: "wild" }, "wild"], [{ value: "★" }, "wild"], [{ value: "W" }, "wild"],
    [{ type: "wild4" }, "wild4"], [{ value: "+4" }, "wild4"],
    [{ type: "number", value: "7" }, ""], [{ value: "9" }, ""]
  ];
  for (const [card, kind] of pairs) {
    assert.equal(cards.glyphKind(card), kind, `${JSON.stringify(card)} should be ${kind || "a number"}`);
  }
});

test("the four-colour wild really is four colours, and the skip is not a slashed circle", async () => {
  const cards = await cardSet();

  // The wild symbol is the one card whose meaning is "all four at once", so it is the one
  // place the palette has to actually appear in the artwork. Measured off the rendered
  // sheet as well: the four quadrants around the centre read red, yellow, blue and green.
  const wild = cards.cardFaceHtml({ type: "wild", colour: "wild", value: "★" });
  for (const colour of ["#ff4646", "#ffd42a", "#34d35f", "#3b8bff"]) {
    assert.ok(wild.includes(colour), `the wild symbol is missing ${colour}`);
  }
  assert.ok((wild.match(/<path/g) || []).length >= 4, "the wild symbol is not four petals");

  // ORIGINALITY, as a property of the drawing rather than a promise: UNO's skip is a
  // circle with a bar through it and its reverse is two arrows chasing. Neither shape is
  // in this set — the skip is two pause bars over a moving line, the reverse one U-turn.
  const skip = cards.GLYPH_BODY.skip!;
  assert.ok(!/<circle/.test(skip), "the skip is a circle again — that is the official shape, not ours");
  assert.ok((skip.match(/<rect/g) || []).length === 2, "the skip should be two bars");

  const reverse = cards.GLYPH_BODY.reverse!;
  assert.equal((reverse.match(/<path/g) || []).length, 2, "the reverse should be one bent stroke and its head");
  // …and two chasing arrows would be four. One arc plus one arrowhead is the U-turn.
  assert.ok(!/scale\(-1/.test(reverse) && !/rotate\(180/.test(reverse), "a mirrored second arrow is back");

  // Nothing anywhere draws the official wordmark on a card.
  const css = await rulesOnly();
  assert.ok(!/content:\s*'UNO'/.test(css), "the UNO wordmark is on a card again");
  assert.ok(!/content:\s*"UNO"/.test(css), "the UNO wordmark is on a card again");
  assert.ok(!/Mattel/i.test(css), "Mattel branding in the sheet");

  // Comments stripped, because the notes in there explain at length which wordmark is
  // deliberately absent, and naming a thing to disown it is not drawing it.
  const js = (await readFile(resolve(ROOT, "game/cards.js"), "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/UNO/.test(js), "cards.js draws the wordmark");
});

test("the faces carry their own marks, and the two-count cards their counts", async () => {
  const cards = await cardSet();

  const seven = cards.cardFaceHtml({ colour: "red", value: "7", type: "number" });
  assert.ok(/class="card-value"[^>]*>7</.test(seven), "a number card has no digit in the middle");
  assert.equal((seven.match(/corner-value/g) || []).length, 2, "a number card is missing a corner");
  assert.ok(!/<svg/.test(seven), "a number card should carry no symbol");

  const draw2 = cards.cardFaceHtml({ colour: "green", value: "+2", type: "draw2" });
  assert.ok(/>\+2</.test(draw2), "draw two lost its count");
  assert.ok(/draw-count/.test(draw2), "the count is not on the count size, so it is set as a digit");
  assert.ok((draw2.match(/corner-value/g) || []).length === 2, "draw two is missing a corner");

  // A card whose whole meaning is a symbol repeats that symbol small in both corners rather
  // than inventing a letter for it — which is what the old faces did with a 🚫.
  const skip = cards.cardFaceHtml({ colour: "red", value: "🚫", type: "skip" });
  assert.equal((skip.match(/mini-glyph/g) || []).length, 2, "skip's corners are not the symbol");
  assert.ok(/card-glyph/.test(skip), "skip lost its centre symbol");

  const wild4 = cards.cardFaceHtml({ colour: "wild", value: "+4", type: "wild4" });
  assert.ok(/\+4/.test(wild4) && /is-wild/.test(wild4), "wild draw four lost its badge or its scale");
});

test("the card system is drawn by the sheet, at every size", async () => {
  const css = await sheet();

  // The emblem and the back's emblem are drawings, not colours: if either turns into a
  // flat fill the design is gone and nothing else in the suite would notice.
  assert.ok(/\.draw-deck-source::before[\s\S]{0,900}data:image\/svg\+xml/.test(css),
    "the draw packet no longer wears the card back's emblem");
  assert.ok(/\.card\.card-back::after[\s\S]{0,700}data:image\/svg\+xml/.test(css),
    "the card back has lost its emblem");
  assert.ok(/\.card::before[\s\S]{0,700}data:image\/svg\+xml/.test(css),
    "the face has lost its emblem ribbon");
  assert.ok(/\.card::after[\s\S]{0,400}linear-gradient\(104deg/.test(css),
    "the face has lost its gloss");

  // The four field colours, defined once.
  for (const colour of ["red", "yellow", "green", "blue", "wild"]) {
    assert.ok(new RegExp(`--face-${colour}-1:`).test(css), `the palette is missing ${colour}`);
  }

  // Everything scales with the card. If a glyph is ever given a pixel size it stops being
  // the same card at 137px and at 300px, which is the whole point of drawing it.
  assert.ok(!/\.card-glyph\s*{[^}]*width:\s*\d+px/.test(css), "the action glyphs are sized in pixels");
  assert.ok(/\.card \.card-glyph\s*{[^}]*width:\s*\d+%/.test(css), "the action glyphs should be a share of the card");
});

test("the type is served by the app, not by a font CDN", async () => {
  const css = await rulesOnly();
  assert.ok(/@font-face/.test(css), "no local @font-face: the type falls back offline");
  assert.ok(/url\('\.\.\/assets\/fonts\//.test(css), "the face does not point at the app's own font file");
  assert.ok(!/fonts\.googleapis\.com/.test(css),
    "a font CDN is still imported: that is a blocked first paint and no type at all offline");
  assert.ok(existsSync(resolve(ROOT, "assets/fonts/nunito-var.woff2")), "the font file is not in the repo");
});

test("the asset sheet is rendered by the game's own card code", async () => {
  const html = await readFile(resolve(ROOT, "cards.html"), "utf8");
  assert.ok(/game\/wild-arcade\.css/.test(html), "the sheet does not use the game's stylesheet");
  assert.ok(/<script src="game\/cards\.js"><\/script>/.test(html), "the sheet does not use the game's card builder");
  assert.ok(/paintCardFace/.test(html), "the sheet builds its own faces instead of calling the game's builder");
  for (const kind of ["skip", "reverse", "draw2", "wild4", "card-back"]) {
    assert.ok(html.includes(kind), `the sheet is missing the ${kind} card`);
  }

  // …and the game loads the same module, before the script that uses it.
  const wild = await readFile(resolve(ROOT, "wild.html"), "utf8");
  assert.ok(/<script src="game\/cards\.js"><\/script>/.test(wild), "wild.html never loads the card module");
  // Compared against a CALL, not a mention: the comment above the tag names the function
  // on purpose, and that is not the thing being ordered.
  assert.ok(wild.indexOf("game/cards.js") < wild.indexOf("cardFaceHtml("), "the module loads after its use");

  // All four call sites go through the one builder — the drift this replaces was four
  // separate faces, each knowing about a different subset of the sizes.
  assert.equal((wild.match(/cardFaceHtml\(/g) || []).length, 4,
    "a call site still assembles its own card face");

  const sw = await readFile(resolve(ROOT, "sw.js"), "utf8");
  assert.ok(/['"]\/game\/cards\.js['"]/.test(sw), "the card module is not precached, so offline faces lose their marks");
  assert.ok(/['"]\/assets\/fonts\/nunito-var\.woff2['"]/.test(sw), "the font is not precached, so offline type falls back");
});
