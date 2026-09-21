import puppeteer from "puppeteer";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const url = "file://" + join(here, "classic.html") + "?demo=1";

const cases = [
  { name: "1600x900", width: 1600, height: 900, portrait: false },
  { name: "1366x768", width: 1366, height: 768, portrait: false },
  { name: "1280x720", width: 1280, height: 720, portrait: false },
  { name: "narrow 1024x600", width: 1024, height: 600, portrait: false },
  { name: "portrait 900x1400", width: 900, height: 1400, portrait: true }
];

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`   ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
};

const browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });

for (const c of cases) {
  console.log(`\n=== ${c.name} ===`);
  const page = await browser.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.setViewport({ width: c.width, height: c.height, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: "load" });
  await new Promise((r) => setTimeout(r, 700));

  const r = await page.evaluate(() => {
    const stage = document.getElementById("stage");
    const rect = stage.getBoundingClientRect();
    const inside = (el) => {
      if (!el) return false;
      const b = el.getBoundingClientRect();
      return b.left >= rect.left - 1 && b.right <= rect.right + 1 && b.top >= rect.top - 1 && b.bottom <= rect.bottom + 1;
    };
    const cards = [...document.querySelectorAll(".letter")];
    return {
      scale: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--s")),
      rect: { l: rect.left, t: rect.top, w: rect.width, h: rect.height },
      vw: window.innerWidth, vh: window.innerHeight,
      scrollW: document.documentElement.scrollWidth, scrollH: document.documentElement.scrollHeight,
      cardCount: cards.length,
      cardsInside: cards.every(inside),
      cardBox: cards[0] ? (({ width, height }) => [Math.round(width), Math.round(height)])(cards[0].getBoundingClientRect()) : null,
      cardLabels: cards.map((x) => x.textContent).join(""),
      selectedCount: cards.filter((x) => x.classList.contains("selected")).length,
      guard: document.getElementById("rotate").classList.contains("on"),
      seats: [...document.querySelectorAll(".seat")].map((s) => ({
        id: s.id.replace("seat-", ""), vis: getComputedStyle(s).visibility, inside: inside(s)
      })),
      boardInside: inside(document.getElementById("board")),
      chatInside: inside(document.querySelector(".chat")),
      reactInside: inside(document.querySelector(".reactions")),
      handInside: inside(document.getElementById("hand")),
      actionsInside: inside(document.querySelector(".actions")),
      headerInside: inside(document.querySelector(".header")),
      revealText: document.getElementById("reveal").textContent.trim(),
      timerText: document.getElementById("timer").textContent,
      wordPreview: document.getElementById("wordPreview").textContent,
      boardDrawable: !document.getElementById("boardWrap").classList.contains("readonly"),
      chatMsgs: document.querySelectorAll("#msgs .msg").length,
      bubbles: document.querySelectorAll(".bubble").length,
      noScrollbars: document.documentElement.clientWidth === window.innerWidth &&
                    document.documentElement.clientHeight === window.innerHeight,
      clientW: document.documentElement.clientWidth, clientH: document.documentElement.clientHeight,
      bleed: (() => {
        const el = document.getElementById("bleed");
        if (!el) return null;
        const b = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
          coversViewport: b.left <= 0.5 && b.top <= 0.5 && b.right >= window.innerWidth - 0.5 && b.bottom >= window.innerHeight - 0.5,
          hasImage: /classic-scene-hd\.webp/.test(cs.backgroundImage)
        };
      })(),
      cardStageSize: cards[0] ? (() => {
        const b = cards[0].getBoundingClientRect();
        const s = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--s")) || 1;
        return [Math.round(b.width / s), Math.round(b.height / s)];
      })() : null,
      canvasPainted: (() => {
        const cv = document.getElementById("board");
        const ctx = cv.getContext("2d");
        const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
        let painted = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 0) painted += 1;
        return painted;
      })()
    };
  });

  const expectedScale = Math.min(c.width / 1600, c.height / 900);
  const is169 = Math.abs(c.width / c.height - 16 / 9) < 0.01;

  check("uniform scale == min(w/1600, h/900)", Math.abs(r.scale - expectedScale) < 0.001, `scale=${r.scale.toFixed(4)} expected=${expectedScale.toFixed(4)}`);
  // The absolutely-positioned stage legitimately overflows the layout box (a
  // transform does not shrink layout size), so the real question is whether a
  // scrollbar is actually rendered, which clientWidth answers.
  check("no scrollbar rendered", r.noScrollbars === true, `client=${r.clientW}x${r.clientH} inner=${r.vw}x${r.vh}`);
  check("no console errors", errors.length === 0, errors.slice(0, 2).join(" | "));

  if (c.portrait) {
    check("orientation guard shown", r.guard === true);
  } else {
    check("orientation guard hidden", r.guard === false);
    if (is169) {
      check("16:9 viewport: stage fills it exactly", Math.abs(r.rect.l) < 1.5 && Math.abs(r.rect.t) < 1.5 && Math.abs(r.rect.w - r.vw) < 1.5 && Math.abs(r.rect.h - r.vh) < 1.5,
        `rect=${r.rect.l.toFixed(1)},${r.rect.t.toFixed(1)} ${r.rect.w.toFixed(1)}x${r.rect.h.toFixed(1)} vs ${r.vw}x${r.vh}`);
    } else {
      // Non-16:9 must letterbox under uniform scaling, so require the bleed
      // layer to cover the whole viewport instead of a grey band.
      check("non-16:9: art bleeds over the letterbox (no grey band)", r.bleed && r.bleed.coversViewport === true && r.bleed.hasImage === true, JSON.stringify(r.bleed));
    }
    check("exactly 14 cards rendered", r.cardCount === 14, `count=${r.cardCount}`);
    check("all 14 cards fully inside the stage", r.cardsInside === true);
    check("card keeps its stage-space size (64x88)", r.cardStageSize && r.cardStageSize[0] === 64 && r.cardStageSize[1] === 88, `stage-space=${r.cardStageSize} device=${r.cardBox}`);
    check("cards remain legible on screen (>=38px wide)", r.cardBox && r.cardBox[0] >= 38, `device width=${r.cardBox && r.cardBox[0]}px`);
    check("3 opponent seats visible", r.seats.length === 3 && r.seats.every((s) => s.vis === "visible"), JSON.stringify(r.seats));
    check("opponent seats inside stage", r.seats.every((s) => s.inside));
    check("board inside stage", r.boardInside);
    check("chat rail inside stage", r.chatInside);
    check("reactions rail inside stage", r.reactInside);
    check("hand row inside stage", r.handInside);
    check("action buttons inside stage", r.actionsInside);
    check("header inside stage", r.headerInside);
    check("demo: artist sees the word", /LANTERN/i.test(r.revealText), r.revealText);
    check("demo: board is drawable for the artist", r.boardDrawable === true);
    check("demo: canvas has painted pixels", r.canvasPainted > 200, `painted=${r.canvasPainted}`);
    check("demo: countdown is ticking", /^\d+\.\d s?$|^\d+\.\ds$/.test(r.timerText.replace(/\s/g, "")) || /\d\.\d/.test(r.timerText), r.timerText);
    check("demo: chat rendered", r.chatMsgs >= 2, `msgs=${r.chatMsgs}`);
    check("demo: selected cards highlighted", r.selectedCount === 2, `selected=${r.selectedCount}`);
    check("demo: word preview shows selection", r.wordPreview.length === 2, `preview="${r.wordPreview}"`);
  }

  await page.close();
}

await browser.close();
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
