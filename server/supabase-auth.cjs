'use strict';
const crypto=require('node:crypto'),{Auth,fail}=require('./auth.cjs');
const validId=s=>typeof s==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s);
function configuration(url,key){const u=new URL(url);if(u.origin!==url||u.protocol!=='https:')throw Error('Supabase HTTPS origin required');let allowed=typeof key==='string'&&key.startsWith('sb_publishable_');if(!allowed)try{allowed=JSON.parse(Buffer.from(key.split('.')[1],'base64url')).role==='anon'}catch{}if(!allowed)throw Error('Only a public Supabase publishable/anon key is accepted');return {url,key}}
class SupabaseAuth extends Auth {
 constructor(store,{url,key,secure=true,now=Date.now,fetcher=fetch}={}){super(store,{secure,now});this.config=configuration(url,key);this.fetcher=fetcher;this.mode='supabase'}
 register(){fail('USE_SUPABASE_AUTH',403)}
 login(){fail('USE_SUPABASE_AUTH',403)}
 async exchange(body){
  if(!body||Object.keys(body).some(k=>k!=='accessToken')||typeof body.accessToken!=='string'||body.accessToken.length>8192)fail('INVALID_TOKEN',401);
  const token=body.accessToken;let payload;try{const parts=token.split('.');if(parts.length!==3)throw Error();payload=JSON.parse(Buffer.from(parts[1],'base64url'))}catch{fail('INVALID_TOKEN',401)}
  let response;try{response=await this.fetcher(this.config.url+'/auth/v1/user',{headers:{apikey:this.config.key,Authorization:'Bearer '+token},signal:AbortSignal.timeout(8000)})}catch{fail('AUTH_UNAVAILABLE',503)}
  if(!response.ok)fail(response.status>=500?'AUTH_UNAVAILABLE':'INVALID_TOKEN',response.status>=500?503:401);
  let user;try{user=await response.json()}catch{fail('AUTH_UNAVAILABLE',503)}
  const aud=Array.isArray(payload.aud)?payload.aud:[payload.aud];if(!validId(user.id)||payload.sub!==user.id||payload.role!=='authenticated'||!aud.includes('authenticated')||!Number.isSafeInteger(payload.exp)||payload.exp*1000<=this.now()||payload.iss!==this.config.url+'/auth/v1')fail('INVALID_TOKEN',401);
  if(!user.email_confirmed_at)fail('EMAIL_NOT_CONFIRMED',403);
  const name=(typeof user.user_metadata?.nickname==='string'?user.user_metadata.nickname:'玩家 '+user.id.slice(0,6)).replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,32)||'玩家';
  const sessionToken=crypto.randomBytes(32).toString('base64url'),expiresAt=Math.min(this.now()+this.ttl,payload.exp*1000),userId=user.id;
  await this.store.transaction(async c=>{
   await c.query("INSERT INTO users(id,username,password_hash,display_name,auth_provider) VALUES($1,$2,'!supabase-only',$3,'supabase') ON CONFLICT(id) DO UPDATE SET display_name=EXCLUDED.display_name",[userId,'u_'+userId.replaceAll('-','').slice(0,20),name]);
   await c.query('INSERT INTO user_settings(user_id) VALUES($1) ON CONFLICT DO NOTHING',[userId]);
   const wallet=await c.query('INSERT INTO wallets(user_id,balance) VALUES($1,1000) ON CONFLICT DO NOTHING RETURNING balance',[userId]);
   if(wallet.rows.length)await this.store.ledger(c,{key:'initial:'+userId,userId,account:'wallet',reason:'initial-play-chips',delta:1000,balance:1000});
   await c.query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)',[crypto.createHash('sha256').update(sessionToken).digest('hex'),userId,new Date(expiresAt)]);
  });
  return {user:{id:userId,username:name},token:sessionToken,maxAge:Math.max(1,Math.floor((expiresAt-this.now())/1000))};
 }
 async user(cookie){const u=await super.user(cookie),r=await this.store.pool.query('SELECT display_name FROM users WHERE id=$1',[u.id]);u.username=r.rows[0]?.display_name||u.username;return u}
 cookie(token,clear=false,maxAge=3600){return super.cookie(token,clear).replace(/Max-Age=\d+/,'Max-Age='+(clear?0:maxAge))}
}
module.exports={SupabaseAuth,configuration};
