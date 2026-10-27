'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),{WebSocketServer}=require('ws'),{Auth,fail}=require('./auth.cjs'),{filterView,uuid}=require('./rooms.cjs');
function createServer({store,rooms,origin,secure=true,logger=console,auth:providedAuth=null,publicConfig=null}){
 const parsed=new URL(origin);if(parsed.origin!==origin||!['https:','http:'].includes(parsed.protocol)||secure&&parsed.protocol!=='https:'||!secure&&!['127.0.0.1','localhost','[::1]'].includes(parsed.hostname))throw Error('HTTPS public origin required; insecure mode only permits localhost');
 if(!providedAuth&&secure)throw Error('Production requires verified Supabase Auth');const auth=providedAuth||new Auth(store,{secure,now:rooms.now}),peers=new Set(),rates=new Map();
 let stopping=false,jobs=0,closePromise;const track=async fn=>{jobs++;try{return await fn()}finally{jobs--}};const connectSources="'self' "+origin.replace(/^http/,'ws')+' '+(publicConfig?.supabaseUrl||'');
 function rate(key,limit=30){const now=Date.now(),old=rates.get(key);if(!old||now-old.at>60000){rates.set(key,{at:now,n:1});return}if(++old.n>limit)fail('RATE_LIMITED',429);if(rates.size>10000)for(const [k,v]of rates)if(now-v.at>60000)rates.delete(k)}
 function sameOrigin(req){if(req.headers.origin!==origin)fail('ORIGIN_REJECTED',403)}
 const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data))};
 async function body(req){if(!(req.headers['content-type']||'').startsWith('application/json'))fail('JSON_REQUIRED',415);let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>16384)fail('PAYLOAD_TOO_LARGE',413)}try{return JSON.parse(text)}catch{fail('INVALID_JSON')}}
 function broadcast(id,events){for(const peer of peers)if(peer.roomId===id&&peer.ws.readyState===1){if(peer.user.sessionExpiresAt<=rooms.now()){peer.ws.close(1008,'Session expired');continue}for(const event of events)peer.ws.send(JSON.stringify({type:'event',roomId:id,seq:event.seq,handId:event.handId,kind:event.kind,view:filterView(event.view,peer.user.id)}))}}
 const server=http.createServer(async(req,res)=>{
  jobs++;
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src "+connectSources+"; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");if(secure)res.setHeader('Strict-Transport-Security','max-age=31536000');
  try{
   if(stopping)fail('SERVER_RESTARTING',503);const url=new URL(req.url,origin),route=url.pathname;
   if(req.method==='POST'){sameOrigin(req);rate(req.socket.remoteAddress+':post',120)}
   if(route==='/healthz'&&req.method==='GET'){await store.pool.query('SELECT 1');return send(res,200,{ok:true})}
   if(route==='/api/config'&&req.method==='GET')return send(res,200,publicConfig||{authMode:'local-test'});
   if(route==='/api/auth/supabase'&&req.method==='POST'){rate(req.socket.remoteAddress+':exchange',30);if(typeof auth.exchange!=='function')fail('SUPABASE_NOT_CONFIGURED',503);const result=await auth.exchange(await body(req));await auth.logout(req.headers.cookie);res.setHeader('Set-Cookie',auth.cookie(result.token,false,result.maxAge));return send(res,200,result.user)}
   if(req.method==='POST'&&['/api/register','/api/login'].includes(route)){
    rate(req.socket.remoteAddress+route,route.endsWith('register')?8:20);const data=await body(req);if(route.endsWith('register'))return send(res,201,await auth.register(data));await auth.logout(req.headers.cookie);const result=await auth.login(data);res.setHeader('Set-Cookie',auth.cookie(result.token));return send(res,200,result.user);
   }
   if(route.startsWith('/api/')){
    const user=await auth.user(req.headers.cookie);
    if(route==='/api/logout'&&req.method==='POST'){await auth.logout(req.headers.cookie);res.setHeader('Set-Cookie',auth.cookie('',true));for(const peer of peers)if(auth.token(peer.cookie)===auth.token(req.headers.cookie))peer.ws.close(1008,'Logged out');return send(res,200,{ok:true})}
    if(route==='/api/me'&&req.method==='GET'){const data=await store.pool.query('SELECT w.balance,s.preferences,r.room_id FROM wallets w JOIN user_settings s ON s.user_id=w.user_id LEFT JOIN room_seats r ON r.user_id=w.user_id WHERE w.user_id=$1',[user.id]);return send(res,200,{...user,balance:Number(data.rows[0].balance),preferences:data.rows[0].preferences,roomId:data.rows[0].room_id})}
    if(route==='/api/settings'&&req.method==='POST'){const p=await body(req);if(Object.keys(p).some(k=>!['animation','sound'].includes(k))||!['normal','fast','instant'].includes(p.animation)||typeof p.sound!=='boolean')fail('INVALID_SETTINGS');await store.pool.query('UPDATE user_settings SET preferences=$2 WHERE user_id=$1',[user.id,JSON.stringify(p)]);return send(res,200,p)}
    if(route==='/api/results'&&req.method==='GET'){const result=await store.pool.query('SELECT hand_id,seat,start_stack,end_stack,payout,net FROM hand_results WHERE user_id=$1 ORDER BY hand_id DESC LIMIT 100',[user.id]);return send(res,200,{results:result.rows})}
    if(route==='/api/rooms'&&req.method==='POST'){const data=await body(req);if(!data||Object.keys(data).some(k=>!['actionId','maxPlayers'].includes(k)))fail('INVALID_INTENT');return send(res,201,await rooms.create(user,data.actionId,{maxPlayers:data.maxPlayers??3}))}
    if(route==='/api/rooms'&&req.method==='GET'){const data=await store.pool.query('SELECT id,code,seq,state FROM rooms WHERE creator_id=$1 OR id IN (SELECT room_id FROM room_seats WHERE user_id=$1) ORDER BY id LIMIT 100',[user.id]);return send(res,200,{rooms:data.rows.map(({id,code,seq,state})=>({id,code,seq:Number(seq),handId:state.hand?.id||null,status:state.status,players:state.seats.filter(Boolean).length,maxPlayers:state.maxPlayers||state.seats.length}))})}
    const invite=route.match(/^\/api\/invites\/([A-Z0-9]{8})$/);if(invite&&req.method==='GET'){rate(user.id+':invite',30);return send(res,200,await rooms.invite(invite[1]))}
    const match=route.match(/^\/api\/rooms\/([a-f0-9-]+)(\/commands)?$/i);
    if(match){if(req.method==='GET'&&!match[2])return send(res,200,await rooms.read(match[1],user));if(req.method==='POST'&&match[2]){const result=await rooms.command(match[1],user,await body(req));broadcast(match[1],result.events);return send(res,200,result.reply)}}
    fail('NOT_FOUND',404);
   }
   if(req.method!=='GET')fail('NOT_FOUND',404);
   const files={'/':'index.html','/online':'server/public/index.html','/online/':'server/public/index.html','/online.js':'server/public/online.js','/state.js':'server/public/state.js','/online.css':'server/public/online.css','/offline':'index.html','/assets/vendor/supabase.js':'assets/vendor/supabase.js','/assets/auth-feedback.js':'assets/auth-feedback.js','/assets/online-config.js':'assets/online-config.js','/assets/online-launch.js':'assets/online-launch.js'};let file=files[route];
   if(/^\/assets\/[a-z0-9-]+\.webp$/.test(route))file=route.slice(1);
   if(!file)fail('NOT_FOUND',404);if(file==='index.html')res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src "+connectSources+"; frame-ancestors 'none'; base-uri 'none'");
   const absolute=path.join(__dirname,'..',file);if(!fs.existsSync(absolute))fail('NOT_FOUND',404);const mime=file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'image/webp';res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store'});fs.createReadStream(absolute).pipe(res);
  }catch(e){if(!res.headersSent){const code=e.code==='23505'?'SEAT_OR_REQUEST_CONFLICT':e.status?e.message:'INTERNAL_ERROR';send(res,e.code==='23505'?409:e.status||500,{error:code})}if(!e.status&&e.code!=='23505')logger.error('HTTP failure',e.code||e.name)}finally{jobs--}
 });
 const wss=new WebSocketServer({noServer:true,maxPayload:4096,perMessageDeflate:false});
 server.on('upgrade',async(req,socket,head)=>{jobs++;try{if(stopping)fail('SERVER_RESTARTING',503);sameOrigin(req);rate(req.socket.remoteAddress+':upgrade',60);const url=new URL(req.url,origin);if(url.pathname!=='/ws'||!uuid(url.searchParams.get('roomId')))fail('INVALID_ROOM');const user=await auth.user(req.headers.cookie),roomId=url.searchParams.get('roomId');await rooms.read(roomId,user);if(stopping)fail('SERVER_RESTARTING',503);wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,{user,roomId,cookie:req.headers.cookie}))}catch{socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')}finally{jobs--}});
 wss.on('connection',(ws,data)=>{
  const peer={ws,...data,alive:true};peers.add(peer);let initialized=false;
  track(async()=>{broadcast(peer.roomId,await rooms.presence(peer.roomId,peer.user,true));if(ws.readyState===1)ws.send(JSON.stringify(await rooms.read(peer.roomId,peer.user)));initialized=true}).catch(()=>ws.close(1008,'Cannot resume'));
  ws.on('pong',()=>peer.alive=true);
  ws.on('message',async raw=>{jobs++;try{if(stopping)fail('SERVER_RESTARTING',503);if(!initialized)fail('WAIT_FOR_SNAPSHOT',409);await auth.user(peer.cookie);rate(peer.user.id+':ws',120);let msg;try{msg=JSON.parse(raw.toString())}catch{fail('INVALID_JSON')}
   if(msg.type==='resume'){ws.send(JSON.stringify(await rooms.read(peer.roomId,peer.user,msg.afterSeq??null)));return}
   const result=await rooms.command(peer.roomId,peer.user,msg);broadcast(peer.roomId,result.events);ws.send(JSON.stringify(result.reply));
  }catch(e){const error={type:'error',error:e.code==='23505'?'SEAT_OR_REQUEST_CONFLICT':e.status?e.message:'INTERNAL_ERROR'};if(e.status===401){ws.close(1008,'Session expired');return}if(ws.readyState===1)ws.send(JSON.stringify(error))}finally{jobs--}});
  ws.on('error',()=>{});ws.on('close',()=>{peers.delete(peer);if(!stopping&&![...peers].some(p=>p.roomId===peer.roomId&&p.user.id===peer.user.id))track(()=>rooms.presence(peer.roomId,peer.user,false)).then(e=>broadcast(peer.roomId,e)).catch(()=>{})});
 });
 let working=false;const timer=setInterval(async()=>{if(working)return;working=true;try{for(const result of await rooms.tick())broadcast(result.roomId,result.events)}catch(e){logger.error('Room tick failed',e.code||e.name)}finally{working=false}},100);timer.unref();
 const heartbeat=setInterval(()=>track(async()=>{for(const peer of peers){try{await auth.user(peer.cookie);if(!peer.alive){peer.ws.terminate();continue}peer.alive=false;peer.ws.ping()}catch{peer.ws.close(1008,'Session expired')}}}).catch(()=>{}),15000);heartbeat.unref();
 return {server,auth,broadcast,close(){if(closePromise)return closePromise;stopping=true;clearInterval(timer);clearInterval(heartbeat);closePromise=(async()=>{const ended=server.listening?new Promise(resolve=>server.close(resolve)):Promise.resolve();server.closeIdleConnections?.();for(const p of peers)p.ws.terminate();await new Promise(resolve=>wss.close(resolve));while(working||jobs)await new Promise(r=>setTimeout(r,10));await ended})();return closePromise}};
}
module.exports={createServer};
