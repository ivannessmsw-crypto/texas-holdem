'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
class Store {
 constructor(pool){this.pool=pool;this.inFlight=0}
 async transaction(fn){this.inFlight++;let c;try{c=await this.pool.connect();await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result}catch(e){if(c)await c.query('ROLLBACK');throw e}finally{c?.release();this.inFlight--}}
 async migrate(){return this.transaction(async c=>{
  await c.query('SELECT pg_advisory_xact_lock(68204719)');
  await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
  for(const name of fs.readdirSync(path.join(__dirname,'migrations')).filter(n=>n.endsWith('.sql')).sort()){
   const sql=fs.readFileSync(path.join(__dirname,'migrations',name),'utf8'),checksum=crypto.createHash('sha256').update(sql).digest('hex'),old=await c.query('SELECT checksum FROM schema_migrations WHERE name=$1',[name]);
   if(old.rows.length){if(old.rows[0].checksum!==checksum)throw Error('Migration checksum changed: '+name);continue}
   await c.query(sql);await c.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)',[name,checksum]);
  }
 })}
 async room(id,fn){return this.transaction(async c=>{const row=await c.query('SELECT state FROM rooms WHERE id=$1 FOR UPDATE',[id]);if(!row.rows.length)throw Object.assign(Error('ROOM_NOT_FOUND'),{status:404});return fn(c,row.rows[0].state)})}
 async save(c,room,events){
  await c.query('UPDATE rooms SET seq=$2,state=$3 WHERE id=$1',[room.id,room.seq,JSON.stringify(room)]);
  await c.query('DELETE FROM room_seats WHERE room_id=$1',[room.id]);
  for(let seat=0;seat<room.seats.length;seat++){const p=room.seats[seat];if(p)await c.query('INSERT INTO room_seats(room_id,seat,user_id,stack,reserved_until) VALUES($1,$2,$3,$4,$5)',[room.id,seat,p.userId,p.stack,p.reservedUntil?new Date(p.reservedUntil):null])}
  if(room.hand)await c.query('INSERT INTO hands(id,room_id,initial_total,private_state,completed) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET private_state=EXCLUDED.private_state,completed=EXCLUDED.completed',[room.hand.id,room.id,room.hand.initialTotal,JSON.stringify(room.hand),room.status==='COMPLETE']);
  for(const e of events)await c.query('INSERT INTO room_events(room_id,seq,hand_id,kind,private_view) VALUES($1,$2,$3,$4,$5)',[room.id,e.seq,e.handId,e.kind,JSON.stringify(e.view)]);
 }
 async ledger(c,{key,userId,roomId=null,handId=null,account,reason,delta,balance}){await c.query('INSERT INTO chip_ledger(entry_id,user_id,room_id,hand_id,account,reason,delta,balance_after) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[key,userId,roomId,handId,account,reason,delta,balance])}
 async close(){await this.pool.end()}
}
module.exports={Store};
