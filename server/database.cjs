'use strict';
const {Pool}=require('pg');
async function database(connectionString){
 if(new URL(connectionString).port==='6543')throw Error('Use a direct or session PostgreSQL connection; transaction poolers cannot hold room authority');
 const pool=new Pool({connectionString,options:'-c search_path=midnight_online,pg_catalog',max:12,connectionTimeoutMillis:8000,idleTimeoutMillis:30000,statement_timeout:15000,lock_timeout:8000});
 try{await pool.query('CREATE SCHEMA IF NOT EXISTS midnight_online');return pool}catch(e){await pool.end();throw e}
}
module.exports={database};
