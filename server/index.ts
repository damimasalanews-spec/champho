import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { checkDatabase, pool } from "./db.js";
import { config } from "./config.js";

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
        database: {
          ok: false
        }
      })
    );
  }
});

const webSocketServer = new WebSocketServer({ server: httpServer });

webSocketServer.on("connection", (socket) => {
  socket.send(
    JSON.stringify({
      type: "server_ready",
      serverTime: new Date().toISOString()
    })
  );
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
