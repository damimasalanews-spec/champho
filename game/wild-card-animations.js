/* Champ Word Go Wild — animated card controller
   Presentation only. It observes the DOM and never changes the authoritative game state. */
(() => {
  "use strict";

  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const seen = new WeakSet();

  function isCard(el) {
    return !!el && el.nodeType === 1 &&
      (el.matches(".card, .opponent-open-card, .ai-card-back, .discarded-card") ||
       el.classList.contains("card"));
  }

  function isWild(el) {
    if (!el) return false;
    const cls = String(el.className || "").toLowerCase();
    const text = String(el.textContent || "").replace(/\s+/g, " ").trim();
    return /wild|wild4|wild_draw4|black/.test(cls) || /\+4/.test(text);
  }

  function animateCard(el) {
    if (!isCard(el) || seen.has(el)) return;
    seen.add(el);

    if (isWild(el)) el.classList.add("champ-wild-card");

    el.classList.add("champ-card-enter");
    const finish = () => el.classList.remove("champ-card-enter");
    el.addEventListener("animationend", finish, { once: true });
    setTimeout(finish, reduced ? 0 : 700);
  }

  function animatePileCard(el) {
    if (!el) return;
    el.classList.remove("champ-card-land", "champ-draw4-land");
    void el.offsetWidth;

    if (isWild(el)) el.classList.add("champ-wild-card");
    const draw4 = /\+4|wild_draw4|wild4/i.test(String(el.className || "") + " " + el.textContent);
    el.classList.add(draw4 ? "champ-draw4-land" : "champ-card-land");

    setTimeout(() => {
      el.classList.remove("champ-card-land", "champ-draw4-land");
    }, reduced ? 0 : 1200);
  }

  function scan(root) {
    if (!root || root.nodeType !== 1) return;
    if (isCard(root)) animateCard(root);
    root.querySelectorAll?.(".card, .opponent-open-card, .ai-card-back").forEach(animateCard);
  }

  function watch(container, pile = false) {
    if (!container) return;
    scan(container);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (pile) {
            const card = node.matches?.(".discarded-card") ? node :
              node.querySelector?.(".discarded-card");
            if (card) animatePileCard(card);
          } else {
            scan(node);
          }
        }
      }
    });
    observer.observe(container, { childList: true, subtree: true });
  }

  function deckFeedback() {
    const deck = document.getElementById("central-deck");
    if (!deck || deck.dataset.champFxBound) return;
    deck.dataset.champFxBound = "1";
    deck.addEventListener("click", () => {
      deck.classList.remove("champ-deck-active");
      void deck.offsetWidth;
      deck.classList.add("champ-deck-active");
      setTimeout(() => deck.classList.remove("champ-deck-active"), reduced ? 0 : 600);
    }, { passive: true });
  }

  function enhance() {
    watch(document.getElementById("local-player-hand"));
    watch(document.getElementById("teammate-hand-container"));
    watch(document.getElementById("fan-hand-left"));
    watch(document.getElementById("fan-hand-right"));
    watch(document.getElementById("discard-deck-pile"), true);
    deckFeedback();

    // The existing engine may replace the whole pile node during a round reset.
    // Re-scan the page cheaply whenever the board mutates, without touching game state.
    const pageObserver = new MutationObserver(() => {
      deckFeedback();
    });
    pageObserver.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", enhance, { once: true });
  } else {
    enhance();
  }

  window.ChampCardFX = {
    animateCard,
    animatePileCard,
    rescan: enhance
  };
})();
