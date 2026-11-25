import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import ts from 'typescript';

// Execute the real group route and SQL in workerd/D1. Only the identity adapter
// is replaced by explicit fixture users; nothing contacts a production service.
const root=resolve('work/group-runtime-test');
function compile(file,name){
  let code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  for(const [from,to] of [['@/lib/kalshi','./fixture-kalshi.js'],['@/lib/group','./group.js'],['@/lib/domain','./domain.js'],['./domain','./domain.js'],['./group','./group.js'],['./odds','./odds.js'],['./parlay-handoff','./parlay-handoff.js'],['./kalshi-links','./fixture-links.js'],['@/lib/parlay-server','./parlay-server.js'],['@/app/chatgpt-auth','./fixture-auth.js']])code=code.replaceAll(`from "${from}"`,`from "${to}"`);
  return {type:'ESModule',path:resolve(root,name+'.js'),contents:code};
}
test('organizer can reopen without losing votes and start a fresh round with ten legs; unauthorized changes are rejected',async()=>{
  const mf=new Miniflare(convertV4MiniflareOptions({modulesRoot:root,modules:[
    {type:'ESModule',path:resolve(root,'worker.js'),contents:`import {GET,PATCH} from './route.js';export default{fetch(request){globalThis.fixtureUser=request.headers.get('X-Fixture-User');return request.method==='PATCH'?PATCH(request):GET();}}`},
    {type:'ESModule',path:resolve(root,'fixture-auth.js'),contents:`export async function getChatGPTUser(){return globalThis.fixtureUser?{userId:globalThis.fixtureUser,displayName:globalThis.fixtureUser}:null;}`},
    compile('app/api/group/route.ts','route'),compile('lib/group.ts','group'),compile('lib/domain.ts','domain'),
  ],compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],inspectorPort:0}));
  try{
    const db=await mf.getD1Database('DB');
    await db.exec("CREATE TABLE groups(id TEXT PRIMARY KEY,owner TEXT,name TEXT,budget INTEGER,top_n INTEGER,round TEXT,deadline TEXT,locked INTEGER); CREATE TABLE ballots(user TEXT,round TEXT,name TEXT,votes TEXT,revision INTEGER,updated TEXT,PRIMARY KEY(user,round));");
    const deadline=new Date(Date.now()+86400000).toISOString();
    await db.prepare("INSERT INTO groups VALUES('club','owner','Club',1000,5,'round',?,1)").bind(deadline).run();
    const votes=[{ticker:'A',side:'yes',direction:1,market:{ticker:'A',title:'A'}}];
    await db.prepare("INSERT INTO ballots VALUES('owner','round','Owner',?,4,?)").bind(JSON.stringify(votes),new Date().toISOString()).run();
    const call=async(body,user='owner',origin='http://runtime.test')=>{
      const response=await mf.dispatchFetch('http://runtime.test/api/group',{method:'PATCH',headers:{'Content-Type':'application/json',Origin:origin,...(user?{'X-Fixture-User':user}:{})},body:JSON.stringify(body)});
      return {status:response.status,data:await response.json()};
    };
    assert.equal((await call({action:'reopen',round:'round'},null)).status,401);
    assert.equal((await call({action:'reopen',round:'round'},'member')).status,403);
    assert.equal((await call({action:'reopen',round:'round'},'owner','https://other.example')).status,400);
    assert.equal((await call({action:'reopen',round:'stale'})).status,409);
    assert.equal((await db.prepare("SELECT locked FROM groups WHERE id='club'").first()).locked,1);
    const reopened=await call({action:'reopen',round:'round'});
    assert.equal(reopened.status,200,JSON.stringify(reopened));assert.equal(reopened.data.locked,false);
    assert.deepEqual(reopened.data.votes,votes);assert.equal(reopened.data.revision,4);
    assert.equal(reopened.data.group.round,'round');assert.equal(reopened.data.group.budget,1000);assert.equal(reopened.data.group.topN,5);assert.equal('deadline' in reopened.data.group,false);
    assert.equal((await call({action:'reopen',round:'round'})).status,409);
    await db.prepare("UPDATE groups SET deadline='2000-01-01T00:00:00Z',locked=0 WHERE id='club'").run();
    const expired=await mf.dispatchFetch('http://runtime.test/api/group',{headers:{'X-Fixture-User':'owner'}}).then(r=>r.json());
    assert.equal(expired.locked,false);assert.deepEqual(expired.votes,votes);
    assert.equal((await call({name:'Club',budget:1000,topN:5})).status,200);
    assert.equal((await call({action:'new-round'})).status,400);
    assert.equal((await call({action:'reopen',round:'round'})).status,409);
    assert.equal((await call({action:'lock'})).data.locked,true);
    assert.deepEqual(JSON.parse((await db.prepare("SELECT votes FROM ballots WHERE user='owner'").first()).votes),votes);
    const fresh=await call({action:'new-round'});
    assert.equal(fresh.status,200);assert.notEqual(fresh.data.group.round,'round');
    assert.equal(fresh.data.group.topN,10);assert.equal(fresh.data.group.budget,1000);
    assert.equal(fresh.data.locked,false);assert.deepEqual(fresh.data.votes,[]);
    assert.deepEqual(JSON.parse((await db.prepare("SELECT votes FROM ballots WHERE user='owner' AND round='round'").first()).votes),votes);
    const customized=await call({name:'Club',budget:1000,topN:7});
    assert.equal(customized.status,200);assert.equal(customized.data.group.topN,7);

  }finally{await mf.dispose();}
});


test('historical deadlines do not block ballot inserts or updates; manual locks still win racing writes',async()=>{
  const mf=new Miniflare(convertV4MiniflareOptions({modulesRoot:root,modules:[
    {type:'ESModule',path:resolve(root,'worker.js'),contents:`import {GET,PATCH} from './route.js';import {POST} from './vote.js';
      export default{fetch(request){globalThis.fixtureUser=request.headers.get('X-Fixture-User');globalThis.fixtureLockDuringQuote=request.headers.has('X-Fixture-Lock-During-Quote');
      return new URL(request.url).pathname==='/api/vote'?POST(request):request.method==='PATCH'?PATCH(request):GET();}}`},
    {type:'ESModule',path:resolve(root,'fixture-auth.js'),contents:`export async function getChatGPTUser(){return globalThis.fixtureUser?{userId:globalThis.fixtureUser,displayName:globalThis.fixtureUser}:null;}`},
    {type:'ESModule',path:resolve(root,'fixture-kalshi.js'),contents:`import {env} from 'cloudflare:workers';
      export async function catalog(){return [{ticker:'KXNFLGAME'}];}
      export async function kalshi(){if(globalThis.fixtureLockDuringQuote)await env.DB.prepare("UPDATE groups SET locked=1 WHERE id='club'").run();
        return {market:{ticker:'KXNFLGAME-FIXTURE-A',event:'KXNFLGAME-FIXTURE',series:'KXNFLGAME',title:'Fixture A wins',category:'Moneyline',status:'open',closes:'2099-01-01T00:00:00Z'}};}
      export function normalize(market){return market;}`},
    compile('app/api/group/route.ts','route'),compile('app/api/vote/route.ts','vote'),compile('lib/group.ts','group'),compile('lib/domain.ts','domain'),
  ],compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],inspectorPort:0}));
  try{
    const db=await mf.getD1Database('DB');
    await db.exec("CREATE TABLE groups(id TEXT PRIMARY KEY,owner TEXT,name TEXT,budget INTEGER,top_n INTEGER,round TEXT,deadline TEXT NOT NULL,locked INTEGER); CREATE TABLE ballots(user TEXT,round TEXT,name TEXT,votes TEXT,revision INTEGER,updated TEXT,PRIMARY KEY(user,round));");
    const initial=await mf.dispatchFetch('http://runtime.test/api/group',{headers:{'X-Fixture-User':'owner'}}).then(r=>r.json());
    assert.equal(initial.group.topN,10);assert.equal(initial.locked,false);assert.equal('deadline' in initial.group,false);
    await db.prepare("UPDATE groups SET deadline='2000-01-01T00:00:00Z' WHERE id='club'").run();
    const vote=async(revision,user='owner',race=false)=>{
      const response=await mf.dispatchFetch('http://runtime.test/api/vote',{method:'POST',headers:{'Content-Type':'application/json','X-Fixture-User':user,Origin:'http://runtime.test',...(race?{'X-Fixture-Lock-During-Quote':'1'}:{})},body:JSON.stringify({ticker:'KXNFLGAME-FIXTURE-A',side:'yes',direction:1,round:initial.group.round,revision})});
      return {status:response.status,data:await response.json()};
    };
    const first=await vote(0);assert.equal(first.status,200,JSON.stringify(first));assert.equal(first.data.votes.length,1);
    const second=await vote(1);assert.equal(second.status,200,JSON.stringify(second));assert.equal(second.data.votes.length,2);
    const member=await vote(0,'member');assert.equal(member.status,200);assert.equal(member.data.votes.length,1);
    assert.equal((await vote(1)).status,409);
    assert.equal((await vote(2,'owner',true)).status,409);
    assert.equal(JSON.parse((await db.prepare("SELECT votes FROM ballots WHERE user='owner'").first()).votes).length,2);
    const locked=await vote(2);assert.equal(locked.status,400);assert.match(locked.data.error,/Voting is closed/);
    const reopened=await mf.dispatchFetch('http://runtime.test/api/group',{method:'PATCH',headers:{'Content-Type':'application/json','X-Fixture-User':'owner',Origin:'http://runtime.test'},body:JSON.stringify({action:'reopen',round:initial.group.round})});
    assert.equal(reopened.status,200);
    const resumed=await vote(2);assert.equal(resumed.status,200);assert.equal(resumed.data.votes.length,3);
  }finally{await mf.dispose();}
});


test('ticket attribution requires sign-in, counts stacked votes by side, and excludes prior rounds and account IDs',async()=>{
  const mf=new Miniflare(convertV4MiniflareOptions({modulesRoot:root,modules:[
    {type:'ESModule',path:resolve(root,'worker.js'),contents:`import {GET as ticket} from './ticket-route.js';import {GET as group} from './route.js';export default{fetch(request){globalThis.fixtureUser=request.headers.get('X-Fixture-User');return new URL(request.url).pathname==='/api/parlay'?ticket():group();}}`},
    {type:'ESModule',path:resolve(root,'fixture-auth.js'),contents:`export async function getChatGPTUser(){return globalThis.fixtureUser?{userId:globalThis.fixtureUser,displayName:'Reader'}:null;}`},
    {type:'ESModule',path:resolve(root,'fixture-links.js'),contents:`export function selectionLink(){throw new Error('Link lookup is outside this test');}`},
    compile('app/api/parlay/route.ts','ticket-route'),compile('app/api/group/route.ts','route'),compile('lib/parlay-server.ts','parlay-server'),compile('lib/parlay-handoff.ts','parlay-handoff'),compile('lib/group.ts','group'),compile('lib/domain.ts','domain'),compile('lib/odds.ts','odds'),
  ],compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],inspectorPort:0}));
  try{
    const db=await mf.getD1Database('DB');
    await db.exec("CREATE TABLE groups(id TEXT PRIMARY KEY,owner TEXT,name TEXT,budget INTEGER,top_n INTEGER,round TEXT,deadline TEXT,locked INTEGER); CREATE TABLE ballots(user TEXT,round TEXT,name TEXT,votes TEXT,revision INTEGER,updated TEXT,PRIMARY KEY(user,round));");
    await db.exec("INSERT INTO groups VALUES('club','private-owner-id','Club',1000,10,'current','',0);");
    const market={ticker:'KXNFLGAME-FIXTURE-A',event:'KXNFLGAME-FIXTURE',title:'Fixture A wins',category:'Moneyline'};
    const up={ticker:market.ticker,side:'yes',direction:1,market};
    for(const [id,round,name,votes] of [
      ['private-alex-id','current','Alex',[up,up,up]],
      ['private-jamie-id','current','jamie@example.test',[{...up,direction:-1}]],
      ['private-other-id','current','Other',[{...up,side:'no'}]],
      ['private-old-id','previous','Previous voter',[up]],
    ])await db.prepare('INSERT INTO ballots VALUES(?,?,?,?,1,?)').bind(id,round,name,JSON.stringify(votes),'2026-01-01T00:00:00Z').run();
    assert.equal((await mf.dispatchFetch('http://runtime.test/api/parlay')).status,401);
    const response=await mf.dispatchFetch('http://runtime.test/api/parlay',{headers:{'X-Fixture-User':'reader'}});
    assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');
    const ticket=await response.json();
    assert.equal(ticket.legs.length,1);assert.equal(ticket.legs[0].side,'yes');
    assert.deepEqual(ticket.legs[0].voters,[{name:'Alex',up:3,down:0},{name:'jamie@example.test',up:0,down:1}]);
    assert.doesNotMatch(JSON.stringify(ticket),/private-|Previous voter/);
    const group=await mf.dispatchFetch('http://runtime.test/api/group',{headers:{'X-Fixture-User':'reader'}}).then(r=>r.json());
    assert.deepEqual(group.scores.find(score=>score.side==='yes').voters,ticket.legs[0].voters);
    assert.deepEqual(group.scores.find(score=>score.side==='no').voters,[{name:'Other',up:1,down:0}]);
    assert.doesNotMatch(JSON.stringify(group),/private-|Previous voter/);
    assert.equal((await mf.dispatchFetch('http://runtime.test/api/group')).status,401);
  }finally{await mf.dispose();}
});
