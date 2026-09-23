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
import {
  applyRoundAction,
  playBotTurn,
  readBotTurn,
  readRoundView,
  startCardRound,
  type RoundActionKind,
  type RoundOutcomeForClient
} from "./round-engine.js";
import type { RoundView } from "./round-view.js";
import { COLORS, type CardColor } from "./cards.js";
import { cardTurnDelayMs } from "./bots.js";
import { createRoom, getPrivateHand, joinRoom, markPlayerDisconnected, resumeRoom, type DisconnectHooks } from "./rooms.js";
import { startScheduler, sweepExpiredTurns, type Scheduler } from "./scheduler.js";
import { botAnswerDelayMs, clampToWindow, planBotTurn } from "./bots.js";
import { enqueuePlayer, leaveQueue, runMatchmakingPass, type MatchResult } from "./matchmaking.js";
import { serveStatic } from "./static.js";
import { doodleFor } from "./doodles.js";
import { issueSession, verifySession, type SessionIdentity } from "./identity.js";
import { telemetry, telemetryError } from "./telemetry.js";

/**
 * Everything a seat may do on its turn, by the name the client sends. Kept at
 * module scope so the handler is a lookup rather than five near-identical
 * branches that can drift apart.
 */
const CARD_ACTIONS: Record<string, RoundActionKind> = {
  play_card: "play",
  draw_card: "draw",
  pass_turn: "pass",
  call_uno: "uno",
  catch_uno: "catch"
};

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
  /** playerId -> live socket, so matchmaking can reach a player before they are in a room. */
  const playerSockets = new Map<string, WebSocket>();
  const drawStrokes = new Map<string, unknown[]>();
  /** Bot timers keyed by `roomId:turnNumber` so a finished turn cancels its own. */
  const botTimers = new Map<string, NodeJS.Timeout[]>();
  /** Same, for an artist bot's sketch: keyed `roomId:turnNumber:doodle`. */
  const doodleTimers = new Map<string, NodeJS.Timeout[]>();

  /** Join a socket's membership of a room. Safe to call more than once. */
  const attachToRoom = (socket: WebSocket, roomId: string, playerId: string, connectionVersion: number | null) => {
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

  const protocolError = (socket: WebSocket, code: string, requestId?: unknown, extra: Record<string, unknown> = {}) =>
    send(socket, {
      type: "error",
      code,
      message: code,
      serverTime: new Date().toISOString(),
      ...(typeof requestId === "string" && requestId ? { requestId } : {}),
      ...extra
    });

  /**
   * A card round sends each seat its own view. There is no shared snapshot to
   * broadcast — a view holds the seat's own hand and only counts of everyone
   * else's — so this is the only way a round reaches a client.
   */
  const publishViews = (views: { playerId: string; view: RoundView }[]) => {
    for (const { playerId, view } of views) {
      for (const [socket, socketPlayerId] of socketsFor(view.roomId)) {
        if (socketPlayerId !== playerId) continue;
        send(socket, view);
      }
    }
  };

  /**
   * Give a bot seat its turn. The delay comes from the personality's thinking
   * range, so a bot never answers faster than a person could, and the turn
   * number guards against a timer outliving the turn it was scheduled for.
   */
  /**
   * Push one round outcome to the table: each seat its own view, then the events
   * everyone shares.
   *
   * A view carries the seat's own hand, so it is addressed rather than broadcast
   * — there is no shared snapshot of a card round to send. The seat that just
   * moved may also have handed the turn to a bot, which is why the re-arm lives
   * here rather than at each call site.
   */
  const publishRoundOutcome = async (roomId: string, outcome: RoundOutcomeForClient) => {
    if (outcome.views.length > 0) publishViews(outcome.views);
    for (const event of outcome.events) broadcast(roomId, event);
    if (outcome.ok) await scheduleCardBots(roomId, outcome.turnNumber);
  };

  const scheduleCardBots = async (roomId: string, turnNumber: number) => {
    if (!options.enableBots) return;
    const bot = await readBotTurn(roomId).catch(() => null);
    if (!bot || bot.turnNumber !== turnNumber) return;

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const outcome = await playBotTurn(roomId, turnNumber);
          await publishRoundOutcome(roomId, outcome);
        } catch (error) {
          telemetryError("bot_card_turn_failed", error, { roomId, turnNumber });
        }
      })();
    }, cardTurnDelayMs(bot.personality));
    timer.unref();

    const key = `${roomId}:${turnNumber}`;
    const timers = botTimers.get(key) ?? [];
    timers.push(timer);
    botTimers.set(key, timers);
  };

  const cancelBotTimers = (roomId: string, turnNumber: number) => {
    const key = `${roomId}:${turnNumber}`;
    const timers = botTimers.get(key);
    if (!timers) return;
    for (const timer of timers) clearTimeout(timer);
    botTimers.delete(key);
  };

  const cancelDoodleTimers = (roomId: string, turnNumber: number) => {
    const key = `${roomId}:${turnNumber}:doodle`;
    const timers = doodleTimers.get(key);
    if (!timers) return;
    for (const timer of timers) clearTimeout(timer);
    doodleTimers.delete(key);
  };

  /**
   * Whoever draws without a pointer — the house in the current game, or a bot
   * artist — sketches the target word with the templates in doodles.ts (§8);
   * otherwise the turn shows an empty board that no solver could answer. Strokes
   * are stored exactly like a human artist's, so `draw_sync` replays them to
   * anyone who joins or reconnects.
   */
  const scheduleBotDoodle = async (roomId: string, turnNumber: number) => {
    const room = await pool.query<{
      target_word: string | null;
      active_player_id: string | null;
      is_bot: boolean | null;
    }>(
      `SELECT g.target_word, g.active_player_id, p.is_bot
         FROM public.game_rooms g
         LEFT JOIN public.room_players p
           ON p.room_id = g.id AND p.player_id = g.active_player_id
        WHERE g.id = $1`,
      [roomId]
    );
    const row = room.rows[0];
    // Draw unless a human owns the turn: `active_player_id === null` is the
    // house, and a bot artist is equally pointerless. A human artist draws with
    // their own pointer, so their board must be left alone.
    const artistIsHuman = Boolean(row && row.active_player_id !== null && row.is_bot !== true);
    if (!row || artistIsHuman || !row.target_word) return;

    const doodle = doodleFor(row.target_word);
    if (!doodle || doodle.length === 0) return;

    const key = `${roomId}:${turnNumber}`;
    const store = drawStrokes.get(key) ?? [];
    // Re-announcing a turn (resume, rejoin) must not sketch the same word twice.
    if (store.length > 0) return;
    drawStrokes.set(key, store);

    cancelDoodleTimers(roomId, turnNumber);
    const passes = 4;
    const perPass = Math.max(1, Math.ceil(doodle.length / passes));
    const timers: NodeJS.Timeout[] = [];
    for (let i = 0; i < doodle.length; i += perPass) {
      const chunk = doodle.slice(i, i + perPass);
      const timer = setTimeout(() => {
        void (async () => {
          try {
            const live = await pool.query<{ turn_number: string }>(
              `SELECT turn_number FROM public.game_rooms WHERE id=$1`,
              [roomId]
            );
            // The turn moved on: its strokes were already discarded.
            if (!live.rows[0] || Number(live.rows[0].turn_number) !== turnNumber) return;
            store.push(...chunk);
            broadcast(roomId, { type: "draw_op", roomId, turnNumber, strokes: chunk, bot: true });
          } catch (error) {
            telemetryError("bot_doodle_failed", error, { roomId, turnNumber });
          }
        })();
      }, 200 + (i / perPass) * 240);
      timer.unref?.();
      timers.push(timer);
    }
    doodleTimers.set(`${roomId}:${turnNumber}:doodle`, timers);
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
      // A solver's answer is paced across the round (ANSWER_WINDOW_SHARE), so a
      // human can beat it; idle/no-move plans keep the fixed §16 timings.
      const delay =
        plan.kind === "submit" ? botAnswerDelayMs(plan.personality, remaining) : clampToWindow(plan.decisionMs, remaining);
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

  /**
   * Announce a freshly written turn (§13).
   *
   * Everyone receives the public shape of the turn; ONLY the artist's socket
   * receives the word itself. Without this the artist has nothing to draw — and
   * if it were broadcast the answer would be public and the game pointless.
   */
  const announceTurn = async (roomId: string, turnNumber: number) => {
    const room = await pool.query<{
      turn_number: string;
      round_number: number;
      active_player_id: string | null;
      target_word: string | null;
      turn_deadline_at: string | null;
    }>(
      `SELECT turn_number,round_number,active_player_id,target_word,turn_deadline_at
         FROM public.game_rooms WHERE id=$1`,
      [roomId]
    );
    const row = room.rows[0];
    // The turn may already have moved on; never announce a stale one.
    if (!row || Number(row.turn_number) !== turnNumber) return;

    const target = typeof row.target_word === "string" && row.target_word ? row.target_word : null;

    // A new turn starts with a blank board.
    drawStrokes.delete(`${roomId}:${turnNumber}`);

    broadcast(roomId, {
      type: "turn_started",
      roomId,
      roundNumber: Number(row.round_number),
      turnNumber: Number(row.turn_number),
      activePlayerId: row.active_player_id,
      artistId: row.active_player_id,
      targetWordLength: target ? target.length : null,
      turnDeadlineAt: row.turn_deadline_at ? new Date(row.turn_deadline_at).toISOString() : null,
      solveWindowEndsAt: null
    });

    if (target && row.active_player_id) {
      for (const [socket, socketPlayerId] of socketsFor(roomId)) {
        if (socketPlayerId === row.active_player_id) {
          send(socket, {
            type: "word_reveal",
            roomId,
            turnNumber: Number(row.turn_number),
            targetWord: target
          });
        }
      }
    }

    // `writeTurn` re-deals as part of starting a turn — patching each hand so
    // the target is spellable — so every player needs a fresh private hand now.
    // Sending hands before the deal (as the match path used to) hands out empty
    // arrays and the player never learns their cards.
    for (const playerId of new Set(socketsFor(roomId).values())) {
      await sendHandTo(roomId, playerId);
    }

    // §8: a client joining or resuming mid-turn must see what has been drawn so
    // far. Sent before the bot starts sketching, so a late `draw_sync` can never
    // wipe strokes that arrived first.
    const strokesSoFar = drawStrokes.get(`${roomId}:${turnNumber}`) ?? [];
    for (const [socket] of socketsFor(roomId)) {
      send(socket, { type: "draw_sync", roomId, turnNumber, strokes: strokesSoFar });
    }

    await scheduleBotDoodle(roomId, turnNumber);
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
      cancelDoodleTimers(roomId, ended.turnNumber);
      broadcast(roomId, ended);
      if (ended.terminalState === "no_valid_move") {
        telemetry("no_valid_move", { roomId, turnNumber: ended.turnNumber });
      }
      // `nextActivePlayerId` is null now that the house draws every turn, so the
      // signal that the room plays on is the turn the transition already wrote.
      if (ended.nextTurnNumber !== null) {
        await announceTurn(roomId, ended.nextTurnNumber);
        await scheduleBots(roomId, ended.nextTurnNumber);
      }
    }

    if (outcome.snapshot) broadcast(roomId, outcome.snapshot);
  };

  /**
   * Seat a freshly matched table and start play.
   *
   * Order matters: sockets must be attached to the room BEFORE anything is
   * broadcast to it. Broadcasting to a room whose members are not yet attached
   * sends to nobody, which left the client waiting forever for its first
   * snapshot even though the server considered the match delivered.
   */
  const startMatchedTable = async (results: MatchResult[]) => {
    const roomId = results[0]!.roomId;

    for (const result of results) {
      const socket = playerSockets.get(result.playerId);
      if (socket) attachToRoom(socket, roomId, result.playerId, 0);
    }

    for (const result of results) {
      const socket = playerSockets.get(result.playerId);
      if (socket) send(socket, { type: "match_found", roomId, seatNumber: result.seatNumber });
    }

    broadcast(roomId, results[0]!.snapshot);

    // The deal happens here rather than at join, and each seat is sent its own
    // view: a view holds that seat's hand, so it cannot be broadcast.
    const started = await startCardRound(roomId);
    if (!started.ok) {
      // The table is seated but cannot play — a seat that cannot cover the stake,
      // or a missing one. Say so, or four clients sit on "starting…" forever.
      broadcast(roomId, {
        type: "round_refused",
        roomId,
        reason: started.code,
        serverTime: new Date().toISOString()
      });
      return;
    }
    await publishRoundOutcome(roomId, started);
  };

  const matchmakingTimer = enableMatchmaking
    ? setInterval(() => {
        void runMatchmakingPass()
          .then(async (results) => {
            if (results.length === 0) return;
            await startMatchedTable(results);
          })
          .catch((error) => telemetryError("matchmaking_pass_failed", error));
      }, 400)
    : null;
  matchmakingTimer?.unref?.();

  // The server owns the clock: a seat that walked away is drawn and passed, and
  // a round that has been won is dealt again once its reveal has been up long
  // enough. Both arrive here as ordinary round outcomes, so a table sees the
  // sweeper's move exactly as it sees another seat's.
  const scheduler: Scheduler | null = enableScheduler
    ? startScheduler({
        onTurnExpired: (roomId, outcome) => publishRoundOutcome(roomId, outcome),
        onRoundDealt: (roomId, outcome) => publishRoundOutcome(roomId, outcome),
        onTableClosed: async (roomId, reason) => {
          // A table that cannot afford another round is over, not stalled. Say so,
          // or the seats sit looking at a reveal that will never advance.
          broadcast(roomId, {
            type: "table_closed",
            roomId,
            reason,
            serverTime: new Date().toISOString()
          });
        },
        onDrawingTurnClosed: async (roomId, outcome) => {
          if (outcome.snapshot) await publishOutcome(roomId, outcome);
        }
      })
    : null;

  webSocketServer.on("connection", (socket) => {
    contexts.set(socket, { playerId: null, roomId: null, connectionVersion: null, chatWindowStartedAt: 0, chatCount: 0 });
    send(socket, { type: "server_ready", serverTime: new Date().toISOString(), protocol: 2 });

    // attachToRoom lives in the outer scope so matchmaking can seat a player
    // before that player has joined a room themselves.
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
          attachToRoom(socket, result.snapshot.roomId, message.playerId, 0);
          send(socket, result.snapshot);
          for (const event of result.events) send(socket, event);
          return;
        }

        if (type === "join_room") {
          if (typeof message.roomId !== "string" || !message.roomId) throw new Error("invalid_room_id");
          if (typeof message.playerId !== "string" || !message.playerId) throw new Error("invalid_player_id");
          const result = await joinRoom(message.roomId, message.playerId);
          attachToRoom(socket, result.snapshot.roomId, message.playerId, 0);
          send(socket, result.snapshot);
          broadcast(result.snapshot.roomId, result.snapshot);
          for (const event of result.events) broadcast(result.snapshot.roomId, event);
          // No hand is sent here: a hand is dealt with the round, and this room is
          // still filling up (§10). The deal at the start of play sends each seat
          // its own view, which is where its cards live.
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
        playerSockets.set(identity.playerId, socket);

        if (type === "find_match") {
          const displayName = typeof message.displayName === "string" ? message.displayName.slice(0, 24) : null;
          await enqueuePlayer(identity.playerId, displayName);
          const results = await runMatchmakingPass();
          if (results.length > 0) {
            await startMatchedTable(results);
          } else {
            send(socket, { type: "match_queued", serverTime: new Date().toISOString() });
          }
          return;
        }

        if (type === "resume_room") {
          if (typeof message.roomId !== "string" || !message.roomId) throw new Error("invalid_room_id");
          // A connection that is already attached to a room must not resume
          // again. A second resume can only duplicate state and bump
          // connection_version a second time, which then breaks the
          // version-guarded disconnect path.
          if (context.roomId !== null) {
            protocolError(socket, "resume_already_active", requestId);
            return;
          }
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
          attachToRoom(socket, result.snapshot.roomId, identity.playerId, result.connectionVersion);
          // The room's public shape always goes out — who is seated, what phase
          // the table is in — and a card round additionally sends this seat its
          // own view, which is where its hand, its legal cards and the pile of
          // thrown cards now live. A table still filling up has no round in play
          // and gets the snapshot alone.
          send(socket, result.snapshot);
          const view = await readRoundView(result.snapshot.roomId, identity.playerId).catch(() => null);
          if (view) {
            send(socket, view);
            // A reconnect can land on a bot's turn whose timer died with whatever
            // held it (a restart, an eviction). Re-arm it rather than leave the
            // table to be timed out. No-op when the seat on the clock is human.
            await scheduleCardBots(result.snapshot.roomId, view.turnNumber);
          }
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
          const started = await startCardRound(context.roomId);
          if (!started.ok) {
            protocolError(socket, started.code ?? "cannot_start", requestId);
            return;
          }
          await publishRoundOutcome(context.roomId, started);
          return;
        }

        // One handler for the five things a seat may do on its turn: they differ
        // only in which action the rules are asked to apply.
        if (typeof type === "string" && CARD_ACTIONS[type]) {
          if (typeof context.roomId !== "string") throw new Error("invalid_request_id");
          if (typeof message.roomId !== "string" || message.roomId !== context.roomId) throw new Error("invalid_request_id");
          if (typeof message.turnNumber !== "number" || !Number.isInteger(message.turnNumber)) {
            throw new Error("invalid_action");
          }
          if (typeof message.requestId !== "string" || !message.requestId) throw new Error("invalid_request_id");

          const cardId = typeof message.cardId === "string" && message.cardId ? message.cardId : null;
          const named = typeof message.color === "string" && (COLORS as readonly string[]).includes(message.color)
            ? (message.color as CardColor)
            : null;
          const targetPlayerId = typeof message.targetPlayerId === "string" && message.targetPlayerId
            ? message.targetPlayerId
            : null;

          const outcome = await applyRoundAction({
            roomId: context.roomId,
            turnNumber: message.turnNumber,
            // The client's request id is the ledger key, so a retry is replayed
            // rather than thrown twice.
            actionId: message.requestId,
            kind: CARD_ACTIONS[type] as RoundActionKind,
            playerId: identity.playerId,
            cardId,
            color: named,
            targetPlayerId
          });

          // Every action answers, accepted or refused. A client left waiting for
          // a result that never arrives cannot tell that apart from a lost
          // response.
          send(socket, {
            type: "action_result",
            requestId: message.requestId,
            roomId: context.roomId,
            kind: CARD_ACTIONS[type],
            status: outcome.ok ? "accepted" : "rejected",
            reason: outcome.code,
            replayed: outcome.replayed,
            roundNumber: outcome.roundNumber,
            turnNumber: outcome.turnNumber,
            serverTime: new Date().toISOString()
          });

          await publishRoundOutcome(context.roomId, outcome);
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
      if (context?.playerId && playerSockets.get(context.playerId) === socket) {
        playerSockets.delete(context.playerId);
      }
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
