import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { checkDatabase, pool } from "./db.js";
import { config } from "./config.js";
import {
  createRoom,
  joinRoom,
  markPlayerDisconnected,
  resumeRoom,
  type DisconnectHooks,
  type RoomEvent
} from "./rooms.js";

export type ServerOptions = {
  disconnectHooks?: DisconnectHooks;
  onSocketClose?: () => void;
};

export type ServerApp = {
  httpServer: ReturnType<typeof createServer>;
  webSocketServer: WebSocketServer;
  listen: (port: number, host: string) => Promise<void>;
  close: () => Promise<void>;
};

export function createServerApp(options: ServerOptions = {}): ServerApp {
  const httpServer = createServer(async (request, response) => {
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

  webSocketServer.on("connection", (socket) => {
    let joinedRoomId: string | null = null;
    let joinedPlayerId: string | null = null;
    let connectionVersion: number | null = null;

    send(socket, {
      type: "server_ready",
      serverTime: new Date().toISOString()
    });

    socket.on("message", async (raw) => {
      try {
        const message = parseMessage(raw);
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
          if (typeof message.roomId !== "string" || !message.roomId) {
            throw new Error("invalid_room_id");
          }
          if (typeof message.playerId !== "string" || !message.playerId) {
            throw new Error("invalid_player_id");
          }
          if (joinedRoomId !== null || joinedPlayerId !== null) {
            throw new Error("resume_already_active");
          }

          send(socket, {
            type: "resume_started",
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
            roomId: result.snapshot.roomId,
            eventSequence: result.snapshot.eventSequence,
            serverTime: new Date().toISOString()
          });
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

        send(socket, {
          type: "error",
          reason: "unknown_message_type"
        });
      } catch (error) {
        console.error("[ws] Message handling failed:", error);
        send(socket, {
          type: "error",
          reason: error instanceof Error ? error.message : "internal_error"
        });
      }
    });

    socket.on("close", () => {
      options.onSocketClose?.();
      if (!joinedRoomId || !joinedPlayerId || connectionVersion === null) return;

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
