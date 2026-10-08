/* Avatar sync: after the app bundle renders its avatars, also reflect the
   chosen character/frame/effect into the profile card's large avatar and the
   home header chip. Works with the gzip-injected bundle (its top-level
   functions are globals) and tolerates the fallback-scripts mode. */
(function () {
  var tries = 0;
  function sync() {
    try {
      if (typeof avatarData !== 'function' || typeof avatarMarkup !== 'function' || typeof AVATARS === 'undefined') return false;
      var a = avatarData();
      var l = document.getElementById('profileAvatarLarge');
      if (l) l.innerHTML = avatarMarkup('profile-large', a);
      /* the redesigned home header chip (old dashboard owns the duplicate id) */
      var av = AVATARS.find(function (x) { return x[0] === a.avatarId; }) || AVATARS[0];
      document.querySelectorAll('#finalDashboard .cw2-ava img').forEach(function (img) { img.src = av[2]; });
      return true;
    } catch (e) { return false; }
  }
  function install() {
    if (typeof renderProfileAvatars === 'function' && !renderProfileAvatars.__cw2sync) {
      var orig = renderProfileAvatars;
      var wrapped = function () { var r = orig.apply(this, arguments); sync(); return r; };
      wrapped.__cw2sync = true;
      try { window.renderProfileAvatars = wrapped; } catch (e) {}
    }
    if (typeof updateHome === 'function' && !updateHome.__cw2sync) {
      var oh = updateHome;
      var wh = function () { var r = oh.apply(this, arguments); sync(); return r; };
      wh.__cw2sync = true;
      try { window.updateHome = wh; } catch (e) {}
    }
  }
  (function boot() {
    if (sync() && install()) return;
    if (++tries < 60) setTimeout(boot, 250);
  })();
  document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 100); });
})();
