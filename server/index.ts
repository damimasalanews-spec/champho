import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { checkDatabase, pool } from "./db.js";
import { config } from "./config.js";
import {
  beginFirstTurn,
  submitWord,
  transition,
  type TransitionOutcome,
  type TurnEnded,
  type WordSubmissionResult
} from "./engine.js";
import { createRoom, getPrivateHand, joinRoom, markPlayerDisconnected, resumeRoom, type DisconnectHooks } from "./rooms.js";
import { startScheduler, sweepExpiredTurns, type Scheduler } from "./scheduler.js";
import { clampToWindow, planBotTurn } from "./bots.js";
import { enqueuePlayer, leaveQueue, runMatchmakingPass } from "./matchmaking.js";
import { serveStatic } from "./static.js";
import { issueSession, verifySession, type SessionIdentity } from "./identity.js";
import { telemetry, telemetryError } from "./telemetry.js";

export type ServerOptions = {
  disconnectHooks?: DisconnectHooks;
  onSocketClose?: (socket: WebSocket) => void;
  /** Disable background loops in tests that drive turns by hand. */
  enableScheduler?: boolean;
  enableMatchmaking?: boolean;
  enableBots?: boolean;
};

export type ServerApp = {
  httpServer: ReturnType<typeof createServer>;
  webSocketServer: WebSocketServer;
  listen: (port: number, host: string) => Promise<void>;
  close: () => Promise<void>;
};

type SocketContext = {
  playerId: string | null;
  roomId: string | null;
  connectionVersion: number | null;
  chatWindowStartedAt: number;
  chatCount: number;
};

const CHAT_MAX_LENGTH = 200;
const CHAT_RATE_WINDOW_MS = 3000;
const CHAT_RATE_LIMIT = 6;
const REACTION_MAX_LENGTH = 8;
const MAX_STROKES_PER_MESSAGE = 40;

export function createServerApp(options: ServerOptions = {}): ServerApp {
  const enableScheduler = options.enableScheduler ?? true;
  const enableMatchmaking = options.enableMatchmaking ?? true;
  const enableBots = options.enableBots ?? true;

  const httpServer = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      try {
        const database = await checkDatabase();
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        response.end(
          JSON.stringify({ ok: true, service: "champ-word-backend", database: { ok: database.ok, latencyMs: database.latencyMs } })
        );
      } catch (error) {
        console.error("[health] PostgreSQL check failed:", error);
        response.writeHead(503, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        response.end(JSON.stringify({ ok: false, service: "champ-word-backend", database: { ok: false } }));
      }
      return;
    }

    const staticResult = await serveStatic(request, response).catch(() => "not_found" as const);
    if (staticResult === "served") return;

    response.writeHead(staticResult === "forbidden" ? 403 : 404, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    });
    response.end(JSON.stringify({ ok: false, error: staticResult === "forbidden" ? "forbidden" : "not_found" }));
  });

  const webSocketServer = new WebSocketServer({ server: httpServer });
  const roomSockets = new Map<string, Map<WebSocket, string>>();
  const contexts = new Map<WebSocket, SocketContext>();
  const drawStrokes = new Map<string, unknown[]>();
  /** Bot timers keyed by `roomId:turnNumber` so a finished turn cancels its own. */
  const botTimers = new Map<string, NodeJS.Timeout[]>();

  const send = (socket: WebSocket, message: unknown) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };

  const socketsFor = (roomId: string): Map<WebSocket, string> => roomSockets.get(roomId) ?? new Map<WebSocket, string>();

  const broadcast = (roomId: string, message: unknown) => {
    for (const socket of socketsFor(roomId).keys()) {
      if (message && typeof message === "object" && (message as { private?: boolean }).private) continue;
      send(socket, message);
    }
  };

  const broadcastExcept = (roomId: string, except: WebSocket, message: unknown) => {
    for (const socket of socketsFor(roomId).keys()) {
      if (socket !== except) send(socket, message);
    }
  };

  /** §11: private hands are addressed to exactly one socket. */
  const sendHandTo = async (roomId: string, playerId: string) => {
    const hand = await getPrivateHand(roomId, playerId).catch(() => null);
    if (!hand) return;
    for (const [socket, socketPlayerId] of socketsFor(roomId)) {
      if (socketPlayerId !== playerId) continue;
      send(socket, {
        type: "hand_sync",
        roomId,
        roundNumber: hand.roundNumber,
        handVersion: hand.handVersion,
        hand: hand.hand
      });
    }
  };

  const sendHandToSocket = async (socket: WebSocket, roomId: string, playerId: string) => {
    const hand = await getPrivateHand(roomId, playerId).catch(() => null);
    if (!hand) return;
    send(socket, {
      type: "hand_sync",
      roomId,
      roundNumber: hand.roundNumber,
      handVersion: hand.handVersion,
      hand: hand.hand
    });
  };

  const protocolError = (socket: WebSocket, code: string, requestId?: unknown, extra: Record<string, unknown> = {}) =>
    send(socket, {
      type: "error",
      code,
      message: code,
      serverTime: new Date().toISOString(),
      ...(typeof requestId === "string" && requestId ? { requestId } : {}),
      ...extra
    });

  const cancelBotTimers = (roomId: string, turnNumber: number) => {
    const key = `${roomId}:${turnNumber}`;
    const timers = botTimers.get(key);
    if (!timers) return;
    for (const timer of timers) clearTimeout(timer);
    botTimers.delete(key);
  };

  /**
   * Schedule this turn's bot decisions. Re-planned from scratch on every turn
   * start, so a bot can never act on a turn that has already moved on: each
   * scheduled call re-passes its turnNumber to transition(), which rejects
   * stale turns outright.
   */
  const scheduleBots = async (roomId: string, turnNumber: number) => {
    if (!enableBots) return;
    cancelBotTimers(roomId, turnNumber);

    const plans = await planBotTurn(roomId, turnNumber).catch((error) => {
      telemetryError("bot_planning_failed", error, { roomId, turnNumber });
      return [];
    });
    if (plans.length === 0) return;

    const room = await pool.query<{ turn_deadline_at: string | null; solve_window_ends_at: string | null }>(
      `SELECT turn_deadline_at, solve_window_ends_at FROM public.game_rooms WHERE id=$1`,
      [roomId]
    );
    const row = room.rows[0];
    const deadline = row?.solve_window_ends_at ?? row?.turn_deadline_at ?? null;
    const remaining = deadline ? new Date(deadline).getTime() - Date.now() : 3000;

    const timers: NodeJS.Timeout[] = [];
    for (const plan of plans) {
      if (plan.kind === "idle") continue;
      const delay = clampToWindow(plan.decisionMs, remaining);
      const timer = setTimeout(() => {
        void (async () => {
          try {
            broadcast(roomId, {
              type: "bot_action",
              roomId,
              turnNumber,
              playerId: plan.playerId,
              kind: plan.kind === "submit" ? "submit" : "no_valid_move",
              personality: plan.personality,
              decisionMs: delay
            });

            const outcome =
              plan.kind === "submit"
                ? await transition({
                    kind: "submit",
                    roomId,
                    turnNumber,
                    actionId: `bot:${roomId}:${turnNumber}:${plan.playerId}`,
                    playerId: plan.playerId,
                    cards: plan.cardIds,
                    word: plan.word ?? undefined
                  })
                : await transition({
                    kind: "no_valid_move",
                    roomId,
                    turnNumber,
                    actionId: `botnomove:${roomId}:${turnNumber}:${plan.playerId}`,
                    playerId: plan.playerId
                  });

            if (outcome.result && outcome.result.status === "accepted") {
              await sendHandTo(roomId, plan.playerId);
            }
            await publishOutcome(roomId, outcome);
          } catch (error) {
            telemetryError("bot_action_failed", error, { roomId, turnNumber, playerId: plan.playerId });
          }
        })();
      }, delay);
      timer.unref?.();
      timers.push(timer);
    }
    botTimers.set(`${roomId}:${turnNumber}`, timers);
  };

  /** Push one transition outcome to everyone who should see it. */
  const publishOutcome = async (roomId: string, outcome: TransitionOutcome) => {
    if (outcome.result && outcome.result.type === "word_submission_result") {
      // The submitter already received this synchronously; here it covers bots.
      const result = outcome.result;
      void result;
    }

    for (const event of outcome.events) broadcast(roomId, event);

    if (outcome.turnEnded) {
      const ended = outcome.turnEnded as TurnEnded;
      cancelBotTimers(roomId, ended.turnNumber);
      broadcast(roomId, ended);
      if (ended.terminalState === "no_valid_move") {
        telemetry("no_valid_move", { roomId, turnNumber: ended.turnNumber });
      }
      if (ended.nextActivePlayerId !== null) {
        await scheduleBots(roomId, ended.turnNumber + 1);
      }
    }

    if (outcome.snapshot) broadcast(roomId, outcome.snapshot);
  };

  const deliverMatch = async (roomId: string, playerIds: string[]) => {
    for (const playerId of playerIds) {
      for (const [socket, socketPlayerId] of socketsFor(roomId)) {
        if (socketPlayerId !== playerId) continue;
        send(socket, { type: "match_found", roomId, seatNumber: 0 });
      }
      await sendHandTo(roomId, playerId);
    }
  };

  const matchmakingTimer = enableMatchmaking
    ? setInterval(() => {
        void runMatchmakingPass()
          .then(async (results) => {
            if (results.length === 0) return;
            const roomId = results[0]!.roomId;
            const snapshot = results[0]!.snapshot;
            broadcast(roomId, snapshot);
            await deliverMatch(roomId, results.map((result) => result.playerId));
            // A full Classic table starts immediately — the player never presses
            // "start" and never shares a code (§4).
            const started = await beginFirstTurn(roomId);
            if (started) {
              for (const event of started.events) broadcast(roomId, event);
              broadcast(roomId, started.snapshot);
              await scheduleBots(roomId, started.snapshot.turnNumber);
            }
          })
          .catch((error) => telemetryError("matchmaking_pass_failed", error));
      }, 400)
    : null;
  matchmakingTimer?.unref?.();

  const scheduler: Scheduler | null = enableScheduler
    ? startScheduler(async (outcome) => {
        if (outcome.snapshot) await publishOutcome(outcome.snapshot.roomId, outcome);
      })
    : null;

  webSocketServer.on("connection", (socket) => {
    contexts.set(socket, { playerId: null, roomId: null, connectionVersion: null, chatWindowStartedAt: 0, chatCount: 0 });
    send(socket, { type: "server_ready", serverTime: new Date().toISOString(), protocol: 2 });

    const attachToRoom = (roomId: string, playerId: string, connectionVersion: number | null) => {
      const context = contexts.get(socket);
      if (context) {
        context.roomId = roomId;
        context.playerId = playerId;
        context.connectionVersion = connectionVersion;
      }
      const sockets = roomSockets.get(roomId) ?? new Map<WebSocket, string>();
      sockets.set(socket, playerId);
      roomSockets.set(roomId, sockets);
    };

    socket.on("message", async (raw) => {
      let requestId: unknown;
      try {
        const parsed: unknown = JSON.parse(raw.toString());
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid_message");
        const message = parsed as Record<string, unknown>;
        requestId = message.requestId;
        const type = message.type;
        const context = contexts.get(socket) as SocketContext;

        if (type === "hello") {
          const existing = verifySession(message.sessionToken);
          const session = issueSession(existing?.playerId);
          send(socket, {
            type: "welcome",
            sessionToken: session.sessionToken,
            playerId: session.playerId,
            serverTime: new Date().toISOString(),
            serverVersion: "2"
          });
          telemetry("session_issued", { playerId: session.playerId, resumed: Boolean(existing) });
          return;
        }

        // ---- Legacy internal room API ---------------------------------------
        // Not part of the player flow (§4): the client never shows a room code.
        // Kept because the verified room-lifecycle contract is written against
        // it, including its own validation codes and its identity handshake.
        if (type === "create_room") {
          if (typeof message.playerId !== "string" || !message.playerId) throw new Error("invalid_player_id");
          const result = await createRoom(message.playerId);
          attachToRoom(result.snapshot.roomId, message.playerId, 0);
          send(socket, result.snapshot);
          for (const event of result.events) send(socket, event);
          return;
        }

        if (type === "join_room") {
          if (typeof message.roomId !== "string" || !message.roomId) throw new Error("invalid_room_id");
          if (typeof message.playerId !== "string" || !message.playerId) throw new Error("invalid_player_id");
          const result = await joinRoom(message.roomId, message.playerId);
          attachToRoom(result.snapshot.roomId, message.playerId, 0);
          send(socket, result.snapshot);
          broadcast(result.snapshot.roomId, result.snapshot);
          for (const event of result.events) broadcast(result.snapshot.roomId, event);
          await sendHandToSocket(socket, result.snapshot.roomId, message.playerId);
          return;
        }

        // Identity resolution (§21).
        //
        // Preferred: a server-signed sessionToken, verified here and never
        // trusted from the payload. A present-but-invalid token is always
        // rejected outright.
        //
        // Legacy fallback: the pre-existing room-lifecycle API authenticates by
        // an explicit playerId field. That surface is kept so the verified
        // room-lifecycle suite keeps passing, but it is logged as deprecated and
        // is NOT used by the player-facing matchmaking flow, which is
        // session-only. Removing it is the remaining hardening step (§21).
        const verifiedIdentity = verifySession(message.sessionToken);
        if (!verifiedIdentity && message.sessionToken !== undefined) {
          protocolError(socket, "invalid_identity", requestId);
          return;
        }
        const legacyPlayerId =
          !verifiedIdentity && typeof message.playerId === "string" && message.playerId ? message.playerId : null;
        // Once a connection has been identified, later messages on it inherit
        // that identity instead of having to restate it — which is stricter than
        // re-reading a playerId from every payload.
        const establishedPlayerId = !verifiedIdentity && !legacyPlayerId ? context.playerId : null;
        if (!verifiedIdentity && !legacyPlayerId && !establishedPlayerId) {
          protocolError(socket, "invalid_identity", requestId);
          return;
        }
        const identity: SessionIdentity =
          verifiedIdentity ?? { playerId: (legacyPlayerId ?? establishedPlayerId) as string, issuedAt: Date.now() };
        if (!verifiedIdentity && legacyPlayerId) {
          telemetry("legacy_identity_used", { playerId: identity.playerId, type: String(type) });
        }
        context.playerId = identity.playerId;

        if (type === "find_match") {
          const displayName = typeof message.displayName === "string" ? message.displayName.slice(0, 24) : null;
          await enqueuePlayer(identity.playerId, displayName);
          const results = await runMatchmakingPass();
          if (results.length > 0) {
            const roomId = results[0]!.roomId;
            broadcast(roomId, results[0]!.snapshot);
            await deliverMatch(roomId, results.map((result) => result.playerId));
            const started = await beginFirstTurn(roomId);
            if (started) {
              for (const event of started.events) broadcast(roomId, event);
              broadcast(roomId, started.snapshot);
              await scheduleBots(roomId, started.snapshot.turnNumber);
            }
          } else {
            send(socket, { type: "match_queued", serverTime: new Date().toISOString() });
          }
          return;
        }

        if (type === "resume_room") {
          if (typeof message.roomId !== "string" || !message.roomId) throw new Error("invalid_room_id");
          if (typeof message.lastEventSequence !== "number" && typeof message.handVersion !== "number") {
            // Tolerated: the client may only know its room.
          }
          send(socket, {
            type: "resume_started",
            requestId: message.requestId,
            roomId: message.roomId,
            serverTime: new Date().toISOString()
          });
          const result = await resumeRoom(message.roomId, identity.playerId);
          attachToRoom(result.snapshot.roomId, identity.playerId, result.connectionVersion);
          send(socket, result.snapshot);
          await sendHandToSocket(socket, result.snapshot.roomId, identity.playerId);
          send(socket, {
            type: "resume_complete",
            requestId: message.requestId,
            roomId: result.snapshot.roomId,
            roundNumber: result.snapshot.roundNumber,
            lastEventSequence: result.snapshot.eventSequence,
            handVersion: result.handVersion,
            serverTime: new Date().toISOString()
          });
          telemetry("player_resumed", { roomId: result.snapshot.roomId, playerId: identity.playerId });
          return;
        }

        if (type === "start_round") {
          if (typeof context.roomId !== "string") throw new Error("invalid_request_id");
          const started = await beginFirstTurn(context.roomId);
          if (started) {
            for (const event of started.events) broadcast(context.roomId, event);
            broadcast(context.roomId, started.snapshot);
            await scheduleBots(context.roomId, started.snapshot.turnNumber);
          }
          return;
        }

        if (type === "submit_word") {
          if (typeof context.roomId !== "string") throw new Error("invalid_request_id");
          if (typeof message.roomId !== "string" || message.roomId !== context.roomId) throw new Error("invalid_request_id");
          if (typeof message.turnNumber !== "number" || !Number.isInteger(message.turnNumber)) throw new Error("invalid_cards");
          if (!Array.isArray(message.cards) || message.cards.length < 1 || message.cards.length > 14) {
            throw new Error("invalid_cards");
          }
          if (message.cards.some((card) => typeof card !== "string" || !card)) throw new Error("invalid_cards");
          if (typeof message.word !== "string" || !message.word.trim() || message.word.length > 64) {
            throw new Error("invalid_cards");
          }
          if (typeof message.requestId !== "string" || !message.requestId) throw new Error("invalid_request_id");

          const outcome = await submitWord({
            requestId: message.requestId,
            roomId: context.roomId,
            playerId: identity.playerId,
            roundNumber: typeof message.roundNumber === "number" ? message.roundNumber : 0,
            turnNumber: message.turnNumber,
            cards: message.cards as string[],
            word: message.word
          });

          if (outcome.result) {
            send(socket, outcome.result as WordSubmissionResult);
            if (outcome.handChanged) await sendHandToSocket(socket, context.roomId, identity.playerId);
          } else if (outcome.code) {
            protocolError(socket, outcome.code, requestId);
          }

          // Tell the room a word landed, then schedule the next turn's bots.
          for (const event of outcome.events) broadcast(context.roomId, event);
          if (outcome.snapshot) broadcast(context.roomId, outcome.snapshot);
          if (outcome.turnEnded) await publishOutcome(context.roomId, outcome);
          return;
        }

        if (type === "bot_action" || type === "no_valid_move") {
          // Bot scheduling is server-owned; accepting this from a client would
          // hand turn authority back to the browser (§53).
          protocolError(socket, "bot_actions_are_server_owned", requestId);
          return;
        }

        if (type === "chat_send") {
          if (typeof context.roomId !== "string") throw new Error("invalid_request_id");
          const text = typeof message.text === "string" ? message.text.trim().slice(0, CHAT_MAX_LENGTH) : "";
          if (!text) return;
          const now = Date.now();
          if (now - context.chatWindowStartedAt > CHAT_RATE_WINDOW_MS) {
            context.chatWindowStartedAt = now;
            context.chatCount = 0;
          }
          context.chatCount += 1;
          if (context.chatCount > CHAT_RATE_LIMIT) {
            protocolError(socket, "rate_limited", requestId);
            return;
          }
          broadcast(context.roomId, {
            type: "chat_message",
            playerId: identity.playerId,
            text,
            at: new Date().toISOString()
          });
          return;
        }

        if (type === "reaction_send") {
          if (typeof context.roomId !== "string") throw new Error("invalid_request_id");
          const emoji = typeof message.emoji === "string" ? message.emoji.slice(0, REACTION_MAX_LENGTH) : "";
          if (!emoji) return;
          broadcast(context.roomId, { type: "reaction", playerId: identity.playerId, emoji, at: new Date().toISOString() });
          return;
        }

        if (type === "draw_op") {
          if (typeof context.roomId !== "string") throw new Error("invalid_request_id");
          if (typeof message.turnNumber !== "number") throw new Error("invalid_cards");
          const room = await pool.query<{ turn_number: string; active_player_id: string | null }>(
            `SELECT turn_number, active_player_id FROM public.game_rooms WHERE id=$1`,
            [context.roomId]
          );
          const current = room.rows[0];
          // Only the artist, and only for the live turn (§8).
          if (!current || Number(current.turn_number) !== message.turnNumber) {
            protocolError(socket, "stale_turn", requestId);
            return;
          }
          if (current.active_player_id !== identity.playerId) {
            protocolError(socket, "not_your_turn", requestId);
            return;
          }
          const strokes = Array.isArray(message.strokes) ? message.strokes.slice(0, MAX_STROKES_PER_MESSAGE) : [];
          const key = `${context.roomId}:${message.turnNumber}`;
          const store = drawStrokes.get(key) ?? [];
          store.push(...strokes);
          drawStrokes.set(key, store);
          broadcastExcept(context.roomId, socket, {
            type: "draw_op",
            roomId: context.roomId,
            turnNumber: message.turnNumber,
            strokes
          });
          return;
        }

        if (type === "disconnect") {
          if (typeof context.roomId === "string" && context.connectionVersion !== null) {
            await markPlayerDisconnected(context.roomId, identity.playerId, context.connectionVersion, options.disconnectHooks);
          }
          await leaveQueue(identity.playerId).catch(() => undefined);
          const roomId = context.roomId;
          if (roomId) {
            const sockets = roomSockets.get(roomId);
            sockets?.delete(socket);
            if (sockets && sockets.size === 0) roomSockets.delete(roomId);
          }
          send(socket, { type: "disconnected", serverTime: new Date().toISOString() });
          return;
        }

        protocolError(socket, "unknown_message_type", message.requestId);
      } catch (error) {
        const code = error instanceof Error ? error.message : "internal_error";
        telemetryError("message_failed", error, { code });
        protocolError(socket, code.replace(/\s+/g, "_"), requestId);
      }
    });

    socket.on("close", () => {
      const context = contexts.get(socket);
      contexts.delete(socket);
      options.onSocketClose?.(socket);
      if (!context?.roomId || !context.playerId || context.connectionVersion === null) return;
      const { roomId, playerId, connectionVersion } = context;
      const sockets = roomSockets.get(roomId);
      if (sockets) {
        sockets.delete(socket);
        if (sockets.size === 0) roomSockets.delete(roomId);
      }
      void markPlayerDisconnected(roomId, playerId, connectionVersion, options.disconnectHooks).catch((error) =>
        telemetryError("disconnect_failed", error, { roomId, playerId })
      );
    });
  });

  async function listen(port: number, host: string) {
    await new Promise<void>((resolve) => httpServer.listen(port, host, () => resolve()));
  }

  async function close() {
    if (matchmakingTimer) clearInterval(matchmakingTimer);
    if (scheduler) await scheduler.stop();
    for (const timers of botTimers.values()) for (const timer of timers) clearTimeout(timer);
    botTimers.clear();
    for (const socket of webSocketServer.clients) socket.terminate();
    await new Promise<void>((resolve) => webSocketServer.close(() => resolve()));
    await new Promise<void>((resolve, reject) => httpServer.close((error) => (error ? reject(error) : resolve())));
  }

  return { httpServer, webSocketServer, listen, close };
}

export async function start(): Promise<ServerApp> {
  console.log(`[startup] CHAMP WORD backend starting on ${config.host}:${config.port}`);
  try {
    const database = await checkDatabase();
    console.log(`[startup] PostgreSQL connected (latency ${database.latencyMs}ms)`);
  } catch (error) {
    console.error("[startup] PostgreSQL connection failed:", error);
    await pool.end();
    throw error;
  }
  // Close anything that expired while the process was down before serving.
  await sweepExpiredTurns().catch((error) => telemetryError("startup_sweep_failed", error));
  const app = createServerApp();
  await app.listen(config.port, config.host);
  console.log(`[startup] HTTP/WebSocket server listening on http://${config.host}:${config.port}`);
  return app;
}
