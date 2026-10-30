/* ==========================================================================
   Go Wild 2v2 — motion driver (word grid)
   Presentation only. It watches the existing DOM for changes the game
   already makes and adds a state class. It never reads or writes game
   state, never calls into the game engine, and does nothing if an element
   is missing. The page keeps working untouched without this file.
   ========================================================================== */
(() => {
  'use strict';

  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
  const LOW_TIME_SECONDS = 20;

  const $ = (id) => document.getElementById(id);

  /* Re-trigger one class, cancelling the previous cleanup so a rapid repeat
     cannot strip the class out from under the animation that just started. */
  function replay(el, className, ms) {
    if (!el || reduce) return;
    const key = '_gwTimer_' + className;
    el.classList.remove(className);
    void el.offsetWidth;
    el.classList.add(className);
    window.clearTimeout(el[key]);
    el[key] = window.setTimeout(() => el.classList.remove(className), ms);
  }

  /* ---- Timer urgency ----------------------------------------------------
     The clock is plain text ("MM:SS"), so the only reliable signal is the
     text itself. */
  function watchTimer() {
    const timer = $('timer');
    if (!timer) return;

    const sync = () => {
      const match = /(\d+):(\d+)/.exec(timer.textContent || '');
      if (!match) return;
      const seconds = Number(match[1]) * 60 + Number(match[2]);
      timer.classList.toggle('gw-low', seconds <= LOW_TIME_SECONDS && seconds > 0);
    };

    sync();
    new MutationObserver(sync).observe(timer, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }

  /* ---- Score bumps ------------------------------------------------------
     Any coin readout that changes text gets a short bump. Watching the text
     keeps this independent of which player or team scored. */
  function watchScores() {
    const ids = [
      'totalCoins',
      'teamCoinsA', 'teamCoinsB',
      'coins-champ', 'coins-poker', 'coins-kalkal', 'coins-jess'
    ];

    ids.forEach((id) => {
      const el = $(id);
      if (!el) return;
      let previous = el.textContent;
      new MutationObserver(() => {
        const next = el.textContent;
        if (next === previous) return;
        previous = next;
        replay(el, 'gw-bump', 520);
      }).observe(el, { childList: true, characterData: true, subtree: true });
    });
  }

  /* ---- Round line flash -------------------------------------------------
     The round line carries the "who found what" result, so a change there
     is worth a beat. */
  function watchRoundMessage() {
    const el = $('roundMessage');
    if (!el) return;
    let previous = el.textContent;
    new MutationObserver(() => {
      const next = el.textContent;
      if (next === previous) return;
      previous = next;
      replay(el, 'gw-flash', 1080);
    }).observe(el, { childList: true, characterData: true, subtree: true });
  }

  /* ---- Board feedback ---------------------------------------------------
     The two text lines that report a guess are hidden by the base sheet, so
     the outcome is played on the grid instead. The game still toggles the
     'good' / 'bad' class on the message element, even while its text is not
     visible — that class is the signal watched here. */
  function watchGuessOutcome() {
    const message = $('guessMessage');
    const grid = $('letterGrid');
    if (!message || !grid) return;

    const sync = () => {
      if (message.classList.contains('good')) replay(grid, 'gw-correct', 820);
      else if (message.classList.contains('bad')) replay(grid, 'gw-wrong', 480);
    };

    new MutationObserver(sync).observe(message, {
      attributes: true,
      attributeFilter: ['class']
    });
  }

  /* ---- Restart spin ----------------------------------------------------- */
  function bindRestart() {
    const button = $('restartBtn');
    if (!button) return;
    button.addEventListener('click', () => replay(button, 'gw-spin', 660), { passive: true });
  }

  function start() {
    watchTimer();
    watchScores();
    watchRoundMessage();
    watchGuessOutcome();
    bindRestart();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
