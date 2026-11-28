# CHAMP WORD

CHAMP WORD is a browser-based multiplayer word game with a lobby and two playable clients: **Classic** and **Go Wild**. The Node.js server serves the web app and provides the HTTP health endpoint, PostgreSQL-backed game services, matchmaking, and WebSocket connections from the same origin.

> Repository cleanup is in progress on `chore/repository-cleanup`. Keep application and deployment changes separate from documentation cleanup until the verification plan has passed.

## Current application layout

```text
/
├── index.html                    # Current lobby entry point
├── lobby/
│   ├── css/                      # Lobby design system and screen styles
│   └── js/                       # Lobby app, routing, screens and API adapter
├── game/
│   ├── index.html                # Classic game entry point (/game/)
│   ├── game.js                   # Classic game client
│   └── ...                       # Classic and shared game assets/modules
├── go-wild-2v2-finished.html     # Go Wild game entry point
├── server/
│   ├── main.ts                   # Migrations, then server startup
│   ├── index.ts                  # HTTP + WebSocket application
│   └── static.ts                 # Root-relative static file serving
├── db/                           # PostgreSQL migrations
├── sw.js                         # Root-scope service worker
├── manifest.json                 # PWA manifest
└── capacitor.config.json         # Android/Capacitor wrapper configuration
```

### How the app opens

- Visiting `/` serves the root `index.html` lobby.
- The lobby's Play screen opens Classic at `/game/`.
- The lobby's Play screen opens Go Wild at `/go-wild-2v2-finished.html`.
- `lobby/js/gameframe.js` displays the selected game client in a full-screen frame.
- The browser client and server use the same origin for WebSocket communication by default.

Several older HTML entry points remain in the repository for compatibility or historical use. Do not delete them solely because the current lobby does not link to them; check the manifest, service worker, mobile wrapper, external links and deployment paths first.

## Requirements

- Node.js 22 or newer
- npm
- PostgreSQL
- A database URL available as `DATABASE_URL`

## Local setup

From the repository root:

```bash
npm install
cp .env.example .env
```

Edit `.env` and set `DATABASE_URL` to a PostgreSQL database you can use for development. The example file uses a local database named `champword`; create that database and matching role locally, or replace the URL with your own development database.

Start the development server:

```bash
npm run dev
```

Open:

```text
http://localhost:3000/
```

The server runs the database migrations before listening. Do not point local development at the production database unless you intentionally mean to run migrations against it.

## Available scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Run the TypeScript server with watch/restart |
| `npm run typecheck` | Type-check server TypeScript without emitting files |
| `npm test` | Run the server test suite |
| `npm run build` | Compile the server into `dist/` |
| `npm start` | Start the compiled server from `dist/server/main.js` |

The production build needs the development dependencies during compilation because TypeScript and Node/PostgreSQL type definitions are in `devDependencies`.

## Server and database

- `server/main.ts` runs migrations, then starts the application.
- `server/index.ts` creates the HTTP server and WebSocket server.
- `server/static.ts` serves the repository root and maps directory requests to their `index.html`.
- `server/config.ts` reads `HOST`, `PORT`, and the required `DATABASE_URL`.
- SQL migrations are versioned under `db/` and listed in `server/migrations.ts`.

The `/health` endpoint checks database connectivity as well as server health. The game requires a long-lived Node web service; a static-only hosting target cannot provide the multiplayer WebSocket backend.

## Deployment notes

The repository contains a Render Blueprint in `render.yaml`. It currently names the service `champword-classic` and specifies the branch `redesign/authoritative-classic`. Before changing deployment settings or applying the Blueprint, verify the actual Render service's configured branch, environment variables, database attachment and current production state.

Do not change the deployment branch, apply the Blueprint, or merge this cleanup branch as part of documentation work.

## PWA and Android

- `game/pwa.js` registers the root-scope service worker `/sw.js`.
- `sw.js` controls navigation, code and art caching.
- `manifest.json` defines the installable web app and legacy shortcuts.
- `capacitor.config.json` sets `mobile/www` as the web directory and currently configures Android to load the GitHub Pages URL remotely.

The manifest shortcuts and service-worker shell still contain older routes. Review and test PWA install, update and offline behavior before changing those paths. The Android wrapper's remote origin and WebSocket behavior also need to be verified on an installed build before changing its configuration.

## Cleanup policy

This repository has legacy entry points, large historical stylesheets, mobile resources and some byte-identical platform assets. A duplicate file or an unreferenced-looking stylesheet is not automatically safe to remove. Before moving or deleting anything:

1. Trace HTML, CSS, JavaScript, manifest and service-worker references.
2. Check server routing, Android/Capacitor packaging and external entry points.
3. Make one small, reversible change on the cleanup branch.
4. Run typecheck, tests and build, then smoke-test both game modes and WebSocket matchmaking.
5. Keep production deployment configuration untouched until explicitly verified.

See [`docs/repository-audit.md`](docs/repository-audit.md) for the ongoing inventory, dependency findings and cleanup decisions.
