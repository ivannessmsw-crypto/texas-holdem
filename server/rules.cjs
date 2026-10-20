'use strict';
const crypto=require('node:crypto'),Rules=require('../engine/poker-engine.cjs');
// 48 cryptographic bits per draw; rejection-free uniform integer space.
const secureRandom=()=>crypto.randomInt(0,2**48-1)/(2**48-1);
function createHand(options){return new Rules.Hand({...options,seed:0,shuffleRandom:secureRandom})}
// Private database format. NEVER return this object or engine.historyFor over HTTP/WS.
function serialize(hand){const state={...hand,pending:[...hand.pending]};delete state.random;return Rules.clone(state)}
function restore(state){const hand=Object.assign(Object.create(Rules.Hand.prototype),Rules.clone(state));hand.pending=new Set(state.pending);hand.assert();return hand}
module.exports={...Rules,createHand,serialize,restore};
