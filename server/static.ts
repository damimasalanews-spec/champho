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
 * The root serves the home page.
 *
 * `index.html` is the legacy Firebase-era page: 533 KB with no WebSocket code in
 * it. Serving it at `/` once handed every visitor a client that could not reach
 * this server at all, and the root was mapped to `classic.html` instead. The home
 * page can reach a game now — its mode cards launch Classic or Go Wild in an
 * overlay, and the overlay is what holds the WebSocket client — so the root is the
 * home page again. It stays mapped together with `/index.html`, because those are
 * the two addresses a visitor actually types.
 */
function routeFor(urlPath: string): string {
  if (urlPath === "/" || urlPath === "/index.html") return "/index.html";
  // Kept: the legacy address still resolves to the home page, so any link handed
  // out before this change keeps working.
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
