import { canPlayWord, chooseAiWord, playableWords, resolveBookDraw, wordLetters } from './go-wild-2v2-word-rules.js';
(()=>{
  'use strict';
  const ORDER=['champ','poker','kalkal','jess'],TEAM={champ:'A',poker:'A',kalkal:'B',jess:'B'},NAME={champ:'Champ',poker:'Poker',kalkal:'Kalkal',jess:'Jess'};
  // Playful Romanized Nepali teasing words; all entries use Latin letters so
  // the last-letter chain stays readable and works with the word rules.
  const WORD_BANK=[
    'alu','alchi','aandhi','akkad','attteri','aalsi','aafno thulo','aghi badhne','boka','bakbak',
    'bujhakkad','bhalu','bhunte','bhandari','bhukne','bhusuna','bimari','bicharo','babal','bindaas',
    'chuche','chatake','chillare','chyangba','chhuchho','chhuchhundro','chhimeki','chhuchhi','chirkuto','chulbule',
    'dhakkan','dhapodi','dhurta','dhulo','dhingana','dhamilo','dherai bolne','dalla','darpoke','dhyangro',
    'ek number ko fattu','ekkasi hero','estai ho','fuchche','fataha','fursadilo','fokso','fuchungi','fuchhe','fiss',
    'guffadi','gadha','gajedi','gaule','gajjab ko natak','ghamandi','ghusghuse','gaule don','golo','gulgule',
    'hawa','halla garne','hero banna khojne','hawa guff','hass uthdo','hattari','huchil','hune khane','hawa raja','hawa dai',
    'ichchhadhari hero','jhagalu','jhyau','jhakri','jpt','jhilke','janne paltya','jibro lamo','jiddi','jhamela',
    'khate','khub janne','khali guff','khurapati','khuski','kukur','kukur ko bachcha','kalkale','kakro','khyau',
    'lato','luchcha','lappan chhappan','lajalu','lappu','lattu','lafaanga','lambu','luchhi','luki luki',
    'muji','makkha','mukhale','moto buddhi','mauka khojne','murmure','mukh chaldai','makune','myaau','masta',
    'natakbaaz','nakkali','nikamma','nindraalu','nakhra','naramro joker','nakkhu','naramro guffadi','nithalla','narisau',
    'olto buddhi','over smart','oho hero','pakhe','pagal','pachhadi bolne','puchhare','puchhi','patalo guff','paila pachhi',
    'qataro janne','risaune','rajai ko kira','rato mukhe','raddi','ramailo dhakkan','rukhho','risaalu','rajkumar','roilo',
    'sano don','susta','suntale','sano buddhi','sukeko','sajilo hero','sakkali guffadi','syaal','suti rahane','suruwaat',
    'thulo guff','thopda','thakuri attitude','thakkar','thulo manche','thute','thukpa','tori laure','taukeko','tiktike',
    'ullu','uchalputhal','ukus mukus','upri hero','utauli','ulto palto','uufri','ukalo oralo','uileko','uchit chaina',
    'vayena hero','vau khojne','vutro','vutla','vukampa jasto','varyaang','vailo','vayena ni','vako natak','vaye bhar ko',
    'wakka','wakkai lagdo','waahiyat','wada hero','wori pari','wasta nagarne','wori ko','wakka dikka','wuiyaa','wasta',
    'xaina janne','xyaa','xyaak','yeta uta','yedi hero','yoyo guff','yesto pani','yakkai','yauwan ko hero','yappa',
    'ziddi','zyaap','zyaau','zabardasti hero','zindagi ko don','zhanakk','zyaada janne','zoro ko guff','zhinge','zukkha'
  ];
  let s=null,aiTimer=null,clock=null,scores={A:0,B:0},roundToken=0,busy=false;
  const $=id=>document.getElementById(id),uid=()=>Math.random().toString(36).slice(2)+Date.now();
  const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a};
  function makeWord(text){return {id:uid(),word:text}}
  function makeBook(){return shuffle(WORD_BANK.map(makeWord))}
  function ensureBook(){if(s.book.length)return;const last=s.tableWord?.id;s.book=shuffle(s.used.filter(w=>w.id!==last));s.used=s.used.filter(w=>w.id===last)}
  function drawOne(){ensureBook();return s.book.pop()||makeWord('guffadi')}
  function current(){return ORDER[s.turn]}
  function nextTurn(){s.turn=(s.turn+1)%ORDER.length;render();scheduleAI()}
  function flash(text){$('message').textContent=text}
  function renderWord(word){const e=document.createElement('div');e.className='gwx-current-word';e.dataset.wordId=word.id;const label=document.createElement('span');label.textContent=word.word;e.appendChild(label);const letters=wordLetters(word.word);const hint=document.createElement('small');hint.textContent='ABA · '+letters.last+' BATA';e.appendChild(hint);return e}
  function renderWordHistory(){
    const trail=$('wordHistory');trail.replaceChildren();
    s.history.forEach((entry,index)=>{
      const item=document.createElement('div');item.className='gwx-history-word'+(index===s.history.length-1?' latest':'');
      const who=document.createElement('small');who.textContent=entry.player==='book'?'KITAB':NAME[entry.player].toUpperCase();
      const word=document.createElement('span');word.textContent=entry.word.word;
      item.append(who,word);trail.appendChild(item)
    });
    trail.scrollLeft=trail.scrollWidth
  }
  function renderHands(){
    const local=$('hand-local');local.innerHTML='';
    const legal=playableWords(s.players.champ,wordLetters(s.tableWord.word).last);
    s.players.champ.forEach(word=>{
      const b=document.createElement('button');b.type='button';b.className='word-chip'+(canPlayWord(word,wordLetters(s.tableWord.word).last)?' is-playable':'');b.dataset.id=word.id;
      const initial=document.createElement('b');initial.textContent=wordLetters(word.word).first;b.appendChild(initial);
      const label=document.createElement('span');label.textContent=word.word;b.appendChild(label);
      b.disabled=s.turn!==0||busy||s.dealing||!canPlayWord(word,wordLetters(s.tableWord.word).last);
      b.setAttribute('aria-label',word.word+(b.disabled?'':' — play'));b.onclick=()=>playWord('champ',word.id);local.appendChild(b)
    });
    const poker=$('hand-top');poker.innerHTML='<span class="word-count">'+s.players.poker.length+' SABDA</span>';
    [['kalkal','count-left'],['jess','count-right']].forEach(([pid,id])=>{$(id).textContent=s.players[pid].length;const seat=document.querySelector('.gwx-seat[data-player="'+pid+'"]');let hand=seat.querySelector('.gwx-opponent-hand');if(!hand){hand=document.createElement('div');hand.className='gwx-opponent-hand';seat.appendChild(hand)}hand.textContent=s.players[pid].length+' SABDA'})
    $('drawBtn').disabled=s.turn!==0||busy||s.dealing||legal.length>0;
    $('drawBtn').title=legal.length?'Mildne sabda pahila khela':'Kitab bata euta sabda tana';
  }
  function renderTable(){const target=$('discard');target.innerHTML='';target.appendChild(renderWord(s.tableWord));renderWordHistory();$('drawBadge').textContent=s.book.length;$('turnLabel').textContent=current()==='champ'?'TIMRO PALO':current()==='poker'?'SAATHI KO PALO':NAME[current()].toUpperCase()+' KO PALO';const need=wordLetters(s.tableWord.word).last;$('message').textContent=s.turn===0?need+' bata suru hune sabda khela.':NAME[current()]+' le '+need+' bata sabda khelna parcha.';document.querySelectorAll('.gwx-seat').forEach(el=>el.classList.toggle('active',el.dataset.player===current()));$('teamScoreA').textContent=scores.A;$('teamScoreB').textContent=scores.B;$('roundLabel').textContent=String(s.round).padStart(2,'0')}
  function render(){renderTable();renderHands()}
  function animatePlay(word,source){
    const target=$('discard').getBoundingClientRect(),from=source?.getBoundingClientRect();if(!from)return;
    const fly=document.createElement('div');fly.className='gwx-word-flight';fly.textContent=word.word;document.body.appendChild(fly);
    fly.style.left=from.left+'px';fly.style.top=from.top+'px';
    const dx=target.left+target.width/2-(from.left+from.width/2),dy=target.top+target.height/2-(from.top+from.height/2);
    const animation=fly.animate([{transform:'translate(0,0) scale(.9)',opacity:1},{transform:'translate('+dx+'px,'+dy+'px) scale(1.06)',opacity:0}],{duration:430,easing:'cubic-bezier(.2,.75,.2,1)'});
    animation.finished.catch(()=>{}).then(()=>fly.remove())
  }
  function win(pid){s.phase='over';clearTimeout(aiTimer);scores[TEAM[pid]]++;$('teamScoreA').textContent=scores.A;$('teamScoreB').textContent=scores.B;$('winTitle').textContent='TEAM '+TEAM[pid]+' JITYO';$('winText').textContent=NAME[pid]+' le antim sabda khelyo. Khatam!';$('winModal').classList.add('open')}
  function playWord(pid,id){
    if(!s||s.phase!=='playing'||busy||current()!==pid)return false;
    const hand=s.players[pid],word=hand.find(x=>x.id===id),required=wordLetters(s.tableWord.word).last;
    if(!word||!canPlayWord(word,required))return false;
    const source=pid==='champ'?document.querySelector('.word-chip[data-id="'+id+'"]'):document.querySelector('.gwx-seat[data-player="'+pid+'"] .gwx-player-card');
    animatePlay(word,source);hand.splice(hand.indexOf(word),1);s.used.push(s.tableWord);s.tableWord=word;s.history.push({word,player:pid});
    if(!hand.length){render();win(pid);return true}
    nextTurn();return true
  }
  function drawFor(pid){
    if(!s||s.phase!=='playing'||busy||current()!==pid)return;
    const required=wordLetters(s.tableWord.word).last,word=drawOne(),hand=s.players[pid],resolution=resolveBookDraw(hand,word,required);
    busy=true;hand.splice(0,hand.length,...resolution.hand);render();flash(NAME[pid]+' le “'+word.word+'” tanyo.');
    setTimeout(()=>{
      if(!s||s.phase!=='playing')return;
      if(resolution.play){flash(NAME[pid]+' ko milne sabda: '+word.word+'!');renderHands();setTimeout(()=>{busy=false;playWord(pid,word.id)},420)}
      else{busy=false;flash(NAME[pid]+' le “'+word.word+'” rakhyo, aba arko palo.');nextTurn()}
    },520)
  }
  function scheduleAI(){clearTimeout(aiTimer);if(!s||s.phase!=='playing'||s.turn===0)return;const token=roundToken;aiTimer=setTimeout(()=>{if(token!==roundToken||!s||s.phase!=='playing')return;const pid=current(),required=wordLetters(s.tableWord.word).last,word=chooseAiWord(s.players[pid],required);if(word)playWord(pid,word.id);else drawFor(pid)},850+Math.random()*650)}
  function reset(){
    roundToken++;clearTimeout(aiTimer);clearInterval(clock);busy=false;document.querySelectorAll('.gwx-word-flight').forEach(x=>x.remove());
    const book=makeBook(),players={};ORDER.forEach(pid=>{players[pid]=[]});for(let i=0;i<7;i++)ORDER.forEach(pid=>players[pid].push(book.pop()));
    const starter=book.pop();s={book,used:[],players,tableWord:starter,history:[{word:starter,player:'book'}],turn:0,phase:'playing',round:s?.round?s.round+1:1,seconds:150};
    $('winModal').classList.remove('open');$('timer').textContent='02:30';render();
    clock=setInterval(()=>{if(s?.phase!=='playing')return;s.seconds--;const mins=Math.max(0,Math.floor(s.seconds/60)),secs=Math.max(0,s.seconds%60);$('timer').textContent=String(mins).padStart(2,'0')+':'+String(secs).padStart(2,'0');if(s.seconds<=0){s.phase='over';$('winTitle').textContent='SAMAYA SAKIYO';$('winText').textContent='Yo round feri khelau!';$('winModal').classList.add('open')}},1000)
  }
  $('drawBtn').onclick=()=>{if(s?.turn===0&&!busy&&!s.dealing&&playableWords(s.players.champ,wordLetters(s.tableWord.word).last).length===0)drawFor('champ')};
  $('drawPile').onclick=()=>$('drawBtn').click();
  $('restartBtn').onclick=reset;$('nextBtn').onclick=reset;
  $('chatBtn').onclick=()=>{$('chatPanel').classList.toggle('open')};
  $('chatPanel').onclick=e=>{const msg=e.target.closest('[data-msg]');if(msg){flash(msg.dataset.msg);$('chatPanel').classList.remove('open')}};
  $('soundBtn').onclick=()=>{document.querySelector('.gwx-app').classList.toggle('muted')};
  $('winModal').addEventListener('click',e=>{if(e.target===$('winModal'))$('winModal').classList.remove('open')});
  reset();window.__goWild2v2Finished={state:()=>s,reset,play:id=>playWord('champ',id),draw:()=>drawFor('champ')};
})();

