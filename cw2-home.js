/* CW2 home wiring — v2
   Self-contained: does not depend on the gzip home bundle (whose Firebase
   imports cannot resolve in this static build). Mirrors the page's own
   fallback navigation contract and adds the missing routes + back support. */
(function(){
  'use strict';
  function ready(fn){if(document.readyState!=='loading')fn();else document.addEventListener('DOMContentLoaded',fn)}
  ready(function(){
    const $=id=>document.getElementById(id);

    /* ---- live profile bridge ----
       The inline champ scripts own #homeCoins/#homeGems/#homeName;
       we mirror the profile name into the visible header. */
    function paintHeader(){
      try{
        const p=(typeof profile!=='undefined'&&profile)?profile:{};
        const name=p.displayName||'Guest';
        const vis=$('fdName'),hid=$('homeName');
        if(vis&&vis.textContent!==name)vis.textContent=name;
        if(hid&&hid.textContent!==name)hid.textContent=name;
      }catch(e){}
    }
    paintHeader();
    new MutationObserver(paintHeader).observe(document.body,{subtree:true,childList:true,characterData:true});

    /* ---- screen switching (bundle-free) ---- */
    function go(screen){
      const target=document.getElementById(screen);
      if(!target)return;
      document.querySelectorAll('.screen').forEach(x=>x.classList.add('hidden'));
      target.classList.remove('hidden');
      document.body.classList.remove('auth-open','profile-open');
      document.body.classList.add('app-open');
    }
    function goHome(){go('finalDashboard')}

    /* back buttons on sub-screens (data-home) */
    document.addEventListener('click',e=>{
      const b=e.target&&e.target.closest?e.target.closest('[data-home]'):null;
      if(b){e.preventDefault();e.stopPropagation();goHome()}
    },true);
    const pb=$('profileBackBtn');if(pb)pb.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();goHome()});

    /* ---- routes: every control lands on a real screen ---- */
    const routes={
      bottomSettings:'settings', bottomFriends:'social', bottomLeague:'leaderboard',
      bottomEvents:'events', bottomCanvas:'progress', bottomStore:'shop',
      homeChat:'social', homePass:'seasonpass', homeBank:'seasonpass',
      homeSettings:'settings'
    };
    Object.keys(routes).forEach(id=>{
      const el=$(id);if(!el)return;
      el.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();go(routes[id])});
    });
    // currency chips open the shop
    document.querySelectorAll('.cw2-chip[data-cw2]').forEach(el=>{
      el.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();go('shop')});
    });
    // free rewards store -> shop (featured)
    const fr=$('homeRewards');if(fr)fr.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();go('shop')});
    // fun pack / contest / friends cards
    const fun=$('homePlayFun');if(fun)fun.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();go('shop')});
    const contest=$('homeContest');if(contest)contest.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();go('leaderboard')});
    const friends=$('homeFriends');if(friends)friends.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();go('social')});
  });
})();
