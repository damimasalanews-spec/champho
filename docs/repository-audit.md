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
