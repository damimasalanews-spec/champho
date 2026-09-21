import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Static asset serving.
 *
 * The production frontend and the authoritative backend were two separate Render
 * services, and the frontend never contacted the backend. Serving both from one
 * origin removes that failure mode entirely: the client can derive its socket
 * URL from `location.host` and cannot be pointed at the wrong host.
 */
const ROOT = resolve(process.cwd());

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8"
};

/** Resolve a request path inside ROOT, or null if it escapes. */
function safeResolve(urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  const normalized = normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const candidate = resolve(join(ROOT, normalized));
  if (candidate !== ROOT && !candidate.startsWith(ROOT + sep)) return null;
  return candidate;
}

export type StaticResult = "served" | "not_found" | "forbidden";

/**
 * The root must serve the authoritative client.
 *
 * `index.html` is the legacy Firebase-era page. It is 533 KB and contains no
 * WebSocket code at all — it never contacts this server, so serving it at `/`
 * hands every visitor a client that cannot play a game. That is precisely the
 * frontend/backend split this module exists to prevent, so the root is mapped
 * to the authoritative `classic.html` instead.
 *
 * The legacy page is kept, not deleted: it stays reachable at `/legacy.html`.
 */
function routeFor(urlPath: string): string {
  if (urlPath === "/" || urlPath === "/index.html") return "/classic.html";
  if (urlPath === "/legacy.html") return "/index.html";
  return urlPath;
}

export async function serveStatic(request: IncomingMessage, response: ServerResponse): Promise<StaticResult> {
  if (request.method !== "GET" && request.method !== "HEAD") return "not_found";

  const requested = (request.url ?? "/").split("?")[0] ?? "/";
  const target = safeResolve(routeFor(requested));
  if (!target) return "forbidden";

  let filePath = target;
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, "index.html");
  } catch {
    return "not_found";
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) return "not_found";

    const body = await readFile(filePath);
    response.writeHead(200, {
      "content-type": CONTENT_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream",
      "content-length": body.byteLength,
      // The client is served from this same process, so no caching games.
      "cache-control": "no-store"
    });
    if (request.method === "HEAD") response.end();
    else response.end(body);
    return "served";
  } catch {
    return "not_found";
  }
}
