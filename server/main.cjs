'use strict';
const crypto=require('node:crypto');
const {Store}=require('./store.cjs'),{Rooms}=require('./rooms.cjs'),{createServer}=require('./http.cjs');
const {SupabaseAuth}=require('./supabase-auth.cjs'),{Auth}=require('./auth.cjs');
const {database}=require('./database.cjs'),{envSettings}=require('./config.cjs');
const {registerInstance,shouldYield}=require('./authority.cjs');
(async()=>{
 const config=envSettings(),pool=await database(process.env.DATABASE_URL),store=new Store(pool);
 const token=crypto.randomUUID(),instanceId=process.env.RENDER_INSTANCE_ID||'local:'+token;
 let lease,app,closing=false,owns=false,closePromise;
 function close(){
  if(closePromise)return closePromise;
  closing=true;
  closePromise=(async()=>{
   if(app)await app.close();
   while(store.inFlight)await new Promise(r=>setTimeout(r,25));
   if(lease){if(owns)await lease.query('SELECT pg_advisory_unlock(68204721)');lease.release()}
   await store.close();
  })();return closePromise;
 }
 process.once('SIGINT',()=>close().catch(()=>process.exitCode=1));
 process.once('SIGTERM',()=>close().catch(()=>process.exitCode=1));
 try{
  if(process.env.RENDER==='true'&&!process.env.RENDER_INSTANCE_ID)throw Error('Render instance ID required for safe rolling deployment');
  await store.migrate();
  const authority=await registerInstance(pool,instanceId);
  if(authority.generation<authority.latest){console.log('Obsolete authority instance; a newer deployment owns this database');await close();return}
  lease=await pool.connect();
  await lease.query('LISTEN midnight_friends_handoff');
  lease.on('error',()=>{console.error('Database authority connection lost');process.exit(1)});
  // A legacy restart sends only a random UUID. It must never evict the new
  // leader. New instances send a durable, monotonic generation instead.
  lease.on('notification',n=>{
   if(owns&&n.channel==='midnight_friends_handoff'&&shouldYield(n.payload,authority.generation,token)){
    console.log('Handing off the authoritative room server to a newer instance; clients will reconnect');
    void close().catch(()=>process.exit(1));
   }
  });
  await lease.query("SELECT pg_notify('midnight_friends_handoff',$1)",[JSON.stringify({protocol:2,token,generation:authority.generation})]);
  const limit=Date.now()+30000;let lastNotice=Date.now();
  while(!owns&&!closing){
   const latest=Number((await lease.query('SELECT max(generation) AS latest FROM authority_instances')).rows[0].latest);
   if(latest>authority.generation){console.log('Obsolete authority instance; newer deployment registered');await close();return}
   owns=(await lease.query('SELECT pg_try_advisory_lock(68204721) AS locked')).rows[0].locked;
   if(!owns){if(Date.now()-lastNotice>=1000){await lease.query("SELECT pg_notify('midnight_friends_handoff',$1)",[JSON.stringify({protocol:2,token,generation:authority.generation})]);lastNotice=Date.now()}if(Date.now()>limit)throw Error('Another authority owns this database');await new Promise(r=>setTimeout(r,200))}
  }
  if(closing){await close();return}
  const rooms=new Rooms(store);await rooms.recoverPresence();
  const auth=config.authMode==='local-test'?new Auth(store,{secure:false}):new SupabaseAuth(store,{url:config.url,key:config.key,secure:!config.local});
  app=createServer({store,rooms,origin:config.origin,secure:!config.local,auth,publicConfig:{authMode:config.authMode,...(config.authMode==='supabase'?{supabaseUrl:config.url,publishableKey:config.key}:{})}});
  await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(config.port,process.env.HOST||'0.0.0.0',resolve)});
  console.log('Midnight friends ready: '+config.origin+'/online');
 }catch(e){await close();throw e}
})().catch(e=>{console.error('Startup failed: '+(e.code||e.name)+': '+e.message.replace(/postgres(?:ql)?:\/\/\S+/g,'[redacted DB URL]'));process.exitCode=1});
