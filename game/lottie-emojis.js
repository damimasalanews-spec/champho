/* CHAMP WORD - animated Lottie emojis for the Go Wild table.
   Three hand-drawn animations (laughing face, love dog, flying bee) shipped as
   self-hosted Lottie JSONs in game/lottie/, rendered by the self-hosted
   lottie-web player in vendor/lottie.min.js. They ride beside the classic
   emoji grid everywhere it appears: the dashboard's #emojiMenu and the game's
   tap-avatar .emo-grid. A tile keeps a looping poster until it is playing. */
(() => {
  'use strict';

  const ANIMATED = [
    { id: 'alo-haha', name: 'Haha', file: './game/lottie/smiley.json', loop: true },
    { id: 'alo-love', name: 'Love dog', file: './game/lottie/dog.json', loop: true },
    { id: 'alo-bee', name: 'Bee', file: './game/lottie/bee.json', loop: false }
  ];
  const POSTER = { 'alo-haha': '😄', 'alo-love': '🐶', 'alo-bee': '🐝' };
  const cache = new Map();

  const player = () => (typeof lottie !== 'undefined' ? lottie : null);

  function loadDef(file) {
    if (!cache.has(file)) cache.set(file, fetch(file).then(res => {
      if (!res.ok) throw new Error(res.status + ' loading ' + file);
      return res.json();
    }).catch(() => null));
    return cache.get(file);
  }

  /* the small looping poster inside a picker tile */
  function paintPoster(host, def) {
    const p = player();
    if (!p || !def) { host.textContent = POSTER[def ? def.id : 'alo-haha'] || '✨'; return; }
    const box = document.createElement('div');
    box.className = 'alo-poster';
    host.textContent = '';
    host.appendChild(box);
    try {
      p.loadAnimation({ container: box, renderer: 'svg', loop: true, autoplay: true, path: def.file });
    } catch { box.textContent = POSTER[def.id] || '✨'; }
  }

  /* every emoji board that supports the animated set calls this once; it returns
     the three tiles appended after the classic buttons */
  function decorateBoard(host, onPick) {
    if (!host || host.dataset.aloWired) return;
    host.dataset.aloWired = '1';
    const p = player();
    if (!p) return;   /* vendor player missing: no tiles, static emojis still work */
    const rail = document.createElement('div');
    rail.className = 'alo-rail';
    ANIMATED.forEach(entry => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'alo-tile';
      tile.title = 'LOTTIE · ' + entry.name;
      tile.dataset.lottie = entry.id;
      loadDef(entry.file).then(def => { if (def) paintPoster(tile, entry); else tile.textContent = POSTER[entry.id] || '✨'; });
      tile.addEventListener('click', ev => {
        ev.stopPropagation();
        onPick(entry);
        /* a press replays the tile's own animation inside the board */
        try { p.loadAnimation({ container: tile.querySelector('.alo-poster') || createHolder(tile), renderer: 'svg', loop: false, autoplay: true, path: entry.file }).addEventListener('complete', function () { this.destroy(); }); } catch (e) {}
      });
      rail.appendChild(tile);
    });
    host.appendChild(rail);
  }

  function createHolder(tile) {
    const box = document.createElement('div');
    box.className = 'alo-poster';
    tile.textContent = '';
    tile.appendChild(box);
    return box;
  }

  /* the flying/staged performance: a looping Lottie plays over one seat for ~2.2s */
  function playAnimatedOnSeat(seatEl, entry) {
    const p = player();
    if (!p || !seatEl) return false;
    seatEl.querySelectorAll('.alo-fx').forEach(el => el.remove());
    const stage = document.createElement('div');
    stage.className = 'alo-fx';
    seatEl.appendChild(stage);
    let anim = null;
    try {
      anim = p.loadAnimation({ container: stage, renderer: 'svg', loop: entry.loop, autoplay: true, path: entry.file });
    } catch (e) { stage.remove(); return false; }
    const done = () => { stage.remove(); anim && anim.destroy && anim.destroy(); };
    if (entry.loop) window.setTimeout(done, 2300);
    else anim.addEventListener('complete', done);
    return true;
  }

  window.__champLottieEmojis = {
    list: () => ANIMATED.map(x => ({ ...x })),
    decorateBoard,
    playOnSeat: playAnimatedOnSeat
  };
})();
