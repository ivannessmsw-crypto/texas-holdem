(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;else root.OnlineState=api})(typeof globalThis!=='undefined'?globalThis:this,()=>{
 class Replica {
  constructor(){this.reset()}
  reset(){this.seq=-1;this.view=null;this.roomId=null;this.handId=null;this.selfSeat=-1;this.gap=false;this.code=null;this.maxPlayers=3}
  accept(packet){
   if(packet.type==='snapshot'){if(this.roomId===packet.roomId&&packet.seq<this.seq)return 'duplicate';this.roomId=packet.roomId;this.code=packet.code||null;this.maxPlayers=packet.maxPlayers||3;this.seq=packet.seq;this.handId=packet.handId;this.selfSeat=packet.selfSeat;this.view=packet;this.gap=false;return 'applied'}
   if(packet.type!=='event'||packet.roomId!==this.roomId)return 'ignored';
   if(packet.seq<=this.seq)return 'duplicate';if(packet.seq!==this.seq+1){this.gap=true;return 'gap'}
   this.seq=packet.seq;this.handId=packet.handId;this.view=packet.view;this.gap=false;return 'applied';
  }
 }
 return {Replica};
});
