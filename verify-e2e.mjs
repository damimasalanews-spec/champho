/**
 * End-to-end proof that the Classic client and the authoritative server are
 * actually connected: real server process, real WebSocket, real matchmaking,
 * real bots, real turn advance — driven through the page the player sees.
 */
import { spawn } from "node:child_process";
import puppeteer from "puppeteer";

const PORT = 3411;
const DB = process.env.DATABASE_URL;

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
};

const server = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "server/main.ts"], {
  env: { ...process.env, HOST: "127.0.0.1", PORT: String(PORT), SESSION_SECRET: "e2e-secret", MATCH_GRACE_MS: "150" },
  stdio: ["ignore", "pipe", "pipe"]
});
let serverLog = "";
server.stdout.on("data", (c) => { serverLog += c.toString(); });
server.stderr.on("data", (c) => { serverLog += c.toString(); });

const listening = new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("server did not start:\n" + serverLog)), 60000);
  const poll = setInterval(() => {
    if (serverLog.includes("listening")) { clearInterval(poll); clearTimeout(t); resolve(); }
  }, 200);
});

let browser;
try {
  await listening;
  console.log("server listening on " + PORT);

  browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  // Capture every WebSocket frame so we can prove what the server did and did
  // not send to a player.
  await page.evaluateOnNewDocument(() => {
    window.__frames = [];
    const Native = window.WebSocket;
    window.WebSocket = function (...args) {
      const sock = new Native(...args);
      sock.addEventListener("message", (ev) => {
        try { window.__frames.push(JSON.parse(ev.data)); } catch { /* ignore */ }
      });
      return sock;
    };
    window.WebSocket.prototype = Native.prototype;
  });

  await page.setViewport({ width: 1600, height: 900 });
  await page.goto(`http://127.0.0.1:${PORT}/classic.html`, { waitUntil: "load" });

  const waitFor = async (fn, ms, label) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const v = await page.evaluate(fn);
      if (v) return v;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error("timed out waiting for " + label);
  };

  // --- 1. matchmaking happens with no room code ---------------------------
  const snap = await waitFor(() => {
    const f = (window.__frames || []).filter((m) => m.type === "room_snapshot");
    return f.length ? f[f.length - 1] : null;
  }, 30000, "room_snapshot");
  check("server sent a room_snapshot", !!snap);
  check("room was filled with 3 bots + me", snap.players.length === 4 && snap.players.filter((p) => p.isBot).length === 3,
    snap.players.map((p) => `${p.displayName}${p.isBot ? "(bot)" : ""}`).join(", "));

  const noRoomCode = await page.evaluate(() => {
    const t = document.body.innerText.toUpperCase();
    return !/ROOM\s*CODE|SHARE THE ROOM|JOIN ROOM|CREATE ROOM/.test(t);
  });
  check("no room-code UI is shown to the player", noRoomCode === true);

  // --- 2. exactly 14 private cards, rendered -------------------------------
  const hand = await waitFor(() => {
    const f = (window.__frames || []).filter((m) => m.type === "hand_sync" && m.hand && m.hand.length);
    return f.length ? f[f.length - 1].hand : null;
  }, 30000, "hand_sync");
  check("private hand_sync carries exactly 14 cards", hand.length === 14, "cards=" + hand.length);

  const dom = await page.evaluate(() => ({
    cards: document.querySelectorAll(".letter").length,
    names: [...document.querySelectorAll(".seat .name")].map((n) => n.textContent),
    turnPill: document.getElementById("turnPill").textContent,
    timer: document.getElementById("timer").textContent,
    reveal: document.getElementById("reveal").textContent.trim()
  }));
  check("UI rendered 14 selectable cards", dom.cards === 14, "rendered=" + dom.cards);
  check("UI shows three opponents", dom.names.filter((n) => n && n !== "Waiting…").length === 3, dom.names.join(" | "));
  check("countdown is live", /\d\.\d/.test(dom.timer), "timer=" + dom.timer);

  // --- 3. §11: no other player's hand is ever transmitted -----------------
  const leak = await page.evaluate(() => {
    const frames = window.__frames || [];
    const bad = [];
    for (const m of frames) {
      const s = JSON.stringify(m);
      if (/bot\d*Hand|bot\d*_hand|private_hand|opponentHand/i.test(s)) bad.push(m.type);
    }
    const handFrames = frames.filter((m) => m.type === "hand_sync");
    const wrongSizes = handFrames.filter((m) => !Array.isArray(m.hand) || m.hand.length !== 14).map((m) => m.hand && m.hand.length);
    return { bad, handFrameCount: handFrames.length, wrongSizes, types: [...new Set(frames.map((m) => m.type))] };
  });
  check("no bot/opponent hand ever appears in any frame", leak.bad.length === 0, JSON.stringify(leak.bad));
  check("every hand_sync is exactly 14 cards", leak.wrongSizes.length === 0, JSON.stringify(leak.wrongSizes));

  // --- 4. the game advances on its own (bots + server clock) --------------
  const firstTurn = snap.turnNumber;
  const advanced = await waitFor((start) => {
    const f = (window.__frames || []).filter((m) => m.type === "turn_ended");
    if (f.length) return { via: "turn_ended", turn: f[f.length - 1].turnNumber, state: f[f.length - 1].terminalState };
    const s = (window.__frames || []).filter((m) => m.type === "turn_started");
    if (s.length && s[s.length - 1].turnNumber > start) return { via: "turn_started", turn: s[s.length - 1].turnNumber };
    return null;
  }, 25000, "turn advance", firstTurn);
  check("a turn ended by itself without any client input", !!advanced, JSON.stringify(advanced));

  const after = await page.evaluate(() => {
    const s = (window.__frames || []).filter((m) => m.type === "turn_started");
    return s.length ? s[s.length - 1].turnNumber : null;
  });
  check("the turn number advanced", typeof after === "number" && after > firstTurn, `turn ${firstTurn} -> ${after}`);

  // --- 5. no page errors --------------------------------------------------
  check("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));

  console.log("\n  observed frame types: " + leak.types.join(", "));
} catch (error) {
  failures += 1;
  console.log("  FAIL  " + (error && error.message ? error.message : String(error)));
  if (serverLog) console.log("  --- server log tail ---\n" + serverLog.split("\n").slice(-12).join("\n"));
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill("SIGTERM");
  setTimeout(() => server.kill("SIGKILL"), 1500);
}

console.log(`\n${failures === 0 ? "E2E PASSED" : failures + " E2E CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
