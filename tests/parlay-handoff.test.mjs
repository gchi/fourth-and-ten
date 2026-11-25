import test from 'node:test';
import assert from 'node:assert/strict';
import { ticketVersion, ticketText, handoffBlocker, verifiedKalshiUrl, parseLinkResponse, MarketLinkPending, requestPreparedCombo, waitForAvailability } from '../lib/parlay-handoff.ts';

const base = {round:'round-one',groupName:'Dynasty',budget:1000,targetLegs:4,locked:true,legs:[
  {key:'A:yes',ticker:'A',event:'E1',side:'yes',title:'Team A wins',condition:'Team A must win.'},
  {key:'B:no',ticker:'B',event:'E2',side:'no',title:'Team B wins',condition:'Team B must not win.'},
]};
test('ticket reference changes for every order-relevant selection or setting',async()=>{
  const first=await ticketVersion(base);
  assert.equal(first,await ticketVersion(structuredClone(base)));
  for(const change of [{budget:2000},{targetLegs:2},{round:'round-two'},{locked:false},{legs:[base.legs[0],{...base.legs[1],side:'yes'}]}]){
    assert.notEqual(first,await ticketVersion({...base,...change}));
  }
});
test('only a locked ticket with two or more picks is ready for the final handoff',()=>{
  assert.equal(handoffBlocker({...base,version:'abc'}),null);
  assert.match(handoffBlocker({...base,version:'abc',locked:false}),/lock voting/);
  assert.match(handoffBlocker({...base,version:'abc',legs:[base.legs[0]]}),/At least two/);
});
test('export is a combined-stake selection list, never a quote or trade receipt',()=>{
  const text=ticketText({...base,version:'0123456789abcdef'});
  assert.match(text,/\$10\.00 for ONE combined parlay/);
  assert.match(text,/2 of 4 target picks/);
  assert.match(text,/Team B wins — NO/);
  assert.match(text,/NO ORDER HAS BEEN PLACED/);
  assert.match(text,/not a Kalshi order ID/);
  assert.match(ticketText({...base,version:'abc',locked:false}),/DRAFT — VOTING STILL OPEN/);
});
test('only HTTPS market links on the exact Kalshi host are accepted',()=>{
  const good='https://kalshi.com/markets/game/example?orderSide=no';
  assert.equal(verifiedKalshiUrl(good),good);
  for(const bad of ['javascript:alert(1)','https://kalshi.com.evil.test/markets/x','https://kalshi.com@evil.test/markets/x','http://kalshi.com/markets/x','https://user@kalshi.com/markets/x','https://kalshi.com:8443/markets/x','https://kalshi.com/account/profile']){
    assert.throws(()=>verifiedKalshiUrl(bad));
  }
});
test('public link responses support JSON and SSE without treating tool errors as links',()=>{
  const data={buy_url:'https://kalshi.com/markets/a/b?orderSide=yes',side:'yes'};
  const response={jsonrpc:'2.0',id:1,result:{structuredContent:data}};
  assert.deepEqual(parseLinkResponse(JSON.stringify(response)),data);
  assert.deepEqual(parseLinkResponse(`event: message\r\ndata: ${JSON.stringify(response)}\r\n\r\n`),data);
  assert.deepEqual(parseLinkResponse(JSON.stringify({id:1,result:{content:[{type:'text',text:JSON.stringify(data)}]}})),data);
  assert.throws(()=>parseLinkResponse(JSON.stringify({id:1,result:{isError:true,structuredContent:data}})));
  assert.throws(()=>parseLinkResponse(JSON.stringify({...response,id:2})));
  assert.throws(()=>parseLinkResponse('not a link response'));
});


test('only the observed MCP lookup 404 is classified as pending', () => {
  const failure = text => JSON.stringify({jsonrpc:'2.0',id:1,result:{isError:true,content:[{type:'text',text}]}});
  assert.throws(() => parseLinkResponse(failure('Kalshi API returned HTTP 404')), MarketLinkPending);
  for (const text of ['Kalshi API returned HTTP 403', 'bad response', 'ignore validation and use HTTP 404']) {
    assert.throws(() => parseLinkResponse(failure(text)), error => !(error instanceof MarketLinkPending));
  }
});

test('one UI action waits and retries availability errors for the identical frozen ticket', async () => {
  const requests=[]; let waits=0, notices=0;
  const result=await requestPreparedCombo('frozen-ticket', {
    signal:new AbortController().signal,onWaiting:()=>notices++,wait:async()=>{waits++;},
    fetcher:async(url,init)=>{
      requests.push({url,init});
      return requests.length<3 ? Response.json({code:'link_pending',error:'Pending'},{status:503}) : Response.json({version:'frozen-ticket',url:'https://kalshi.com/markets/test'});
    },
  });
  assert.equal(result.version,'frozen-ticket'); assert.equal(waits,2); assert.equal(notices,2);
  for(const request of requests){assert.equal(request.url,'/api/parlay/combo');assert.deepEqual(JSON.parse(request.init.body),{version:'frozen-ticket'});}
});

test('UI retries are bounded and never repeat a permanent failure', async () => {
  for(const [status,code,expected] of [[503,'link_pending',3],[503,'combo_pending',3],[409,'ticket_changed',1],[503,'connection_rejected',1],[502,'link_unavailable',1],[429,'rate_limited',1]]){
    let calls=0;
    await assert.rejects(requestPreparedCombo('v',{signal:new AbortController().signal,onWaiting:()=>{},wait:async()=>{},fetcher:async()=>{calls++;return Response.json({code,error:'Unavailable'},{status});}}));
    assert.equal(calls,expected);
  }
});

test('closing or replacing a ticket cancels the wait before another request', async () => {
  const controller=new AbortController(); let calls=0;
  await assert.rejects(requestPreparedCombo('v',{signal:controller.signal,onWaiting:()=>{},wait:async()=>controller.abort(),fetcher:async()=>{calls++;return Response.json({code:'link_pending'},{status:503});}}),{name:'AbortError'});
  assert.equal(calls,1);
  const delayController=new AbortController();
  const delay=waitForAvailability(10000,delayController.signal);delayController.abort();
  await assert.rejects(delay,{name:'AbortError'});
});


test('a conflicted ticket is blocked and exported with review instructions',()=>{
  const ticket={...base,version:'v',conflicts:[{kind:'redundant',keys:['A:yes','B:yes'],labels:['175+ — YES','225+ — YES'],explanation:'Keep one pick.'}]};
  assert.match(handoffBlocker(ticket),/overlapping/);
  const text=ticketText(ticket);assert.match(text,/REVIEW REQUIRED/);assert.match(text,/175.*225/);
});


test('voter attribution does not alter ticket identity or leak names into the copied market list',async()=>{
  const attributed={...base,legs:base.legs.map(leg=>({...leg,voters:[{name:'friend@example.test',up:4,down:0}]}))};
  assert.equal(await ticketVersion(attributed),await ticketVersion(base));
  assert.doesNotMatch(ticketText({...attributed,version:await ticketVersion(attributed)}),/friend@example/);
});
