'use strict';
const crypto=require('node:crypto'),R=require('./rules.cjs'),{fail}=require('./auth.cjs');
const uuid=s=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const member=(room,user)=>room.seats.findIndex(p=>p?.userId===user.id);
const canonical=value=>JSON.stringify(value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(canonical(value[k]))])):value);
function lobby(room){return {board:[],pot:0,street:0,dealer:room.dealer,turn:-1,players:room.seats.map((p,seat)=>p?{seat,name:p.name,stack:p.stack,bet:0,total:0,folded:false,inHand:true,cards:[]}:null),pots:[],privateHoles:{},legalByUser:{},payout:[]}}
function frame(h,event){
 const folded=new Set();for(const e of h.history){if(e.seq>event.seq)break;if(e.type==='action'&&e.action==='fold')folded.add(e.seat)}
 const done=event.type==='end',players=h.players.map((p,seat)=>({seat,name:p.name,stack:event.stacks[seat],bet:event.bets[seat],total:event.totals[seat],folded:!p.inHand||folded.has(seat),inHand:p.inHand,cards:done&&h.reveal&&!folded.has(seat)&&p.inHand?R.clone(p.cards):[]}));
 let prev=0;const pots=done?h.settledPots.map(p=>({amount:p.amount,eligible:p.eligible,winners:p.winners,awards:p.awards})):[...new Set(players.map(p=>p.total).filter(Boolean))].sort((a,b)=>a-b).map(cap=>{const contributed=players.filter(p=>p.total>=cap),pot={amount:(cap-prev)*contributed.length,uncalled:contributed.length===1,eligible:contributed.filter(p=>p.inHand&&!p.folded).map(p=>p.seat)};prev=cap;return pot});
 return {board:R.clone(event.board),pot:event.pot,street:event.street,dealer:h.dealer,turn:-1,players,pots,privateHoles:Object.fromEntries(h.players.filter(p=>p.inHand).map(p=>[p.id,R.clone(p.cards)])),legalByUser:{},payout:done?R.clone(h.payout):[],action:event.type==='action'?{seat:event.seat,type:event.action,amount:event.amount,to:event.to}:null};
}
function filterView(view,userId){
 const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>value&&Object.hasOwn(value,k)).map(k=>[k,R.clone(value[k])])),legal=view.legalByUser?.[userId]||{active:false};
 return {...pick(view,['board','pot','street','dealer','turn','status','deadline','payout']),players:view.players.map(p=>p&&({...pick(p,['seat','name','stack','bet','total','folded','inHand']),cards:R.clone(view.privateHoles?.[userId]&&view.owners?.[p.seat]===userId?view.privateHoles[userId]:p.cards)})),pots:(view.pots||[]).map(p=>pick(p,['amount','uncalled','eligible','winners','awards'])),action:view.action?pick(view.action,['seat','type','amount','to']):null,legal:pick(legal,['active','fold','check','call','callAmount','toCall','bet','raise','raiseAllowed','minRaiseTo','maxRaiseTo','shortAllInOnly','allIn','currentBet','lastFullRaise'])};
}
function snapshot(room,user){return {type:'snapshot',roomId:room.id,code:room.code,maxPlayers:room.maxPlayers||room.seats.length,handId:room.hand?.id||null,seq:room.seq,selfSeat:member(room,user),...filterView({...room.visible,status:room.status,deadline:room.deadline},user.id)}}
class Rooms {
 constructor(store,{now=Date.now,turnMs=30000,reserveMs=120000,streetMs=900,resultMs=500}={}){this.store=store;this.now=now;this.turnMs=turnMs;this.reserveMs=reserveMs;this.streetMs=streetMs;this.resultMs=resultMs}
 async create(user,actionId,{maxPlayers=3}={}){if(!uuid(actionId))fail('INVALID_ACTION_ID');if(![2,3].includes(maxPlayers))fail('INVALID_ROOM_SIZE');const id=crypto.randomUUID(),alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',code=Array.from(crypto.randomBytes(8),n=>alphabet[n%32]).join(''),room={id,code,maxPlayers,seq:0,seats:Array(maxPlayers).fill(null),dealer:-1,previousBlinds:null,status:'LOBBY',hand:null,queue:[],nextAt:null,deadline:null,settledHand:null};room.visible={...lobby(room),status:room.status,deadline:null};const inserted=await this.store.pool.query('INSERT INTO rooms(id,creator_id,creation_action_id,code,state) VALUES($1,$2,$3,$4,$5) ON CONFLICT(creator_id,creation_action_id) DO NOTHING RETURNING id',[id,user.id,actionId,code,JSON.stringify(room)]);if(!inserted.rows.length){const old=(await this.store.pool.query('SELECT id,code,state FROM rooms WHERE creator_id=$1 AND creation_action_id=$2',[user.id,actionId])).rows[0];if((old.state.maxPlayers||old.state.seats.length)!==maxPlayers)fail('ACTION_ID_CONFLICT',409);return {roomId:old.id,code:old.code,maxPlayers}}return {roomId:id,code,maxPlayers}}
 async invite(code){if(typeof code!=='string'||!/^[A-Z0-9]{8}$/.test(code))fail('INVALID_ROOM_CODE');const row=(await this.store.pool.query('SELECT id,code,seq,state FROM rooms WHERE code=$1',[code])).rows[0];if(!row)fail('ROOM_NOT_FOUND',404);return {roomId:row.id,code:row.code,seq:Number(row.seq),handId:row.state.hand?.id||null,status:row.state.status,players:row.state.seats.filter(Boolean).length,maxPlayers:row.state.maxPlayers||row.state.seats.length}}
 _emit(room,events,kind){const view=R.clone({...room.visible,status:room.status,deadline:room.deadline});events.push({seq:++room.seq,handId:room.hand?.id||null,kind,view})}
 async _settle(c,room){
  const h=R.restore(room.hand);if(!h.done)throw Error('Premature settlement');if(room.settledHand===h.id)return;
  for(const p of h.players){const seat=room.seats[p.seat];if(!seat)continue;seat.stack=p.stack;if(!p.inHand)continue;await c.query('INSERT INTO hand_results(hand_id,user_id,seat,start_stack,end_stack,payout,net) VALUES($1,$2,$3,$4,$5,$6,$7)',[h.id,p.id,p.seat,p.startStack,p.stack,h.payout[p.seat],p.stack-p.startStack]);await this.store.ledger(c,{key:`settle:${h.id}:${p.id}`,userId:p.id,roomId:room.id,handId:h.id,account:'seat',reason:'hand-settlement',delta:p.stack-p.startStack,balance:p.stack})}
  room.settledHand=h.id;room.previousBlinds={sb:h.sb,bb:h.bb};room.dealer=h.dealer;
 }
 async _deliver(c,room,events){
  const item=room.queue.shift();room.visible=item.view;room.visible.owners=room.hand.players.map(p=>p.id);room.deadline=null;room.nextAt=null;
  if(room.queue.length){room.status='PRESENTING';room.visible.turn=-1;room.visible.legalByUser={};room.nextAt=this.now()+(room.queue[0].kind==='board'?this.streetMs:this.resultMs)}
  else if(room.hand.done){await this._settle(c,room);room.status='COMPLETE';room.visible.turn=-1;room.visible.legalByUser={}}
  else{const h=R.restore(room.hand);room.status='PLAYING';room.visible.turn=h.turn;room.visible.legalByUser={[h.players[h.turn].id]:h.legalActions()};room.deadline=this.now()+this.turnMs}
  room.visible.status=room.status;room.visible.deadline=room.deadline;this._emit(room,events,item.kind);
 }
 async _enqueue(c,room,events,h,newEvents){
  room.hand=R.serialize(h);room.queue=newEvents.filter(e=>e.type!=='award').map(e=>({kind:e.type,view:frame(h,e)}));
  while(room.queue.length){if(['board','end'].includes(room.queue[0].kind)){room.status='PRESENTING';room.deadline=null;room.nextAt=this.now()+(room.queue[0].kind==='board'?this.streetMs:this.resultMs);room.visible.turn=-1;room.visible.legalByUser={};break}await this._deliver(c,room,events)}
  // Immediate frames were captured with PRESENTING already set by _deliver.
 }
 async _cashout(c,room,seat,key){const p=room.seats[seat];const row=await c.query('UPDATE wallets SET balance=balance+$2 WHERE user_id=$1 RETURNING balance',[p.userId,p.stack]),balance=Number(row.rows[0].balance);await this.store.ledger(c,{key:key+':seat',userId:p.userId,roomId:room.id,account:'seat',reason:'cashout',delta:-p.stack,balance:0});await this.store.ledger(c,{key:key+':wallet',userId:p.userId,roomId:room.id,account:'wallet',reason:'cashout',delta:p.stack,balance});room.seats[seat]=null}
 _lobby(room){room.hand=null;room.queue=[];room.status='LOBBY';room.deadline=null;room.nextAt=null;room.visible={...lobby(room),status:'LOBBY',deadline:null}}
 async command(id,user,msg){
  if(!uuid(id)||!msg||!uuid(msg.actionId)||!Number.isSafeInteger(msg.expectedSeq)||msg.expectedSeq<0||!(msg.handId===null||uuid(msg.handId)))fail('INVALID_ENVELOPE');
  const allowed={join:['buyIn'],start:[],action:['action'],leave:[]};if(!allowed[msg.type]||Object.keys(msg).some(k=>!['type','handId','actionId','expectedSeq',...allowed[msg.type]].includes(k)))fail('INVALID_INTENT');
  const fingerprint=crypto.createHash('sha256').update(canonical(msg)).digest('hex');
  return this.store.room(id,async(c,room)=>{
   const existing=await c.query('SELECT fingerprint,reply FROM action_receipts WHERE room_id=$1 AND user_id=$2 AND action_id=$3',[id,user.id,msg.actionId]);
   if(existing.rows[0]){if(existing.rows[0].fingerprint!==fingerprint)fail('ACTION_ID_CONFLICT',409);return {reply:existing.rows[0].reply,events:[]}}
   if(msg.expectedSeq!==room.seq)fail('STALE_SEQ',409);if(msg.handId!==(room.hand?.id||null))fail('STALE_HAND',409);
   const events=[],seat=member(room,user);
   if(msg.type==='join'){
    if(!['LOBBY','COMPLETE'].includes(room.status))fail('HAND_IN_PROGRESS',409);if(seat>=0)fail('ALREADY_SEATED',409);if(!Number.isInteger(msg.buyIn)||msg.buyIn<100||msg.buyIn>1000)fail('INVALID_BUYIN');const free=room.seats.indexOf(null);if(free<0)fail('ROOM_FULL',409);
    const wallet=await c.query('UPDATE wallets SET balance=balance-$2 WHERE user_id=$1 AND balance>=$2 RETURNING balance',[user.id,msg.buyIn]);if(!wallet.rows.length)fail('INSUFFICIENT_CHIPS',409);room.seats[free]={userId:user.id,name:user.username,stack:msg.buyIn,reservedUntil:this.now()+this.reserveMs};this._lobby(room);
    await this.store.ledger(c,{key:`buyin:${id}:${user.id}:${msg.actionId}:wallet`,userId:user.id,account:'wallet',reason:'buyin',delta:-msg.buyIn,balance:Number(wallet.rows[0].balance)});await this.store.ledger(c,{key:`buyin:${id}:${user.id}:${msg.actionId}:seat`,userId:user.id,roomId:id,account:'seat',reason:'buyin',delta:msg.buyIn,balance:msg.buyIn});this._emit(room,events,'join');
   }else{
    if(seat<0)fail('NOT_SEATED',403);
    if(msg.type==='start'){
     if(!['LOBBY','COMPLETE'].includes(room.status))fail('HAND_IN_PROGRESS',409);const funded=room.seats.filter(p=>p&&p.stack>0);if(funded.length<2||funded.some(p=>p.reservedUntil))fail('NEED_TWO_CONNECTED_PLAYERS',409);
     const h=R.createHand({players:room.seats.map((p,i)=>p?{id:p.userId,name:p.name,stack:p.stack}:{id:'empty-'+i,stack:0,seated:false}),id:crypto.randomUUID(),dealer:room.dealer,previousBlinds:room.previousBlinds});await this._enqueue(c,room,events,h,h.history);
    }else if(msg.type==='action'){
     if(room.status!=='PLAYING')fail('NOT_ACCEPTING_ACTIONS',409);if(this.now()>=room.deadline)fail('ACTION_EXPIRED',409);if(!msg.action||Object.keys(msg.action).some(k=>!['type','to'].includes(k)))fail('INVALID_ACTION');const h=R.restore(room.hand),before=h.history.length;try{h.act(seat,msg.action)}catch{fail('ILLEGAL_ACTION',409)}await this._enqueue(c,room,events,h,h.history.slice(before));
    }else if(msg.type==='leave'){
     if(!['LOBBY','COMPLETE'].includes(room.status))fail('LEAVE_AFTER_HAND',409);await this._cashout(c,room,seat,`leave:${id}:${user.id}:${msg.actionId}`);this._lobby(room);this._emit(room,events,'leave');
    }
   }
   await this.store.save(c,room,events);const reply={type:'ack',actionId:msg.actionId,handId:room.hand?.id||null,acceptedSeq:room.seq};await c.query('INSERT INTO action_receipts(room_id,user_id,action_id,fingerprint,reply) VALUES($1,$2,$3,$4,$5)',[id,user.id,msg.actionId,fingerprint,JSON.stringify(reply)]);return {reply,events};
  });
 }
 async read(id,user,after=null){if(!uuid(id))fail('ROOM_NOT_FOUND',404);return this.store.room(id,async(c,room)=>{if(member(room,user)<0)fail('NOT_SEATED',403);if(after!==null&&(!Number.isSafeInteger(after)||after<0||after>room.seq))fail('INVALID_SEQ');if(after!==null&&after>=room.seq-256){const rows=await c.query('SELECT seq,hand_id,kind,private_view FROM room_events WHERE room_id=$1 AND seq>$2 ORDER BY seq',[id,after]);return {type:'events',roomId:id,seq:room.seq,events:rows.rows.map(e=>({seq:Number(e.seq),handId:e.hand_id,kind:e.kind,view:filterView(e.private_view,user.id)}))}}return snapshot(room,user)})}
 async presence(id,user,connected){return this.store.room(id,async(c,room)=>{const seat=member(room,user);if(seat<0)fail('NOT_SEATED',403);const p=room.seats[seat];if(connected&&!p.reservedUntil||!connected&&p.reservedUntil)return [];p.reservedUntil=connected?null:this.now()+this.reserveMs;const events=[];this._emit(room,events,connected?'reconnected':'disconnected');await this.store.save(c,room,events);return events})}
 async tick(){const rows=await this.store.pool.query('SELECT id FROM rooms');const changed=[];for(const {id}of rows.rows){const events=await this.store.room(id,async(c,room)=>{const events=[];
   if(room.status==='PRESENTING'&&room.nextAt<=this.now())await this._deliver(c,room,events);
   else if(room.status==='PLAYING'&&room.deadline<=this.now()){const h=R.restore(room.hand),before=h.history.length,l=h.legalActions();h.act(h.turn,{type:l.check?'check':'fold'});await this._enqueue(c,room,events,h,h.history.slice(before))}
   if(['LOBBY','COMPLETE'].includes(room.status)){for(let seat=0;seat<room.seats.length;seat++){const p=room.seats[seat];if(p?.reservedUntil&&p.reservedUntil<=this.now()){await this._cashout(c,room,seat,`expired:${id}:${p.userId}:${p.reservedUntil}`);this._lobby(room);this._emit(room,events,'seat-expired')}}}
   if(events.length)await this.store.save(c,room,events);return events});if(events.length)changed.push({roomId:id,events})}return changed}
 async recoverPresence(){const rows=await this.store.pool.query('SELECT id FROM rooms');for(const {id}of rows.rows)await this.store.room(id,async(c,room)=>{for(const p of room.seats)if(p&&!p.reservedUntil)p.reservedUntil=this.now()+this.reserveMs;await this.store.save(c,room,[])})}
}
module.exports={Rooms,filterView,snapshot,uuid};
