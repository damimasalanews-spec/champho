/** Watch a real room for ~22s and report what the bots actually do each turn. */
import { spawn } from "node:child_process";
import { WebSocket } from "ws";

const PORT = 3433;
const server = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "server/main.ts"], {
  env: { ...process.env, HOST: "127.0.0.1", PORT: String(PORT), SESSION_SECRET: "probe", MATCH_GRACE_MS: "150" },
  stdio: ["ignore", "pipe", "pipe"]
});
let log = "";
server.stdout.on("data", (c) => { log += c.toString(); });
server.stderr.on("data", (c) => { log += c.toString(); });

await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("server did not start")), 60000);
  const poll = setInterval(() => {
    if (log.includes("listening")) { clearInterval(poll); clearTimeout(t); resolve(); }
  }, 200);
});

const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`);
const seen = [];
ws.on("open", () => ws.send(JSON.stringify({ type: "hello", requestId: "h1" })));
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "welcome") {
    ws.send(JSON.stringify({ type: "find_match", requestId: "f1", sessionToken: m.sessionToken, displayName: "Probe" }));
  }
  if (["turn_started", "turn_ended", "bot_action", "word_submission_result"].includes(m.type)) {
    seen.push(m.type === "turn_started" ? `turn ${m.turnNumber} started — artist ${String(m.activePlayerId).slice(0, 4)} (${m.targetWordLength} letters)`
      : m.type === "turn_ended" ? `turn ${m.turnNumber} ended: ${m.terminalState}${m.word ? " word=" + m.word : ""} solver=${m.firstSolverId ? String(m.firstSolverId).slice(0, 4) : "none"}`
      : m.type === "bot_action" ? `  bot ${String(m.playerId).slice(0, 4)} -> ${m.kind} (${m.personality}, ${m.decisionMs}ms)`
      : `  submit result: ${m.status} ${m.reason || ""}`);
  }
});

await new Promise((r) => setTimeout(r, 22000));
ws.close();

console.log("=== client-visible turn flow ===");
for (const line of seen) console.log(line);

console.log("\n=== server telemetry (bot + turn events) ===");
const lines = log.split("\n").filter((l) => l.includes("[telemetry]"));
const pick = lines
  .map((l) => { try { return JSON.parse(l.replace("[telemetry] ", "")); } catch { return null; } })
  .filter((e) => e && ["bot_action_failed", "bot_planning_failed", "submission_rejected", "no_valid_move", "turn_advanced", "turn_timeout", "word_submitted", "duplicate_action", "stale_action", "transaction_failed"].includes(e.event));
for (const e of pick.slice(-26)) console.log(JSON.stringify(e));

const counts = {};
for (const l of lines) { const m = l.match(/"event":"([a-z_]+)"/); if (m) counts[m[1]] = (counts[m[1]] || 0) + 1; }
console.log("\n=== telemetry event counts ===");
console.log(JSON.stringify(counts, null, 1));

server.kill("SIGTERM");
setTimeout(() => server.kill("SIGKILL"), 1200);
process.exit(0);
