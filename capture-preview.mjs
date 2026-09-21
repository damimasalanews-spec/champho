/**
 * Capture real screenshots of the running game for a visual preview.
 *
 * Starts the actual server, plays the actual matchmaking flow with the actual
 * bots, and screenshots the page a player would see — not the ?demo=1 fixture.
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import puppeteer from "puppeteer";

const PORT = 3512;
const OUT = process.argv[2] || "/tmp/champword-preview";
mkdirSync(OUT, { recursive: true });

const server = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "server/main.ts"], {
  env: { ...process.env, HOST: "127.0.0.1", PORT: String(PORT), SESSION_SECRET: "preview", MATCH_GRACE_MS: "200" },
  stdio: ["ignore", "pipe", "pipe"]
});
let log = "";
server.stdout.on("data", (c) => { log += c.toString(); });
server.stderr.on("data", (c) => { log += c.toString(); });

await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("server failed to start:\n" + log)), 60000);
  const poll = setInterval(() => {
    if (log.includes("listening")) { clearInterval(poll); clearTimeout(t); resolve(); }
  }, 200);
});
console.log(`server listening on ${PORT}`);

const browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const shots = [];

async function shoot(name, width, height, settleMs = 2500) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${PORT}/classic.html`, { waitUntil: "load" });
  // Wait until the player genuinely holds 14 cards and the turn is live.
  await page.waitForFunction(
    () => document.querySelectorAll(".letter").length === 14,
    { timeout: 30000 }
  ).catch(() => {});
  await new Promise((r) => setTimeout(r, settleMs));
  const path = `${OUT}/${name}.png`;
  await page.screenshot({ path });
  const info = await page.evaluate(() => ({
    cards: document.querySelectorAll(".letter").length,
    seats: [...document.querySelectorAll(".seat .name")].map((n) => n.textContent).filter((n) => n && n !== "Waiting…"),
    turn: document.getElementById("turnPill").textContent,
    timer: document.getElementById("timer").textContent,
    reveal: document.getElementById("reveal").textContent.trim(),
    hint: document.getElementById("boardHint").textContent.trim()
  }));
  shots.push({ name, path, ...info });
  console.log(`  ${name}: ${JSON.stringify(info)}`);
  await page.close();
}

await shoot("classic-1600x900", 1600, 900);
await shoot("classic-1366x768", 1366, 768);
await shoot("classic-1280x720", 1280, 720);
await shoot("portrait-guard-900x1400", 900, 1400, 600);

await browser.close();
server.kill("SIGTERM");
setTimeout(() => server.kill("SIGKILL"), 1200);

console.log("\n=== captured ===");
for (const s of shots) console.log(`${s.path}  (cards=${s.cards}, seats=${s.seats.length}, ${s.turn})`);
process.exit(0);
