const {PGlite}=require('@electric-sql/pglite'),{Store}=require('../store.cjs'),{Auth}=require('../auth.cjs'),{Rooms}=require('../rooms.cjs'),crypto=require('node:crypto');
async function fixture(){
 let db,admin,realPool,schema;
 if(process.env.TEST_DATABASE_URL){const {Pool}=require('pg');schema='test_'+crypto.randomUUID().replaceAll('-','');admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});await admin.query('CREATE SCHEMA '+schema);realPool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:'-c search_path='+schema})}else{db=new PGlite();await db.waitReady}let chain=Promise.resolve();
 async function connect(){let unlock;const before=chain;chain=new Promise(r=>unlock=r);await before;return {query:(sql,params)=>!params&&sql.includes(';')?db.exec(sql).then(results=>results.at(-1)):db.query(sql,params),release:unlock}}
 const pool=realPool||{connect,async query(sql,params){const c=await connect();try{return await c.query(sql,params)}finally{c.release()}},end:()=>db.close()},store=new Store(pool);await store.migrate();let clock=1000000;const options={now:()=>clock,streetMs:900,resultMs:500,turnMs:30000,reserveMs:120000},rooms=new Rooms(store,options),auth=new Auth(store,{secure:false,now:options.now});
 const users=[];for(let i=0;i<3;i++)users.push(await auth.register({username:'player_'+i,password:'test-password-'+i}));
 const id=(await rooms.create(users[0],crypto.randomUUID())).roomId;
 const state=async(roomId=id)=>(await pool.query('SELECT state FROM rooms WHERE id=$1',[roomId])).rows[0].state;
 async function send(user,type,extra={},roomId=id){const r=await state(roomId);return rooms.command(roomId,user,{type,actionId:crypto.randomUUID(),handId:r.hand?.id||null,expectedSeq:r.seq,...extra})}
 return {db,store,pool,rooms,auth,users,id,state,send,options,advance:ms=>clock+=ms,close:async()=>{await store.close();if(admin){await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end()}}};
}
module.exports={fixture};
