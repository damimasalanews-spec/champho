/* ===========================================================================
   CHAMP WORD — transport
   The lobby talks to the game server through this one adapter. When a server
   answers, matchmaking is real. When none does, the same interface is served
   from a local simulation, so the site is fully explorable as a static deploy
   and the screens never need to know which mode they are in.

   Wire protocol, from server/index.ts:
     -> { type: "hello", clientVersion, mode }
     <- { type: "welcome", sessionToken, playerId, serverTime }
     -> { type: "find_match", sessionToken, displayName }
     <- { type: "match_queued" }
     <- { type: "match_found", roomId, seatNumber }
   =========================================================================== */

const OVERRIDE = new URLSearchParams(location.search).get('backend');
const PROBE_TIMEOUT = 4500;

/**
 * Where the socket lives: SAME ORIGIN, unless someone says otherwise.
 *
 * The rule used to be inverted — same origin only on localhost, and otherwise a
 * hard-coded `wss://champword-classic.onrender.com`. That host is a different
 * service, and it is the one every deployed copy of this page pointed at, so
 * every deployed copy showed "the table needs a matchmaking server" no matter
 * which server was actually running. The server in this repository serves this
 * page itself (server/static.ts), so the page and the socket are always the
 * same host. An explicit override is still honoured for a split deployment:
 *   ?backend=my-game.onrender.com     (as a query parameter on the lobby URL)
 *   ?backend=mock                     (forces the offline path, for tests)
 */
export function socketUrl() {
  if (OVERRIDE === 'mock') return null;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  if (OVERRIDE) return `${proto}://${OVERRIDE}`;
  return `${proto}://${location.host}`;
}

/**
 * Where the round client lives.
 *
 * The lobby is deployed as a self-contained folder (`site/`), while the table
 * client (`wild-play.html`) stays at the repository root and is not touched by
 * this rewrite. Resolving the path instead of hard-coding it means the same
 * build works whether it is served from /site/ or promoted to the root.
 */
const GAME_DIR = new URLSearchParams(location.search).get('game')
  ?? (location.pathname.includes('/site/') ? '../' : './');

/** Resolve a game client that lives beside the lobby, not inside it. */
export function gameUrl(file) {
  if (/^(https?:|\/|\.{1,2}\/)/.test(file)) return file;
  return `${GAME_DIR}${file}`;
}

/** The classic table, which is what "quick play" opens. */
export const GAME_CLIENT = gameUrl('game/');

let status = 'unknown'; // unknown | online | offline
let socket = null;
let session = null;
let statusListeners = new Set();

function setStatus(next) {
  status = next;
  statusListeners.forEach((fn) => fn(status));
}

function open(timeout = PROBE_TIMEOUT) {
  return new Promise((resolve) => {
    const url = socketUrl();
    if (!url || typeof WebSocket === 'undefined') {
      setStatus('offline');
      resolve({ ok: false, reason: 'no-endpoint' });
      return;
    }

    let settled = false;
    let ws;
    try {
      ws = new WebSocket(url);
    } catch {
      setStatus('offline');
      resolve({ ok: false, reason: 'blocked' });
      return;
    }

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch { /* already closing */ }
      setStatus('offline');
      resolve({ ok: false, reason: 'timeout' });
    }, timeout);

    ws.addEventListener('open', () => {
      try {
        ws.send(JSON.stringify({ type: 'hello', requestId: crypto.randomUUID(), clientVersion: '4.0', mode: 'cards' }));
      } catch { /* the error handler will fire */ }
    });

    ws.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === 'server_ready') return;
      if (msg.type === 'welcome' && !settled) {
        settled = true;
        clearTimeout(timer);
        session = { token: msg.sessionToken, playerId: msg.playerId };
        socket = ws;
        setStatus('online');
        resolve({ ok: true, session, url });
      }
    });

    ws.addEventListener('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      setStatus('offline');
      resolve({ ok: false, reason: 'unreachable' });
    });

    ws.addEventListener('close', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        setStatus('offline');
        resolve({ ok: false, reason: 'closed' });
      } else if (socket === ws) {
        socket = null;
        setStatus('offline');
      }
    });
  });
}

/* --- matchmaking ---------------------------------------------------------- */

let queueController = null;

/**
 * Queue for a table.
 * Resolves once with { mode: 'live'|'mock', roomId, seatNumber }.
 * `onState` is called with 'queued' and 'found' so the screen can narrate.
 */
export function findMatch({ displayName = 'You', teamSize = 2, onState = () => {} } = {}) {
  cancelQueue();
  const controller = { cancelled: false, timer: null, ws: null };
  queueController = controller;

  return new Promise(async (resolve) => {
    onState('queued');

    if (status !== 'offline') {
      const probe = socket ? { ok: true } : await open();
      if (controller.cancelled) return;

      if (probe.ok) {
        const ws = socket ?? probe.ws;
        const started = Date.now();

        const onMessage = (event) => {
          let msg;
          try { msg = JSON.parse(event.data); } catch { return; }
          if (msg.type === 'match_queued') onState('queued');
          if (msg.type === 'error') {
            cleanup();
            resolve({ mode: 'offline', reason: msg.code || 'server-error' });
          }
          if (msg.type === 'match_found') {
            cleanup();
            onState('found');
            resolve({ mode: 'live', roomId: msg.roomId, seatNumber: msg.seatNumber ?? 1 });
          }
        };

        const cleanup = () => {
          clearTimeout(controller.timer);
          ws.removeEventListener('message', onMessage);
          queueController = null;
        };

        controller.ws = ws;
        controller.cleanup = cleanup;
        ws.addEventListener('message', onMessage);

        try {
          ws.send(JSON.stringify({
            type: 'find_match',
            requestId: crypto.randomUUID(),
            sessionToken: session?.token,
            displayName,
            teamSize
          }));
        } catch { /* handled by the timeout below */ }

        // The server queues in passes; a quiet queue is normal, so this is a
        // generous ceiling rather than a failure of the connection.
        controller.timer = setTimeout(() => {
          if (controller.cancelled) return;
          cleanup();
          resolve({ mode: 'offline', reason: 'queue-timeout' });
        }, 25_000);
        return;
      }
    }

    // No server. Say so — this used to hand back a fabricated room code after
    // 2.6 seconds, so a player sat down at a table that did not exist and lost
    // to nobody. That is worse than no table at all.
    queueController = null;
    resolve({ mode: 'offline', reason: 'unreachable' });
  });
}

export function cancelQueue() {
  if (!queueController) return;
  queueController.cancelled = true;
  clearTimeout(queueController.timer);
  try { queueController.cleanup?.(); } catch { /* noop */ }
  try {
    queueController.ws?.send(JSON.stringify({ type: 'disconnect' }));
  } catch { /* socket may already be gone */ }
  queueController = null;
}

function simulatedRoom() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

/* --- public surface -------------------------------------------------------- */

export const server = {
  get status() { return status; },
  get session() { return session; },

  onStatus(fn) {
    statusListeners.add(fn);
    return () => statusListeners.delete(fn);
  },

  probe() {
    if (socket) return Promise.resolve({ ok: true, session });
    return open();
  },

  findMatch,
  cancelQueue,

  disconnect() {
    cancelQueue();
    try { socket?.close(); } catch { /* noop */ }
    socket = null;
    session = null;
    setStatus('unknown');
  }
};
