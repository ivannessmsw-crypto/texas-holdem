const {test}=require('node:test'),assert=require('node:assert/strict'),R=require('../rules.cjs'),Old=require('../../tests/fixtures/online-before-engine.cjs');
test('phase 1: existing seeded offline rules are identical across 256 complete hands',()=>{
 for(let seed=1;seed<=256;seed++){
  const r=R.rng(seed),players=Array.from({length:2+seed%8},()=>({stack:1+Math.floor(r()*1500)})),a=new R.Hand({players,seed}),b=new Old.Hand({players,seed});let steps=0;
  while(!a.done){assert(++steps<500);assert.deepEqual(a.legalActions(),b.legalActions());const l=a.legalActions(),n=r(),action=n<.10?{type:'fold'}:n<.35&&l.allIn?{type:'allin'}:{type:l.check?'check':'call'};a.act(a.turn,action);b.act(b.turn,action);assert.deepEqual(R.serialize(a),R.serialize(b))}
 }
});
test('phase 1: crypto shuffle, no duplicate cards, private state restores all-in side pots',()=>{
 const h=R.createHand({players:[100,250,500].map(stack=>({stack})),id:'test-hand'});assert(h.assert());h.act(0,{type:'allin'});const restored=R.restore(R.serialize(h));for(const hand of [h,restored]){hand.act(1,{type:'allin'});hand.act(2,{type:'call'});assert.equal(hand.settledPots.length,2);assert.equal(hand.players.reduce((s,p)=>s+p.stack,0),850);assert.equal(hand.history.filter(x=>x.type==='end').length,1)}assert.deepEqual(R.serialize(h),R.serialize(restored));
 const boards=new Set(Array.from({length:10},()=>JSON.stringify(R.createHand({players:[{stack:100},{stack:100}]}).deck)));assert.equal(boards.size,10);
});
