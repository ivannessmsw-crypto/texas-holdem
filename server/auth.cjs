'use strict';
const crypto=require('node:crypto'),{promisify}=require('node:util'),scrypt=promisify(crypto.scrypt);
const fail=(code,status=400)=>{throw Object.assign(Error(code),{status})};
const digest=token=>crypto.createHash('sha256').update(token).digest('hex');
async function hashPassword(password){const salt=crypto.randomBytes(16).toString('hex'),hash=await scrypt(password,salt,64);return salt+':'+hash.toString('hex')}
async function verify(password,encoded){const [salt,hash]=encoded.split(':'),actual=await scrypt(password,salt,64);return crypto.timingSafeEqual(actual,Buffer.from(hash,'hex'))}
class Auth {
 constructor(store,{secure=true,now=Date.now}={}){this.store=store;this.secure=secure;this.now=now;this.cookieName=secure?'__Host-midnight_sid':'midnight_dev_sid';this.ttl=12*60*60*1000;this.dummy=hashPassword('dummy-unmatchable-password')}
 credentials(body){if(!body||typeof body.username!=='string'||!/^[a-z0-9_]{3,24}$/.test(body.username)||typeof body.password!=='string'||body.password.length<12||Buffer.byteLength(body.password)>128)fail('INVALID_CREDENTIAL_FORMAT');return body}
 async register(body){const {username,password}=this.credentials(body),id=crypto.randomUUID(),encoded=await hashPassword(password);try{return await this.store.transaction(async c=>{await c.query('INSERT INTO users(id,username,password_hash) VALUES($1,$2,$3)',[id,username,encoded]);await c.query('INSERT INTO user_settings(user_id) VALUES($1)',[id]);await c.query('INSERT INTO wallets(user_id,balance) VALUES($1,1000)',[id]);await this.store.ledger(c,{key:'initial:'+id,userId:id,account:'wallet',reason:'initial-play-chips',delta:1000,balance:1000});return {id,username}})}catch(e){if(e.code==='23505')fail('USERNAME_UNAVAILABLE',409);throw e}}
 async login(body){const {username,password}=this.credentials(body),result=await this.store.pool.query('SELECT id,username,password_hash FROM users WHERE username=$1',[username]),user=result.rows[0];if(!await verify(password,user?.password_hash||await this.dummy)||!user)fail('INVALID_LOGIN',401);const token=crypto.randomBytes(32).toString('base64url');await this.store.pool.query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)',[digest(token),user.id,new Date(this.now()+this.ttl)]);return {user:{id:user.id,username:user.username},token}}
 token(cookie=''){return cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith(this.cookieName+'='))?.slice(this.cookieName.length+1)||''}
 async user(cookie){const token=this.token(cookie);if(!/^[A-Za-z0-9_-]{43}$/.test(token))fail('UNAUTHENTICATED',401);const row=await this.store.pool.query('SELECT u.id,u.username,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>$2',[digest(token),new Date(this.now())]);if(!row.rows[0])fail('UNAUTHENTICATED',401);const user={id:row.rows[0].id,username:row.rows[0].username};Object.defineProperty(user,'sessionExpiresAt',{value:new Date(row.rows[0].expires_at).getTime()});return user}
 async logout(cookie){await this.store.pool.query('DELETE FROM sessions WHERE token_hash=$1',[digest(this.token(cookie))])}
 cookie(token,clear=false){return `${this.cookieName}=${clear?'':token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear?0:this.ttl/1000}${this.secure?'; Secure':''}`}
}
module.exports={Auth,fail};
