import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { checkDatabase, pool } from "./db.js";
import { config } from "./config.js";
import { createRoom, joinRoom, type RoomEvent } from "./rooms.js";

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
        roomSockets.set(joinedRoomId, new Set([socket]));
        send(socket, result.snapshot);
        for (const event of result.events) send(socket, event);
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
    if (!joinedRoomId) return;
    const sockets = roomSockets.get(joinedRoomId);
    if (!sockets) return;
    sockets.delete(socket);
    if (sockets.size === 0) roomSockets.delete(joinedRoomId);
  });
});

async function start(): Promise<void> {
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
    process.exitCode = 1;
    return;
  }

  await new Promise<void>((resolve) => {
    httpServer.listen(config.port, config.host, () => resolve());
  });

  console.log(
    `[startup] HTTP/WebSocket server listening on http://${config.host}:${config.port}`
  );
}

async function shutdown(signal: string): Promise<void> {
  console.log(`[shutdown] Received ${signal}; closing server`);
  webSocketServer.close();
  httpServer.close(async () => {
    await pool.end();
    console.log("[shutdown] PostgreSQL pool closed");
  });
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

void start();
