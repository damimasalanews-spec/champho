import test from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { serveStatic } from "../static.js";

/**
 * Regression tests for static routing.
 *
 * These exist because of a specific bug: the server served `index.html` at `/`.
 * That file is the legacy Firebase-era client — 533 KB with no WebSocket code
 * anywhere in it — so every visitor to the root received a page that could not
 * reach the server. The backend was healthy and the game was unplayable.
 *
 * The root must serve the authoritative client (`classic.html`). Asserting on
 * `find_match` is deliberate: that is the protocol message the client uses to
 * enter matchmaking, so its presence is what distinguishes a playable page from
 * a dead one.
 */

/** Marker unique to the legacy page's <title>. */
const LEGACY_MARKER = "V38 Polished Mobile Landscape";

interface Captured {
  status?: number;
  body?: Buffer;
}

function fakeResponse(): { response: ServerResponse; captured: Captured } {
  const captured: Captured = {};
  const response = {
    writeHead(status: number) {
      captured.status = status;
      return response;
    },
    end(chunk?: Buffer | string) {
      if (chunk !== undefined) {
        captured.body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      }
      return response;
    }
  };
  return { response: response as unknown as ServerResponse, captured };
}

async function get(url: string): Promise<{ result: string; status?: number; text: string }> {
  const { response, captured } = fakeResponse();
  const request = { method: "GET", url } as unknown as IncomingMessage;
  const result = await serveStatic(request, response);
  return { result, status: captured.status, text: captured.body?.toString("utf8") ?? "" };
}

test("the root serves the authoritative client, not the legacy page", async () => {
  const root = await get("/");

  assert.equal(root.result, "served");
  assert.equal(root.status, 200);
  assert.match(root.text, /find_match/, "root must contain the matchmaking call");
  assert.doesNotMatch(root.text, new RegExp(LEGACY_MARKER), "root must not be the legacy client");
});

test("/classic.html matches the root and is playable", async () => {
  const classic = await get("/classic.html");

  assert.equal(classic.result, "served");
  assert.match(classic.text, /find_match/);
  assert.doesNotMatch(classic.text, new RegExp(LEGACY_MARKER));
});

test("the legacy page stays reachable at /legacy.html rather than being deleted", async () => {
  const legacy = await get("/legacy.html");

  assert.equal(legacy.result, "served");
  assert.match(legacy.text, new RegExp(LEGACY_MARKER));
});

test("the legacy page is not reachable at /index.html", async () => {
  const index = await get("/index.html");

  assert.equal(index.result, "served");
  assert.match(index.text, /find_match/, "/index.html routes to the authoritative client");
  assert.doesNotMatch(index.text, new RegExp(LEGACY_MARKER));
});

test("asset paths referenced by the authoritative client resolve", async () => {
  const root = await get("/");
  const refs = [...root.text.matchAll(/src="([^"]+)"/g)]
    .map((match) => match[1] ?? "")
    .filter((ref) => ref !== "" && !/^(https?:)?\/\//.test(ref) && !ref.startsWith("data:"));

  assert.ok(refs.length > 0, "the authoritative client should reference local assets");
  for (const ref of refs) {
    const asset = await get(`/${ref.replace(/^\.?\//, "")}`);
    assert.equal(asset.result, "served", `asset ${ref} must be served`);
  }
});

test("a missing file is a 404, and path traversal never serves a file", async () => {
  assert.equal((await get("/definitely-missing.html")).result, "not_found");

  for (const attempt of ["/../etc/passwd", "/%2e%2e/%2e%2e/etc/passwd", "/..%2f..%2fetc/passwd"]) {
    const escaped = await get(attempt);
    assert.notEqual(escaped.result, "served", `${attempt} must not be served`);
    assert.doesNotMatch(escaped.text, /root:x:/, `${attempt} must not leak /etc/passwd`);
  }
});

test("non-GET requests are refused", async () => {
  const { response } = fakeResponse();
  const request = { method: "POST", url: "/" } as unknown as IncomingMessage;
  assert.equal(await serveStatic(request, response), "not_found");
});
