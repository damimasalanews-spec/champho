import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { LETTER_VALUES, letterValue, scoreHand, type Card, type CardKind } from "../cards.js";

/**
 * The scoring console is a page for checking the maths, so the one thing that must
 * never happen is the page and the server disagreeing about the maths.
 *
 * score.html is a static page with no build step, so it carries its own copy of the
 * scoring table — and a copy can drift. These tests are the guard: they read the
 * table out of the page and hold it against server/cards.ts, so changing a letter's
 * value or a bucket's worth on the server fails here instead of quietly making the
 * console lie.
 *
 * The buckets are asserted through scoreHand rather than by reading constants out of
 * it: scoreHand is what actually scores a round, and it is the behaviour that has to
 * agree with the page, not the shape of the source.
 */

const here = dirname(fileURLToPath(import.meta.url));
const PAGE = join(here, "..", "..", "score.html");

const page = readFileSync(PAGE, "utf8");

/** The table, as the page itself declares it. */
function readScoringBlock() {
  const start = page.indexOf("const SCORING = {");
  assert.notEqual(start, -1, "score.html must declare a SCORING block for this test to read");
  const end = page.indexOf("\n  };", start);
  assert.notEqual(end, -1, "the SCORING block must be closed");
  const source = page.slice(start, end + 4);
  // It is a literal, so evaluating it is safe and keeps this test from re-implementing
  // a parser for it. Anything executable in there would be a mistake worth failing on.
  // eslint-disable-next-line no-new-func
  return new Function(`${source}; return SCORING;`)() as {
    letters: Record<string, number>;
    letterFallback: number;
    actionPoints: number;
    wildPoints: number;
  };
}

const card = (kind: CardKind, value = ""): Card => ({ cardId: `${kind}-x`, value, color: null, kind });

test("the console scores letters by the server's own table", () => {
  const { letters } = readScoringBlock();
  assert.deepEqual(
    Object.keys(letters).sort(),
    Object.keys(LETTER_VALUES).sort(),
    "the page must cover exactly the letters the server prices, no more and no fewer"
  );
  for (const [letter, value] of Object.entries(LETTER_VALUES)) {
    assert.equal(letters[letter], value, `the page prices "${letter}" as ${letters[letter]}, the server as ${value}`);
  }
});

test("the console falls back the way letterValue does", () => {
  const { letterFallback } = readScoringBlock();
  // letterValue() answers 5 for anything it does not list — including the symbols the
  // deck uses for action cards, which is why this fallback is not hypothetical.
  for (const unlisted of ["?", "~", "1", "9", ""]) {
    assert.equal(letterValue(unlisted), letterFallback, `letterValue("${unlisted}") must be the fallback the page uses`);
  }
});

test("the console's two buckets are the server's two buckets", () => {
  const { actionPoints, wildPoints } = readScoringBlock();

  for (const kind of ["skip", "reverse", "draw2"] as CardKind[]) {
    assert.equal(scoreHand([card(kind)]), actionPoints, `${kind} must be worth the page's action value`);
  }
  for (const kind of ["wild", "wild4", "discardAll"] as CardKind[]) {
    assert.equal(scoreHand([card(kind)]), wildPoints, `${kind} must be worth the page's wild value`);
  }
});

test("a whole hand scores the same on the page and on the server", () => {
  const { letters, actionPoints, wildPoints } = readScoringBlock();

  const hand: Card[] = [
    ...Array.from("cymbal", (ch) => card("letter", ch)),
    card("skip"),
    card("wild4")
  ];

  // the page's arithmetic, exactly as its script does it
  let fromPage = 0;
  for (const ch of "cymbal") fromPage += letters[ch] ?? 0;
  fromPage += 1 * actionPoints + 1 * wildPoints;

  assert.equal(fromPage, scoreHand(hand), "scoreHand and the page must agree on a mixed hand");
});

test("the page links no second copy of the rules", () => {
  // One table in the page, and it is the one read above. A second would be a second
  // place for the numbers to be wrong.
  const declares = page.match(/const SCORING = \{/g) ?? [];
  assert.equal(declares.length, 1, "exactly one SCORING table in the page");
});
