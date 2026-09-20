import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { checkDatabase, pool } from "./db.js";
import { config } from "./config.js";
import {
  createRoom,
  joinRoom,
  startRound,
  markPlayerDisconnected,
  resumeRoom,
  type DisconnectHooks,
  type RoomEvent
} from "./rooms.js";
import { submitWord } from "./submissions.js";
import { runProductionPreflight } from "./preflight.js";

export type ServerOptions = {
  disconnectHooks?: DisconnectHooks;
  onSocketClose?: (socket: WebSocket) => void;
};

export type ServerApp = {
  httpServer: ReturnType<typeof createServer>;
  webSocketServer: WebSocketServer;
  listen: (port: number, host: string) => Promise<void>;
  close: () => Promise<void>;
};

export function createServerApp(options: ServerOptions = {}): ServerApp {
  const httpServer = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/__production-preflight") {
      const expectedToken = process.env.PRODUCTION_PREFLIGHT_TOKEN;
      const suppliedToken = request.headers.authorization?.replace(/^Bearer\\s+/, "");
      if (!expectedToken || suppliedToken !== expectedToken) {
        response.writeHead(404);
        response.end();
        return;
      }

      try {
        const result = await runProductionPreflight(pool);
        response.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store"
        });
        response.end(JSON.stringify(result));
      } catch (error) {
        console.error("[preflight] PostgreSQL check failed:", error);
        response.writeHead(500, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store"
        });
        response.end(JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : "internal_error"
        }));
      }
      return;
    }

    if (request.method !== "GET" || request.url !== "/health") {
      response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: false, error: "not_found" }));
      return;
    }

    try {
      const database = await checkDatabase();

      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      });
      response.end(
        JSON.stringify({
          ok: true,
          service: "champ-word-backend",
          database: {
            ok: database.ok,
            latencyMs: database.latencyMs
          }
        })
      );
    } catch (error) {
      console.error("[health] PostgreSQL check failed:", error);
      response.writeHead(503, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      });
      response.end(
        JSON.stringify({
          ok: false,
          service: "champ-word-backend",
          database: { ok: false }
        })
      );
    }
  });

  const webSocketServer = new WebSocketServer({ server: httpServer });
  const roomSockets = new Map<string, Set<WebSocket>>();

  function send(socket: WebSocket, message: unknown): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  function broadcast(sockets: Set<WebSocket>, message: RoomEvent): void {
    for (const socket of sockets) send(socket, message);
  }

  function parseMessage(raw: WebSocket.RawData): Record<string, unknown> {
    const parsed: unknown = JSON.parse(raw.toString());
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid_message");
    }
    return parsed as Record<string, unknown>;
  }

  function protocolError(
    socket: WebSocket,
    code: string,
    requestId?: unknown
  ): void {
    send(socket, {
      type: "error",
      code,
      message: code,
      serverTime: new Date().toISOString(),
      ...(typeof requestId === "string" && requestId ? { requestId } : {})
    });
  }

  webSocketServer.on("connection", (socket) => {
    let joinedRoomId: string | null = null;
    let joinedPlayerId: string | null = null;
    let connectionVersion: number | null = null;

    send(socket, {
      type: "server_ready",
      serverTime: new Date().toISOString()
    });

    socket.on("message", async (raw) => {
      let requestId: string | undefined;
      try {
        const message = parseMessage(raw);
        requestId = typeof message.requestId === "string" ? message.requestId : undefined;
        const type = message.type;

        if (type === "create_room") {
          if (typeof message.playerId !== "string" || !message.playerId) {
            throw new Error("invalid_player_id");
          }

          const result = await createRoom(message.playerId);
          joinedRoomId = result.snapshot.roomId;
          joinedPlayerId = message.playerId;
          connectionVersion = 0;
          roomSockets.set(joinedRoomId, new Set([socket]));
          send(socket, result.snapshot);
          for (const event of result.events) send(socket, event);
          return;
        }

        if (type === "resume_room") {
          if (typeof message.requestId !== "string" || !message.requestId) {
            throw new Error("invalid_request_id");
          }
          if (typeof message.roomId !== "string" || !message.roomId) {
            throw new Error("invalid_room_id");
          }
          if (typeof message.playerId !== "string" || !message.playerId) {
            throw new Error("invalid_player_id");
          }
          if (typeof message.roundNumber !== "number" || !Number.isInteger(message.roundNumber) || message.roundNumber < 1) {
            throw new Error("invalid_round_number");
          }
          if (typeof message.lastEventSequence !== "number" || !Number.isInteger(message.lastEventSequence) || message.lastEventSequence < 0) {
            throw new Error("invalid_event_sequence");
          }
          if (typeof message.handVersion !== "number" || !Number.isInteger(message.handVersion) || message.handVersion < 0) {
            throw new Error("invalid_hand_version");
          }
          if (joinedRoomId !== null || joinedPlayerId !== null) {
            throw new Error("resume_already_active");
          }

          send(socket, {
            type: "resume_started",
            requestId: message.requestId,
            roomId: message.roomId,
            serverTime: new Date().toISOString()
          });

          const result = await resumeRoom(message.roomId, message.playerId);
          joinedRoomId = result.snapshot.roomId;
          joinedPlayerId = message.playerId;
          connectionVersion = result.connectionVersion;
          const sockets = roomSockets.get(joinedRoomId) ?? new Set<WebSocket>();
          sockets.add(socket);
          roomSockets.set(joinedRoomId, sockets);

          send(socket, result.snapshot);
          send(socket, {
            type: "resume_complete",
            requestId: message.requestId,
            roomId: result.snapshot.roomId,
            roundNumber: result.snapshot.roundNumber,
            lastEventSequence: result.snapshot.eventSequence,
            handVersion: result.handVersion,
            serverTime: new Date().toISOString()
          });
          return;
        }

        if (type === "start_round") {
          if (typeof message.requestId !== "string" || !message.requestId) throw new Error("invalid_request_id");
          if (typeof joinedRoomId !== "string" || joinedRoomId === null) throw new Error("not_joined");
          const snapshot = await startRound(joinedRoomId);
          const sockets = roomSockets.get(joinedRoomId);
          if (sockets) {
            for (const roomSocket of sockets) send(roomSocket, snapshot);
          }
          return;
        }

        if (type === "submit_word") {
          if (typeof message.requestId !== "string" || !message.requestId) throw new Error("invalid_request_id");
          if (typeof message.roomId !== "string" || !message.roomId) throw new Error("invalid_room_id");
          if (typeof joinedRoomId !== "string" || joinedRoomId !== message.roomId || joinedPlayerId === null) {
            throw new Error("not_joined");
          }
          if (typeof message.roundNumber !== "number" || !Number.isInteger(message.roundNumber) || message.roundNumber < 1) {
            throw new Error("invalid_round_number");
          }
          if (typeof message.turnNumber !== "number" || !Number.isInteger(message.turnNumber) || message.turnNumber < 0) {
            throw new Error("invalid_turn_number");
          }
          if (!Array.isArray(message.cards) || message.cards.length < 1 || message.cards.length > 14 ||
              message.cards.some((card) => typeof card !== "string" || !card)) {
            throw new Error("invalid_cards");
          }
          if (typeof message.word !== "string" || !message.word.trim() || message.word.length > 64) {
            throw new Error("invalid_word");
          }

          const outcome = await submitWord({
            requestId: message.requestId,
            roomId: message.roomId,
            playerId: joinedPlayerId,
            roundNumber: message.roundNumber,
            turnNumber: message.turnNumber,
            cards: message.cards,
            word: message.word
          });

          send(socket, outcome.result);
          for (const event of outcome.events) {
            const sockets = roomSockets.get(outcome.result.roomId);
            if (sockets) broadcast(sockets, event);
          }
          if (outcome.roundCompleted) {
            const sockets = roomSockets.get(outcome.roundCompleted.roomId);
            if (sockets) {
              for (const roomSocket of sockets) send(roomSocket, outcome.roundCompleted);
            }
          }
          if (outcome.snapshot) {
            const sockets = roomSockets.get(outcome.snapshot.roomId);
            if (sockets) {
              for (const roomSocket of sockets) send(roomSocket, outcome.snapshot);
            }
          }
          return;
        }

        if (type === "join_room") {
          if (typeof message.roomId !== "string" || !message.roomId) {
            throw new Error("invalid_room_id");
          }
          if (typeof message.playerId !== "string" || !message.playerId) {
            throw new Error("invalid_player_id");
          }

          const result = await joinRoom(message.roomId, message.playerId);
          joinedRoomId = result.snapshot.roomId;
          joinedPlayerId = message.playerId;
          connectionVersion = 0;
          const sockets = roomSockets.get(joinedRoomId) ?? new Set<WebSocket>();
          sockets.add(socket);
          roomSockets.set(joinedRoomId, sockets);
          send(socket, result.snapshot);
          for (const event of result.events) broadcast(sockets, event);
          return;
        }

        protocolError(socket, "unknown_message_type", message.requestId);
      } catch (error) {
        console.error("[ws] Message handling failed:", error);
        protocolError(
          socket,
          error instanceof Error ? error.message : "internal_error",
          requestId
        );
      }
    });

    socket.on("close", () => {
      if (!joinedRoomId || !joinedPlayerId || connectionVersion === null) return;

      options.onSocketClose?.(socket);

      const roomId = joinedRoomId;
      const playerId = joinedPlayerId;
      const disconnectedConnectionVersion = connectionVersion;
      const sockets = roomSockets.get(roomId);

      if (sockets) {
        sockets.delete(socket);
        if (sockets.size === 0) roomSockets.delete(roomId);
      }

      void markPlayerDisconnected(
        roomId,
        playerId,
        disconnectedConnectionVersion,
        options.disconnectHooks
      ).catch((error) => {
        console.error("[ws] Failed to mark player disconnected:", error);
      });
    });
  });

  async function listen(port: number, host: string): Promise<void> {
    await new Promise<void>((resolve) => {
      httpServer.listen(port, host, () => resolve());
    });
  }

  async function close(): Promise<void> {
    for (const socket of webSocketServer.clients) {
      socket.terminate();
    }

    await new Promise<void>((resolve) => {
      webSocketServer.close(() => resolve());
    });

    await new Promise<void>((resolve, reject) => {
      httpServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  return {
    httpServer,
    webSocketServer,
    listen,
    close
  };
}

export async function start(): Promise<ServerApp> {
  console.log(
    `[startup] CHAMP WORD backend starting on ${config.host}:${config.port}`
  );

  try {
    const database = await checkDatabase();
    console.log(
      `[startup] PostgreSQL connected (latency ${database.latencyMs}ms)`
    );
  } catch (error) {
    console.error("[startup] PostgreSQL connection failed:", error);
    await pool.end();
    throw error;
  }

  const app = createServerApp();
  await app.listen(config.port, config.host);

  console.log(
    `[startup] HTTP/WebSocket server listening on http://${config.host}:${config.port}`
  );

  return app;
}
