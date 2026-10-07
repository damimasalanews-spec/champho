/* ===========================================================================
   CLIPART CONTEST — the post-match guessing duel
   ---------------------------------------------------------------------------
   The wall-push arena is gone from the game entirely. What remains is the
   guessing contest on its own screen: the same stage scaffold (navy overlay,
   1600x900 board, banner, taunts, hype) with the deck centred on it.

     - four 3D clipart pictures of words per duel, 30 seconds each
     - the first duelist to TWO correct answers wins the round (three in the
       grand final); the winner is whoever holds the louder tally
     - the coin stake settles straight into the scoreboard: the winner takes
       the underdog's balance, an underdog win doubles it, capped fairly

   Every word in POOL was checked against game/english-word-bank.js, so the
   contest can only ask for words a player could also have met on the board.
   =========================================================================== */
(() => {
  "use strict";
  if (window.ChampWallGuess) return;

  /* ------------------------------------------------------------------ config */
  const POOL = [
    "cat", "egg", "sun", "key", "bus", "cup",
    "cake", "fish", "star", "boat", "moon", "ring",
    "house", "apple", "crown", "piano",
    "diamond", "giraffe", "butterfly", "pineapple"
  ];
  const ART = w => `assets/clipart/${w}.webp`;
  const HEADS = {
    boy: "assets/avatars/pumpkin-boy.webp",
    girl: "assets/avatars/pumpkin-girl.webp",
    ninja: "assets/avatars/ninja.webp"
  };
  /* the payout video's own ladder: the badge changes word as the total grows */
  const TIERS = [[2400, "SUPER WIN", "super"], [1000, "BIG WIN", "big"], [0, "WIN", ""]];

  const ROUNDS = 4;          /* four cliparts in a duel */
  const SLOT_MS = 30000;     /* 30 seconds for each one */
  const NEED = 2;            /* correct answers a PAIR round needs; the final needs 3 */
  const TICK_MS = 100;
  const BOT_SKILL = 0.9;     /* how often a bot actually knows the picture */
  const SHOVE_MS = 1150;     /* beat between a shove and the next picture */
const FINISH_MS = 1600;    /* beat between the winning answer and the result:
                              the WINS THE ROUND! tab and the hype call get a
                              moment to read before the coins book */
  const CARD_MS = 700;       /* a short settle after the result books, then the
                                next round starts */
  /* correct answers that have to be answered BACK before the other side wins -
     the comeback line's trigger. Also the wrong-answer sound cue's name, which
     shares the constant so the two can never drift apart. */
  const COMEBACK_AT = 2;
  const COMEBACK_WORDS = ["NOW OR NEVER!", "DO OR DIE!", "ONE LEFT!"];
  const HYPE = ["CRUSH 'EM!", "HOLD THE LINE!", "ON FIRE!", "WORD POWER!", "NO MERCY!",
                "UNSTOPPABLE!", "BRACE!!", "LET'S GOOO!"];
  /* the bots have opinions: taunts after they answer, and while they are
     beating you. `final` ones only fire in the title fight, and areNaughty
     taunts (with your name in them) only fire when YOU are losing. */
  const TAUNT = {
    after:  ["HA!", "TOO EASY!", "TOO SLOW!", "WATCH THIS!"],
    ahead:  ["IS THAT ALL?", "GO HOME!", "CATCH UP!", "NOT TODAY!"],
    final:  ["NO MERCY!", "THE WALL IS MINE!", "THIS ENDS NOW!"]
  };
  /* back-to-back duel wins pay extra: the second win in a row is 1.5x, the
     third and every one after it 2x, so a streak is worth protecting */
  const STREAK_MULT = s => (s >= 3 ? 2 : s === 2 ? 1.5 : 1);
  const SUDDEN_WORDS = ["SUDDEN DEATH!", "NEXT WINS!", "ONE PICTURE!"];

  const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
  const normalize = s => String(s || "").toLowerCase().replace(/[^a-z]/g, "").slice(0, 9);
  const fmt = n => Number(n || 0).toLocaleString("en-US");
  const easeOut = t => 1 - Math.pow(1 - t, 3);

  let ui = null;             /* the deck while it is mounted */
  let run = null;            /* the live run: { token, timers } */
  let streaks = new Map();   /* id -> consecutive duel wins, for the payout multiplier */

  /* =============================== rivalry + titles (from champ-rivalry.js) == */
  const RIV = () => window.ChampRivalry || null;
  const chipTitle = name => { try { return RIV() ? RIV().title(name) : ""; } catch (e) { return ""; } };
  const POWERUPS = true;   /* golden pictures on */

  /* ============================================================== the deck UI */
  function buildDeck(stage) {
    const deck = document.createElement("div");
    deck.className = "wp-deck";
    deck.innerHTML =
      '<div class="wd-art"><span class="wd-chip">CLIPART <b data-x="n">1</b>/' + ROUNDS + '</span>' +
        '<img alt="" data-x="img"></div>' +
      '<div class="wd-mid">' +
        '<div class="wd-tab l" data-x="tabA">GOT IT!</div>' +
        '<div class="wd-tab r" data-x="tabB">GOT IT!</div>' +
        '<div class="wd-head">' +
          '<span class="wd-side" data-x="sideA"><b data-x="nameA">—</b>' +
            '<i class="wd-coins" data-x="coinsA">0</i>' +
            '<span class="wd-pips" data-x="tallyA"><i></i><i></i></span>' +
            '<span class="wd-tchip" data-x="titleA"></span></span>' +
          '<span class="wd-midhead"><span class="wd-title">GUESS THE WORD</span>' +
            '<span class="wd-rivalry" data-x="rivalry"></span></span>' +
          '<span class="wd-side" data-x="sideB"><span class="wd-tchip" data-x="titleB"></span>' +
            '<span class="wd-pips" data-x="tallyB"><i></i><i></i></span>' +
            '<i class="wd-coins" data-x="coinsB">0</i>' +
            '<b data-x="nameB">—</b></span>' +
        '</div>' +
        '<div class="wd-blanks" data-x="blanks"></div>' +
        '<div class="wd-feed" data-x="feed"></div>' +
      '</div>' +
      '<div class="wd-right">' +
        '<div class="wd-clock" data-x="clock">' +
          '<div class="wd-clock-top"><span>SECONDS LEFT</span><b data-x="secs">30</b>' +
            '<span class="wd-rounds" data-x="rounds">' + "<i></i>".repeat(ROUNDS) + '</span></div>' +
          '<div class="wd-bar"><i data-x="fill"></i></div>' +
        '</div>' +
        '<form class="wd-form" data-x="form">' +
          '<input autocomplete="off" autocapitalize="none" maxlength="9" placeholder="Type the word" ' +
            'aria-label="Word guess" data-x="input">' +
          '<button type="submit">GUESS</button>' +
        '</form>' +
        '<div class="wd-msg" data-x="msg">Both duelists may answer.</div>' +
      '</div>';

    stage.appendChild(deck);

    const find = {};
    deck.querySelectorAll("[data-x]").forEach(el => { find[el.dataset.x] = el; });
    find.deck = deck;
    /* the fighter pips live in the arena markup (built by wall-push.js), not in
       the deck - registered here so the contest can light them like its own */
    find.pipsA = document.getElementById("wpPipsA");
    find.pipsB = document.getElementById("wpPipsB");
    find.chant = document.getElementById("wpChant");   /* the crowd, in the arena markup */
    ui = find;
    return ui;
  }

  function dropDeck() {
    if (ui && ui.deck && ui.deck.parentNode) ui.deck.parentNode.removeChild(ui.deck);
    ui = null;
  }

  /* ============================================================ the stage ====
     The contest keeps the arena's screen scaffold - the navy overlay, the
     1600x900 board, the banner - but builds none of the wall, fighters or
     meters. The deck centres on the stage (wg-quiz overrides in CSS) and the
     taunts and hype calls fly over it, exactly as they did over the standoff. */
  let wgFitStage = null;
  function wgFit() {
    if (!wgFitStage) return;
    const s = Math.min(window.innerWidth / 1600, window.innerHeight / 900);
    wgFitStage.style.setProperty("--wp-scale", String(s));
  }
  window.addEventListener("resize", wgFit);

  function buildStage(duel) {
    const overlay = document.createElement("div");
    overlay.id = "wpOverlay";
    overlay.className = "on standoff wg-quiz";
    const stage = document.createElement("div");
    stage.id = "wpStage";
    if (duel.isFinal) stage.classList.add("final");
    overlay.appendChild(stage);
    document.body.appendChild(overlay);
    const banner = document.createElement("div");
    banner.className = "wp-banner on";
    banner.innerHTML =
      '<span class="bk">POST MATCH</span>' +
      '<span class="bt">' + (duel.isFinal ? "GRAND FINAL" : "TOP " + duel.rankA + " vs TOP " + duel.rankB) + "</span>";
    stage.appendChild(banner);
    wgFitStage = stage;
    wgFit();
    return stage;
  }

  function dropStage() {
    wgFitStage = null;
    const overlay = document.getElementById("wpOverlay");
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }

  /* ================================================================= helpers */
  function pips(host, n) {
    if (!host || !host.children) return;   /* the arena stubs have no children to light */
    [...host.children].forEach((i, index) => i.classList.toggle("on", index < n));
  }

  function blanks(host, word) {
    host.replaceChildren();
    for (const ch of word) {
      const b = document.createElement("span");
      b.className = "wd-blank";
      b.dataset.letter = ch.toUpperCase();
      host.appendChild(b);
    }
  }

  function revealBlanks(host, ok) {
    [...host.children].forEach(b => {
      b.textContent = b.dataset.letter;
      if (ok) b.classList.add("on");
    });
  }

  /* the deck is 180px tall, so the feed runs across instead of down */
  function note(text, kind) {
    const line = document.createElement("span");
    line.className = kind || "";
    line.textContent = text;
    ui.feed.prepend(line);
    while (ui.feed.children.length > 3) ui.feed.lastElementChild.remove();
  }

  /* the hype call flies up over the deck on the answering seat's half */
  let lastHype = -1;
  function hype(side, text, final) {
    const stage = ui.deck && ui.deck.parentNode;
    if (!stage) return;
    const el = document.createElement("div");
    el.className = "wp-hype" + (final ? " final" : "");
    el.style.left = side === "b" ? "76%" : "24%";
    el.style.transform = "translate(-50%,20px) scale(.7) rotate(-2deg)";
    el.textContent = text;
    stage.appendChild(el);
    window.setTimeout(() => el.remove(), 2500);
  }

  /* a bot's taunt: a speech bubble over their film half. The tail flips for the
     right seat, and at most one bubble lives at a time. */
  function say(side, text) {
    const stage = ui.deck && ui.deck.parentNode;
    if (!stage) return;
    stage.querySelectorAll(".wp-taunt").forEach(t => t.remove());
    const el = document.createElement("div");
    el.className = "wp-taunt" + (side === "b" ? " r" : "");
    el.style.left = side === "b" ? "76%" : "24%";
    el.textContent = text;
    stage.appendChild(el);
    window.setTimeout(() => el.remove(), 2900);
  }

  /* ================================================================== timing */
  function after(ms, fn) {
    if (!run) return 0;
    const id = window.setTimeout(() => { if (run) fn(); }, ms);
    run.timers.push(id);
    return id;
  }
  function every(ms, fn) {
    if (!run) return 0;
    const id = window.setInterval(() => { if (run) fn(); }, ms);
    run.timers.push(id);
    return id;
  }
  function clearTimers() {
    if (!run) return;
    run.timers.forEach(id => { window.clearTimeout(id); window.clearInterval(id); });
    run.timers.length = 0;
  }
  const alive = token => !!run && run.token === token;

  function preload(words, cb) {
    let left = words.length;
    if (!left) { cb(); return; }
    let fired = false;
    const finish = () => { if (!fired) { fired = true; cb(); } };
    after(3000, finish);                       /* never hold the contest hostage */
    words.forEach(w => {
      const im = new Image();
      im.onload = im.onerror = () => { if (--left <= 0) finish(); };
      im.src = ART(w);
    });
  }

  /* ==================================================================== duel */
  function runDuel(duel, token, onSettled) {
    const A = duel.a, B = duel.b;
    let words = [...POOL].sort(() => Math.random() - 0.5).slice(0, ROUNDS);
    const tally = { a: 0, b: 0 };
    const human = A.id === "champ" ? "a" : B.id === "champ" ? "b" : null;
    let round = 0;
    let knocked = false;      /* has the deciding blow (or the expiry knockout) fired yet */
    let isSudden = false;     /* the duel is past its pictures and playing sudden death */
    let speedKicker = 0;      /* house-funded coin extra for fast wins, added at settle */
    /* the round watchdog's clock: every real step of the round touches it, and
       the watchdog below recovers the match when nothing has touched it for far
       longer than a legitimate round can last */
    let progressAt = performance.now();
    let stall = 0;
    let recover = null;       /* the live round's time-up close, re-armed per round */

    const need = duel.isFinal ? 3 : NEED;   /* the final is played to three */
    /* the title fight sounds bigger: the music bed runs at 1.3x for the final,
       back to normal for everything else */
    window.ChampCues?.heat?.(duel.isFinal ? 1.3 : 1);
    /* the golden picture: one per duel, a real prize on the line */
    const powerUp = POWERUPS && Math.random() < 0.65
      ? { word: words[Math.floor(Math.random() * words.length)], kind: Math.random() < 0.5 ? "double" : "shield" }
      : null;
    const usedShield = { a: false, b: false };   /* the shield spends itself on the next hit taken */
    const hasShield = side => powerUp && powerUp.kind === "shield" && !usedShield[side];
    /* the rivalry board: today's record in the deck header, and titles on the chips */
    try {
      const R = RIV() ? RIV().get(A.name, B.name) : null;
      if (ui.rivalry && R && (R.a + R.b) > 0)
        ui.rivalry.textContent = "H2H " + A.name + " " + R.a + " \u2014 " + R.b + " " + B.name;
    } catch (e) {}
    const tA = chipTitle(A.name), tB = chipTitle(B.name);
    if (tA) ui.titleA.textContent = tA;
    if (tB) ui.titleB.textContent = tB;
    /* the champion's medal + crown render on their finale line; the fighter
       pips reset here and the streak comes from the map */
    ui.nameA.textContent = A.name;
    ui.nameB.textContent = B.name;
    ui.coinsA.textContent = fmt(A.coins);
    ui.coinsB.textContent = fmt(B.coins);
    ui.sideA.classList.remove("win");
    ui.sideB.classList.remove("win");
    ui.deck.classList.remove("shake");
    pips(ui.tallyA, 0);
    pips(ui.tallyB, 0);
    pips(ui.rounds, 0);
    /* the arena's own score dots reset with everything else; stubs from the
       element map degrade silently if the arena markup ever changes */
    pips(ui.pipsA, 0);
    pips(ui.pipsB, 0);
    ui.feed.replaceChildren();
    ui.msg.className = "wd-msg";

    /* Only the two duelists answer, and each answers for their OWN seat - hence
       no "who is answering" picker. In this round nobody else has a guess to
       spend; the other two players are not left out, they simply get their own
       round, because TOP 3 vs TOP 4 runs straight after this one. */
    if (human) {
      ui.form.style.display = "";
      ui.input.disabled = false;
      ui.input.placeholder = "Type the word for " + (human === "a" ? A.name : B.name);
      ui.msg.textContent = `Only ${A.name} and ${B.name} can answer this round.`;
    } else {
      ui.form.style.display = "none";
      ui.msg.textContent = `${A.name} vs ${B.name} — both are bots, spectating.`;
    }

    /* ---- one picture ---------------------------------------------------- */
    function runRound(word) {
      clearTimers();
      if (!alive(token)) return;
      progressAt = performance.now();
      recover = () => closeRound(null);   /* the watchdog's way out of this round */

      ui.n.textContent = isSudden ? "SD" : String(round);
      pips(ui.rounds, Math.min(round, ui.rounds.children ? ui.rounds.children.length : round));
      ui.img.classList.remove("solved");
      ui.img.classList.remove("pop");
      /* the golden picture makes itself known the moment it arrives */
      ui.img.classList.toggle("golden", !!powerUp && powerUp.word === word);
      ui.blanks.classList.toggle("golden", !!powerUp && powerUp.word === word);
      if (ui.img.parentNode && ui.img.parentNode.classList) ui.img.parentNode.classList.toggle("golden-art", !!powerUp && powerUp.word === word);
      ui.tabA.classList.remove("show");
      ui.tabB.classList.remove("show");
      void ui.img.offsetWidth;
      ui.img.src = ART(word);
      ui.img.classList.add("pop");
      blanks(ui.blanks, word);
      ui.clock.classList.remove("low");
      ui.secs.textContent = String(Math.round(SLOT_MS / 1000));
      ui.fill.style.transform = "scaleX(1)";
      ui.msg.className = "wd-msg";        ui.msg.textContent = isSudden
          ? `SUDDEN DEATH — the next correct answer wins it all!`
          : `Picture ${round} of ${ROUNDS} — only ${A.name} and ${B.name} can answer.`;

      const started = performance.now();
      let open = true;
      let lastTickSec = -1;

      every(TICK_MS, () => {
        const left = Math.max(0, SLOT_MS - (performance.now() - started));
        ui.secs.textContent = String(Math.ceil(left / 1000));
        ui.fill.style.transform = "scaleX(" + (left / SLOT_MS).toFixed(4) + ")";
        /* the last five seconds are the urgent ones: the deck itself pulses red
           and every second is a soft tock, not just a colour change on the clock */
        const urgent = left <= 5000 && left > 0;
        ui.clock.classList.toggle("low", left <= 10000);
        ui.deck.classList.toggle("urgent", urgent);
        if (urgent) {
          const s = Math.ceil(left / 1000);
          if (s !== lastTickSec) { lastTickSec = s; window.ChampCues?.play?.("tick"); }
        }
        if (left <= 0) closeRound(null);
      });

      ["a", "b"].forEach(side => {
        const who = side === "a" ? A : B;
        if (who.id === "champ") return;
        if (Math.random() > BOT_SKILL) return;
        const at = 2200 + Math.random() * 16000;
        const other = POOL[Math.floor(Math.random() * POOL.length)];
        /* the winner talks: answering bots taunt about half the time */
        if (Math.random() < 0.5) {
          const pool = duel.isFinal && Math.random() < 0.4 ? TAUNT.final
            : TAUNT.after;
          after(at - 400, () => { if (alive(token)) say(side, pool[Math.floor(Math.random() * pool.length)]); });
        }
        /* a wrong guess is only a wrong guess: it used to close the round, which
           cancelled the same bot's pending right answer along with every other
           timer in flight, so a duel could never score at all */
        if (other !== word && Math.random() < 0.45) {
          after(Math.max(1400, at - 2600), () => wrongGuess(side, other));
        }
        after(at, () => closeRound({ side, guess: word, ms: at }));
      });

      function wrongGuess(side, guess) {
        if (!open || !alive(token)) return;
        const naming = side === "a" ? A.name : B.name;
        note(`${naming} · ${guess.toUpperCase()}`, "no");
        ui.msg.className = "wd-msg bad";
        ui.msg.textContent = `${naming} guessed ${guess.toUpperCase()} — not it.`;
        window.ChampCues?.play?.("wrong");
        /* a wrong answer is still an event: one small knock so the deck says so
           even if the message line is the last thing being read */
        ui.deck.classList.remove("shake");
        void ui.deck.offsetWidth;
        ui.deck.classList.add("shake");
      }

      /* closeRound ends the picture: a correct answer, or nobody at all inside
         thirty seconds. A wrong guess deliberately leaves it running. */
      function closeRound(result) {
        if (!open) return;
        open = false;
        clearTimers();
        progressAt = performance.now();

        if (!result) {
          revealBlanks(ui.blanks, false);
          note(`TIME UP · ${word.toUpperCase()}`, "no");
          ui.msg.className = "wd-msg bad";
          ui.msg.textContent = `Time up — the picture was ${word.toUpperCase()}.`;
          ui.deck.classList.remove("urgent");
          after(1200, () => advance(false));
          return;
        }

        const by = result.side;
        tally[by]++;
        pips(by === "a" ? ui.tallyA : ui.tallyB, tally[by]);

        /* ---- what this answer is worth -------------------------------------
           The golden picture pays its power-up, and speed pays its shove:
           both stack, so a fast golden answer is the jackpot. */
        const SPEED_MS = 5000;
        const fast = (result.ms || 0) <= SPEED_MS;
        /* what the answer is worth: DOUBLE SHOVE (the golden prize) hits twice
           as hard as the 50 the answer already costs, SPEED SHOVE (the speed
           prize) only a little harder - speed pays its coins as the kicker, the
           golden picture pays its force */
        const isDouble = !!(powerUp && powerUp.word === word && powerUp.kind === "double");
        if (powerUp && powerUp.word === word) {
          if (isDouble) hype(by, "DOUBLE SHOVED!", false);
          else { ui.deck.classList.remove("shielded"); void ui.deck.offsetWidth; ui.deck.classList.add("shielded"); }
        } else if (fast) {
          hype(by, "SPEED SHOVE!", false);
        }
        drain = isDouble ? 90 : fast ? 70 : undefined;
        ui.img.classList.add("solved");
        revealBlanks(ui.blanks, true);

        const naming = by === "a" ? A.name : B.name;
        note(`${naming} · ${word.toUpperCase()}`, "ok");
        ui.msg.className = "wd-msg good";
        ui.msg.textContent = `${naming} has it!`;

        /* a sudden-death picture is announced, not slipped in */
        if (isSudden) {
          const tabS = by === "a" ? ui.tabA : ui.tabB;
          tabS.textContent = "SUDDEN DEATH!";
          tabS.classList.remove("show"); void tabS.offsetWidth; tabS.classList.add("show");
          hype(by, SUDDEN_WORDS[Math.floor(Math.random() * SUDDEN_WORDS.length)], true);
        }

        /* the green tab pops over the answerer's side of the deck: GOT IT! on
           every correct answer, and on the round-winner it says what they won */
        const tab = by === "a" ? ui.tabA : ui.tabB;
        tab.textContent = tally[by] >= need
          ? (duel.isFinal ? "WINS THE GAME!" : "WINS THE ROUND!")
          : `GOT IT! ${tally[by]}`;
        tab.classList.remove("show");
        void tab.offsetWidth;
        tab.classList.add("show");

        /* the light the pips earn: same rhythm as the tab, and the hype call
           follows the seat that answered, on their own half of the arena */
        const pipsRow = by === "a" ? ui.pipsA : ui.pipsB;
        if (pipsRow) {
          const lit = Math.min(tally[by], pipsRow.children.length);
          [...pipsRow.children].forEach((p, i) => p.classList.toggle("on", i < lit));
        }
        window.ChampCues?.play?.("correct");
        /* the crowd chants for whoever is out in front */
        const leader = tally.a === tally.b ? null : tally.a > tally.b ? "a" : "b";
        if (leader) {
          const n = (leader === "a" ? A.name : B.name).split(/\s+/)[0].toUpperCase();
          const chantEl = ui.chant;
          if (chantEl) { chantEl.textContent = n + "! " + n + "! " + n + "!"; chantEl.classList.remove("on"); void chantEl.offsetWidth; chantEl.classList.add("on"); }
        }
        if (tally[by] >= need) {
          hype(by, duel.isFinal ? "WINS THE GAME!" : "ROUND WON!", duel.isFinal);
        } else if (duel.isFinal && Math.max(tally.a, tally.b) - Math.min(tally.a, tally.b) === COMEBACK_AT) {
          hype(by, COMEBACK_WORDS[Math.floor(Math.random() * COMEBACK_WORDS.length)], true);
        } else {
          hype(by, HYPE[Math.floor(Math.random() * HYPE.length)]);
        }

        /* net answers in that side's favour: +1 shoves the slab toward the
           opponent, and an answer from the other side shoves it straight back */
        const decided = tally[by] >= need;
        if (decided) knocked = true;
        if (fast && decided) speedKicker = 150;   /* the house pays for the highlight-reel finish */
        /* a bot that is beating the human cannot help saying so */
        if (human && by !== human && tally[by] > tally[human] && tally[by] >= 2
            && Math.random() < 0.55) {
          const pool = duel.isFinal ? TAUNT.final : TAUNT.ahead;
          window.setTimeout(() => { if (alive(token)) say(by, pool[Math.floor(Math.random() * pool.length)]); }, 1100);
        }
        /* the shield still spends itself on a hit, even with no meter to drain */
        if (!decided && hasShield(by === "a" ? "b" : "a")) {
          usedShield[by === "a" ? "b" : "a"] = true;
          note((by === "a" ? B.name : A.name) + " · SHIELD!", "no");
        }

        if (decided) {
          ui.sideA.classList.toggle("win", by === "a");
          ui.sideB.classList.toggle("win", by === "b");
          ui.msg.textContent = `${naming} wins the round ${Math.max(tally.a, tally.b)} — ${Math.min(tally.a, tally.b)}.`;
        }
        after(decided ? FINISH_MS : SHOVE_MS, () => advance(decided));
      }

      /* the human answers for their own seat and no other */
      ui.form.onsubmit = event => {
        event.preventDefault();
        if (!open || !alive(token) || !human) return;
        window.ChampCues?.play?.("throwWord");
        const value = normalize(ui.input.value);
        ui.input.value = "";
        if (!value) return;
        if (value === word) closeRound({ side: human, guess: value });
        else wrongGuess(human, value);
      };
    }

    /* `round` is 1-based: the chip and the round pips read straight off it, and
       the first picture is entered by calling advance() rather than runRound()
       directly - entering at 0 rendered "CLIPART 0 / 4" with no pip lit. */
    function advance(decided) {
      if (!alive(token)) return;
      progressAt = performance.now();
      if (decided) return settle();
      round++;
      if (round > words.length || tally.a >= need || tally.b >= need) {
        /* Dead heat when the pictures run out - a 2-2 final is the common case,
           which asks for three correct in four. Rather than handing the wall to
           the higher seed on a bookkeeping rule, keep playing sudden-death
           pictures: the next correct answer anywhere settles it on film. */
        if (tally.a === tally.b) {
          isSudden = true;
          const p = POOL[Math.floor(Math.random() * POOL.length)];
          words.push(p);
          runRound(p);
          return;
        }
        /* The pictures ran out with a leader and nobody landed the deciding
           blow - possible in the grand final, which asks for THREE correct in
           four pictures, so a 2-1 or 2-0 finish expires. The louder tally
           takes the round: announce it, then settle. */
        const winner = tally.b > tally.a ? "b" : "a";
        if (!knocked) {
          knocked = true;
          const tab = winner === "a" ? ui.tabA : ui.tabB;
          tab.textContent = duel.isFinal ? "WINS THE GAME!" : "WINS THE ROUND!";
          tab.classList.remove("show");
          void tab.offsetWidth;
          tab.classList.add("show");
          ui.sideA.classList.toggle("win", winner === "a");
          ui.sideB.classList.toggle("win", winner === "b");
          hype(winner, duel.isFinal ? "WINS THE GAME!" : "ROUND WON!", duel.isFinal);
          window.ChampCues?.play?.("correct");
          after(FINISH_MS, () => settle());
          return;
        }
        return settle();
      }
      runRound(words[round - 1]);
    }

    function settle() {
      clearTimers();
      progressAt = performance.now();
      window.clearInterval(wdId);   /* this duel is over; its watchdog retires */
      ui.form.onsubmit = null;
      /* no coin flip and no invented winner: the louder tally takes the wall,
         and a dead heat goes to the higher seed, which is at least a rule a
         player can learn. It cannot happen in a 2-1 or a 2-0 finish. */
      const winner = tally.b > tally.a ? "b" : "a";
      onSettled({
        rankA: duel.rankA, rankB: duel.rankB, winner,
        correctA: tally.a, correctB: tally.b,
        speedKicker: speedKicker          /* fast wins pay a little extra, funded by the house */
      });
    }

    /* the round watchdog: this file's tracked timers are what makes a round
       move, and twice on the live site a whole round's set of them died silently
       — the picture sat frozen at its clock with no error anywhere. This loop is
       deliberately scheduled OUTSIDE run.timers (so closeRound's clearTimers()
       cannot kill it, exactly what killed the round it guards) and outside the
       capture list (so an old duel's watchdog can never kill a new duel's
       round). It fires only when nothing has touched `progressAt` for longer
       than a legitimate round can last, and closes the round as a time-up. */
    const STALL_MS = SLOT_MS + 20000;
    let wdId = 0;
    (function watchdog() {
      if (!alive(token)) return;
      const idle = performance.now() - progressAt;
      if (idle > STALL_MS && recover) {
        const r = recover; recover = null;
        console.warn("wall-push: round stalled with no timers in flight; recovering");
        r();
        progressAt = performance.now();
      }
      wdId = window.setTimeout(watchdog, 2500);
    })();

    preload(words, () => { if (alive(token)) advance(false); });
  }

  /* ================================================================ the finale
     The last beat, once BOTH pairs have pushed: one pop-up in the language of the
     payout video - a tier that escalates with the total, a ribbon that counts that
     total up, and gold spraying in from every side - except this one names all
     four players, shows the avatar each of them played as, and gives every one of
     them the figure they gained or handed over. Each duel already paid out on the
     arena; this is the receipt for the whole post-match. */
  function finale(list, done) {
    if (!list || !list.length) { done(); return; }
    const total = list.reduce((n, p) => n + Math.max(0, p.delta), 0);

    const el = document.createElement("div");
    el.id = "wpFinal";
    el.className = "wp-final";
    el.innerHTML =
      '<div class="wf-card">' +
        '<div class="wf-kicker">COIN PAYOUT</div>' +
        '<div class="wf-tier" data-x="ftier">WIN</div>' +
        '<div class="wf-ribbon"><span class="wf-num" data-x="fnum">0</span><small>coins won</small></div>' +
        /* the champion's spotlight sits between the card and its rows */
        '<div class="wf-spotlight"></div>' +
        '<div class="wf-grid' + (list.some(p => p.champ) ? " champ-in" : "") + '">' +
          list.map(p =>
            '<div class="wf-p' + (p.won ? " won" : "") + (p.champ ? " champ" : "") + '">' +
              /* the champion gets the medal and the crown; everyone else just
                 gets their row */
              (p.champ ? '<span class="wf-crown">👑</span>' : '') +
              '<img alt="" src="' + (HEADS[p.key] || HEADS.boy) + '">' +
              '<div class="wf-p-body">' +
                '<b>' + (p.champ ? '🥇 ' : '') + p.name + '</b>' +
                '<span class="wf-delta ' + (p.delta >= 0 ? "plus" : "minus") + '">' +
                  (p.delta >= 0 ? "+" : "−") + fmt(Math.abs(p.delta)) + '</span>' +
                '<span class="wf-flow">' + fmt(p.before) + " → " + fmt(p.after) + '</span>' +
                /* the role is booked per duel, so a finalist reads CHAMPION or
                   RUNNER-UP rather than being called a play-off winner twice */
                '<span class="wf-role">' + (p.role || (p.won ? "WON THE DUEL" : "PAID THE STAKE")) + '</span>' +
                /* the streak that closed the match shows on the champion's line */
                '<span class="wf-flames">' + (p.champ && p.streak >= 2 ? "\uD83D\uDD25".repeat(Math.min(p.streak, 3)) : "") + '</span>' +
                '<span class="wf-h2h" data-x="h2h-' + p.id + '"></span>' +
              '</div>' +
            '</div>').join("") +
        '</div>' +
        '<div class="wf-foot">Tap to continue</div>' +
      '</div>' +
      '<div class="wf-spray" data-x="fspray"></div>';
    document.body.appendChild(el);

    const ref = {};
    el.querySelectorAll("[data-x]").forEach(n => { ref[n.dataset.x] = n; });

    /* the ladder: each line gets its H2H record and, for a newly promoted
       player, what they just became */
    list.forEach(p => {
      const cell = ref["h2h-" + p.id];
      if (!cell) return;
      try {
        if (!RIV()) return;
        const t = RIV().nextTitle(p.name);
        const total = RIV().wins(p.name);
        cell.textContent = total + "W \u00B7 " + t.now;
      } catch (err) {}
    });

    /* gold from all sides, the way the payout video fills its screen */
    let spray = "";
    for (let i = 0; i < 46; i++) {
      const x = (Math.random() * 100).toFixed(1), y = (Math.random() * 100).toFixed(1);
      const dx = Math.round(-170 + Math.random() * 340), dy = Math.round(130 + Math.random() * 300);
      const s = (0.5 + Math.random() * 0.95).toFixed(2);
      const delay = (Math.random() * 1.5).toFixed(2), dur = (1.1 + Math.random() * 1.4).toFixed(2);
      spray += '<i style="left:' + x + '%;top:' + y + '%;--dx:' + dx + 'px;--dy:' + dy +
        'px;--s:' + s + ';animation-delay:' + delay + 's;animation-duration:' + dur + 's"></i>';
    }
    ref.fspray.innerHTML = spray;

    function tierFor(v) {
      for (const t of TIERS) if (v >= t[0]) return t;
      return TIERS[TIERS.length - 1];
    }
    function paint(v) {
      ref.fnum.textContent = fmt(Math.round(v));
      const t = tierFor(v);
      if (ref.ftier.textContent !== t[1]) {
        ref.ftier.textContent = t[1];
        ref.ftier.className = "wf-tier " + t[2] + " pop";
        void ref.ftier.offsetWidth;
      }
    }
    paint(0);
    requestAnimationFrame(() => el.classList.add("on"));
    window.ChampCues?.play?.("superWin");

    const COUNT_MS = 1800;
    const t0 = performance.now();
    let dead = false, raf = 0;

    function close() {
      if (dead) return;
      dead = true;
      cancelAnimationFrame(raf);
      el.classList.remove("on");
      window.setTimeout(() => { el.remove(); done(); }, 280);
    }
    function frame() {
      if (dead) return;
      const t = clamp((performance.now() - t0) / COUNT_MS, 0, 1);
      paint(total * easeOut(t));
      if (t >= 1) return;         /* the count is done; the pop-up stays put */
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    /* No auto-dismiss. This receipt is where the post-match ends, so it stays on
       screen until the player taps Continue - going away on its own would mean
       the last thing they see is a summary they did not get to read. */
    el.addEventListener("click", close);
  }

  /* =================================================================== module */
  window.ChampWallGuess = {
    pool: POOL,
    rounds: ROUNDS,
    seconds: SLOT_MS / 1000,    /* duels: [{ rankA, rankB, a:{id,name,coins,team,key}, b:{...} }, ...]
       opts:   { onDone, onSettled, sound }

       Each duel is raced on the shared screen and settled on its tally - the
       winner is whoever answered more, never a coin flip. When it is given the
       two play-offs, their winners are paired for one more match - the grand
       final - and only then does the post-match close on the receipt. */
    play: function (duels, opts) {
      opts = opts || {};
      const done = opts.onDone || function () {};
      const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      if (!duels || !duels.length || reduced) { done([]); return; }

      /* The music belongs to the fights, so it starts with the first round and runs
         until the last one ends. loop() and not play(): it is a bed, not an event,
         and it must not restart if this is ever re-entered. */
      window.ChampCues?.loop?.("music");

      const token = {};
      run = { token, timers: [] };

      /* The queue starts as the two play-offs and grows by one: their winners
         meet in a final before the post-match closes. Balances are tracked here
         because the final's stake is whatever the pair round left each finalist
         holding, not the figure they started it with. */
      const queue = duels.slice();
      const balance = new Map();
      const table = new Map();        /* id -> that player's line in the receipt */
      const pairWinners = [];
      let finalAdded = false;
      let idx = 0;
      let results = [];
      duels.forEach(d => { balance.set(d.a.id, d.a.coins); balance.set(d.b.id, d.b.coins); });

      function cleanup() {
        /* covers a round reset and the normal close - the music must never
           outlive the contest it belongs to, and neither may the voice */
        window.ChampCues?.stop?.("music");
        dropStage();
        clearTimers();
        dropDeck();
        /* the streak ladder belongs to one post-match: a fresh one starts
           everyone back at zero */
        streaks.clear();
        run = null;
      }

      function nextDuel() {
        if (!alive(token)) return;
        /* Once both play-offs are done their winners meet, and only then does
           the post-match close on one receipt. A final needs two different
           people, so it is skipped rather than fought against oneself. */
        if (!finalAdded && idx >= duels.length && pairWinners.length === 2
            && pairWinners[0].id !== pairWinners[1].id) {
          finalAdded = true;
          queue.push({
            rankA: 1, rankB: 2,
            labelA: "FINALIST 1", labelB: "FINALIST 2",
            title: "GRAND FINAL",
            isFinal: true,
            a: Object.assign({}, pairWinners[0], { coins: balance.get(pairWinners[0].id) }),
            b: Object.assign({}, pairWinners[1], { coins: balance.get(pairWinners[1].id) })
          });
        }
        if (idx >= queue.length) {
          const tok = token;
          /* All three rounds are done, so the music stops HERE rather than under
             the receipt: it is the sound of the fight, not of the result. */
          window.ChampCues?.stop?.("music");
          finale(Array.from(table.values()).sort((a, b) => b.delta - a.delta), function () {
            if (!run || run.token !== tok) return;      /* cancelled mid-finale */
            const all = results.slice();
            cleanup();
            done(all);
          });
          return;
        }
        const duel = queue[idx];
        buildDeck(buildStage(duel));
        runDuel(duel, token, function (verdict) {
              if (!alive(token)) return;
              results.push(verdict);
              const advancePair = function () {
                dropStage();
                dropDeck();
                idx++;
                nextDuel();
              };
              /* the settlement books the stake straight from the verdict,
                 so there is no second place a winner could be chosen */
              const book = function () {
                /* the stake rule the arena used to settle: the stake is the
                   underdog's (seat b) balance, the winner takes it, and an
                   underdog win doubles it out of the favourite's balance,
                   capped at what the favourite actually holds */
                const aWon = verdict.winner === "a";
                const dogWins = !aWon;
                const stake = duel.b.coins;
                const paid = dogWins ? Math.min(stake, duel.a.coins) : stake;
                const payout = Math.round(paid * STREAK_MULT((streaks.get(aWon ? duel.a.id : duel.b.id) || 0) + 1))
                  + (verdict.speedKicker || 0);
                const st = {
                  paid: paid, capped: dogWins && paid < stake, bonus: payout,
                  a: { before: duel.a.coins, after: dogWins ? duel.a.coins - paid : duel.a.coins + payout },
                  b: { before: duel.b.coins, after: dogWins ? duel.b.coins + payout : duel.b.coins - paid }
                };
                const bonus = Math.max(0, payout - paid);
                if (opts.onSettled) {
                  opts.onSettled({
                    winnerId: aWon ? duel.a.id : duel.b.id,
                    loserId: aWon ? duel.b.id : duel.a.id,
                    paid: paid,
                    bonus: bonus            /* house-funded streak extra the winner also received */
                  });
                }
                /* history: this pair's head-to-head now has another chapter */
                try {
                  if (RIV()) RIV().record(duel.a.name, duel.b.name, aWon ? duel.a.name : duel.b.name);
                } catch (err) {}
                /* a finalist appears in two duels, so the receipt is summed per
                   player: the delta adds up, the before is their first and the
                   after is their last */
                const role = duel.isFinal
                  ? { win: "CHAMPION", lose: "RUNNER-UP" }
                  : { win: "TOOK THE WALL", lose: "PAID THE STAKE" };
                [[duel.a, aWon, st && st.a], [duel.b, !aWon, st && st.b]].forEach(function (row) {
                  const who = row[0], won = row[1], money = row[2];
                  const before = money ? money.before : who.coins;
                  const after = money ? money.after : who.coins;
                  balance.set(who.id, after);
                  /* the streak ladder rides on every settlement, win or lose:
                     winning extends it, losing resets it to zero */
                  const s0 = streaks.get(who.id) || 0;
                  const s1 = won ? s0 + 1 : 0;
                  streaks.set(who.id, s1);
                  const line = table.get(who.id) || {
                    id: who.id, name: who.name, key: who.key,
                    delta: 0, before: before, after: after, won: false, role: ""
                  };
                  line.streak = s1;
                  line.name = who.name;
                  line.key = who.key;
                  /* the receipt's delta is what the player actually walked away
                     with, minus what they arrived with - the one number that
                     cannot disagree with the settlement figures */
                  line.delta = (money ? money.after : who.coins) - (money ? money.before : who.coins);
                  line.after = after;
                  line.won = won;
                  line.role = won ? role.win : role.lose;
                  /* the crown and medal go to the final's winner only */
                  line.champ = duel.isFinal && won;
                  table.set(who.id, line);
                });
                if (!duel.isFinal) pairWinners.push(aWon ? duel.a : duel.b);
              };

              /* no knockout film to wait for any more: the beat after the
                 deciding answer already played inside the round, so the coins
                 book and the pair advances at once */
              book();
              after(CARD_MS, function () { if (alive(token)) advancePair(); });
        });
      }

      nextDuel();
    },

    /* the multiplier a win RIGHT NOW would earn: the ladder applies to the win
       that completes the streak, so 0 prior wins -> x1, 1 prior (this would be
       the 2nd in a row) -> x1.5, 2+ prior -> x2. The settlement reads this at
       each result to size the house-funded bonus, so the payout and the
       receipt quote the same ladder. */
    streak: function (id) { return STREAK_MULT((streaks.get(id) || 0) + 1); },

    /* a round reset must not leave a bot's answer queued for the next board */
    cancel: function () {
      dropStage();
      clearTimers();
      dropDeck();
      /* the receipt no longer dismisses itself, so a round reset has to take it
         down or it would sit over the next board */
      const fin = document.getElementById("wpFinal");
      if (fin) fin.remove();
      /* a round reset is still the end of this post-match: the ladder goes too */
      streaks.clear();
      run = null;
    }
  };
})();
