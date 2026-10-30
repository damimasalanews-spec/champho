/* ===========================================================================
   RIVALRY BOARD — head-to-head records and title ladder that survive reloads
   ---------------------------------------------------------------------------
   The wall push gets history. The banner can say these two have met before and
   one of them is ahead, name chips carry the title a player's wins have earned,
   and the receipt can announce a new one. Only names and results are stored,
   under one localStorage key, and every read is wrapped so a blocked store
   degrades to an empty record instead of breaking the post-match.
   =========================================================================== */
(() => {
  "use strict";
  if (window.ChampRivalry) return;

  /* a new title every 2 wins; the last one is the top of the ladder */
  const TITLES = ["WALL ROOKIE", "WALL BREAKER", "WALL CRUSHER", "WALL DESTROYER", "CHAMPION"];
  const KEY = "champ-rivalry-v1";
  let data = null;

  function load() {
    if (data) return data;
    try { data = JSON.parse(window.localStorage.getItem(KEY) || "{}") || {}; }
    catch (e) { data = {}; }
    return data;
  }
  function save() {
    try { window.localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {}
  }

  window.ChampRivalry = {
    /* a pair is keyed on the SORTED names, so either seat can ask */
    get(a, b) {
      const d = load();
      const pair = [a, b].sort();
      return d[pair[0] + "|" + pair[1]] || { a: 0, b: 0 };   /* counts in sorted-name order */
    },
    record(a, b, winnerName) {
      const d = load();
      const pair = [a, b].sort();
      const key = pair[0] + "|" + pair[1];
      const r = d[key] || { a: 0, b: 0 };
      if (winnerName === pair[0]) r.a++; else if (winnerName === pair[1]) r.b++;
      d[key] = r;
      save();
      return r;
    },
    wins(name) {
      const d = load();
      let n = 0;
      Object.keys(d).forEach(k => {
        const parts = k.split("|");
        if (parts[0] === name) n += d[k].a || 0;
        else if (parts[1] === name) n += d[k].b || 0;
      });
      return n;
    },
    title(name) {
      const w = this.wins(name);
      return TITLES[Math.min(TITLES.length - 1, Math.floor(w / 2))];
    },
    /* what the player holds now, what the next title is, and how many wins away */
    nextTitle(name) {
      const w = this.wins(name);
      const i = Math.min(TITLES.length - 1, Math.floor(w / 2));
      return { now: TITLES[i], next: TITLES[Math.min(TITLES.length - 1, i + 1)], toNext: (i + 1) * 2 - w };
    },
    titles: TITLES
  };
})();
