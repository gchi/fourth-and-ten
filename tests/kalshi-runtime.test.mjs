import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateKeyPairSync, verify } from 'node:crypto';
import { Miniflare, convertV4MiniflareOptions, Response as WorkerResponse } from 'miniflare';
import ts from 'typescript';

// Run the actual server modules inside workerd. Node's fetch accepts options
// (notably redirect: "error") that production Workers rejects before network I/O.
const root = resolve('work/runtime-test');
function moduleFor(file) {
  const code = ts.transpileModule(readFileSync(`lib/${file}.ts`, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText.replace('from "./parlay-handoff"', 'from "./parlay-handoff.js"');
  return { type: 'ESModule', path: resolve(root, `${file}.js`), contents: code };
}
const ticket = { version: 'runtime-test', round: 'runtime-test', locked: true, budget: 1000, targetLegs: 2, legs: [
  { ticker: 'A', event: 'E1', side: 'yes' }, { ticker: 'B', event: 'E2', side: 'no' },
] };
const collection = { collection_ticker: 'COMBO-R', open_date: '2020-01-01T00:00:00Z', close_date: '2099-01-01T00:00:00Z', is_ordered: false, size_min: 2, size_max: 0,
  associated_events: [{ ticker: 'E1', is_yes_only: false, size_max: 1 }, { ticker: 'E2', is_yes_only: false, size_max: 1 }] };
const market = { ticker: 'COMBO-AB', event_ticker: 'COMBO-EVENT', market_type: 'binary', status: 'active', close_time: '2099-01-01T00:00:00Z',
  mve_selected_legs: ticket.legs.map(leg => ({ event_ticker: leg.event, market_ticker: leg.ticker, side: leg.side })) };
const url = 'https://kalshi.com/markets/combo/example?marketTicker=COMBO-AB&orderSide=yes&op_side=BUY';
const entry = `import {prepareCombo,comboCredentials} from './kalshi-combo.js';
import {selectionLink} from './kalshi-links.js';
export default {async fetch(request,env){let stage='ticket';try{
 const result=await prepareCombo({version:'runtime-test',getTicket:async()=>JSON.parse(env.TICKET),
  getCredentials:()=>comboCredentials({KALSHI_API_KEY_ID:'runtime-key',KALSHI_PRIVATE_KEY_PEM:env.TEST_KEY}),
  getLink:selectionLink,onStage:next=>stage=next});
 return Response.json(result);
}catch(e){return Response.json({error:e.message,code:e.code,stage},{status:e.status??500});}}};`;

test('Cloudflare runtime prepares exact mixed-side combo and rejects redirects without forwarding credentials', async t => {
  const pair = generateKeyPairSync('ed25519');
  const key = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  let mode = '', calls = [], marketReads = 0, linkReads = 0;
  const createWorker = () => new Miniflare(convertV4MiniflareOptions({ modulesRoot: root, modules: [
    { type: 'ESModule', path: resolve(root, 'worker.js'), contents: entry },
    ...['kalshi-combo', 'kalshi-links', 'parlay-handoff'].map(moduleFor),
  ], compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'],
  bindings: { TICKET: JSON.stringify(ticket), TEST_KEY: key }, inspectorPort: 0,
  outboundService: async request => {
    const parsed = new URL(request.url); calls.push(parsed.href);
    assert.ok(['external-api.kalshi.com', 'api.elections.kalshi.com'].includes(parsed.hostname), 'Never follow an upstream redirect');
    if (parsed.pathname === '/trade-api/v2/multivariate_event_collections') {
      assert.equal(request.headers.has('KALSHI-ACCESS-KEY'), false);
      if (mode === 'eligibility') return new WorkerResponse(null, { status: 302, headers: { Location: 'https://untrusted.example/' } });
      return WorkerResponse.json({ multivariate_contracts: [collection] });
    }
    if (parsed.pathname === '/trade-api/v2/multivariate_event_collections/COMBO-R') {
      assert.equal(request.method, 'POST'); assert.equal(request.headers.get('KALSHI-ACCESS-KEY'), 'runtime-key');
      assert.ok(verify(null, Buffer.from(request.headers.get('KALSHI-ACCESS-TIMESTAMP') + 'POST' + parsed.pathname), pair.publicKey,
        Buffer.from(request.headers.get('KALSHI-ACCESS-SIGNATURE'), 'base64')));
      assert.deepEqual(await request.json(), { selected_markets: market.mve_selected_legs, with_market_payload: true });
      if (mode === 'creation') return new WorkerResponse(null, { status: 307, headers: { Location: 'https://untrusted.example/' } });
      return WorkerResponse.json({ market_ticker: market.ticker, event_ticker: market.event_ticker, ...(mode === 'payload' ? { market } : {}) });
    }
    if (parsed.pathname === '/trade-api/v2/markets/COMBO-AB') {
      assert.notEqual(mode, 'payload', 'The creation payload avoids a redundant public lookup');
      if (mode === 'indexing_lag' && ++marketReads < 3) return WorkerResponse.json({ error: { code: 'not_found' } }, { status: 404 });
      return WorkerResponse.json({ market });
    }
    if (parsed.pathname === '/mcp') {
      assert.equal(request.headers.has('KALSHI-ACCESS-KEY'), false);
      assert.deepEqual((await request.json()).params, { name: 'get_market_links', arguments: { market_ticker: 'COMBO-AB', side: 'yes' } });
      if (mode === 'link') return new WorkerResponse(null, { status: 301, headers: { Location: 'https://untrusted.example/' } });
      linkReads++;
      if (mode === 'link_pending' || (mode === 'link_lag' && linkReads < 3)) return WorkerResponse.json({jsonrpc:'2.0',id:1,result:{isError:true,content:[{type:'text',text:'Kalshi API returned HTTP 404'}]}});
      if (mode === 'bad_link') return WorkerResponse.json({jsonrpc:'2.0',id:1,result:{structuredContent:{side:'no',buy_url:url}}});
      return WorkerResponse.json({ jsonrpc: '2.0', id: 1, result: { structuredContent: { side: 'yes', buy_url: url } } });
    }
    assert.fail(`Unexpected endpoint, including any order or RFQ: ${parsed.pathname}`);
  } }));
  // A fresh isolate per scenario also exercises uncached official link lookup.
  for (const scenario of ['eligibility', 'creation', 'link', 'success', 'payload', 'indexing_lag', 'link_lag', 'link_pending', 'bad_link']) await t.test(scenario, async () => {
    mode = scenario; calls = []; marketReads = 0; linkReads = 0;
    const mf = createWorker();
    try {
      const response = await mf.dispatchFetch('http://runtime.test/'); const data = await response.json();
      if (['success', 'payload', 'indexing_lag', 'link_lag'].includes(scenario)) {
        assert.equal(response.status, 200, JSON.stringify(data)); assert.equal(data.url, url); assert.equal(data.legCount, 2);
        assert.equal(calls.length, scenario === 'payload' ? 3 : ['indexing_lag', 'link_lag'].includes(scenario) ? 6 : 4);
        assert.equal(calls.filter(url => url.endsWith('/multivariate_event_collections/COMBO-R')).length, 1);
      } else {
        assert.equal(response.status, scenario === 'link_pending' ? 503 : 502, JSON.stringify(data)); assert.equal(data.stage, ['link_pending', 'bad_link'].includes(scenario) ? 'link' : scenario);
        assert.equal(data.code, scenario === 'link_pending' ? 'link_pending' : ['link', 'bad_link'].includes(scenario) ? 'link_unavailable' : 'unexpected_redirect');
        assert.equal(calls.length, scenario === 'eligibility' ? 1 : scenario === 'creation' ? 2 : scenario === 'link_pending' ? 8 : 4);
      }
    } finally { await mf.dispose(); }
  });
});
