import { canPlayCard, chooseAiCard, resolveChallenge, resolveAcceptedPenalty } from './go-wild-2v2-rules.js';
(()=>{'use strict';
const C=['red','yellow','green','blue'],ORDER=['champ','poker','kalkal','jess'],TEAM={champ:'A',poker:'A',kalkal:'B',jess:'B'},NAME={champ:'Champ',poker:'Poker',kalkal:'Kalkal',jess:'Jess'};
let s=null,aiTimer=null,clock=null,busy=false,sound=true,scores={A:0,B:0},roundToken=0;
const $=id=>document.getElementById(id),uid=()=>Math.random().toString(36).slice(2)+Date.now();
const shuffle=a=>{for(let i=a.length-1;i>0;i--){let j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a};
function deck(){let d=[];C.forEach(color=>{d.push({id:uid(),color,type:'number',value:'0'});for(let n=1;n<10;n++)for(let k=0;k<2;k++)d.push({id:uid(),color,type:'number',value:String(n)});for(let k=0;k<2;k++)['skip','reverse','draw2'].forEach(type=>d.push({id:uid(),color,type,value:type==='draw2'?'+2':type==='skip'?'SKIP':'↻'}))});for(let k=0;k<4;k++){d.push({id:uid(),color:'wild',type:'wild',value:'W'});d.push({id:uid(),color:'wild',type:'wild4',value:'+4'})}return shuffle(d)}
function idx(pid){return ORDER.indexOf(pid)}function current(){return ORDER[s.current]}function next(pid,steps=1){let i=idx(pid);for(let n=0;n<steps;n++)i=(i+s.dir+4)%4;return ORDER[i]}
function face(c){let e=document.createElement('div');e.className='gwx-card';e.dataset.id=c.id;e.dataset.color=c.color;e.dataset.type=c.type;e.innerHTML=window.ChampCards?.cardFaceHtml?window.ChampCards.cardFaceHtml(c):'<div class="gwx-card-face"><b>'+c.value+'</b></div>';return e}
function host(pid){if(pid==='champ')return $('hand-local');if(pid==='poker')return $('hand-top');return document.querySelector('.gwx-seat[data-player="'+pid+'"] .gwx-opponent-hand')}
function renderHidden(pid){let seat=document.querySelector('.gwx-seat[data-player="'+pid+'"]');if(!seat)return;let count=pid==='kalkal'?$('count-left'):$('count-right');count.textContent=s.players[pid].length;let h=seat.querySelector('.gwx-opponent-hand');if(!h){h=document.createElement('div');h.className='gwx-opponent-hand';seat.appendChild(h)}h.innerHTML='';let n=s.players[pid].length;s.players[pid].forEach((card,i)=>{let b=document.createElement('div');b.className='opponent-back';b.dataset.id=card.id;b.style.setProperty('--i',i);b.style.setProperty('--n',n);h.appendChild(b)})}
function render(pid){if(pid==='champ'){let h=$('hand-local');h.innerHTML='';s.players.champ.forEach((c,i)=>{let w=document.createElement('div');w.className='gwx-hand-card '+(playable(c,pid)?'playable':'illegal');w.dataset.id=c.id;w.style.setProperty('--rot',((i-(s.players.champ.length-1)/2)*4.2)+'deg');w.appendChild(face(c));w.onclick=()=>playLocal(c.id);h.appendChild(w)})}else if(pid==='poker'){let h=$('hand-top');h.innerHTML='';s.players.poker.forEach((c,i)=>{let e=document.createElement('div');e.className='mini mini-back';e.dataset.id=c.id;e.setAttribute('aria-hidden','true');e.style.transform='rotate('+((i-(s.players.poker.length-1)/2)*3)+'deg)';h.appendChild(e)})}else renderHidden(pid)}
function renderDiscard(){let d=$('discard');d.innerHTML='';d.appendChild(face(s.discard.at(-1)));let col=s.color;$('colorLabel').innerHTML='<i style="background:var(--'+col+')"></i> '+col.toUpperCase();$('stackBadge').textContent=s.pending?'+4 STACK ×'+(s.pending/4):'';$('stackBadge').classList.toggle('show',!!s.pending);$('drawBadge').textContent=s.deck.length}
function renderTurn(){let p=current();$('turnLabel').textContent=p==='champ'?'YOUR TURN':p==='poker'?'PARTNER TURN':NAME[p].toUpperCase()+' TURN';$('message').textContent=s.pending?(p==='champ'?'DRAW '+s.pending+' OR STACK +4':'Waiting for '+NAME[p]+' to respond…'):p==='champ'?'Match color, number or action':NAME[p]+' is choosing a card…';document.querySelectorAll('.gwx-seat').forEach(x=>x.classList.toggle('active',x.dataset.player===p))}
function render(){ORDER.forEach(render);renderDiscard();renderTurn();$('roundLabel').textContent=String(s.round).padStart(2,'0');$('teamScoreA').textContent=scores.A;$('teamScoreB').textContent=scores.B;if(s.pending){let canStack=s.players.champ.some(x=>x.type==='wild4');$('draw4Text').textContent='+'+s.pending+' is stacked. Stack another +4, challenge the last play, or take the full penalty.';$('acceptBtn').textContent='DRAW '+s.pending;$('stackBtn').textContent='STACK +4';$('stackBtn').disabled=!canStack;$('stackBtn').title=canStack?'Add another +4 to the stack':'You do not have a Wild +4 to stack'}else{$('draw4Text').textContent='Choose how to respond.';$('acceptBtn').textContent='DRAW 4';$('stackBtn').textContent='STACK +4';$('stackBtn').disabled=false;$('stackBtn').title=''}}
function playable(c,pid=current()){return canPlayCard(c,{pending:s.pending,color:s.color,top:s.discard.at(-1),hand:s.players[pid]||[]})}
function ensure(){if(s.deck.length)return;let top=s.discard.pop();s.deck=shuffle(s.discard.splice(0));s.discard=[top]}
function draw(pid,n){let got=[];for(let i=0;i<n;i++){ensure();if(!s.deck.length)break;let c=s.deck.pop();s.players[pid].push(c);got.push(c)}render(pid);if(got.length)animateDraw(pid,got);return got}
function drawAndWait(pid,n,message,done){let token=roundToken,got=draw(pid,n);$('message').textContent=message;busy=true;setTimeout(()=>{if(token!==roundToken)return;busy=false;done()},got.length?560+(got.length-1)*95:0)}
function drawTarget(pid,id){return host(pid)?.querySelector('[data-id="'+id+'"]')||document.querySelector('.gwx-seat[data-player="'+pid+'"] .opponent-back[data-id="'+id+'"]')||document.querySelector('.gwx-seat[data-player="'+pid+'"] .mini-back[data-id="'+id+'"]')}
function animateDraw(pid,cards){
  let pile=$('drawPile')?.getBoundingClientRect();if(!pile)return;
  cards.map(c=>drawTarget(pid,c.id)).filter(Boolean).forEach((target,k)=>{
    let r=target.getBoundingClientRect(),f=document.createElement('div');
    f.className='gwx-draw-flight';document.body.appendChild(f);
    f.style.left=(pile.left+pile.width/2-28)+'px';f.style.top=(pile.top+pile.height/2-39)+'px';
    target.classList.add('card-arriving');
    let x=r.left-f.offsetLeft,y=r.top-f.offsetTop;
    setTimeout(()=>{
      f.animate([
        {transform:'translate(0,0) rotate(-8deg) scale(.72)',opacity:0},
        {transform:'translate('+x*.55+'px,'+(y*.55-45)+'px) rotate(12deg) scale(1)',opacity:1,offset:.58},
        {transform:'translate('+x+'px,'+y+'px) rotate(0deg) scale(.84)',opacity:.25}
      ],{duration:560,easing:'cubic-bezier(.16,.84,.22,1)'}).finished
        .then(()=>{f.remove();target.classList.remove('card-arriving')})
        .catch(()=>{f.remove();target.classList.remove('card-arriving')});
    },k*95);
  });
}
function impact(){let fx=$('fx');for(let i=0;i<14;i++){let q=document.createElement('i');q.className='spark';q.style.left='50%';q.style.top='50%';let a=i*Math.PI*2/14,d=50+Math.random()*65;q.style.setProperty('--dx',Math.cos(a)*d+'px');q.style.setProperty('--dy',Math.sin(a)*d+'px');fx.appendChild(q);setTimeout(()=>q.remove(),600)}$('table').animate([{filter:'brightness(1.35)'},{filter:'brightness(1)'}],320)}
function fly(pid,c,done,srcRect){let src=host(pid)?.querySelector('[data-id="'+c.id+'"]');let a=srcRect||src?.getBoundingClientRect(),b=$('discard').getBoundingClientRect();if(!a||!b){done();return}let f=face(c);f.className='fly';document.body.appendChild(f);f.style.left=a.left+'px';f.style.top=a.top+'px';let x0=a.left,y0=a.top,x1=b.left,y1=b.top,cx=(x0+x1)/2,cy=Math.min(y0,y1)-100,t0=performance.now(),dur=500;function step(now){let t=Math.min(1,(now-t0)/dur),u=1-t;let x=u*u*x0+2*u*t*cx+t*t*x1,y=u*u*y0+2*u*t*cy+t*t*y1;f.style.transform='translate('+((x-x0))+'px,'+((y-y0))+'px) rotate('+(-10+28*t)+'deg) scale('+(1+.18*Math.sin(t*Math.PI))+')';if(t<1)requestAnimationFrame(step);else{f.remove();impact();done()}}requestAnimationFrame(step)}
function commit(pid,c,chosen){
if(!playable(c,pid))return false;
let token=roundToken;let p=s.players[pid],i=p.findIndex(x=>x.id===c.id);if(i<0)return false;let srcEl=host(pid)?.querySelector('[data-id="'+c.id+'"]');let srcRect=srcEl?.getBoundingClientRect()||document.querySelector('.gwx-seat[data-player="'+pid+'"] .gwx-player-card')?.getBoundingClientRect()||$('drawPile').getBoundingClientRect();let prior=s.color;if(c.type==='wild4'){s.lastDraw4Legal=!p.some(x=>x.color===prior&&x.type!=='wild4');s.pending=(s.pending||0)+4;s.pendingBy=pid;s.pendingColor=prior}p.splice(i,1);s.discard.push(c);s.color=c.color==='wild'?(chosen||C[Math.floor(Math.random()*4)]):c.color;render(pid);renderDiscard();if(!p.length){win(TEAM[pid],NAME[pid]+' went out');return true}if(p.length===1&&pid==='champ'){$('message').textContent='UNO! One card left!';$('unoBtn').animate([{transform:'scale(1)'},{transform:'scale(1.12)'},{transform:'scale(1)'}],420)}busy=true;fly(pid,c,()=>{if(token!==roundToken)return;busy=false;resolve(pid,c)},srcRect);return true}
function resolve(pid,c){if(c.type==='wild4'){advance();return}let steps=c.type==='skip'?2:1;if(c.type==='reverse')s.dir*=-1;if(c.type==='draw2'){let t=next(pid);draw(t,2);steps=2}advance(steps)}
function advance(steps=1){s.current=idx(next(current(),steps));renderTurn();if(current()==='champ'&&s.pending)setTimeout(()=>{render();$('draw4Modal').classList.add('open')},160);else if(current()!=='champ')scheduleAI()}
function playLocal(id){if(busy||s.dealing||s.phase!=='playing'||current()!=='champ')return;let c=s.players.champ.find(x=>x.id===id);if(!c||!playable(c))return;if(c.type==='wild'||c.type==='wild4'){$('colorModal').dataset.id=id;$('colorModal').classList.add('open');return}commit('champ',c)}
function aiChoose(pid){return chooseAiCard(s.players[pid],{pending:s.pending,color:s.color,top:s.discard.at(-1)})}
function scheduleAI(){clearTimeout(aiTimer);aiTimer=setTimeout(aiTurn,700+Math.random()*700)}
function aiTurn(){let pid=current();if(s.phase!=='playing'||pid==='champ')return;if(busy||s.dealing){scheduleAI();return}if(s.pending){let c=aiChoose(pid);if(c){commit(pid,c,C[Math.floor(Math.random()*4)]);return}let penalty=s.pending;s.pending=0;s.pendingBy=null;render();drawAndWait(pid,penalty,NAME[pid]+' drew '+penalty+' cards and was skipped.',advance);return}let c=aiChoose(pid);if(!c){drawAndWait(pid,1,NAME[pid]+' drew a card and skipped the turn.',advance);return}if(c.type==='wild4'||c.type==='wild'){let counts=C.map(col=>[col,s.players[pid].filter(x=>x.color===col).length]).sort((a,b)=>b[1]-a[1]);commit(pid,c,counts[0]?.[0]||C[0])}else commit(pid,c)}
function resolve4(action){if(!s.pending)return;let challenger=current(),offender=s.pendingBy;if(action==='challenge'){let outcome=resolveChallenge(s.lastDraw4Legal,s.pending);if(outcome.offenderDraws){s.pending=0;s.pendingBy=null;render();drawAndWait(offender,outcome.offenderDraws,NAME[offender]+' was challenged — +'+outcome.offenderDraws+' returned to '+NAME[offender]+'. Your turn continues.',()=>{if(current()!=='champ'&&!s.dealing)scheduleAI()})}else{s.pending=0;s.pendingBy=null;render();drawAndWait(challenger,outcome.challengerDraws,'Challenge failed. You drew '+outcome.challengerDraws+' cards and lost your turn.',advance)}}else if(action==='stack'){let c=s.players.champ.find(x=>x.type==='wild4');if(c){$('draw4Modal').classList.remove('open');commit('champ',c,C[Math.floor(Math.random()*4)]);return}}else{let outcome=resolveAcceptedPenalty(s.pending);s.pending=0;s.pendingBy=null;render();drawAndWait(challenger,outcome.draws,'You drew '+outcome.draws+' cards. Your turn is skipped.',advance)}}
function win(team,reason){if(!s||s.phase==='ended')return;s.phase='ended';clearTimeout(aiTimer);clearInterval(clock);busy=false;scores[team]=(scores[team]||0)+1;s.scores=scores;$('teamScoreA').textContent=scores.A;$('teamScoreB').textContent=scores.B;$('winTitle').textContent=team==='A'?'TEAM A WINS':'TEAM B WINS';$('winText').textContent=reason+' · '+(team==='A'?'Team A':'Team B')+' score '+scores[team];$('winModal').classList.add('open')}
function reportSetupError(error){console.error('Go Wild 2v2 setup failed',error);if(s){s.phase='error';s.dealing=false}const table=$('table');if(table){table.classList.remove('dealing');table.querySelectorAll('.gwx-hand-card,.mini-back,.opponent-back').forEach(card=>card.style.visibility='visible')}const message=$('message');if(message)message.textContent='Table setup failed: '+(error?.message||'please refresh and try again')}
function dealIntro(){
  const table=$('table'),pile=$('drawPile');
  if(!table||!pile||!s)return;
  const token=roundToken;
  clearTimeout(aiTimer);
  table.classList.add('dealing');
  s.dealing=true;
  const ps=$('previewState'); if(ps) ps.textContent='DEALING';

  document.querySelectorAll('.gwx-motion-layer').forEach(node=>node.remove());
  const motion=document.createElement('div');
  motion.className='gwx-motion-layer';
  document.body.appendChild(motion);

  const seats={
    poker:document.querySelector('.gwx-seat.top'),
    kalkal:document.querySelector('.gwx-seat.left'),
    jess:document.querySelector('.gwx-seat.right'),
    champ:document.querySelector('.gwx-seat.bottom')
  };

  const targetFor=(pid,i)=>{
    if(pid==='champ') return $('hand-local')?.children[i]||null;
    if(pid==='poker') return $('hand-top')?.children[i]||null;
    return seats[pid]?.querySelector('.gwx-opponent-hand')?.children[i]||null;
  };

  // True 2v2 round-robin: one card to each seat, seven passes.
  const jobs=[];
  for(let round=0;round<7;round++){
    for(const pid of ORDER){
      const target=targetFor(pid,round);
      if(target){target.style.visibility='hidden';jobs.push({pid,i:round,target});}
    }
  }

  const from=pile.getBoundingClientRect();
  if(!from.width||!from.height){
    finish();
    return;
  }

  let completed=0;
  let finished=false;
  const total=jobs.length;
  const step=150,startDelay=300,duration=650;

  jobs.forEach((job,index)=>{
    const delay=startDelay+index*step;
    setTimeout(()=>{
      if(token!==roundToken)return;

      const target=targetFor(job.pid,job.i);
      if(!target){completed++;finishIfDone();return;}

      const r=target.getBoundingClientRect();
      if(!r.width||!r.height){
        target.style.visibility='visible';
        completed++;finishIfDone();return;
      }

      // Build a guaranteed-visible card from the real destination card.
      const clone=job.pid==='champ'
        ? target.cloneNode(true)
        : target.cloneNode(true);

      clone.classList.remove('deal-target','deal-land');
      clone.classList.add('gwx-deal-clone');
      clone.style.setProperty('position','fixed','important');
      clone.style.setProperty('left',(from.left+from.width/2-r.width/2)+'px','important');
      clone.style.setProperty('top',(from.top+from.height/2-r.height/2)+'px','important');
      clone.style.setProperty('width',r.width+'px','important');
      clone.style.setProperty('height',r.height+'px','important');
      clone.style.setProperty('margin','0','important');
      clone.style.setProperty('visibility','visible','important');
      clone.style.setProperty('opacity','1','important');
      clone.style.setProperty('display','block','important');
      clone.style.setProperty('z-index','100000','important');
      clone.style.pointerEvents='none';
      clone.style.transform='rotate('+(index%2?-8:8)+'deg) scale(.72)';
      motion.appendChild(clone);

      const sx=from.left+from.width/2-r.width/2;
      const sy=from.top+from.height/2-r.height/2;
      const tx=r.left-sx,ty=r.top-sy;
      const arc=job.pid==='champ'?-75:job.pid==='poker'?-95:-70;
      const spin=index%2?-8:8;

      requestAnimationFrame(()=>{
        const anim=clone.animate([
          {transform:'translate(0,0) rotate('+(-spin)+'deg) scale(.72)',opacity:0},
          {transform:'translate('+tx*.32+'px,'+(ty*.32+arc)+'px) rotate('+spin+'deg) scale(1.12)',opacity:1,offset:.3},
          {transform:'translate('+tx*.72+'px,'+(ty*.72+arc*.25)+'px) rotate('+(-spin*.35)+'deg) scale(1.04)',opacity:1,offset:.72},
          {transform:'translate('+tx+'px,'+ty+'px) rotate(0deg) scale(1)',opacity:1}
        ],{duration,easing:'cubic-bezier(.12,.78,.18,1)',fill:'forwards'});

        anim.finished.then(()=>{
          clone.remove();
          if(token!==roundToken)return;
          target.style.visibility='visible';
          target.classList.add('deal-land');
          setTimeout(()=>target.classList.remove('deal-land'),380);
          completed++;finishIfDone();
        }).catch(()=>{
          clone.remove();
          if(token!==roundToken)return;
          target.style.visibility='visible';
          completed++;finishIfDone();
        });
      });
    },delay);
  });

  const finishDelay=total?startDelay+(total-1)*step+duration+350:0;
  setTimeout(()=>{if(token===roundToken)finish()},finishDelay);
  function finishIfDone(){if(!finished&&completed>=total)finish()}
  function finish(){
    if(finished)return;
    finished=true;
    motion.remove();
    table.querySelectorAll('.gwx-hand-card,.mini-back,.opponent-back').forEach(card=>{card.style.visibility='visible';card.classList.remove('deal-target')});
    table.classList.remove('dealing');
    s.dealing=false;
    const ps=$('previewState'); if(ps) ps.textContent='READY';
    render();
    if(current()!=='champ'&&!s.dealing)scheduleAI();
  }
}

function reset(){roundToken++;clearTimeout(aiTimer);clearInterval(clock);busy=false;document.querySelectorAll('.gwx-motion-layer').forEach(node=>node.remove());$('colorModal').classList.remove('open');$('draw4Modal').classList.remove('open');$('winModal').classList.remove('open');let d=deck(),players={};ORDER.forEach(p=>players[p]=[]);for(let i=0;i<7;i++)ORDER.forEach(p=>players[p].push(d.pop()));let top=d.pop();while(top.color==='wild'||top.type!=='number'){d.unshift(top);shuffle(d);top=d.pop()}s={deck:d,discard:[top],players,current:0,dir:1,color:top.color,pending:0,pendingBy:null,lastDraw4Legal:null,phase:'playing',dealing:true,round:s?.round?s.round+1:1,scores,seconds:150};try{render()}catch(error){reportSetupError(error);return}requestAnimationFrame(()=>setTimeout(()=>{try{dealIntro()}catch(error){reportSetupError(error)}},120));$('timer').textContent='02:30';clock=setInterval(()=>{if(s.phase==='playing' && !s.dealing){s.seconds--;let m=Math.max(0,Math.floor(s.seconds/60)),sec=Math.max(0,s.seconds%60);$('timer').textContent=String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0');if(s.seconds<=0)win('B','Time expired')}},1000);}
$('drawBtn').onclick=()=>{if(current()!=='champ'||busy||s?.dealing||s?.phase!=='playing')return;if(s.pending){$('draw4Modal').classList.add('open');return}drawAndWait('champ',1,'You drew a card and skipped your turn.',advance)};
$('drawPile').onclick=()=>$('drawBtn').click();
$('unoBtn').onclick=()=>{$('message').textContent='UNO called!';$('unoBtn').animate([{transform:'scale(1)'},{transform:'scale(1.1)'},{transform:'scale(1)'}],350)};
$('chatBtn').onclick=()=>$('chatPanel').classList.toggle('open');$('chatPanel').querySelectorAll('button').forEach(b=>b.onclick=()=>{$('message').textContent=b.dataset.msg;$('chatPanel').classList.remove('open')});
$('soundBtn').onclick=()=>{sound=!sound;$('app').classList.toggle('muted',!sound)};
$('restartBtn').onclick=reset;$('nextBtn').onclick=()=>{$('winModal').classList.remove('open');reset()};
document.querySelectorAll('#colorModal [data-color]').forEach(b=>b.onclick=()=>{let id=$('colorModal').dataset.id,c=s.players.champ.find(x=>x.id===id);if(c){$('colorModal').classList.remove('open');commit('champ',c,b.dataset.color)}});
$('challengeBtn').onclick=()=>{$('draw4Modal').classList.remove('open');resolve4('challenge')};$('stackBtn').onclick=()=>resolve4('stack');$('acceptBtn').onclick=()=>{$('draw4Modal').classList.remove('open');resolve4('accept')};
window.__goWild2v2Finished={state:()=>s,reset,play:id=>playLocal(id),replayDeal:()=>{roundToken++;clearTimeout(aiTimer);if(s) s.dealing=true;requestAnimationFrame(()=>dealIntro())}};
const previewDeal=$('previewDeal'),previewReset=$('previewReset');
if(previewDeal) previewDeal.onclick=()=>{roundToken++;clearTimeout(aiTimer);if(s){s.dealing=true;s.phase='playing';}dealIntro()};
if(previewReset) previewReset.onclick=()=>reset();
reset();
})();
