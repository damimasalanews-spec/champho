# CHAMP WORD repository audit

Date: 2026-11-28
Audited ref: main
Working branch: chore/repository-cleanup

## Safety status

This audit is observational. No existing application files were moved, deleted, or rewritten. The live deployment branch has not been changed.

## Verified application entry points

1. The repository-root `index.html` is the current lobby shell. It loads the lobby styles from `lobby/css/`, the JavaScript bootstrap from `lobby/js/app.js`, and the PWA helper from `game/pwa.js`.
2. `lobby/js/app.js` imports the screen modules and router.
3. `lobby/js/screens/play.js` defines the two game clients:
   - Classic: `game/` (served through `game/index.html`)
   - Go Wild: `go-wild-2v2-finished.html`
4. `lobby/js/gameframe.js` opens the selected client in a full-screen iframe.
5. `lobby/js/api.js` resolves the game URL and WebSocket endpoint. Its current comments contain references to an older `site/` layout and should be reviewed before path changes.

## Verified client dependencies

### Lobby
- HTML shell: `index.html`
- CSS: `lobby/css/tokens.css`, `base.css`, `components.css`, `screens.css`, `home.css`
- JavaScript: `lobby/js/` including app, router, store, API, game frame, and screen modules

### Classic
- Entry: `game/index.html`
- Main logic: `game/game.js`
- Styles: `game/styles.css`
- Supporting scripts loaded by the entry page: `game/sound.js`, `game/sketches.js`, `game/emojis.js`

### Go Wild
- Entry: `go-wild-2v2-finished.html`
- Main logic: `game/go-wild-2v2-finished.js`
- The entry page loads several dedicated stylesheets, including motion, coins, design, competition, moonlit redesign, final polish, poker-card fix, cinematic, and royal arena styles.
- Supporting scripts include `game/audio-cues.js`, `game/go-wild-2v2-motion.js`, `game/go-wild-2v2-coins.js`, and `game/pwa.js`.

## Documentation drift

- Root `README.md` describes a `site/` directory and `site/README.md`; the current tree instead has root `index.html` and `lobby/`.
- `lobby/README.md` also describes `site/`, `assets/js/`, and older table entry points such as `wild-play.html`. Its instructions do not accurately describe the current tree.
- These docs should be rewritten only after confirming the intended deployment and local development commands.

## Older or alternate clients requiring further investigation

The root also contains `classic.html`, `go-wild-2v2.html`, `wild.html`, `wild-play.html`, and `index-legacy.html`. Their existence does not prove they are safe to delete. Search all links, redirects, service-worker caches, manifest references, tests, and deployment paths before classifying any as obsolete.

## Large stylesheet investigation

The earlier tree inventory identified large legacy `style-part-*.css` files. Their presence and size alone do not prove they are unused or duplicates. Before removal, trace references from all HTML, JavaScript, CSS imports, service-worker precache lists, and any build/deployment scripts.

## Deployment caution

The user reports that the Render dashboard is configured to deploy from `main`. The repository's `render.yaml` currently specifies `redesign/authoritative-classic`. Treat the dashboard configuration and Blueprint file as a discrepancy to resolve; do not apply the Blueprint or change deployment settings during repository cleanup.

## Next audit steps

1. Enumerate all HTML entry points and map every local script, stylesheet, image, audio, manifest, and worker reference.
2. Inspect service-worker and PWA cache paths.
3. Inspect server static-file routing and build output assumptions.
4. Compare candidate duplicate/legacy files by content and reference graph.
5. Produce a proposed move/delete matrix with evidence and test plan before restructuring.
