(()=>{'use strict';
const C=['red','yellow','green','blue'],ORDER=['champ','poker','kalkal','jess'],TEAM={champ:'A',poker:'A',kalkal:'B',jess:'B'},NAME={champ:'Champ',poker:'Poker',kalkal:'Kalkal',jess:'Jess'};
let s=null,aiTimer=null,clock=null,busy=false,sound=true;
const $=id=>document.getElementById(id),uid=()=>Math.random().toString(36).slice(2)+Date.now();
const shuffle=a=>{for(let i=a.length-1;i>0;i--){let j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a};
function deck(){let d=[];C.forEach(color=>{d.push({id:uid(),color,type:'number',value:'0'});for(let n=1;n<10;n++)for(let k=0;k<2;k++)d.push({id:uid(),color,type:'number',value:String(n)});for(let k=0;k<2;k++)['skip','reverse','draw2'].forEach(type=>d.push({id:uid(),color,type,value:type==='draw2'?'+2':type==='skip'?'SKIP':'↻'}))});for(let k=0;k<4;k++){d.push({id:uid(),color:'wild',type:'wild',value:'W'});d.push({id:uid(),color:'wild',type:'wild4',value:'+4'})}return shuffle(d)}
function idx(pid){return ORDER.indexOf(pid)}function current(){return ORDER[s.current]}function next(pid,steps=1){let i=idx(pid);for(let n=0;n<steps;n++)i=(i+s.dir+4)%4;return ORDER[i]}
function face(c){let e=document.createElement('div');e.className='gwx-card';e.dataset.id=c.id;e.dataset.color=c.color;e.dataset.type=c.type;e.innerHTML=window.ChampCards?.cardFaceHtml?window.ChampCards.cardFaceHtml(c):'<div class="gwx-card-face"><b>'+c.value+'</b></div>';return e}
function host(pid){return pid==='champ'?$('hand-local'):pid==='poker'?$('hand-top'):null}
function renderHidden(pid){let seat=document.querySelector('.gwx-seat[data-player="'+pid+'"]');if(!seat)return;let count=pid==='kalkal'?$('count-left'):$('count-right');count.textContent=s.players[pid].length}
function render(pid){if(pid==='champ'){let h=$('hand-local');h.innerHTML='';s.players.champ.forEach((c,i)=>{let w=document.createElement('div');w.className='gwx-hand-card '+(playable(c)?'playable':'illegal');w.dataset.id=c.id;w.style.setProperty('--rot',((i-(s.players.champ.length-1)/2)*4.2)+'deg');w.appendChild(face(c));w.onclick=()=>playLocal(c.id);h.appendChild(w)})}else if(pid==='poker'){let h=$('hand-top');h.innerHTML='';s.players.poker.forEach((c,i)=>{let e=face(c);e.classList.add('mini');e.style.transform='rotate('+((i-(s.players.poker.length-1)/2)*3)+'deg)';h.appendChild(e)})}else renderHidden(pid)}
function renderDiscard(){let d=$('discard');d.innerHTML='';d.appendChild(face(s.discard.at(-1)));let col=s.color;$('colorLabel').innerHTML='<i style="background:var(--'+col+')"></i> '+col.toUpperCase();$('stackBadge').textContent=s.pending?'+4 STACK ×'+(s.pending/4):'';$('stackBadge').classList.toggle('show',!!s.pending);$('drawBadge').textContent=s.deck.length}
function renderTurn(){let p=current();$('turnLabel').textContent=p==='champ'?'YOUR TURN':p==='poker'?'PARTNER TURN':NAME[p].toUpperCase()+' TURN';$('message').textContent=s.pending?(p==='champ'?'DRAW '+s.pending+' OR STACK +4':'Waiting for '+NAME[p]+' to respond…'):p==='champ'?'Match color, number or action':NAME[p]+' is choosing a card…';document.querySelectorAll('.gwx-seat').forEach(x=>x.classList.toggle('active',x.dataset.player===p))}
function render(){ORDER.forEach(render);renderDiscard();renderTurn();$('roundLabel').textContent=String(s.round).padStart(2,'0')}
function playable(c){if(s.pending)return c.type==='wild4';let t=s.discard.at(-1);return c.color==='wild'||c.color===s.color||c.value===t.value||c.type===t.type}
function ensure(){if(s.deck.length)return;let top=s.discard.pop();s.deck=shuffle(s.discard.splice(0));s.discard=[top]}
function draw(pid,n){let got=[];for(let i=0;i<n;i++){ensure();if(!s.deck.length)break;let c=s.deck.pop();s.players[pid].push(c);got.push(c)}render(pid);return got}
function impact(){let fx=$('fx');for(let i=0;i<14;i++){let q=document.createElement('i');q.className='spark';q.style.left='50%';q.style.top='50%';let a=i*Math.PI*2/14,d=50+Math.random()*65;q.style.setProperty('--dx',Math.cos(a)*d+'px');q.style.setProperty('--dy',Math.sin(a)*d+'px');fx.appendChild(q);setTimeout(()=>q.remove(),600)}$('table').animate([{filter:'brightness(1.35)'},{filter:'brightness(1)'}],320)}
function fly(pid,c,done){let src=host(pid)?.querySelector('[data-id="'+c.id+'"]');let a=src?.getBoundingClientRect(),b=$('discard').getBoundingClientRect();if(!a||!b){done();return}let f=face(c);f.className='fly';document.body.appendChild(f);f.style.left=a.left+'px';f.style.top=a.top+'px';let x0=a.left,y0=a.top,x1=b.left,y1=b.top,cx=(x0+x1)/2,cy=Math.min(y0,y1)-100,t0=performance.now(),dur=500;function step(now){let t=Math.min(1,(now-t0)/dur),u=1-t;let x=u*u*x0+2*u*t*cx+t*t*x1,y=u*u*y0+2*u*t*cy+t*t*y1;f.style.transform='translate('+((x-x0))+'px,'+((y-y0))+'px) rotate('+(-10+28*t)+'deg) scale('+(1+.18*Math.sin(t*Math.PI))+')';if(t<1)requestAnimationFrame(step);else{f.remove();impact();done()}}requestAnimationFrame(step)}
function commit(pid,c,chosen){let p=s.players[pid],i=p.findIndex(x=>x.id===c.id);if(i<0)return;let prior=s.color;if(c.type==='wild4'){s.lastDraw4Legal=!p.some(x=>x.color===prior&&x.type!=='wild4');s.pending=(s.pending||0)+4;s.pendingBy=pid;s.pendingColor=prior}p.splice(i,1);s.discard.push(c);s.color=c.color==='wild'?(chosen||C[Math.floor(Math.random()*4)]):c.color;render(pid);renderDiscard();if(!p.length){win(TEAM[pid],NAME[pid]+' went out');return}if(p.length===1&&pid==='champ'){$('message').textContent='UNO! One card left!';$('unoBtn').animate([{transform:'scale(1)'},{transform:'scale(1.12)'},{transform:'scale(1)'}],420)}busy=true;fly(pid,c,()=>{busy=false;resolve(pid,c)})}
function resolve(pid,c){if(c.type==='wild4'){advance();return}let steps=c.type==='skip'?2:1;if(c.type==='reverse')s.dir*=-1;if(c.type==='draw2'){let t=next(pid);draw(t,2);steps=2}advance(steps)}
function advance(steps=1){s.current=idx(next(current(),steps));renderTurn();if(current()==='champ'&&s.pending)setTimeout(()=>$('draw4Modal').classList.add('open'),160);else if(current()!=='champ')scheduleAI()}
function playLocal(id){if(busy||s.phase!=='playing'||current()!=='champ')return;let c=s.players.champ.find(x=>x.id===id);if(!c||!playable(c))return;if(c.type==='wild'||c.type==='wild4'){$('colorModal').dataset.id=id;$('colorModal').classList.add('open');return}commit('champ',c)}
function aiChoose(pid){let h=s.players[pid].filter(playable);if(!h.length)return null;let score=c=>({wild4:10,draw2:9,skip:8,reverse:7,wild:6}[c.type]||1);return h.sort((a,b)=>score(b)-score(a))[0]}
function scheduleAI(){clearTimeout(aiTimer);aiTimer=setTimeout(aiTurn,700+Math.random()*700)}
function aiTurn(){let pid=current();if(s.phase!=='playing'||pid==='champ')return;if(s.pending){let c=s.players[pid].find(x=>x.type==='wild4');if(c){commit(pid,c,C[Math.floor(Math.random()*4)]);return}draw(pid,s.pending);s.pending=0;s.pendingBy=null;setTimeout(advance,500);return}let c=aiChoose(pid);if(!c){let g=draw(pid,1);c=g[0]&&playable(g[0])?g[0]:null}if(!c){setTimeout(advance,450);return}if(c.type==='wild4'||c.type==='wild'){let counts=C.map(col=>[col,s.players[pid].filter(x=>x.color===col).length]).sort((a,b)=>b[1]-a[1]);commit(pid,c,counts[0]?.[0]||C[0])}else commit(pid,c)}
function resolve4(action){let challenger=current(),offender=s.pendingBy;if(action==='challenge'){let guilty=s.lastDraw4Legal===false;if(guilty){draw(offender,s.pending);s.pending=0;s.pendingBy=null;render();if(current()!=='champ')scheduleAI()}else{draw(challenger,s.pending+2);s.pending=0;s.pendingBy=null;advance()}}else if(action==='stack'){let c=s.players.champ.find(x=>x.type==='wild4');if(c){$('draw4Modal').classList.remove('open');commit('champ',c,C[Math.floor(Math.random()*4)]);return}}else{draw(challenger,s.pending);s.pending=0;s.pendingBy=null;advance()}}
function win(team,reason){s.phase='ended';$('winTitle').textContent=team==='A'?'TEAM A WINS':'TEAM B WINS';$('winText').textContent=reason;$('winModal').classList.add('open')}
function reset(){clearTimeout(aiTimer);clearInterval(clock);let d=deck(),players={};ORDER.forEach(p=>players[p]=[]);for(let i=0;i<7;i++)ORDER.forEach(p=>players[p].push(d.pop()));let top=d.pop();while(top.color==='wild'){d.unshift(top);shuffle(d);top=d.pop()}s={deck:d,discard:[top],players,current:0,dir:1,color:top.color,pending:0,pendingBy:null,lastDraw4Legal:null,phase:'playing',round:s?.round? s.round+1:1};render();clock=setInterval(()=>{if(s.phase==='playing'){s.seconds=(s.seconds||150)-1;let m=Math.floor(s.seconds/60),sec=s.seconds%60;$('timer').textContent=String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0');if(s.seconds<=0)win('B','Time expired')}},1000);s.seconds=150;if(current()!=='champ')scheduleAI()}
$('drawBtn').onclick=()=>{if(current()!=='champ'||busy)return;if(s.pending){$('draw4Modal').classList.add('open');return}let g=draw('champ',1);if(!g[0]||!playable(g[0]))setTimeout(advance,450)};
$('drawPile').onclick=()=>$('drawBtn').click();
$('unoBtn').onclick=()=>{$('message').textContent='UNO called!';$('unoBtn').animate([{transform:'scale(1)'},{transform:'scale(1.1)'},{transform:'scale(1)'}],350)};
$('chatBtn').onclick=()=>$('chatPanel').classList.toggle('open');$('chatPanel').querySelectorAll('button').forEach(b=>b.onclick=()=>{$('message').textContent=b.dataset.msg;$('chatPanel').classList.remove('open')});
$('soundBtn').onclick=()=>{sound=!sound;$('app').classList.toggle('muted',!sound)};
$('restartBtn').onclick=reset;$('nextBtn').onclick=()=>{$('winModal').classList.remove('open');reset()};
document.querySelectorAll('#colorModal [data-color]').forEach(b=>b.onclick=()=>{let id=$('colorModal').dataset.id,c=s.players.champ.find(x=>x.id===id);if(c){$('colorModal').classList.remove('open');commit('champ',c,b.dataset.color)}});
$('challengeBtn').onclick=()=>{$('draw4Modal').classList.remove('open');resolve4('challenge')};$('stackBtn').onclick=()=>resolve4('stack');$('acceptBtn').onclick=()=>{$('draw4Modal').classList.remove('open');resolve4('accept')};
window.__goWild2v2Finished={state:()=>s,reset,play:id=>playLocal(id)};reset();dealIntro();
})();
// Premium round-start choreography + opponent card-flight feedback
function dealIntro(){
  const table=$('table');
  table.classList.add('dealing');
  const all=['champ','poker','kalkal','jess'];
  let n=0;
  all.forEach((pid,pi)=>{
    for(let j=0;j<7;j++){
      setTimeout(()=>{
        const seat=document.querySelector('.gwx-seat[data-player="'+pid+'"]');
        if(seat){seat.animate([{transform:getComputedStyle(seat).transform+' translateY(8px)',opacity:.55},{transform:getComputedStyle(seat).transform,opacity:1}],220)}
      },n++*38);
    }
  });
  setTimeout(()=>table.classList.remove('dealing'),n*38+300);
}
