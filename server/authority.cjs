'use strict';
async function registerInstance(pool,instanceId){
 if(typeof instanceId!=='string'||!instanceId.length||instanceId.length>256)throw Error('Invalid authority instance ID');
 await pool.query('INSERT INTO authority_instances(instance_id) VALUES($1) ON CONFLICT DO NOTHING',[instanceId]);
 const row=(await pool.query('SELECT generation,(SELECT max(generation) FROM authority_instances) AS latest FROM authority_instances WHERE instance_id=$1',[instanceId])).rows[0];
 return {generation:Number(row.generation),latest:Number(row.latest)};
}
function shouldYield(payload,generation,token){
 try{const request=JSON.parse(payload);return request?.protocol===2&&typeof request.token==='string'&&request.token!==token&&Number.isSafeInteger(request.generation)&&request.generation>generation}catch{return false}
}
module.exports={registerInstance,shouldYield};
