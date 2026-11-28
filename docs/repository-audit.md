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


## Follow-up legacy and duplicate-file triage — 2026-11-28

### Exact duplicate blobs

The Git tree contains three groups of byte-identical files:

| Files | Size | Initial interpretation |
|---|---:|---|
| `android/app/src/main/res/drawable-land-mdpi/splash.png` and `android/app/src/main/res/drawable/splash.png` | 30,455 bytes each | Android resource variants; retain both unless Android packaging is deliberately reworked. |
| `android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml` and `ic_launcher_round.xml` | 265 bytes each | Android launcher resource names may be referenced by platform configuration; retain both. |
| `offline.html` and `mobile/www/offline.html` | 3,599 bytes each | Root web app fallback and Capacitor web bundle copy; retain both until the mobile packaging workflow is verified. |

Identical content does not mean interchangeable paths. No duplicate was deleted.

### Root-level stylesheet candidates

The root contains `style.css` (about 503 KB), `style-part-1.css` (about 96 KB), `style-part-2.css` (about 2.73 MB), and `style-part-3.css` (about 406 KB).

- None of the 13 HTML documents directly links to these root-level stylesheets by filename.
- The current lobby and game clients use their own stylesheets under `lobby/css/` and `game/`.
- `index-legacy.html` contains a large embedded/decompressed legacy application and does not show a normal stylesheet link to these root-level files in its HTML references.
- The repository fetch operation returned no readable content for the 2.73 MB `style-part-2.css` file, so its internal imports and selectors could not be inspected in this pass.
- This is evidence to investigate, not sufficient proof that the root stylesheets are unused. Dynamic references, historical routes, mobile packaging, or external entry points must be ruled out before any removal.

### Triage decision

No application file is approved for deletion or relocation yet. Next, inspect the legacy page's embedded loader and the Android/Capacitor packaging inputs, then build a complete reference matrix for the large root stylesheets and alternate HTML entry points. Only after that should we propose a reversible move/delete list.


### Mobile wrapper origin check

- `capacitor.config.json` sets `webDir` to `mobile/www`, but configures the Android wrapper to load `https://damimasalanews-spec.github.io/champho/` remotely.
- `mobile/www/README.md` says the remote-site approach is intentional because the game socket is derived from `location.host`.
- The lobby's default WebSocket URL is indeed same-origin. A GitHub Pages origin does not, by itself, establish that the Render WebSocket backend is reachable at that same host.
- Treat this as a configuration risk to verify on an installed Android build. Do not change `server.url` or replace it with the Render URL until the intended production mobile origin and WebSocket routing are confirmed.


## Follow-up deployment, documentation and runtime findings — 2026-11-28

### Confirmed source-of-truth conflicts

1. `README.md` still says the lobby lives in `site/` and directs readers to `/site/`. The live tree and static server instead use root `index.html` and `lobby/`.
2. `lobby/README.md` describes the old split-folder deployment, says the lobby hands off to `wild-play.html`, and contains stale deployment instructions. Current mode routing in `lobby/js/screens/play.js` points Classic to `game/` and Go Wild to `go-wild-2v2-finished.html`.
3. `lobby/js/api.js` has old `site/` / `wild-play.html` explanatory comments even though its executable URL resolution supports the current root layout.
4. `sw.js` and `manifest.json` retain legacy app-shell routes and shortcuts. The legacy pages still exist, so this is a migration/consistency issue, not a safe deletion opportunity.

### Deployment branch discrepancy

- `render.yaml` explicitly sets the Render web service branch to `redesign/authoritative-classic`.
- The cleanup work is on `chore/repository-cleanup`; the previously reported dashboard setting was `main`.
- These three branch references do not agree. No deployment configuration was changed. Before merging or applying a Blueprint, verify the actual Render service's configured branch and whether it is managed by this Blueprint. Do not apply the Blueprint as part of file cleanup.

### Mobile packaging

- Capacitor's `webDir` is `mobile/www`, but the Android app is configured to load the GitHub Pages URL remotely.
- The mobile README says this is intentional. Keep this arrangement unchanged until the actual production WebSocket origin is verified on an installed build.

### Safe next implementation order

1. Update documentation only: rewrite root `README.md` and `lobby/README.md` to reflect the current root lobby, real game entry points, Node 22 requirements, scripts, same-origin WebSocket, and current deployment caveats.
2. Correct stale comments in `lobby/js/api.js` without changing executable logic.
3. Separately review PWA shortcuts and service-worker pre-cache against the current game entry points. Treat this as a behavior change and test install/update/offline behavior before merging.
4. Do not move/delete the root stylesheets, legacy HTML pages, mobile assets, or duplicate platform resources until their consumers and packaging paths are fully proven.
5. Run `npm ci`, `npm run typecheck`, `npm test`, and `npm run build` in a clean checkout; then smoke-test lobby, Classic, Go Wild, WebSocket matchmaking, and mobile wrapper. These commands have not been executed by this remote repository inspection.

No application source, deployment settings, mobile configuration, or live branch was modified in this audit pass.
