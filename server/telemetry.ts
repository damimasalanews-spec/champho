/**
 * Structured telemetry (§47).
 *
 * One JSON line per transition. Private hand contents are never logged — only
 * the identifiers needed to reconstruct what happened server-side.
 */
export function telemetry(event: string, fields: Record<string, unknown> = {}): void {
  const line = { ts: new Date().toISOString(), event, ...fields };
  console.log(`[telemetry] ${JSON.stringify(line)}`);
}

export function telemetryError(event: string, error: unknown, fields: Record<string, unknown> = {}): void {
  const message = error instanceof Error ? error.message : String(error);
  telemetry(event, { ...fields, result: "error", error: message });
}
