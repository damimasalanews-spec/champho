# Classic mode — letter-card UNO format

Spec agreed 2026-09-23. Implemented on the `cards-on-board` branch: the rules live in
`server/cards.ts` and `server/round.ts`, the table in `server/round-engine.ts`, and the
board in `classic.html`.

## 1. Summary

Classic mode keeps the official UNO format, with one substitution: **numbers 0–9 become letters**. Each player's opening hand of 7 cards always spells one real 7-letter word. Everything else follows the official ruleset — the same four colours, the same action cards, the same "say UNO" rule, the same scoring race to 500.

| Official UNO | Classic mode here |
|---|---|
| Colours red, yellow, green, blue | Same, unchanged |
| One `0` + two each of `1`–`9` per colour (19 number cards) | 19 **letter** cards per colour |
| 2 Skip, 2 Reverse, 2 Draw Two per colour | Same, per colour |
| 4 Wild, 4 Wild Draw Four | Same, uncoloured |
| — | + 1 **Discard All** per colour |
| Deal 7 cards at random | Deal 7 cards that **spell a 7-letter word** |
| Match colour, number or symbol | Match colour, **letter** or symbol |
| First to empty their hand wins the round | Same |
| First to 500 points wins the game | Same |

## 2. Deck — 112 cards

26 cards per colour × 4 colours = 104, plus 8 uncoloured.

| Card | Per colour | Total |
|---|---|---|
| Letter card | 19 | 76 |
| Skip | 2 | 8 |
| Reverse | 2 | 8 |
| Draw Two | 2 | 8 |
| Discard All | 1 | 4 |
| Wild (uncoloured) | — | 4 |
| Wild Draw Four (uncoloured) | — | 4 |
| | | **112** |

112 = UNO's classic 108 plus the 4 Discard All cards. Colour counts stay even at 26 each, so no colour runs out before the others.

## 3. The deal

The deal is constructed, not a plain shuffle — that is what guarantees the word.

1. Pick four **distinct** 7-letter words from the word pool, one per seat.
2. Those 28 letters become the four opening hands (7 each). Colour is assigned round-robin across the four colours, so each seat holds roughly two cards of each colour.
3. Complete the letter cards to 76 by drawing more letters from the pool, again balanced 19 per colour.
4. Add the action cards: 2 Skip, 2 Reverse, 2 Draw Two and 1 Discard All per colour, plus 4 Wild and 4 Wild Draw Four.
5. Shuffle. Deal 7, leaving 84 in the draw pile.

**Invariant:** an opening hand contains letter cards only. No action card is ever dealt, so a hand always spells a real word. Action cards arrive by drawing.

**First card:** turn up cards from the draw pile until a letter card appears, so the first player has a letter to match. If that pile runs out, reshuffle.

## 4. Turn flow

Play moves clockwise from the first seat; Reverse flips the direction.

On your turn, do one of:

- **Play a card** that matches the top of the discard pile by **colour**, by **letter**, or by **symbol**.
- **Play a Wild or Wild Draw Four**, which may go on anything (Wild Draw Four has an extra restriction, below).
- **Draw one card.** If the card you draw is playable you may play it at once; otherwise your turn passes.

Cannot move, and the draw pile is empty? Reshuffle the discard pile, keeping its top card, and draw from that.

## 5. Card behaviour

| Card | Effect |
|---|---|
| Letter | A normal card. Its colour must match the current colour, or its letter must match the letter on top of the pile. |
| Skip | The next player loses their turn. |
| Reverse | Play reverses direction. With two players it acts as a Skip. |
| Draw Two | The next player draws 2 cards and loses their turn. |
| Discard All | A coloured card. Play it to discard every other card of that colour from your hand. |
| Wild | Playable on anything. The player names the colour that continues. |
| Wild Draw Four | Playable on anything. Names the colour, and the next player draws 4 and loses their turn. |

**Wild Draw Four restriction (official).** You may only play it when you hold **no card of the current colour**. The next player may **challenge**:

- You held a matching colour after all (guilty) — you draw 4.
- You had no matching colour (innocent) — the challenger draws 6.

## 6. Saying UNO

When you play your second-to-last card you must call UNO. If another player catches you before the next player takes their turn, you draw 2.

## 7. Round end and scoring

The round ends the moment a player plays their last card. That player scores the total value of every opponent's remaining cards:

| Card | Value |
|---|---|
| Letter | the letter's printed value (table below) |
| Skip, Reverse, Draw Two | 20 |
| Discard All | 50 |
| Wild, Wild Draw Four | 50 |

Letter values follow rarity, so common letters are cheap and awkward ones cost more — the same idea as "number cards score face value".

| Value | Letters |
|---|---|
| 1 | E A I O T N S R |
| 2 | L U D G B C M P |
| 3 | F H V W Y |
| 4 | K J |
| 5 | X |
| 6 | Q Z |

First player to **500** points wins the game. Points are cumulative across rounds.

## 8. Word pool

- A curated list of common 7-letter English words, one per line, `A`–`Z` only.
- Every word in the pool must be spellable from the deck's letter multiset. This is checked at build time, so an unspellable word fails loudly rather than producing an impossible deal.
- A single deal never uses the same word twice.

## 9. Decisions taken (easy to change)

- 112-card deck, with Discard All added at 1 per colour.
- Letter values by rarity, as tabulated above.
- Opening hands are letters only; action cards arrive by drawing.
- Four seats, matching the current table: you plus three opponents.
- The word is a *themed opening hand* — the win condition stays official UNO (empty your hand), so the word shapes your start rather than being a target to spell.

## 10. Current state of the card table

Verified on `main` at `6afbae2`:

- The card table markup is real and complete: `<section id="game" class="screen hidden">` in `index.html`, containing `#discard`, `#hand`, `#colorHint`, `#eventBanner`, `#tableFlash` and the mode cards.
- **No engine is wired to it.** The page's inline scripts (66 KB + 28 KB + 11 KB) contain no card logic at all — no `legal()`, no `playCard`, no turn handling. Nothing calls `show('game')`.
- The readable engine at the repo root, `game.js` (132 KB), targets exactly these element ids (`colorHint`, `eventBanner`, `tableFlash`, `colorModal`, `discard`, `hand`) and does contain colour/word matching, Wild and Wild Draw Four with a challenge. It is referenced by no page, on either branch.
- `index.html` embeds its CSS as gzip+base64 blobs, but embeds no JavaScript beyond a 372-byte stub. There is no build script in the repo, so `index.html` is effectively hand-maintained.
- `firebase.js` still holds `YOUR_API_KEY` placeholders and the Cloud Functions sources are not in this repo, so online rooms cannot run.

So this is not a change to a working mode — it is the first engine behind the table.

## 11. Build plan

1. Rules core: deck construction, word-validated deal, legality, action resolution, direction, draw-pile recycling, UNO call, scoring — as a testable module.
2. Table UI: render `#hand`, `#discard`, `#colorHint`, `#eventBanner` and the scoreboard inside the existing `#game` markup; colour chooser; UNO button.
3. Wire it up: the app's home buttons call `window.startGame()`, and reveal `#game` when that is missing. Export `window.startGame` and drive the screen.
4. Bot opponents, paced so a bot cannot finish before the player has looked at their hand.
5. Verify locally, then PR so CI runs, then deploy and check on the live URL.

The engine targets the local/offline path so Classic mode is playable immediately. Server-backed rooms need the Firebase project values, which is the existing open item.
