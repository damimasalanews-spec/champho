(()=>{'use strict';
const $=id=>document.getElementById(id);
const app=$('app'),table=$('table');
let audioCtx=null,lastTurn='',lastPending=0;
function tone(freq,dur=.09,type='sine',gain=.035){try{if(!audioCtx)audioCtx=new (window.AudioContext||window.webkitAudioContext)();let o=audioCtx.createOscillator(),g=audioCtx.createGain();o.type=type;o.frequency.value=freq;g.gain.setValueAtTime(gain,audioCtx.currentTime);g.gain.exponentialRampToValueAtTime(.001,audioCtx.currentTime+dur);o.connect(g).connect(audioCtx.destination);o.start();o.stop(audioCtx.currentTime+dur)}catch(e){}}
function burst(kind='play'){let fx=$('fx');if(!fx)return;let n=kind==='wild4'?28:kind==='win'?42:18;for(let i=0;i<n;i++){let q=document.createElement('i');q.className='gwx-burst-particle';let a=Math.random()*Math.PI*2,d=55+Math.random()*150;q.style.left='50%';q.style.top='48%';q.style.setProperty('--dx',Math.cos(a)*d+'px');q.style.setProperty('--dy',Math.sin(a)*d+'px');q.style.setProperty('--delay',Math.random()*.08+'s');fx.appendChild(q);setTimeout(()=>q.remove(),850)}table?.classList.remove('gwx-impact');void table?.offsetWidth;table?.classList.add('gwx-impact');setTimeout(()=>table?.classList.remove('gwx-impact'),360)}
function refresh(){const api=window.__goWild2v2Finished;if(!api)return;const s=api.state();if(!s)return;const cur=s.players?['champ','poker','kalkal','jess'][s.current]:'';if(cur!==lastTurn){if(lastTurn)tone(620,.07,'triangle');else tone(440,.05);lastTurn=cur;document.querySelectorAll('.gwx-seat').forEach(el=>el.classList.toggle('turn-arrive',el.dataset.player===cur));}
if(s.pending!==lastPending){if(s.pending>0){tone(180,.14,'sawtooth',.05);burst('wild4')}else if(lastPending>0)tone(520,.12,'triangle');lastPending=s.pending}
const hand=s.players?.champ?.length;if(hand===1){$('message').textContent='UNO! ONE CARD LEFT';burst('play');tone(880,.12,'square',.045);tone(1175,.16,'square',.04)}
if(s.phase==='ended')burst('win');
}
setInterval(refresh,180);
document.addEventListener('pointerdown',()=>{if(!audioCtx)try{audioCtx=new (window.AudioContext||window.webkitAudioContext)()}catch(e){}},{once:false});
$('drawBtn')?.addEventListener('click',()=>tone(300,.08,'triangle'));
$('drawPile')?.addEventListener('click',()=>tone(300,.08,'triangle'));
$('unoBtn')?.addEventListener('click',()=>{tone(880,.1,'square',.04);setTimeout(()=>tone(1175,.14,'square',.035),80)});
$('challengeBtn')?.addEventListener('click',()=>tone(240,.18,'sawtooth',.045));
$('stackBtn')?.addEventListener('click',()=>{tone(520,.08);setTimeout(()=>tone(780,.12),70)});
$('acceptBtn')?.addEventListener('click',()=>tone(180,.16,'sawtooth',.045));
$('restartBtn')?.addEventListener('click',()=>tone(440,.1));
})();