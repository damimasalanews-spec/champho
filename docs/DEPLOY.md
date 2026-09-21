# Deploying CHAMP WORD to Render

The repository now ships `render.yaml`, so deployment is a Blueprint import rather than
hand-building a service. This replaces a setup that previously had **no deployment config in
the repo at all** — which is exactly how the frontend and backend ended up on two separate
services that never talked to each other.

---

## Before you start: what must be true

| Requirement | Why |
|---|---|
| The service is a **Web Service**, not a Static Site | CHAMP WORD needs a long-lived Node process for WebSockets and for serving the client. A Static Site can run neither. |
| `DATABASE_URL` is set | The server refuses to boot without it. |
| `SESSION_SECRET` is set | Without it the server generates a per-process secret, so **every restart logs every player out**. |
| `buildCommand` includes `npm run build` | `npm start` runs `node dist/server/main.js`, so the TypeScript must be compiled first. |

---

## Option A — Blueprint (recommended, ~3 minutes)

1. Push this branch to GitHub and merge it into `main` (Render's Blueprint reads `render.yaml`
   from the branch named in the file, which is `main`).
2. In the Render dashboard: **New → Blueprint**.
3. Pick the `damimasalanews-spec/champho` repository.
4. Render reads `render.yaml` and shows a plan: one **web service** (`champword`) and one
   **PostgreSQL** (`champword-db`).
5. Click **Apply**. Render provisions the database, generates `SESSION_SECRET`, wires
   `DATABASE_URL` from the database into the service, then builds and deploys.

No manual environment variables are needed — `render.yaml` declares all of them.

## Option B — Manual Web Service

If you would rather not use a Blueprint:

1. **New → Postgres**, region *Singapore*, plan *Free*. Copy the **Internal** connection string.
2. **New → Web Service**, connect the repository, branch `main`, runtime **Node**.
3. Set:
   - **Build command:** `npm install && npm run build`
   - **Start command:** `npm start`
   - **Health check path:** `/health`
4. Environment:
   - `DATABASE_URL` = the internal connection string from step 1, with
     **`?sslmode=require` appended** (see the note below)
   - `SESSION_SECRET` = any long random string (`openssl rand -hex 32`)
   - `NODE_ENV` = `production`
5. **Create Web Service.**

---

## TLS to the database

Managed PostgreSQL terminates TLS with a chain that Node's default trust store rejects, so the
server reads `sslmode` from the connection string rather than forcing TLS on:

- `postgresql://…/champword` → no TLS (a local database works unchanged)
- `postgresql://…/champword?sslmode=require` → TLS enabled

If the first deploy fails with an SSL error, that is the line to fix: append `?sslmode=require`.

## Migrations

Nothing to run by hand. `server/main.ts` calls `runMigrations()` at startup, under a PostgreSQL
advisory lock so that concurrent instances cannot race, and the process aborts if the database is
unreachable. All six migrations apply on first boot.

---

## Verify the deployment (do not skip this)

A successful build is **not** proof that the game is live. The last time this project was
deployed, `champho-live.onrender.com` served a page with four hardcoded players and **zero**
`WebSocket` — so it looked deployed while being unplayable.

1. **Check the health endpoint returns JSON, not 404:**
   ```bash
   curl https://<your-service>.onrender.com/health
   # expect: {"ok":true,"service":"champ-word-backend","database":{"ok":true,...}}
   ```
   A **404** means you are still on a Static Site. This is the single most common failure.

2. **Confirm the served client is real, not a mockup:**
   ```bash
   curl -s https://<your-service>.onrender.com/classic.html | grep -c find_match
   ```
   Expect a non-zero count. Zero means the page is the old static mockup.

3. **Confirm the socket actually works from outside** (the step that matters most):
   ```bash
   node verify-public-link.mjs wss://<your-service>.onrender.com
   ```
   Expect: WebSocket connected, 4 seats with 3 bots, exactly 14 private cards, a turn deadline.

4. **Play one turn in two browsers.** Confirm the turn advances by itself, and that you cannot
   see the other player's cards.

Do not report the game as deployed until step 3 passes. A page that loads proves nothing about
whether anyone can play.

---

## Known limitation at deploy time

`server/tests/*` and the two acceptance harnesses (`verify-ui.mjs`, `verify-e2e.mjs`) are not
wired into any CI workflow yet, and `.github/workflows/postgres-migrations.yml` runs each test
file individually. All suites pass locally (`./scripts/verify.sh` → 9/9 green), but CI will only
stay green once a workflow runs them in the same order the harness does — the migration-runner
suite is order-dependent and must run **first**.

Also note that `fix-video.yml` runs on every push to `main` and commits a patch into `index.html`.
A CI job that mutates the deployed artifact means `main` is not the source of truth for what is
served; worth removing.
