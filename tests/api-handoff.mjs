import assert from 'node:assert/strict';
const base=process.env.TEST_URL||'http://127.0.0.1:5173';
if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw new Error('This smoke test only mutates a local test database.');
const headers={'Content-Type':'application/json','Cookie':'__sites_local_auth=1'};
async function call(path,method='GET',body,auth=true){const r=await fetch(base+path,{method,headers:auth?headers:{},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
assert.equal((await call('/api/parlay','GET',null,false)).status,401);
assert.equal((await call('/api/parlay/link','GET',null,false)).status,401);
let {data:group,status}=await call('/api/group');assert.equal(status,200);
assert.equal(group.votes.length,0,'Use a fresh local round to avoid overwriting local ballots.');
if(group.locked)group=(await call('/api/group','PATCH',{action:'new-round'})).data;
const original={name:group.group.name,budget:group.group.budget,topN:group.group.topN};
let usedRound=false;
try {
 const feed=await call('/api/markets?series=KXNFLGAME');assert.equal(feed.status,200);
 const events=new Set();const markets=feed.data.markets.filter(m=>{if(events.has(m.event))return false;events.add(m.event);return true;}).slice(0,2);
 assert.equal(markets.length,2);
 group=(await call('/api/group','PATCH',{...original,topN:2})).data;
 for(const [i,market] of markets.entries()){
  const vote=await call('/api/vote','POST',{ticker:market.ticker,side:i?'no':'yes',direction:1,action:'add',revision:group.revision,round:group.group.round});
  assert.equal(vote.status,200,JSON.stringify(vote));group=vote.data;usedRound=true;
 }
 let ticket=(await call('/api/parlay')).data;assert.equal(ticket.locked,false);assert.equal(ticket.legs.length,2);
 const query=t=>`/api/parlay/link?version=${t.version}&key=${encodeURIComponent(t.legs[0].key)}`;
 assert.equal((await call(query(ticket))).status,409,'Drafts cannot be handed off as final tickets.');
 const locked=await call('/api/group','PATCH',{action:'lock'});assert.equal(locked.status,200);
 const final=(await call('/api/parlay')).data;assert.equal(final.locked,true);assert.notEqual(final.version,ticket.version);
 assert.equal((await call(query(ticket))).status,409,'Old ticket references are rejected.');
 assert.equal((await call(`/api/parlay/link?version=${final.version}&key=NOT-A-WINNER`)).status,400);
 for(const leg of final.legs){
  const result=await call(`/api/parlay/link?version=${final.version}&key=${encodeURIComponent(leg.key)}`);
  assert.equal(result.status,200,JSON.stringify(result));const url=new URL(result.data.url);
  assert.equal(url.hostname,'kalshi.com');assert.equal(url.searchParams.get('orderSide'),leg.side);
  assert.equal(url.searchParams.get('marketTicker'),leg.ticker);
 }
 await call('/api/group','PATCH',{action:'new-round'});
 assert.equal((await call(query(final))).status,409,'Previous-round tickets cannot resolve links in a new round.');
 usedRound=false;
 console.log('Handoff API passed: identity required, final selections from server, draft and stale references rejected, unselected legs rejected, verified live YES and NO links, new-round invalidation. No order endpoint was called.');
} finally {
 if(usedRound){await call('/api/group','PATCH',{action:'lock'});await call('/api/group','PATCH',{action:'new-round'});}
 const current=(await call('/api/group')).data;
 await call('/api/group','PATCH',{...original});
}
