/* ===========================================================================
   WALL PUSH — CLIPART GUESSING CONTEST
   ---------------------------------------------------------------------------
   The wall push used to decide its winner with Math.random(). This module is
   what replaces that: instead of a coin flip, the two duelists are shown a 3D
   clipart drawing of a word and race to name it.

     - four cliparts per duel, 30 seconds each
     - a correct answer shoves the slab one step toward the opponent
     - a correct answer from the other side shoves it back
     - the first duelist to TWO correct answers drives the slab into the
       opponent's corner and that opponent goes down

   The contest renders into the round's own grid section - the seven-word rail
   carries the answer's letter boxes, the centre carries the picture, the
   leaderboard rail carries the two duelists and the slab. The layout is the
   game's; only the contents change.

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

  const ROUNDS = 4;          /* four cliparts in a duel */
  const SLOT_MS = 30000;     /* 30 seconds for each one */
  const NEED = 2;            /* first to two correct answers takes the wall */
  const TICK_MS = 100;
  const BOT_SKILL = 0.78;    /* how often a bot actually knows the picture */
  const RESOLVE_MS = 1250;   /* beat between the knockout and the post-match reel */

  const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
  const normalize = s => String(s || "").toLowerCase().replace(/[^a-z]/g, "").slice(0, 9);

  let root = null;     /* the three contest panels while they are mounted */
  let run = null;      /* the live run: { token, timers } */

  /* ====================================================================== DOM */
  function build() {
    const row = document.querySelector(".gwx-board-row");
    const table = document.getElementById("table");
    if (!row || !table) return null;

    const slots = document.createElement("section");
    slots.className = "gwx-word-panel wgx wgx-slots";
    slots.innerHTML =
      '<h2 class="gwx-side-heading">GUESS THE WORD</h2>' +
      '<div class="wgx-title">TOP <b data-x="rankA">1</b> vs TOP <b data-x="rankB">2</b></div>' +
      '<div class="wgx-slotrow" data-x="slots"></div>' +
      '<div class="wgx-feed" data-x="feed"></div>';

    const stage = document.createElement("div");
    stage.className = "gwx-letter-grid-shell wgx wgx-stage";
    stage.innerHTML =
      '<div class="wgx-head-row">' +
        '<span class="wgx-kicker">CLIPART <b data-x="n">1</b> / ' + ROUNDS + '</span>' +
        /* the marks have to exist: pips() toggles the children it finds, so an
           empty span is a progress bar that can never light up */
        '<span class="wgx-pips" data-x="rounds">' + '<i></i>'.repeat(ROUNDS) + '</span>' +
      '</div>' +
      '<div class="wgx-art" data-x="art"><img alt="" data-x="img"></div>' +
      '<div class="wgx-clock" data-x="clock">' +
        '<div class="wgx-clock-top"><span>SECONDS LEFT</span><b data-x="secs">30</b></div>' +
        '<div class="wgx-clock-track"><div class="wgx-clock-fill" data-x="fill"></div></div>' +
      '</div>' +
      '<form class="gwx-guess-form wgx-form" data-x="form">' +
        '<input autocomplete="off" autocapitalize="none" maxlength="9" placeholder="Type the word" aria-label="Word guess" data-x="input">' +
        '<select aria-label="Who is answering" data-x="select"></select>' +
        '<button type="submit">GUESS</button>' +
      '</form>' +
      '<div class="wgx-msg" data-x="msg">Both duelists may answer.</div>';

    const tally = document.createElement("section");
    tally.className = "gwx-leaderboard wgx wgx-tally";
    tally.innerHTML =
      '<h2 class="gwx-side-heading">THE WALL</h2>' +
      '<div class="wgx-duelist" data-x="da">' +
        '<img alt="" data-x="ava">' +
        '<b data-x="nameA">—</b>' +
        '<span class="wgx-pips" data-x="pipsA"><i></i><i></i></span>' +
      '</div>' +
      '<div class="wgx-track" data-x="track">' +
        '<span class="wgx-corner l"></span><span class="wgx-corner r"></span>' +
        '<div class="wgx-rig" data-x="rig">' +
          '<img class="wgx-head" alt="" data-x="headA">' +
          '<i class="wgx-slab"></i>' +
          '<img class="wgx-head" alt="" data-x="headB">' +
        '</div>' +
      '</div>' +
      '<div class="wgx-duelist" data-x="db">' +
        '<img alt="" data-x="avb">' +
        '<b data-x="nameB">—</b>' +
        '<span class="wgx-pips" data-x="pipsB"><i></i><i></i></span>' +
      '</div>' +
      '<div class="wgx-msg" data-x="verdict">First to ' + NEED + ' correct answers.</div>';

    const find = {};
    [slots, stage, tally].forEach(node => {
      node.querySelectorAll("[data-x]").forEach(el => { find[el.dataset.x] = el; });
    });

    row.append(slots, stage, tally);
    row.classList.add("wg-on");
    table.classList.add("wg-on");

    root = { row, table, slots, stage, tally, find };
    return root;
  }

  function teardown() {
    if (!root) return;
    root.row.classList.remove("wg-on");
    root.table.classList.remove("wg-on");
    [root.slots, root.stage, root.tally].forEach(n => n.remove());
    root = null;
  }

  /* ================================================================ rendering */
  function pips(host, n) {
    [...host.children].forEach((i, index) => i.classList.toggle("on", index < n));
  }

  function blanks(host, word) {
    host.replaceChildren();
    for (const ch of word) {
      const b = document.createElement("span");
      b.className = "wgx-blank";
      b.textContent = "";
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

  function note(text, kind) {
    const f = root.find.feed;
    const line = document.createElement("div");
    const left = document.createElement("span");
    left.textContent = text;
    const right = document.createElement("span");
    if (kind) right.className = kind;
    right.textContent = kind === "ok" ? "✓" : kind === "no" ? "✗" : "";
    line.append(left, right);
    f.prepend(line);
    while (f.children.length > 5) f.lastElementChild.remove();
  }

  /* ==================================================================== timing */
  function timers() {
    if (!run) run = { token: {}, timers: [] };
    return run.timers;
  }
  function after(ms, fn) {
    const id = window.setTimeout(() => { if (run) fn(); }, ms);
    timers().push(id);
    return id;
  }
  function every(ms, fn) {
    const id = window.setInterval(() => { if (run) fn(); }, ms);
    timers().push(id);
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
    let done = false;
    const finish = () => { if (done) return; done = true; cb(); };
    after(3000, finish);                       /* never hold the contest hostage */
    words.forEach(w => {
      const im = new Image();
      im.onload = im.onerror = () => { if (--left <= 0) finish(); };
      im.src = ART(w);
    });
  }

  /* ===================================================================== duel */
  function playDuel(duel, token, done) {
    const A = duel.a, B = duel.b;
    const f = root.find;
    const words = [...POOL].sort(() => Math.random() - 0.5).slice(0, ROUNDS);
    const tally = { a: 0, b: 0 };
    const human = A.id === "champ" ? "a" : B.id === "champ" ? "b" : null;
    let round = 0;

    f.rankA.textContent = String(duel.rankA);
    f.rankB.textContent = String(duel.rankB);
    f.nameA.textContent = A.name;
    f.nameB.textContent = B.name;
    f.ava.src = HEADS[A.key] || HEADS.boy;
    f.avb.src = HEADS[B.key] || HEADS.girl;
    f.headA.src = f.ava.src;
    f.headB.src = f.avb.src;
    f.da.classList.remove("win");
    f.db.classList.remove("win");
    f.headA.classList.remove("fall");
    f.headB.classList.remove("fall");
    f.track.style.setProperty("--wg-push", "0");
    pips(f.pipsA, 0);
    pips(f.pipsB, 0);
    f.feed.replaceChildren();
    f.verdict.textContent = `TOP ${duel.rankA} vs TOP ${duel.rankB} — first to ${NEED} correct answers.`;

    if (human) {
      f.form.style.display = "";
      f.select.innerHTML = `<option value="a">${A.name}</option><option value="b">${B.name}</option>`;
      f.select.value = human;
      f.input.disabled = false;
      f.msg.textContent = `You answer for ${human === "a" ? A.name : B.name}. Both duelists may guess.`;
    } else {
      f.form.style.display = "none";
      f.msg.textContent = "Both duelists are bots — spectating.";
    }

    /* ---- one clipart ---------------------------------------------------- */
    function runRound(word) {
      clearTimers();
      if (!alive(token)) return;

      f.n.textContent = String(round);
      pips(f.rounds, round);
      const clock = f.clock, fill = f.fill, secs = f.secs;
      f.art.classList.remove("done");
      f.img.src = ART(word);
      blanks(f.slots, word);
      clock.classList.remove("low");
      secs.textContent = String(Math.round(SLOT_MS / 1000));
      fill.style.transform = "scaleX(1)";
      f.verdict.textContent = `${round} of ${ROUNDS} — name the picture.`;

      const started = performance.now();
      let open = true;

      every(TICK_MS, () => {
        const left = Math.max(0, SLOT_MS - (performance.now() - started));
        secs.textContent = String(Math.ceil(left / 1000));
        fill.style.transform = "scaleX(" + (left / SLOT_MS).toFixed(4) + ")";
        clock.classList.toggle("low", left <= 10000);
        if (left <= 0) closeRound(null);
      });

      /* the bots decide whether they know this picture, and when they say so */
      ["a", "b"].forEach(side => {
        const who = side === "a" ? A : B;
        if (who.id === "champ") return;
        if (Math.random() > BOT_SKILL) return;
        const at = 3500 + Math.random() * 22500;
        const other = POOL[Math.floor(Math.random() * POOL.length)];
        /* A wrong guess is only a wrong guess. It used to close the round, which
           cancelled the same bot's own pending right answer along with every
           other timer in flight - so the duel could never score at all. */
        if (other !== word && Math.random() < 0.45) {
          after(Math.max(1400, at - 2600), () => wrongGuess(side, other));
        }
        after(at, () => closeRound({ side, guess: word }));
      });

      function wrongGuess(side, guess) {
        if (!open || !alive(token)) return;
        const naming = side === "a" ? A.name : B.name;
        note(`${naming} · ${guess.toUpperCase()}`, "no");
        f.msg.textContent = `${naming} guessed ${guess.toUpperCase()} — not it.`;
      }

      /* closeRound ends the round: a correct answer, or nobody at all in thirty
         seconds. A wrong guess deliberately leaves it running. */
      function closeRound(result) {
        if (!open) return;
        open = false;
        clearTimers();

        if (!result) {
          revealBlanks(f.slots, false);
          note(`TIME UP · ${word.toUpperCase()}`, "no");
          f.msg.textContent = `Time up — the picture was ${word.toUpperCase()}.`;
          after(1000, () => advance(false));
          return;
        }

        {
          const by = result.side;
          tally[by]++;
          pips(by === "a" ? f.pipsA : f.pipsB, tally[by]);
          f.art.classList.add("done");
          revealBlanks(f.slots, true);
          const naming = by === "a" ? A.name : B.name;
          note(`${naming} · ${word.toUpperCase()}`, "ok");
          f.msg.textContent = `${naming} has it — the wall takes a shove!`;
          f.verdict.textContent = `${word.toUpperCase()} · ${tally.a} — ${tally.b}`;
          const decided = tally[by] >= NEED;
          /* the finishing answer is the one that drives the slab into the
             opponent's corner, so a 2-1 duel ends with the loser buried in the
             corner rather than stranded in the middle */
          if (decided) {
            f.track.style.setProperty("--wg-push", by === "a" ? "2" : "-2");
            f.rig.classList.add("crash");
            (by === "a" ? f.headB : f.headA).classList.add("fall");
            f.da.classList.toggle("win", by === "a");
            f.db.classList.toggle("win", by === "b");
          } else {
            f.track.style.setProperty("--wg-push", String(clamp(tally.a - tally.b, -NEED, NEED)));
          }
          after(decided ? RESOLVE_MS : 1150, () => advance(decided));
        }
      }

      /* the human's answer for this round */
      f.form.onsubmit = event => {
        event.preventDefault();
        if (!open || !alive(token)) return;
        const value = normalize(f.input.value);
        const side = f.select.value;
        f.input.value = "";
        if (!value) return;
        if (value === word) closeRound({ side, guess: value });
        else wrongGuess(side, value);
      };
    }

    /* `round` is 1-based here: the counter and the round pips read straight off
       it, and the first round is entered by calling advance() rather than
       runRound() directly - entering at round 0 rendered "CLIPART 0 / 4" with no
       pip lit for the whole first picture. */
    function advance(decided) {
      if (!alive(token)) return;
      if (decided) return finish();
      round++;
      if (round > ROUNDS || tally.a >= NEED || tally.b >= NEED) return finish();
      runRound(words[round - 1]);
    }

    function finish() {
      if (!alive(token)) return;
      clearTimers();
      f.form.onsubmit = null;
      /* No coin flip and no invented winner: the louder tally takes the wall,
         and a dead heat goes to the higher seed, which is at least a rule a
         player can learn. It cannot happen in a 2-1 or 2-0 finish. */
      const winner = tally.b > tally.a ? "b" : "a";
      const loser = winner === "a" ? "b" : "a";
      f.track.style.setProperty("--wg-push", winner === "a" ? "2" : "-2");
      f.rig.classList.add("crash");
      (winner === "a" ? f.headB : f.headA).classList.add("fall");
      f.da.classList.toggle("win", winner === "a");
      f.db.classList.toggle("win", winner === "b");
      f.verdict.textContent = tally.a === tally.b
        ? `Level at ${tally.a} — TOP ${winner === "a" ? duel.rankA : duel.rankB} holds the wall.`
        : `TOP ${winner === "a" ? duel.rankA : duel.rankB} takes the wall ${Math.max(tally.a, tally.b)} — ${Math.min(tally.a, tally.b)}.`;
      after(700, () => done({
        rankA: duel.rankA, rankB: duel.rankB, winner,
        correctA: tally.a, correctB: tally.b,
        loserName: (loser === "a" ? A : B).name
      }));
    }

    preload(words, () => { if (alive(token)) advance(false); });
  }

  /* ==================================================================== module */
  window.ChampWallGuess = {
    pool: POOL,
    rounds: ROUNDS,
    seconds: SLOT_MS / 1000,

    /* duels: [{ rankA, rankB, a:{id,name,coins,team,key}, b:{...} }, ...]
       opts:   { push, onDone, sound }
       Each duel is raced here, then handed to `push` as a DECIDED duel so the
       post-match reel can no longer pick its own winner. */
    play: function (duels, opts) {
      opts = opts || {};
      const done = opts.onDone || function () {};
      const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!duels || !duels.length || reduced) { done([]); return; }
      if (!build()) { done([]); return; }

      const token = {};
      run = { token, timers: [] };
      const results = [];
      let idx = 0;

      function next() {
        if (!alive(token)) return;
        if (idx >= duels.length) {
          clearTimers();
          run = null;
          teardown();
          done(results);
          return;
        }
        const duel = duels[idx];
        playDuel(duel, token, verdict => {
          results.push(verdict);
          idx++;
          const push = opts.push;
          if (push && typeof push.play === "function") {
            push.play([{
              rankA: duel.rankA, rankB: duel.rankB, a: duel.a, b: duel.b,
              winner: verdict.winner
            }], { sound: opts.sound, onDone: next });
          } else {
            next();
          }
        });
      }
      next();
    },

    /* a round reset must not leave a bot's answer queued for the next board */
    cancel: function () {
      clearTimers();
      run = null;
      teardown();
    }
  };
})();
