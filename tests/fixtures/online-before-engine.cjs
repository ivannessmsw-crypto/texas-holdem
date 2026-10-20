/* Pure offline NLHE rules. No DOM, storage, timers or strategy dependencies. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PokerRules=api})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const SUITS=['♠','♥','♦','♣'];
const STREETS=['PREFLOP','FLOP','TURN','RIVER'];
const clone=x=>JSON.parse(JSON.stringify(x));
function freeze(x){if(x&&typeof x==='object'){Object.freeze(x);Object.values(x).forEach(freeze)}return x}
function rng(seed){let a=seed>>>0;return ()=>{a+=0x6D2B79F5;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296}}
function deck(random){const d=[];for(const s of SUITS)for(let r=2;r<=14;r++)d.push({r,s});for(let i=51;i>0;i--){const j=Math.floor(random()*(i+1));[d[i],d[j]]=[d[j],d[i]]}return d}
function compare(a,b){for(let i=0;i<Math.max(a.length,b.length);i++){const v=(a[i]||0)-(b[i]||0);if(v)return Math.sign(v)}return 0}
function score5(cards){
 if(cards.length!==5)throw Error('Exactly five cards required');
 const rs=cards.map(c=>c.r).sort((a,b)=>b-a),counts={};rs.forEach(r=>counts[r]=(counts[r]||0)+1);
 const unique=[...new Set(rs)];if(unique.includes(14))unique.push(1);
 let straight=0;for(let i=0;i+4<unique.length;i++)if(unique[i]-unique[i+4]===4){straight=unique[i];break}
 const flush=cards.every(c=>c.s===cards[0].s),groups=Object.keys(counts).map(Number).sort((a,b)=>counts[b]-counts[a]||b-a);
 if(flush&&straight)return [8,straight];if(counts[groups[0]]===4)return [7,...groups];
 if(counts[groups[0]]===3&&counts[groups[1]]===2)return [6,...groups];if(flush)return [5,...rs];if(straight)return [4,straight];
 if(counts[groups[0]]===3)return [3,groups[0],...groups.slice(1).sort((a,b)=>b-a)];
 if(counts[groups[0]]===2&&counts[groups[1]]===2)return [2,Math.max(groups[0],groups[1]),Math.min(groups[0],groups[1]),groups[2]];
 if(counts[groups[0]]===2)return [1,groups[0],...groups.slice(1).sort((a,b)=>b-a)];return [0,...rs];
}
function best(cards){
 if(cards.length<5||cards.length>7)throw Error('Five to seven cards required');
 const count=Array(15).fill(0),suits={};for(const c of cards){count[c.r]++;(suits[c.s]||=[]).push(c.r)}
 const ranks=[];for(let r=14;r>=2;r--)if(count[r])ranks.push(r);
 const straight=rs=>{const u=[...new Set(rs)].sort((a,b)=>b-a);if(u.includes(14))u.push(1);for(let i=0;i+4<u.length;i++)if(u[i]-u[i+4]===4)return u[i];return 0};
 const flush=Object.values(suits).find(rs=>rs.length>=5);if(flush){const sf=straight(flush);if(sf)return [8,sf]}
 const quads=ranks.find(r=>count[r]===4);if(quads)return [7,quads,ranks.find(r=>r!==quads)];
 const trips=ranks.filter(r=>count[r]>=3),pairs=ranks.filter(r=>count[r]>=2);
 if(trips.length&&pairs.some(r=>r!==trips[0]))return [6,trips[0],pairs.find(r=>r!==trips[0])];
 if(flush)return [5,...flush.sort((a,b)=>b-a).slice(0,5)];const st=straight(ranks);if(st)return [4,st];
 if(trips.length)return [3,trips[0],...ranks.filter(r=>r!==trips[0]).slice(0,2)];
 if(pairs.length>=2)return [2,pairs[0],pairs[1],ranks.find(r=>r!==pairs[0]&&r!==pairs[1])];
 if(pairs.length)return [1,pairs[0],...ranks.filter(r=>r!==pairs[0]).slice(0,3)];return [0,...ranks.slice(0,5)];
}
function cardKey(c){return c.r+c.s}
function validChip(n){return Number.isSafeInteger(n)&&n>=0}
function validateObservedAction(l,action){
  if(!l.active)throw Error('Not this player’s turn');if(!action||typeof action!=='object')throw Error('Action required');
  const type=action.type;
  if(type==='fold')return {type};
  if(type==='check'){if(!l.check)throw Error('Cannot check facing a wager');return {type}}
  if(type==='call'){if(!l.call)throw Error('Nothing to call');return {type}}
  if(type==='allin'){if(!l.allIn)throw Error('All-in would be an illegal raise');return {type,to:l.maxRaiseTo}}
  if(type==='bet'||type==='raise'){
   if(!(type==='bet'?l.bet:l.raise))throw Error('Bet / raise rights closed');const to=action.to;
   if(!validChip(to)||to<=l.currentBet||to>l.maxRaiseTo||(to<l.minRaiseTo&&to!==l.maxRaiseTo))throw Error('Outside legal raise range');return {type,to};
  }
  throw Error('Unknown action');
 }
class Hand {
 constructor({players,dealer=-1,sb=10,bb=20,seed=1,id=1,previousBlinds=null,positions=null}){
  if(!Array.isArray(players)||players.length<2||players.length>9)throw Error('2–9 seats required');
  if(!validChip(sb)||!validChip(bb)||sb<1||bb<sb)throw Error('Invalid blinds');
  this.players=players.map((p,i)=>{if(!validChip(p.stack))throw Error('Invalid stack');return {id:p.id||'seat-'+i,name:p.name||'Seat '+i,style:p.style||'TAG',seat:i,stack:p.stack,startStack:p.stack,seated:p.seated!==false,folded:p.stack===0||p.seated===false,inHand:p.stack>0&&p.seated!==false,cards:[],bet:0,total:0,acted:false,reopenAt:0,checkedAtZero:false,lastAction:'',leaveAfterHand:false}});
  if(this.players.filter(p=>p.inHand).length<2)throw Error('At least two funded players required');
  this.initialTotal=this.players.reduce((n,p)=>n+p.stack,0);if(!Number.isSafeInteger(this.initialTotal))throw Error('Table exceeds safe integer chip range');
  this.id=id;this.seed=seed>>>0;this.random=rng(this.seed);this.deck=deck(this.random);this.burn=[];this.board=[];this.pot=0;this.street=0;this.phase='PREFLOP';this.done=false;this.reveal=false;this.sbAmount=sb;this.bbAmount=bb;this.currentBet=bb;this.lastFullRaise=bb;this.history=[];this.pending=new Set();this.payout=this.players.map(()=>0);this.settledPots=[];
  const count=this.players.filter(p=>p.inHand).length;
  this.dealer=this.next(dealer,p=>p.inHand);this.sb=count===2?this.dealer:this.next(this.dealer,p=>p.inHand);this.bb=this.next(this.sb,p=>p.inHand);
  if(previousBlinds){const old=previousBlinds;if(!Number.isInteger(old.sb)||!Number.isInteger(old.bb)||old.sb<0||old.bb<0||old.sb>=this.players.length||old.bb>=this.players.length)throw Error('Invalid previous blinds');this.bb=this.next(old.bb,p=>p.inHand);this.sb=count===2?this.next(this.bb,p=>p.inHand):old.bb;this.dealer=count===2?this.sb:old.sb}
  if(positions){const valid=i=>Number.isInteger(i)&&i>=0&&i<this.players.length;if(![positions.dealer,positions.sb,positions.bb].every(valid)||!this.players[positions.bb].inHand||count===2&&(positions.dealer!==positions.sb||positions.sb===positions.bb||!this.players[positions.dealer].inHand)||count>2&&new Set(Object.values(positions)).size!==3)throw Error('Invalid blind positions');this.dealer=positions.dealer;this.sb=positions.sb;this.bb=positions.bb}
  this.record('start',{dealer:this.dealer,sb:this.sb,bb:this.bb,seed:this.seed,stacks:this.players.map(p=>p.stack)});
  let seat=this.dealer;for(let round=0;round<2;round++)for(let i=0;i<count;i++){seat=this.next(seat,p=>p.inHand);this.players[seat].cards.push(this.deck.pop())}
  if(this.players[this.sb].inHand)this.postBlind(this.sb,sb,'SB');else this.record('blind',{seat:this.sb,amount:0,label:'SB (dead)'});this.postBlind(this.bb,bb,'BB');
  this.players.forEach((p,i)=>{if(this.canAct(p))this.pending.add(i)});this.turn=this.next(this.bb,p=>this.pending.has(p.seat));this.progress();this.assert();
 }
 next(from,predicate){for(let n=1;n<=this.players.length;n++){const i=((from+n)%this.players.length+this.players.length)%this.players.length;if(predicate(this.players[i]))return i}return -1}
 canAct(p){return p.inHand&&!p.folded&&p.stack>0}
 live(){return this.players.filter(p=>p.inHand&&!p.folded)}
 record(type,data={}){this.history.push({seq:this.history.length,type,street:this.street,...clone(data),pot:this.pot,stacks:this.players.map(p=>p.stack),bets:this.players.map(p=>p.bet),totals:this.players.map(p=>p.total),board:clone(this.board)})}
 pay(seat,n){const p=this.players[seat];if(!validChip(n)||n>p.stack)throw Error('Invalid payment');p.stack-=n;p.bet+=n;p.total+=n;this.pot+=n;return n}
 postBlind(seat,n,label){const amount=this.pay(seat,Math.min(n,this.players[seat].stack));this.players[seat].lastAction=label+' '+amount;this.record('blind',{seat,amount,label})}
 legalActions(seat=this.turn){
  const p=this.players[seat];const active=!this.done&&seat===this.turn&&p&&this.canAct(p)&&this.pending.has(seat);
  if(!active)return {active:false};
  const due=Math.max(0,this.currentBet-p.bet),opponentCanAct=this.live().some(q=>q.seat!==seat&&q.stack>0);
  const right=!p.acted||this.currentBet>=p.reopenAt;
  const min=this.currentBet+this.lastFullRaise;
  const max=p.bet+p.stack,aggressive=opponentCanAct&&right&&max>this.currentBet;
  return {active:true,fold:true,check:due===0,call:due>0,callAmount:Math.min(due,p.stack),toCall:due,bet:this.currentBet===0&&aggressive,raise:this.currentBet>0&&aggressive,raiseAllowed:aggressive,minRaiseTo:min,maxRaiseTo:max,shortAllInOnly:aggressive&&max<min,allIn:p.stack>0&&(max<=this.currentBet||aggressive),currentBet:this.currentBet,lastFullRaise:this.lastFullRaise};
 }
 validate(seat,action){return validateObservedAction(this.legalActions(seat),action)}
 act(seat,action){
  const a=this.validate(seat,action),p=this.players[seat],old=this.currentBet,l=this.legalActions(seat),before=p.stack;let paid=0;
  if(a.type==='fold')p.folded=true;else if(a.type==='call')paid=this.pay(seat,l.callAmount);else if(a.type==='bet'||a.type==='raise'||a.type==='allin')paid=this.pay(seat,a.to-p.bet);
  const increased=p.bet>old,full=increased&&p.bet-old>=this.lastFullRaise;
  if(increased){if(full)this.lastFullRaise=p.bet-old;this.currentBet=p.bet;for(const q of this.players)if(q.seat!==seat&&this.canAct(q)&&q.bet<this.currentBet)this.pending.add(q.seat)}
  p.acted=true;p.checkedAtZero=a.type==='check'&&old===0;p.reopenAt=this.currentBet+this.lastFullRaise;this.pending.delete(seat);
  p.lastAction=a.type+(paid?' '+paid:'');this.record('action',{seat,action:a.type,amount:paid,to:p.bet,stackBefore:before,toCall:l.toCall,potBefore:this.pot-paid,fullRaise:full,raises:increased,raiseOpportunity:l.raiseAllowed});
  this.turn=this.next(seat,q=>this.pending.has(q.seat)&&this.canAct(q));this.progress();this.assert();return this.history;
 }
 refundUncalled(){
  const order=this.players.map((p,i)=>({i,total:p.total})).sort((a,b)=>b.total-a.total);
  const excess=order[0].total-order[1].total;
  if(excess>0){const p=this.players[order[0].i];p.total-=excess;p.bet=Math.max(0,p.bet-excess);p.stack+=excess;this.pot-=excess;this.record('return',{seat:p.seat,amount:excess})}
 }
 progress(){
  for(let guard=0;guard<30&&!this.done;guard++){
   if(this.live().length===1){this.settle(false);return}
   for(const i of this.pending)if(!this.canAct(this.players[i]))this.pending.delete(i);
   const actors=this.players.filter(p=>this.canAct(p));
   if(actors.length===1){const p=actors[0],maxOther=Math.max(0,...this.live().filter(q=>q!==p).map(q=>q.bet));if(p.bet>=maxOther)this.pending.clear();else this.currentBet=maxOther}
   if(this.pending.size){if(!this.pending.has(this.turn))this.turn=this.next(this.turn,p=>this.pending.has(p.seat));if(this.players[this.turn].leaveAfterHand){this.act(this.turn,{type:'fold'});return}return}
   this.refundUncalled();if(this.street===3){this.settle(true);return}
   this.street++;this.phase=STREETS[this.street];this.currentBet=0;this.lastFullRaise=this.bbAmount;
   this.players.forEach(p=>{p.bet=0;p.acted=false;p.reopenAt=0;p.checkedAtZero=false;p.lastAction=''});
   this.burn.push(this.deck.pop());const count=this.street===1?3:1;for(let i=0;i<count;i++)this.board.push(this.deck.pop());this.record('board');
   this.players.forEach(p=>{if(this.canAct(p))this.pending.add(p.seat)});this.turn=this.next(this.dealer,p=>this.pending.has(p.seat));
  }
  if(!this.done)throw Error('State progression did not terminate');
 }
 pots(){let prev=0;return [...new Set(this.players.map(p=>p.total).filter(n=>n>0))].sort((a,b)=>a-b).map(cap=>{const contributors=this.players.filter(p=>p.total>=cap);const pot={cap,amount:(cap-prev)*contributors.length,contributors:contributors.map(p=>p.seat),eligible:contributors.filter(p=>!p.folded&&p.inHand).map(p=>p.seat),uncalled:contributors.length===1};prev=cap;return pot})}
 settle(showdown){
  this.refundUncalled();this.phase=showdown?'SHOWDOWN':'AWARD';this.reveal=showdown;const scores=this.players.map(p=>p.inHand&&!p.folded&&showdown?best([...p.cards,...this.board]):null);
  const pots=showdown?this.pots():[{amount:this.pot,eligible:this.live().map(p=>p.seat),contributors:this.players.filter(p=>p.total>0).map(p=>p.seat)}];
  for(const pot of pots){if(!pot.eligible.length)throw Error('Pot has no eligible winner');let top=pot.eligible[0];if(showdown)for(const i of pot.eligible)if(compare(scores[i],scores[top])>0)top=i;
   const winners=pot.eligible.filter(i=>!showdown||compare(scores[i],scores[top])===0).sort((a,b)=>((a-this.dealer-1+this.players.length)%this.players.length)-((b-this.dealer-1+this.players.length)%this.players.length));
   const share=Math.floor(pot.amount/winners.length),remainder=pot.amount%winners.length,awards={};winners.forEach((seat,i)=>{const amount=share+(i<remainder?1:0);this.players[seat].stack+=amount;this.payout[seat]+=amount;awards[seat]=amount});this.pot-=pot.amount;
   this.settledPots.push({...pot,winners,awards});this.record('award',{...pot,winners,awards});
  }
  this.scores=scores;this.done=true;this.phase='COMPLETE';this.turn=-1;this.pending.clear();this.players.forEach(p=>{if(p.leaveAfterHand)p.seated=false});this.record('end',{showdown,payout:this.payout});
 }
 requestLeave(seat){const p=this.players[seat];if(!p)throw Error('Invalid seat');p.leaveAfterHand=true;if(this.done)p.seated=false;else this.progress();this.assert()}
 position(seat){
  if(!this.players[seat]?.inHand)return 'OUT';const count=this.players.filter(p=>p.inHand).length;if(seat===this.dealer)return count===2?'BTN / SB':'BTN';if(seat===this.sb)return 'SB';if(seat===this.bb)return 'BB';
  const first=this.next(this.bb,p=>p.inHand),order=[];let i=first;do{if(i!==this.dealer&&i!==this.sb&&i!==this.bb)order.push(i);i=this.next(i,p=>p.inHand)}while(i!==first&&i>=0);
  const index=order.indexOf(seat);return index===order.length-1?'CO':index===order.length-2?'HJ':index===0?'UTG':'UTG+'+index;
 }

 observation(seat,opponents={}){
  if(!this.players[seat])throw Error('Invalid seat');const own=this.players[seat];const publicPlayers=this.players.map(p=>({seat:p.seat,id:p.id,name:p.name,style:p.style,stack:p.stack,bet:p.bet,total:p.total,folded:p.folded,inHand:p.inHand,position:this.position(p.seat),lastAction:p.lastAction}));
  return freeze(clone({handId:this.id,street:this.street,phase:this.phase,hero:seat,hole:own.cards,board:this.board,pot:this.pot,bb:this.bbAmount,sb:this.sbAmount,dealer:this.dealer,players:publicPlayers,legal:this.legalActions(seat),history:this.history.filter(e=>e.type==='action'||e.type==='board'||e.type==='blind').map(e=>({type:e.type,street:e.street,seat:e.seat,action:e.action,amount:e.amount,to:e.to,raises:e.raises,pot:e.pot,board:e.board})),opponents}));
 }
 historyFor(viewer=0){const revealed={};this.players.forEach(p=>{if(p.seat===viewer||(this.reveal&&!p.folded&&p.inHand))revealed[p.seat]=clone(p.cards)});return clone({version:1,id:this.id,seed:this.seed,dealer:this.dealer,positions:{dealer:this.dealer,sb:this.sb,bb:this.bb},sb:this.sbAmount,bb:this.bbAmount,players:this.players.map(p=>({seat:p.seat,id:p.id,name:p.name,style:p.style,startStack:p.startStack,endStack:p.stack,inHand:p.inHand,folded:p.folded,cards:revealed[p.seat]||[]})),events:this.history,pots:this.settledPots,payout:this.payout,showdown:this.reveal})}
 assert(){
  if(!validChip(this.pot)||this.players.some(p=>!validChip(p.stack)||!validChip(p.bet)||!validChip(p.total)))throw Error('Invalid chip state');
  if(this.players.reduce((n,p)=>n+p.stack,0)+this.pot!==this.initialTotal)throw Error('Chip conservation violated');
  if(!this.done&&this.players.reduce((n,p)=>n+p.total,0)!==this.pot)throw Error('Contribution / pot mismatch');
  const cards=[...this.deck,...this.board,...this.burn,...this.players.flatMap(p=>p.cards)];if(cards.length!==52||new Set(cards.map(cardKey)).size!==52)throw Error('Duplicate / missing cards');
  if(!this.done&&!this.legalActions().active)throw Error('No legal actor');return true;
 }
}
return {Hand,rng,deck,score5,best,compare,cardKey,clone,freeze,STREETS,validateObservedAction};
});
