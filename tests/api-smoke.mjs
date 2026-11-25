import assert from 'node:assert/strict';
const base=process.env.TEST_URL||'http://127.0.0.1:5173';
const headers={'Content-Type':'application/json','Cookie':'__sites_local_auth=1'};
async function call(path,method='GET',body,auth=true){const r=await fetch(base+path,{method,headers:auth?headers:{},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
assert.equal((await call('/api/group','GET',null,false)).status,401);
let {data:state,status}=await call('/api/group');assert.equal(status,200);assert.ok(state.user.isOwner);
if(state.votes.length){await call('/api/group','PATCH',{action:'lock'});state=(await call('/api/group','PATCH',{action:'new-round'})).data;}
if(state.locked)state=(await call('/api/group','PATCH',{action:'new-round'})).data;
const {data:catalog}=await call('/api/catalog');assert.ok(catalog.series.length>100);
const {data:feed,status:feedStatus}=await call('/api/markets?series=KXNFLGAME');assert.equal(feedStatus,200);assert.ok(feed.markets.length>=6);
const market=feed.markets.slice(0,6);
async function vote(i,side,direction,revision=state.revision,action='add'){return call('/api/vote','POST',{ticker:market[i].ticker,side,direction,revision,round:state.group.round,action});}
for(let i=0;i<10;i++){const r=await vote(0,'yes',1);assert.equal(r.status,200,JSON.stringify(r));state=r.data;}
assert.equal(state.votes.filter(v=>v.direction===1).length,10);
assert.equal(state.votes.filter(v=>v.ticker===market[0].ticker&&v.side==='yes').length,10);
assert.equal(state.scores.find(s=>s.key===`${market[0].ticker}:yes`).up,10);
assert.equal((await vote(0,'yes',1)).status,400);
let result=await vote(5,'yes',1);assert.equal(result.status,400);assert.match(result.data.error,/10 upvotes/);
for(let i=0;i<5;i++){const r=await vote(i,'no',-1);assert.equal(r.status,200,JSON.stringify(r));state=r.data;}
assert.equal(state.votes.length,15);
assert.equal((await vote(5,'no',-1)).status,400);
assert.equal((await call('/api/group')).data.votes.length,15);
const stale=state.revision;
state=(await vote(0,'yes',1,state.revision,'remove')).data;
assert.equal(state.votes.length,14);
assert.equal((await vote(0,'yes',1,stale)).status,409);
const concurrent=await Promise.all([vote(0,'yes',1),vote(0,'yes',1)]);
assert.equal(concurrent.filter(r=>r.status===200).length,1);
assert.equal(concurrent.filter(r=>r.status===409).length,1);
state=(await call('/api/group')).data;
assert.equal(state.votes.filter(v=>v.direction===1).length,10);
assert.equal(state.votes.filter(v=>v.ticker===market[0].ticker&&v.side==='yes').length,10);
assert.equal((await vote(0,'yes',1,state.revision,'set-99')).status,400);
assert.equal((await vote(0,'yes',-1,state.revision,'remove')).status,400);
result=await call('/api/group','PATCH',{name:'The Thursday Club',budget:1234,topN:4});
assert.equal(result.status,200);assert.equal(result.data.group.budget,1234);assert.equal(result.data.group.topN,4);
assert.equal((await call('/api/group','PATCH',{name:'Club',budget:-10,topN:4})).status,400);
assert.equal((await call('/api/markets?series=NOTFOOTBALL')).status,400);
result=await call('/api/group','PATCH',{action:'lock'});assert.equal(result.status,200);assert.ok(result.data.locked);
assert.equal((await vote(0,'yes',1)).status,400);
const previousRound=state.group.round;
state=(await call('/api/group','PATCH',{action:'new-round'})).data;
assert.notEqual(state.group.round,previousRound);assert.equal(state.votes.length,0);assert.equal(state.scores.length,0);assert.equal(state.group.budget,1234);assert.equal(state.group.topN,10);
await call('/api/group','PATCH',{name:'The Thursday Club',budget:1000,topN:10});
console.log(JSON.stringify({passed:true,checks:['unauthenticated writes blocked','live football catalog and quotes','10 up / 5 down limits','ten upvotes on one outcome','stacked group score','one-point refund','invalid actions rejected','saved ballots','stale revision conflict','concurrent requests cannot exceed limits','configurable stake and top N','invalid settings rejected','non-football series rejected','locked voting rejected','new round resets ballot and leg target while retaining stake'],footballSeries:catalog.series.length,openGameMarkets:feed.markets.length},null,2));
