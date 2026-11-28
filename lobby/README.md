# CHAMP WORD lobby

This directory contains the current lobby's presentation and client-side application modules. The lobby's HTML entry point is the repository-root `/index.html`, not an HTML file inside `lobby/`.

## Current launch flow

```text
/index.html
  ├── lobby/css/
  ├── lobby/js/app.js
  │     ├── shared modules: store, api, ui, data, router, nav
  │     └── screens/: home, play, shop, events, pass, ranks,
  │                    profile, social, settings, room, welcome
  └── game/pwa.js → /sw.js

Play screen
  ├── Classic → /game/ → game/index.html
  └── Go Wild → /go-wild-2v2-finished.html
```

The lobby's `gameframe.js` opens the selected game client in a full-screen frame. The mode-to-client mapping lives in `lobby/js/screens/play.js`; update that mapping deliberately if a game entry point changes.

## Directory map

```text
lobby/
├── css/
│   ├── tokens.css       # Shared design tokens
│   ├── base.css         # Reset, typography and shell foundations
│   ├── components.css   # Reusable interface components
│   ├── screens.css      # Screen-level layout rules
│   └── home.css         # Home screen styles
└── js/
    ├── app.js           # Lobby boot and screen registration
    ├── api.js           # Same-origin WebSocket adapter and game URL helper
    ├── data.js          # Lobby content and mode metadata
    ├── gameframe.js     # Full-screen game handoff
    ├── nav.js           # Navigation helpers
    ├── router.js        # Hash-based screen routing
    ├── store.js         # Lobby client state
    ├── ui.js            # Shared UI helpers
    └── screens/         # One module per lobby screen
```

## Local development

Run the complete application from the repository root; the lobby is served by the Node server along with the game clients and WebSocket backend.

```bash
npm install
cp .env.example .env
# Set DATABASE_URL in .env to a development PostgreSQL database.
npm run dev
```

Then open `http://localhost:3000/`. See the root [README](../README.md) for requirements, scripts, database setup and deployment cautions.

The lobby's default WebSocket endpoint is same-origin. Do not move the lobby to a different host or change its backend URL without validating the WebSocket endpoint and multiplayer flow.

## Maintenance rules

- Keep lobby-specific styles in `lobby/css/` and lobby modules in `lobby/js/`.
- Keep the Classic and Go Wild game clients in their existing locations unless a complete reference and deployment review supports a move.
- If a route or client entry point changes, review `lobby/js/screens/play.js`, `lobby/js/gameframe.js`, `lobby/js/api.js`, `manifest.json` and `sw.js`.
- Treat PWA and mobile wrapper changes as separate behavior changes. Verify install, update, offline and Android WebSocket behavior before merging.
- Avoid deleting legacy root pages or stylesheets until all runtime, mobile, service-worker and external references have been checked.

The repository-wide dependency map and cleanup decisions are maintained in [`docs/repository-audit.md`](../docs/repository-audit.md).
