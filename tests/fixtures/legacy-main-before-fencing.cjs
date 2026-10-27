// Regression fixture: the legacy authority used before Render instance fencing.
'use strict';
const crypto=require('node:crypto'),{Store}=require('../../server/store.cjs'),{Rooms}=require('../../server/rooms.cjs'),{createServer}=require('../../server/http.cjs'),{SupabaseAuth}=require('../../server/supabase-auth.cjs'),{Auth}=require('../../server/auth.cjs'),{database}=require('../../server/database.cjs'),{envSettings}=require('../../server/config.cjs');
(async()=>{
 const config=envSettings(),pool=await database(process.env.DATABASE_URL),store=new Store(pool);let lease,app,closing=false,owns=false;const token=crypto.randomUUID();
 const close=async()=>{if(closing)return;closing=true;if(app)await app.close();while(store.inFlight)await new Promise(r=>setTimeout(r,25));if(lease){if(owns)await lease.query('SELECT pg_advisory_unlock(68204721)');lease.release()}await store.close()};
 process.once('SIGINT',()=>close().catch(()=>process.exitCode=1));process.once('SIGTERM',()=>close().catch(()=>process.exitCode=1));
 try{
  await store.migrate();lease=await pool.connect();await lease.query('LISTEN midnight_friends_handoff');lease.on('error',()=>{console.error('Database authority connection lost');process.exit(1)});
  lease.on('notification',n=>{if(owns&&n.channel==='midnight_friends_handoff'&&n.payload!==token){console.log('Handing off the authoritative room server; clients will reconnect');void close().catch(()=>process.exit(1))}});
  await lease.query("SELECT pg_notify('midnight_friends_handoff',$1)",[token]);
  const limit=Date.now()+30000;while(!owns&&!closing){owns=(await lease.query('SELECT pg_try_advisory_lock(68204721) AS locked')).rows[0].locked;if(!owns){if(Date.now()>limit)throw Error('Another authority owns this database');await new Promise(r=>setTimeout(r,200))}}
  if(closing){await close();return}const rooms=new Rooms(store);await rooms.recoverPresence();
  const auth=config.authMode==='local-test'?new Auth(store,{secure:false}):new SupabaseAuth(store,{url:config.url,key:config.key,secure:!config.local});
  app=createServer({store,rooms,origin:config.origin,secure:!config.local,auth,publicConfig:{authMode:config.authMode,...(config.authMode==='supabase'?{supabaseUrl:config.url,publishableKey:config.key}:{})}});
  await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(config.port,process.env.HOST||'0.0.0.0',resolve)});console.log('Midnight friends ready: '+config.origin+'/online');
 }catch(e){await close();throw e}
})().catch(e=>{console.error('Startup failed: '+(e.code||e.name)+': '+e.message.replace(/postgres(?:ql)?:\/\/\S+/g,'[redacted DB URL]'));process.exitCode=1});
