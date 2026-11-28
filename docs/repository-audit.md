# CHAMP WORD repository audit

Date: 2026-11-28
Audited ref: main
Working branch: chore/repository-cleanup

## Safety status

This audit is observational. No existing application files were moved, deleted, or rewritten. The live deployment branch has not been changed.

## Verified application entry points

1. The repository-root `index.html` is the current lobby shell. It loads lobby styles from `lobby/css/`, the JavaScript bootstrap from `lobby/js/app.js`, and the PWA helper from `game/pwa.js`.
2. `lobby/js/app.js` imports the screen modules and router.
3. `lobby/js/screens/play.js` defines the two game clients:
   - Classic: `game/` (served through `game/index.html`)
   - Go Wild: `go-wild-2v2-finished.html` (the 7×6 word-grid client)
4. `lobby/js/gameframe.js` opens the selected client in a full-screen iframe.
5. `lobby/js/api.js` resolves the game URL and same-origin WebSocket endpoint. Its comments still describe the older `site/` layout and an older `wild-play.html` handoff; preserve the executable route behavior while correcting comments.

## Verified client dependencies

### Lobby
- HTML shell: `index.html`
- CSS: `lobby/css/tokens.css`, `base.css`, `components.css`, `screens.css`, `home.css`
- JavaScript: `lobby/js/`, including app, router, store, API, game frame, and screen modules

### Classic
- Entry: `game/index.html`
- Main logic: `game/game.js`
- Styles: `game/styles.css`
- Supporting scripts loaded by the entry page include `game/sound.js`, `game/sketches.js`, and `game/emojis.js`.

### Go Wild
- Entry: `go-wild-2v2-finished.html`
- Main logic: `game/go-wild-2v2-finished.js`
- The page loads dedicated stylesheets for motion, coins, design, competition, moonlit redesign, final polish, poker-card fixes, cinematic activity, and royal arena layout.
- The main module imports `game/english-word-bank.js` and `game/word-grid-rules.js`; these are runtime dependencies and must remain resolvable if the tree is reorganized.
- Supporting scripts include `game/audio-cues.js` and `game/go-wild-2v2-motion.js`.

## Documentation drift

- Root `README.md` describes a `site/` directory and `site/README.md`, but the current app shell is at the repository root and screens live under `lobby/`.
- `lobby/README.md` also describes `site/`, `assets/js/`, and older table entry points such as `wild-play.html`. Its instructions do not accurately describe the current root-level lobby and game-mode routing.
- Correct the documentation after confirming the intended local development and deployment commands.

## PWA and offline compatibility findings

- `game/pwa.js` registers the root service worker at `/sw.js` with scope `/`.
- The current service-worker cache version is `v17`.
- Its install-time shell list still includes older entry pages such as `/classic.html`, `/wild.html`, and `/wild-play.html`.
- The current lobby launches Classic from `/game/` and Go Wild from `/go-wild-2v2-finished.html`. The Go Wild entry page, main module, word-bank/rules imports, and dedicated stylesheets are not in the install-time shell list. Runtime caching may cache them after an online visit, but a fresh installation is not guaranteed to have the current Go Wild client available offline immediately.
- `manifest.json` shortcuts still point to `/classic.html` and `/wild-play.html`, not the current lobby's mode entry points. Those legacy pages still exist, so this is a route-consistency issue—not proof that they can be deleted.
- Before changing service-worker paths, test installation, updates, offline first launch, offline repeat launch, and both game modes. Change the cache version only alongside a tested cache-list update.

## Older or alternate clients requiring investigation

The root also contains `classic.html`, `go-wild-2v2.html`, `wild.html`, `wild-play.html`, and `index-legacy.html`. Their existence does not prove they are safe to delete. Search all links, redirects, service-worker caches, manifest references, tests, and deployment paths before classifying any as obsolete.

## Large stylesheet investigation

The earlier tree inventory identified large legacy `style-part-*.css` files. Their presence and size alone do not prove they are unused or duplicates. Trace references from HTML, JavaScript, CSS imports, service-worker precache lists, tests, and deployment scripts before removal.

## Deployment caution

The user reports that the Render dashboard is configured to deploy from `main`. The repository's `render.yaml` specifies `redesign/authoritative-classic`. Treat the dashboard and Blueprint as a discrepancy to resolve; do not apply the Blueprint or change deployment settings during repository cleanup.

## Next steps

1. Enumerate all HTML entry points and map every local script, stylesheet, image, audio, manifest, and worker reference.
2. Inspect server static-file routing and build output assumptions.
3. Compare candidate duplicate/legacy files by content and reference graph.
4. Produce a proposed move/delete matrix with evidence and a test plan before restructuring.
5. Make only small, reversible organization changes on this branch and validate both game modes before considering a merge.


## Follow-up dependency map — 2026-11-28

Audited working-branch snapshot: `chore/repository-cleanup` at `4ffd3a9168a41eb5929fe8ee537df05ce9f51ad9`.

### Current launch and runtime paths

```text
/ (index.html)
  ├─ lobby/css/{tokens,base,components,screens,home}.css
  ├─ lobby/js/app.js
  │    ├─ store.js, api.js, ui.js, data.js, router.js, nav.js
  │    └─ screens/{home,play,shop,events,pass,ranks,profile,social,
  │                 settings,room,welcome}.js
  └─ game/pwa.js → registers /sw.js

Play screen
  ├─ Classic → /game/ → game/index.html
  │    ├─ game/styles.css
  │    └─ game/{sound,sketches,emojis,game}.js
  └─ Go Wild → /go-wild-2v2-finished.html
       ├─ game/go-wild-2v2-{motion,coins,design,competition,
       │                    moonlit-redesign,final-polish,
       │                    poker-card-fix,cinematic,royal-arena}.css
       ├─ game/go-wild-2v2-finished.js
       │    ├─ game/english-word-bank.js
       │    └─ game/word-grid-rules.js
       └─ game/{audio-cues,go-wild-2v2-motion,go-wild-2v2-coins,pwa}.js
```

The lobby's `gameframe.js` loads the selected client in a full-screen iframe. The play screen's mode definitions—not the older README descriptions—are the authoritative mapping for the current Classic and Go Wild clients.

### Server and build path

- `package.json` requires Node.js 22 or newer. `npm run dev` runs `tsx watch server/main.ts`; `npm run build` compiles TypeScript; `npm start` runs `dist/server/main.js`; `npm test` runs the server test suite.
- `server/main.ts` runs migrations and starts `server/index.ts`.
- `server/index.ts` handles the HTTP and WebSocket server and delegates static requests to `server/static.ts`.
- `server/static.ts` serves files from the repository root, maps `/` and `/index.html` to the current lobby, maps `/legacy.html` to that same lobby, and resolves directory requests such as `/game/` to that directory's `index.html`.
- The lobby derives its WebSocket endpoint from the same origin by default. Keep the lobby and backend on the same host unless a deliberate deployment change is planned.

### HTML reference check

All 13 tracked HTML documents were inspected for literal local `src` and `href` references. No missing local file reference was found. Three directory-prefix references in `index-legacy.html` (`assets/titles/`, `assets/avatars/`, and `assets/effects/`) are used for dynamic asset loading; they are not missing individual files.

### Confirmed cleanup cautions

- `lobby/js/api.js` and `lobby/js/gameframe.js` contain comments describing the old `site/` and `wild-play.html` layout. Their executable path logic currently supports the root lobby and the current game clients; update comments separately without changing behavior.
- `manifest.json` shortcuts still open `/wild-play.html` and `/classic.html`. Both files exist, but these are not the two current lobby mode entry points.
- `sw.js` still pre-caches the older `classic.html`, `wild.html`, and `wild-play.html` routes. It does not pre-cache the current Go Wild HTML entry, its main module, word-bank/rules modules, or its dedicated stylesheets. Runtime caching may fill these after an online visit; first-install offline availability is therefore not guaranteed.
- The old/alternate HTML pages and root-level `style-part-*.css` files remain in place. No deletion or move is justified by this dependency pass alone.

This follow-up is still observational. No game, server, deployment, manifest, service-worker, or asset files were changed.
