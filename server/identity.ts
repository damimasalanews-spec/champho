import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * Server-issued session identity (§21, protocol-v2 §1).
 *
 * The previous implementation adopted whatever playerId a client sent, so any
 * client could claim any identity. Here the server mints a playerId and signs
 * it; a client-supplied playerId is never an authority source.
 */
const SECRET: string = resolveSecret();

function resolveSecret(): string {
  const configured = process.env.SESSION_SECRET?.trim();
  if (configured) return configured;

  // A per-process secret is safe (tokens simply stop verifying after a restart,
  // and clients transparently re-hello) but it is not durable, so say so loudly.
  console.warn(
    "[identity] SESSION_SECRET is not set; using an ephemeral per-process secret. " +
      "Sessions will not survive a restart. Set SESSION_SECRET in production."
  );
  return randomUUID();
}

function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("base64url");
}

export type SessionIdentity = { playerId: string; issuedAt: number };

export function issueSession(existingPlayerId?: string): { sessionToken: string; playerId: string } {
  const playerId = existingPlayerId ?? randomUUID();
  const issuedAt = Date.now();
  const payload = Buffer.from(JSON.stringify({ playerId, issuedAt }), "utf8").toString("base64url");
  return { sessionToken: `${payload}.${sign(payload)}`, playerId };
}

/**
 * Returns the identity when the token is authentic, otherwise null. Uses a
 * constant-time comparison so token validity cannot be probed byte by byte.
 */
export function verifySession(sessionToken: unknown): SessionIdentity | null {
  if (typeof sessionToken !== "string" || sessionToken.length === 0) return null;

  const separator = sessionToken.lastIndexOf(".");
  if (separator <= 0 || separator === sessionToken.length - 1) return null;

  const payload = sessionToken.slice(0, separator);
  const provided = Buffer.from(sessionToken.slice(separator + 1), "utf8");
  const expected = Buffer.from(sign(payload), "utf8");

  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<SessionIdentity>;
    if (typeof parsed.playerId !== "string" || !parsed.playerId) return null;
    if (typeof parsed.issuedAt !== "number" || !Number.isFinite(parsed.issuedAt)) return null;
    return { playerId: parsed.playerId, issuedAt: parsed.issuedAt };
  } catch {
    return null;
  }
}
