# Champ Word — lobby rewrite (v4.0)

A ground-up rebuild of the **website and lobby**: landing, home, play, shop, events,
season pass, leaderboard, profile, social, settings and private-room screens.

The **card table itself is not touched**. `wild-play.html` and `game/` are the same
files as before, and the lobby hands off to them in a full-screen frame.

---

## Why it was rebuilt

The previous front end was one `index.html` of 517 KB plus `style-part-1/2/3.css`
totalling 3.1 MB, of which `style-part-2.css` alone was 2.6 MB of base64 blobs.
Screens were driven by full-bleed artwork with **invisible percentage-positioned
hit layers** (`left:42.26%;top:47.13%;width:3%`), so:

- every new control meant re-measuring the artwork,
- the layout only held at one aspect ratio (mobile landscape), and
- nothing could reflow, zoom or respond to a keyboard.

This rewrite replaces that with semantic markup, a token-based design system and
fluid layout. No screen depends on a measured pixel position.

| | before | after |
|---|---|---|
| HTML | 517 KB, one file | 9 KB shell + screen modules |
| CSS | 3.1 MB (2.6 MB base64) | ~56 KB, 4 files |
| Images | 2.6 MB background PNG | SVG/CSS only, zero bitmaps |
| Layout | landscape-locked artwork | phone, tablet, desktop, portrait |
| Navigation | hidden sections | real hash routes, back button |
| Controls | tap layers over a picture | buttons, links, switches, dialogs |

---

## Run it

The client is ES modules, so it needs an HTTP origin (not `file://`):

```powershell
# from the repository root
python -m http.server 8792
# then open http://127.0.0.1:8792/site/
```

`npm run dev` works too — the Node server serves the repository root, so
`http://localhost:8787/site/` reaches it the same way.

---

## Structure

```
site/
  index.html               app shell: rail, topbar, tabbar, main, toasts
  assets/
    css/
      tokens.css           colour, type, space, motion, elevation — one source
      base.css             reset, typography, scenery, shell layout
      components.css       buttons, panels, pills, avatar, progress, forms,
                           dialog, toasts, skeletons, rarity
      screens.css          per-screen compositions (hero, modes, shop, pass…)
    img/favicon.svg
    js/
      app.js               boot: routes, shell sync, account menu, notifications
      router.js            hash router (aria-current, crumbs, title, focus)
      store.js             one state object, persisted, subscribe
      data.js              demo content (players, ladder, missions, tiers)
      api.js               transport: live WebSocket or local simulation
      ui.js                icons, formatting, toasts, dialogs, reveal
      gameframe.js         hands off to wild-play.html
      nav.js
      screens/*.js         one module per screen
```

---

## Routes

| Route | Screen |
|---|---|
| `#/home` | Hero, player strip, four modes, open tables, daily reward, progress |
| `#/play/classic`, `#/play/wild` | Mode + queue, which ends in "Enter table" |
| `#/shop` | Style store: characters, frames, effects |
| `#/events` | Daily and weekly missions, live events |
| `#/pass` | Season track, claimable tiers |
| `#/ranks` | Podium, standings, "your rank" |
| `#/profile` | Player card, standing, medals, collection |
| `#/social` | Friends, party, server state |
| `#/settings` | Sound, display, privacy, connection, account |
| `#/room` | Join by six-character code, or open a table |
| `#/welcome` | Entry screen (guest seat) |

Deep links work: `#/play/wild` opens that mode directly. The back button moves
between screens, and each route sets its own document title and breadcrumb.

---

## The five games

The "Five ways to play" section mirrors the deployed home card for card. Each
card opens the client it names, not a stand-in:

| Card | Opens |
|---|---|
| **Word UNO** — classic mode | `game/` — the classic word-grid client |
| **Go Wild** — +2 · +4 · wild | `go-wild-2v2-finished.html` — 7×6 word grid, 2v2 |
| **UNO Fun Pack** — no mercy | no separate build exists yet; the card says "Coming soon" and offers the classic table |
| **UNO Contest** | `#/ranks` — the season ladder, inside the lobby |
| **Play with Friends** | `#/room` — private table and code entry |

The Fun Pack has no client of its own in this repository — the deployed home
opens the classic table for that card, silently. `MODES` in `data.js` carries a
`pending` flag so the card says so instead. When a No Mercy build ships, point
`MODES.fun.game` at it and drop the flag.

Quick play on the hero opens Word UNO directly, which is what the deployed home
does; matchmaking for the same two clients is still reachable from **Play**.

## Data and the live server

`assets/js/api.js` is the only place that talks to the backend.

- On boot it opens a socket, sends `{type:"hello", mode:"cards"}`, and waits for
  `welcome`. That single handshake decides whether the queue is real.
- `findMatch()` sends `{type:"find_match", sessionToken, displayName}` and resolves
  on `match_found`. Cancelling sends `disconnect` and leaves the queue.
- If no server answers within 4.5 s — which is the current situation, the Render
  service `champword-classic` is suspended — the same interface is served from a
  local simulation, and the UI says so in words rather than pretending.

Override the endpoint when testing:

```
?backend=localhost:8787      # point at a local server
?backend=mock                # force the simulation
?game=../                    # where wild-play.html lives
```

Everything else on screen (coins, cosmetics, tiers, missions) is demo content in
`data.js`, stored per browser in `localStorage` under `champword.lobby.v2`. When
the accounts API exists, `store.js` is the only file that needs to change.

---

## Handing off to the table

`gameframe.js` opens `wild-play.html` in a fixed, full-viewport frame with a
"Leave table" bar. The path is resolved at runtime:

```js
const GAME_DIR = new URLSearchParams(location.search).get('game')
  ?? (location.pathname.includes('/site/') ? '../' : './');
```

so the lobby works both from `/site/` today and from the repository root if it is
promoted later. The table keeps its own socket, seats and round state.

---

## Deploying

Preview as-is: GitHub Pages serves `https://<user>.github.io/champho/site/`
with no configuration — everything is static and relative.

To make it the root of the site, either

1. **move it**: `git mv site/* .` (keep `site/README.md`), or
2. **serve it from Node**: in `server/static.ts`, map `/` to `/site/index.html`
   instead of `/index.html`.

Option 2 is one line and leaves the legacy page in place for comparison:

```ts
if (urlPath === "/" || urlPath === "/index.html") return "/site/index.html";
```

Either way `wild-play.html` stays where it is.

---

## Accessibility and performance

- Semantic landmarks, one `<h1>` per screen, skip link, visible focus rings.
- The rail/tabbar mark the current screen with `aria-current="page"`.
- Dialogs are native `<dialog>`: Esc, focus trap and inert background come from
  the platform.
- Toasts are announced through a polite live region; the queue panel is `aria-live`.
- `prefers-reduced-motion` is honoured, and Settings adds an independent
  "Motion & animation" switch that writes `data-motion` on `<html>`.
- No bitmap images, no web fonts beyond two families with `display=swap`, no
  build step. First paint needs one HTML file, four CSS files and one JS module.

---

## Deliberately not done

- **The card table.** Out of scope by agreement; `wild-play.html`, `game/` and
  `go-wild-2v2-*` are untouched.
- **Accounts.** `#/welcome` creates a local guest seat. Email sign-in needs the
  server's identity endpoints.
- **PWA icons and service worker** for the new shell. `manifest.json` and `sw.js`
  still describe the old page; regenerate them when the lobby moves to the root.
- **Server-side matchmaking changes.** The lobby speaks the existing protocol; it
  does not extend it.
