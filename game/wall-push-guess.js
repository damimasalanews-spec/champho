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

  const ROUNDS = 4;          /* four cliparts in a duel */
  const SLOT_MS = 30000;     /* 30 seconds for each one */
  const NEED = 2;            /* first to two correct answers takes the wall */
  const TICK_MS = 100;
  const BOT_SKILL = 0.78;    /* how often a bot actually knows the picture */
  const SHOVE_MS = 1150;     /* beat between a shove and the next picture */
  const FINISH_MS = 1000;    /* beat between the winning answer and the knockout */
  const CARD_MS = 4200;      /* how long the coin card is held before the next pair */

  const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
  const normalize = s => String(s || "").toLowerCase().replace(/[^a-z]/g, "").slice(0, 9);
  const fmt = n => Number(n || 0).toLocaleString("en-US");

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
    ui = find;
    return ui;
  }

  function dropDeck() {
    if (ui && ui.deck && ui.deck.parentNode) ui.deck.parentNode.removeChild(ui.deck);
    ui = null;
  }

  /* ================================================================= helpers */
  function pips(host, n) {
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

      every(TICK_MS, () => {
        const left = Math.max(0, SLOT_MS - (performance.now() - started));
        ui.secs.textContent = String(Math.ceil(left / 1000));
        ui.fill.style.transform = "scaleX(" + (left / SLOT_MS).toFixed(4) + ")";
        ui.clock.classList.toggle("low", left <= 10000);
        if (left <= 0) closeRound(null);
      });

      ["a", "b"].forEach(side => {
        const who = side === "a" ? A : B;
        if (who.id === "champ") return;
        if (Math.random() > BOT_SKILL) return;
        const at = 3500 + Math.random() * 22500;
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

        /* net answers in that side's favour: +1 shoves the slab toward the
           opponent, and an answer from the other side shoves it straight back */
        const net = tally.a - tally.b;
        if (arena && arena.steps) arena.steps(net);
        if (arena && arena.charge) arena.charge(tally.a, tally.b);

        const decided = tally[by] >= NEED;
        if (decided) {
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
      if (round > ROUNDS || tally.a >= NEED || tally.b >= NEED) return settle();
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

  /* =================================================================== module */
  window.ChampWallGuess = {
    pool: POOL,
    rounds: ROUNDS,
    seconds: SLOT_MS / 1000,

    /* duels: [{ rankA, rankB, a:{id,name,coins,team,key}, b:{...} }, ...]
       opts:   { push, onDone, sound }

       Each duel is raced on the shared screen and handed to `push.knock` with a
       verdict, so the arena no longer picks its own winner. */
    play: function (duels, opts) {
      opts = opts || {};
      const done = opts.onDone || function () {};
      const push = opts.push;
      const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      if (!duels || !duels.length || reduced) { done([]); return; }
      if (!push || typeof push.standoff !== "function") { done([]); return; }

      const token = {};
      run = { token, timers: [], arena: null };

      let idx = 0;
      let results = [];

      function cleanup() {
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
        if (idx >= duels.length) {
          const all = results.slice();
          cleanup();
          done(all);
          return;
        }
        const duel = duels[idx];
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
              /* the knockout belongs to the arena and it is told the verdict,
                 so there is no second place a winner could be chosen */
              handle.knock(verdict.winner, function () {
                after(CARD_MS, function () {
                  if (!alive(token)) return;
                  handle.teardown();
                  run.arena = null;
                  dropDeck();
                  idx++;
                  nextDuel();
                });
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
      run = null;
    }
  };
})();
