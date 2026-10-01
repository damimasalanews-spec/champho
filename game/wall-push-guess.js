/* ===========================================================================
   WALL PUSH — THE STANDOFF
   ---------------------------------------------------------------------------
   The wall push and the clipart contest, on one screen.

   The duel module used to decide its winner with Math.random() and play the
   result as a separate 6.5 second reel. Neither happens now. This module mounts
   the same arena in a "standoff" mode - both fighters leaning on the slab, no
   timeline - and puts the guessing deck underneath it, so the picture that moves
   the wall and the wall moving are in the same view at the same time.

     - four 3D clipart pictures of words per duel, 30 seconds each
     - a correct answer shoves the slab one step toward the opponent, lives, and
       drains half of the opponent's push power with it
     - a correct answer from the other side shoves it straight back
     - the first duelist to TWO correct answers drives it into the opponent's
       corner, that opponent goes down, and the coin card prints

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
    girl: "assets/avatars/pumpkin-girl.webp"
  };
  /* the payout video's own ladder: the badge changes word as the total grows */
  const TIERS = [[2400, "SUPER WIN", "super"], [1000, "BIG WIN", "big"], [0, "WIN", ""]];

  const ROUNDS = 4;          /* four cliparts in a duel */
  const SLOT_MS = 30000;     /* 30 seconds for each one */
  const NEED = 2;            /* correct answers a PAIR round needs; the final needs 3 */
  const TICK_MS = 100;
  const BOT_SKILL = 0.9;     /* how often a bot actually knows the picture */
  const SHOVE_MS = 1150;     /* beat between a shove and the next picture */
  /* The knockout is two film beats back to back: the winner's wall-break (~1.0s)
   and then the loser's fall (~1.6s). At the original 1000ms the payout card cut
   in while the loser was still standing, so the hold has to cover both cuts. */
const FINISH_MS = 3000;    /* beat between the winning answer and the knockout:
                              kick 2.67s + fall 2.75s play together; the old 4200
                              parked the screen for ~12s once the payout and coin
                              card were counted in */
  const CARD_MS = 2200;      /* how long the coin card is held before the next pair */
  const KNOCK_CEILING_MS = 14000;  /* longest a knockout + payout + card may take */
  /* correct answers that have to be answered BACK before the other side wins -
     the comeback line's trigger. Also the wrong-answer sound cue's name, which
     shares the constant so the two can never drift apart. */
  const COMEBACK_AT = 2;
  const COMEBACK_WORDS = ["NOW OR NEVER!", "DO OR DIE!", "ONE LEFT!"];
  const HYPE = ["CRUSH 'EM!", "HOLD THE LINE!", "PUSH!!", "WALL POWER!", "NO MERCY!",
                "HEAVE!!", "BRACE!!", "LET'S GOOO!"];

  const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
  const normalize = s => String(s || "").toLowerCase().replace(/[^a-z]/g, "").slice(0, 9);
  const fmt = n => Number(n || 0).toLocaleString("en-US");
  const easeOut = t => 1 - Math.pow(1 - t, 3);

  let ui = null;             /* the deck while it is mounted */
  let run = null;            /* the live run: { token, timers, arena } */

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
            '<span class="wd-pips" data-x="tallyA"><i></i><i></i></span></span>' +
          '<span class="wd-title">GUESS THE WORD</span>' +
          '<span class="wd-side" data-x="sideB"><span class="wd-pips" data-x="tallyB"><i></i><i></i></span>' +
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
    ui = find;
    return ui;
  }

  function dropDeck() {
    if (ui && ui.deck && ui.deck.parentNode) ui.deck.parentNode.removeChild(ui.deck);
    ui = null;
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

  /* the hype call flies up through the arena on the seat's film half */
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
    window.setTimeout(() => el.remove(), 1500);
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
    const arena = run.arena;
    const words = [...POOL].sort(() => Math.random() - 0.5).slice(0, ROUNDS);
    const tally = { a: 0, b: 0 };
    const human = A.id === "champ" ? "a" : B.id === "champ" ? "b" : null;
    let round = 0;
    let knocked = false;      /* has the deciding blow (or the expiry knockout) fired yet */

    const need = duel.isFinal ? 3 : NEED;   /* the final is played to three */
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

      ui.n.textContent = String(round);
      pips(ui.rounds, round);
      ui.img.classList.remove("solved");
      ui.img.classList.remove("pop");
      ui.tabA.classList.remove("show");
      ui.tabB.classList.remove("show");
      void ui.img.offsetWidth;
      ui.img.src = ART(word);
      ui.img.classList.add("pop");
      blanks(ui.blanks, word);
      ui.clock.classList.remove("low");
      ui.secs.textContent = String(Math.round(SLOT_MS / 1000));
      ui.fill.style.transform = "scaleX(1)";
      ui.msg.className = "wd-msg";
      ui.msg.textContent = `Picture ${round} of ${ROUNDS} — only ${A.name} and ${B.name} can answer.`;

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
        /* a wrong guess is only a wrong guess: it used to close the round, which
           cancelled the same bot's pending right answer along with every other
           timer in flight, so a duel could never score at all */
        if (other !== word && Math.random() < 0.45) {
          after(Math.max(1400, at - 2600), () => wrongGuess(side, other));
        }
        after(at, () => closeRound({ side, guess: word }));
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
        ui.img.classList.add("solved");
        revealBlanks(ui.blanks, true);

        const naming = by === "a" ? A.name : B.name;
        note(`${naming} · ${word.toUpperCase()}`, "ok");
        ui.msg.className = "wd-msg good";
        ui.msg.textContent = `${naming} has it — the wall takes a shove!`;

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
        const lit = Math.min(tally[by], pipsRow.children.length);
        [...pipsRow.children].forEach((p, i) => p.classList.toggle("on", i < lit));
        window.ChampCues?.play?.("correct");
        if (tally[by] >= need) {
          hype(by, duel.isFinal ? "WINS THE GAME!" : "KNOCKOUT!", duel.isFinal);
        } else if (duel.isFinal && Math.max(tally.a, tally.b) - Math.min(tally.a, tally.b) === COMEBACK_AT) {
          hype(by, COMEBACK_WORDS[Math.floor(Math.random() * COMEBACK_WORDS.length)], true);
        } else {
          hype(by, HYPE[Math.floor(Math.random() * HYPE.length)]);
        }

        /* net answers in that side's favour: +1 shoves the slab toward the
           opponent, and an answer from the other side shoves it straight back */
        const decided = tally[by] >= need;
        if (decided) knocked = true;
        const net = tally.a - tally.b;
        if (arena && arena.steps) arena.steps(net);
        /* the same answer that moves the slab now also plays that seat's film
           beat, so the push the player sees IS their correct answer — except on
           the deciding answer, where breaker() owns the film outright: a shove
           clip started here would fight the kick for the same video element */
        if (arena && arena.film && !decided) arena.film(by);
        if (arena && arena.charge) arena.charge(tally.a, tally.b);

        if (decided) {
          /* reaching NEED is the knockout: the wall gives way on film and the
             losing seat drops */
          if (arena && arena.breaker) arena.breaker(by);
          ui.sideA.classList.toggle("win", by === "a");
          ui.sideB.classList.toggle("win", by === "b");
          ui.msg.textContent = `${naming} takes the wall ${Math.max(tally.a, tally.b)} — ${Math.min(tally.a, tally.b)}.`;
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
      if (decided) return settle();
      round++;
      if (round > ROUNDS || tally.a >= need || tally.b >= need) {
        /* The pictures ran out with nobody landing the deciding blow — very
           possible in the final, which asks for THREE correct in only four
           pictures, so a 2-1 or 2-0 finish expires. The louder tally still
           takes the wall, and it takes it ON FILM: play the knockout for the
           leader instead of cutting straight to the settlement, which read as
           "no kick animation in the final wall push round". */
        const winner = tally.b > tally.a ? "b" : "a";
        if (arena && arena.breaker && !knocked) {
          knocked = true;
          const tab = winner === "a" ? ui.tabA : ui.tabB;
          tab.textContent = duel.isFinal ? "WINS THE GAME!" : "WINS THE ROUND!";
          tab.classList.remove("show");
          void tab.offsetWidth;
          tab.classList.add("show");
          ui.sideA.classList.toggle("win", winner === "a");
          ui.sideB.classList.toggle("win", winner === "b");
          hype(winner, duel.isFinal ? "WINS THE GAME!" : "KNOCKOUT!", duel.isFinal);
          window.ChampCues?.play?.("correct");
          arena.breaker(winner);
          after(FINISH_MS, () => settle());
          return;
        }
        return settle();
      }
      runRound(words[round - 1]);
    }

    function settle() {
      clearTimers();
      ui.form.onsubmit = null;
      /* no coin flip and no invented winner: the louder tally takes the wall,
         and a dead heat goes to the higher seed, which is at least a rule a
         player can learn. It cannot happen in a 2-1 or a 2-0 finish. */
      const winner = tally.b > tally.a ? "b" : "a";
      onSettled({
        rankA: duel.rankA, rankB: duel.rankB, winner,
        correctA: tally.a, correctB: tally.b
      });
    }

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
        '<div class="wf-grid">' +
          list.map(p =>
            '<div class="wf-p' + (p.won ? " won" : "") + '">' +
              '<img alt="" src="' + (HEADS[p.key] || HEADS.boy) + '">' +
              '<div class="wf-p-body">' +
                '<b>' + p.name + '</b>' +
                '<span class="wf-delta ' + (p.delta >= 0 ? "plus" : "minus") + '">' +
                  (p.delta >= 0 ? "+" : "−") + fmt(Math.abs(p.delta)) + '</span>' +
                '<span class="wf-flow">' + fmt(p.before) + " → " + fmt(p.after) + '</span>' +
                /* the role is booked per duel, so a finalist reads CHAMPION or
                   RUNNER-UP rather than being called a play-off winner twice */
                '<span class="wf-role">' + (p.role || (p.won ? "TOOK THE WALL" : "PAID THE STAKE")) + '</span>' +
              '</div>' +
            '</div>').join("") +
        '</div>' +
        '<div class="wf-foot">Tap to continue</div>' +
      '</div>' +
      '<div class="wf-spray" data-x="fspray"></div>';
    document.body.appendChild(el);

    const ref = {};
    el.querySelectorAll("[data-x]").forEach(n => { ref[n.dataset.x] = n; });

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
    seconds: SLOT_MS / 1000,

    /* duels: [{ rankA, rankB, a:{id,name,coins,team,key}, b:{...} }, ...]
       opts:   { push, onDone, sound }

       Each duel is raced on the shared screen and handed to `push.knock` with a
       verdict, so the arena no longer picks its own winner. When it is given the
       two play-offs, their winners are paired for one more match - the final - and
       only then does the post-match close on the receipt. */
    play: function (duels, opts) {
      opts = opts || {};
      const done = opts.onDone || function () {};
      const push = opts.push;
      const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      if (!duels || !duels.length || reduced) { done([]); return; }
      if (!push || typeof push.standoff !== "function") { done([]); return; }

      /* The music belongs to the fights, so it starts with the first round and runs
         until the last one ends. loop() and not play(): it is a bed, not an event,
         and it must not restart if this is ever re-entered. */
      window.ChampCues?.loop?.("music");

      const token = {};
      run = { token, timers: [], arena: null };

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
        /* covers SKIP, a round reset, and the normal close - the music must never
           outlive the wall push it belongs to */
        window.ChampCues?.stop?.("music");
        if (run && run.arena) run.arena.teardown();
        clearTimers();
        dropDeck();
        run = null;
      }

      function bail() {                       /* sprite load failed, or SKIP */
        if (!alive(token)) return;
        const sofar = results.slice();
        cleanup();
        done(sofar);
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
            title: "FINAL WALL PUSH",
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
        let opened = false;
        push.standoff(duel, {
          sound: opts.sound,
          onSkip: bail,
          onReady: function (handle) {
            if (!alive(token)) { if (handle) handle.teardown(); return; }
            if (!handle) { bail(); return; }
            opened = true;
            run.arena = handle;
            buildDeck(handle.stage);
            runDuel(duel, token, function (verdict) {
              if (!alive(token)) return;
              results.push(verdict);
              const advancePair = function () {
                handle.teardown();
                run.arena = null;
                dropDeck();
                idx++;
                nextDuel();
              };
              /* the knockout belongs to the arena and it is told the verdict,
                 so there is no second place a winner could be chosen */
              /* Book the pair's settlement: tell the game so it can move the real
                 balances, and keep the figures for the finale's receipt. `result()`
                 comes from the arena's own settle(), so the numbers shown, the
                 numbers paid and the numbers on the receipt are all one source. */
              const book = function () {
                const st = handle.result ? handle.result() : null;
                const aWon = verdict.winner === "a";
                const paid = st ? st.paid : 0;
                if (opts.onSettled) {
                  opts.onSettled({
                    winnerId: aWon ? duel.a.id : duel.b.id,
                    loserId: aWon ? duel.b.id : duel.a.id,
                    paid: paid
                  });
                }
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
                  const line = table.get(who.id) || {
                    id: who.id, name: who.name, key: who.key,
                    delta: 0, before: before, after: after, won: false, role: ""
                  };
                  line.name = who.name;
                  line.key = who.key;
                  line.delta += won ? paid : -paid;
                  line.after = after;
                  line.won = won;
                  line.role = won ? role.win : role.lose;
                  table.set(who.id, line);
                });
                if (!duel.isFinal) pairWinners.push(aWon ? duel.a : duel.b);
              };

              let settled = false;
              handle.knock(verdict.winner, function () {
                if (settled || !alive(token)) return;
                settled = true;
                book();
                after(CARD_MS, function () { if (alive(token)) advancePair(); });
              });
              /* The knock-out, the payout and the coin card are three chained
                 animations in another module. If any of them throws or never
                 reports back, the player would be left staring at the arena with
                 no way forward, so the pair advances on a ceiling regardless. */
              after(KNOCK_CEILING_MS, function () {
                if (settled) return;
                settled = true;
                console.warn("wall-push: the post-match beat never finished; moving on");
                book();          /* the coins still move, even if the show did not */
                if (alive(token)) advancePair();
              });
            });
          }
        });
        /* the arena builds synchronously and preloads both bodies; if that
           preload never resolves the whole post-match would hang, so a hard
           ceiling hands the round back to the result card */
        window.setTimeout(function () {
          if (alive(token) && !opened) bail();
        }, 6000);
      }

      nextDuel();
    },

    /* a round reset must not leave a bot's answer queued for the next board */
    cancel: function () {
      if (run && run.arena) run.arena.teardown();
      clearTimers();
      dropDeck();
      /* the receipt no longer dismisses itself, so a round reset has to take it
         down or it would sit over the next board */
      const fin = document.getElementById("wpFinal");
      if (fin) fin.remove();
      run = null;
    }
  };
})();
