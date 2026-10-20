'use strict';
const {database}=require('./database.cjs'),{Store}=require('./store.cjs');
(async()=>{if(!process.env.DATABASE_URL)throw Error('DATABASE_URL required');const store=new Store(await database(process.env.DATABASE_URL));try{await store.migrate();console.log('midnight_online migrations applied')}finally{await store.close()}})().catch(e=>{console.error('Migration failed: '+(e.code||e.name));process.exitCode=1});
