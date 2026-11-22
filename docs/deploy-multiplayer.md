# Making the game actually multiplayer

The card shown to players — *"The round client talks to wss://champword-classic.onrender.com.
Nothing is answering there"* — is not a bug in the page. It is the page reporting the truth:
the host it was told to talk to is not running.

## What was wrong

| # | Problem | Evidence |
|---|---|---|
| 1 | The lobby hard-coded its socket host to `wss://champword-classic.onrender.com` unless the page was on `localhost`. Whatever server was actually running, the page pointed somewhere else. | `lobby/js/api.js` `socketUrl()` |
| 2 | That host answers **502 Bad Gateway** — the service exists, the process behind it does not. | `GET /health` → 502; `/` → timeout |
| 3 | The server in this repo **cannot boot without a database**: `config.ts` throws `DATABASE_URL is required` at import time. | `server/config.ts` |
| 4 | When the socket failed, the lobby **invented a room code** after 2.6s and told the player "Table found". | `api.js` `findMatch` |
| 5 | The Go Wild card opened `go-wild-2v2-finished.html`, which contains **zero networking code** — a picture of a table. | `Select-String WebSocket` → 0 hits |
| 6 | The client is served by the static site, so the page and the socket were always on different hosts. | `champword-go-wild-2v2.onrender.com` is a Render *static site*; `/health` 404s |

## What is fixed in the code (this commit)

- **`lobby/js/api.js`** — the socket is **same-origin** now: `wss://${location.host}`, with
  `?backend=host` as an explicit override for a deliberately split deployment. The repo's
  server serves this page itself (`server/static.ts`), so page and socket are the same host
  by construction and the client cannot be pointed at a service that does not exist.
- **`lobby/js/api.js`** — no more fabricated tables. A failed queue returns
  `{ mode: 'offline' }`; nothing pretends a room exists.
- **`lobby/js/screens/play.js`** — renders that honestly: *Server unreachable* or
  *No one else is queued*, with a **Try again** button that rejoins the queue.
- **`lobby/js/data.js`, `play.js`** — Go Wild now opens **`wild-play.html`**, the 2v2 client
  that holds a socket, seats and round state. `go-wild-2v2-finished.html` stays in the repo
  as the static design build, but it is no longer reachable from a "play" card.
- **`wild-play.html`, `classic.html`** — same-origin socket, with the same `?backend=` override.
- **`lobby/js/gameframe.js`** — the offline card speaks to players, not developers (it used to
  tell them to run `npm run dev` with `DATABASE_URL` set).

## What only you can do — three things, all in Render

Nothing below can be done from a code change: a free Render service cannot host a database,
and this repo's server refuses to start without one.

### 1. Give the server a database

Render dashboard → **New + → Postgres** (free, region **oregon** — it must match the web
service's region; the internal connection string does not route cross-region).

Name it `champword-db`, create it, then open it → **Connections → Internal Database URL**,
and copy that string.

> If Render says you already have a free Postgres in this workspace, reuse it instead of
> creating a second one — free plans allow only one per workspace.

### 2. Put the server on `main` and give it the URL

Open the **web service** (the one at `champword-classic.onrender.com`, or create
**New + → Web Service** against this repo):

| Setting | Value |
|---|---|
| Branch | `main` ← this is the fix; it was pinned to `redesign/authoritative-classic` |
| Runtime | Node |
| Build command | `npm install --include=dev && npm run build` |
| Start command | `npm start` |
| Health check path | `/health` |
| Env `DATABASE_URL` | the Internal Database URL from step 1 |
| Env `SESSION_SECRET` | any long random string (or Render's *Generate*) |
| Env `NODE_ENV` | `production` |

`--include=dev` is load-bearing: `typescript` and `@types/*` are devDependencies, and
`NODE_ENV=production` makes npm skip them, which fails the build with "Cannot find name
'process'".

Deploy. `GET /health` must answer `{"ok":true,...}` — if it 502s, the log will say
`[startup] database unavailable` or `DATABASE_URL is required`.

### 3. Serve the page from the server, not the static site

The Node service already serves `index.html` at `/` (`server/static.ts`), so
**`https://<your-service>.onrender.com/` is the whole game** — lobby, home page, tables,
socket, all on one origin. Nothing else needs configuring.

Then either point the `champword-go-wild-2v2` hostname at that service (Render → Settings →
Custom Domain) or retire the static site. A static site **cannot** host a WebSocket, so as
long as the page is served from one, the table will always be unreachable.

### If you must keep the split (page on one host, server on another)

The override exists for exactly that case: open the lobby as
`https://champword-go-wild-2v2.onrender.com/?backend=<server-host>` and the client will
connect to `wss://<server-host>` instead of its own origin.

## One honest caveat about "Classic"

`game/` and `go-wild-2v2-finished.html` contain no `WebSocket` call at all — they are
client-side boards. The networked clients in this repository are `wild-play.html`
(2v2 word grid) and the classic table served by `server/index.ts`. So:

- **Go Wild** — real multiplayer as soon as step 2 is live.
- **Classic Mode** — real multiplayer through the server's own table client; the `game/`
  board that the home card opens is a local board, not a networked one.

Both need the service from step 2 either way.

## Verify it end to end

1. `https://<service>.onrender.com/health` → `{"ok":true,...}`
2. Open two browser windows (one incognito) at `https://<service>.onrender.com/`
3. In both: **Play → Go Wild → Find a table**
4. Both should say **Table found**, with the **same room code**, and each window should see the
   other's seat. That is the only proof that matters — one window alone will sit in the queue
   for 25 seconds and then say *No one else is queued*, which is correct behaviour, not a bug.
