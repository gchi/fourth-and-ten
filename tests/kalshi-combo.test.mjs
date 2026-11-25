import test from 'node:test';
import assert from 'node:assert/strict';
import { constants, generateKeyPairSync, verify } from 'node:crypto';
import { comboCredentials, comboConnection, signedHeaders, collectionAllows, verifyComboMarket, prepareCombo } from '../lib/kalshi-combo.ts';
import { verifiedSelectionLink, ticketText } from '../lib/parlay-handoff.ts';

const keys = generateKeyPairSync('ed25519');
const secrets = { KALSHI_API_KEY_ID: 'test-key', KALSHI_PRIVATE_KEY_PEM: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }) };
const credentials = comboCredentials(secrets);
const ticket = { version: 'version-one', round: 'round-one', locked: true, budget: 1000, targetLegs: 2, groupName: 'Thursday', legs: [
  { key: 'A:yes', ticker: 'A', event: 'E1', side: 'yes', title: 'A wins', condition: 'A wins' },
  { key: 'B:no', ticker: 'B', event: 'E2', side: 'no', title: 'B wins', condition: 'B does not win' },
] };
const collection = { collection_ticker: 'COMBO-R', open_date: '2020-01-01T00:00:00Z', close_date: '2099-01-01T00:00:00Z', is_ordered: false, size_min: 2, size_max: 0,
  associated_events: [{ ticker: 'E1', is_yes_only: false, size_max: 1 }, { ticker: 'E2', is_yes_only: false, size_max: 1 }] };
const market = { ticker: 'COMBO-AB', event_ticker: 'COMBO-EVENT', market_type: 'binary', status: 'active', close_time: '2099-01-01T00:00:00Z',
  mve_selected_legs: ticket.legs.map(leg => ({ event_ticker: leg.event, market_ticker: leg.ticker, side: leg.side })) };
const buyLink = 'https://kalshi.com/markets/combo/example?marketTicker=COMBO-AB&orderSide=yes&op_side=BUY';
const json = (data, status = 200) => Response.json(data, { status });

function harness(overrides = {}) {
  const calls = [];
  const options = { version: ticket.version, getTicket: async () => ticket, getCredentials: () => credentials,
    getLink: async (ticker, side) => { calls.push({ link: ticker, side }); return buyLink; },
    fetcher: async (input, init) => {
      const url = new URL(input); calls.push({ url, init });
      assert.equal(url.origin, 'https://external-api.kalshi.com');
      assert.equal(init.redirect, 'manual');
      if (url.pathname.endsWith('/multivariate_event_collections')) return json({ multivariate_contracts: [collection] });
      if (url.pathname.endsWith('/multivariate_event_collections/COMBO-R')) return json({ market_ticker: market.ticker, event_ticker: market.event_ticker });
      if (url.pathname.endsWith('/markets/COMBO-AB')) return json({ market });
      assert.fail(`Unexpected request, including any trading endpoint: ${url}`);
    }, ...overrides };
  return { options, calls };
}

test('Ed25519 and RSA-PSS signatures verify against the official timestamp/method/path format', () => {
  for (const type of ['ed25519', 'rsa']) {
    const pair = type === 'rsa' ? generateKeyPairSync('rsa', { modulusLength: 2048 }) : keys;
    const formats = type === 'rsa' ? ['pkcs1', 'pkcs8'] : ['pkcs8'];
    for (const format of formats) {
      const creds = comboCredentials({ KALSHI_API_KEY_ID: 'test-key', KALSHI_PRIVATE_KEY_PEM: pair.privateKey.export({ type: format, format: 'pem' }).replaceAll('\n', '\\n') });
      const headers = signedHeaders(creds, 'post', '/trade-api/v2/multivariate_event_collections/COMBO-R?ignored=1', '1234567890000');
      const data = Buffer.from('1234567890000POST/trade-api/v2/multivariate_event_collections/COMBO-R');
      assert.ok(verify(type === 'rsa' ? 'sha256' : null, data,
        type === 'rsa' ? { key: pair.publicKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 } : pair.publicKey,
        Buffer.from(headers['KALSHI-ACCESS-SIGNATURE'], 'base64')));
    }
  }
});

test('connection status distinguishes missing/invalid/configured keys without exposing secrets', () => {
  assert.equal(comboConnection({}).code, 'setup_required');
  assert.equal(comboConnection({ ...secrets, KALSHI_PRIVATE_KEY_PEM: 'private-secret-marker' }).code, 'invalid_configuration');
  const status = comboConnection(secrets);
  assert.equal(status.configured, true);
  assert.ok(!JSON.stringify(status).includes('PRIVATE KEY'));
  assert.ok(!JSON.stringify(status).includes('test-key'));
  const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  assert.throws(() => comboCredentials({ ...secrets, KALSHI_PRIVATE_KEY_PEM: ec.privateKey.export({ type: 'pkcs8', format: 'pem' }) }), { code: 'invalid_configuration' });
});

test('eligibility preserves NO picks, event membership, collection size and per-event requirements', () => {
  assert.equal(collectionAllows(collection, ticket), true); // zero means no collection maximum in the live API
  for (const change of [
    { size_max: 1 }, { size_min: 3 }, { is_ordered: true }, { close_date: '2000-01-01' },
    { associated_events: [collection.associated_events[0]] },
    { associated_events: [collection.associated_events[0], { ...collection.associated_events[1], is_yes_only: true }] },
    { associated_events: [...collection.associated_events, { ticker: 'E3', is_yes_only: false, size_min: 1 }] },
  ]) assert.equal(collectionAllows({ ...collection, ...change }, ticket), false, JSON.stringify(change));
  assert.equal(collectionAllows(collection, { ...ticket, legs: [ticket.legs[0], { ...ticket.legs[1], event: 'E1' }] }), false);
});

test('whole-combo flow sends the exact locked sides, verifies returned legs, and requests YES on the combo without an order', async () => {
  const { options, calls } = harness();
  const result = await prepareCombo(options);
  const writes = calls.filter(call => call.init?.method === 'POST');
  assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(writes[0].init.body), { selected_markets: market.mve_selected_legs, with_market_payload: true });
  assert.deepEqual(calls.at(-1), { link: 'COMBO-AB', side: 'yes' });
  assert.equal(result.url, buyLink); assert.equal(result.legCount, 2); assert.equal(result.version, ticket.version);
  assert.ok(result.expiresAt > result.preparedAt && result.expiresAt - result.preparedAt <= 120000);
  assert.ok(verify(null, Buffer.from(writes[0].init.headers['KALSHI-ACCESS-TIMESTAMP'] + 'POST' + writes[0].url.pathname), keys.publicKey,
    Buffer.from(writes[0].init.headers['KALSHI-ACCESS-SIGNATURE'], 'base64')));
});

test('unauthenticated, stale, draft, duplicate and unconfigured requests stop before any external request', async () => {
  for (const override of [
    { getTicket: async () => { throw new Error('Sign in required'); } },
    { version: 'old' }, { getTicket: async () => ({ ...ticket, locked: false }) },
    { getTicket: async () => ({ ...ticket, legs: [ticket.legs[0], ticket.legs[0]] }) },
    { getCredentials: () => comboCredentials({}) },
  ]) {
    const { options, calls } = harness(override);
    await assert.rejects(prepareCombo(options)); assert.equal(calls.length, 0);
  }
});

test('a changed ticket is rejected before creation, before linking, and after the link resolves', async () => {
  for (const changeAt of [2, 3, 4]) {
    let reads = 0;
    const { options, calls } = harness({ getTicket: async () => ++reads >= changeAt ? { ...ticket, version: 'new-round' } : ticket });
    await assert.rejects(prepareCombo(options), { code: 'ticket_changed' });
    if (changeAt === 2) assert.ok(!calls.some(c => c.init?.method === 'POST'));
    if (changeAt <= 3) assert.ok(!calls.some(c => c.link));
  }
});

test('a combo must be open and contain precisely the expected events, markets and sides', () => {
  verifyComboMarket({ ...market, mve_selected_legs: [...market.mve_selected_legs].reverse() }, market.ticker, market.event_ticker, ticket);
  for (const change of [
    { status: 'closed' }, { close_time: '2000-01-01' }, { market_type: 'scalar' }, { ticker: 'OTHER' },
    { mve_selected_legs: [market.mve_selected_legs[0]] },
    { mve_selected_legs: [market.mve_selected_legs[0], { ...market.mve_selected_legs[1], side: 'yes' }] },
    { mve_selected_legs: [market.mve_selected_legs[0], { ...market.mve_selected_legs[1], event_ticker: 'OTHER' }] },
  ]) assert.throws(() => verifyComboMarket({ ...market, ...change }, market.ticker, market.event_ticker, ticket));
});

test('ineligible selections fail before any write; eligibility pagination is followed', async () => {
  const noMatch = harness({ fetcher: async () => json({ multivariate_contracts: [] }) });
  await assert.rejects(prepareCombo(noMatch.options), { code: 'ineligible_combo' });
  const { options, calls } = harness(); const original = options.fetcher; let pages = 0;
  options.fetcher = async (url, init) => {
    if (new URL(url).pathname.endsWith('/multivariate_event_collections') && pages++ === 0) return json({ multivariate_contracts: [], cursor: 'page-two' });
    if (new URL(url).pathname.endsWith('/multivariate_event_collections')) assert.equal(new URL(url).searchParams.get('cursor'), 'page-two');
    return original(url, init);
  };
  assert.equal((await prepareCombo(options)).ticker, market.ticker);
  assert.equal(pages, 2); assert.ok(calls.some(c => c.link));
});

test('authentication, rate limit and conflict failures are actionable and redact upstream bodies', async () => {
  for (const [status, code, expected] of [[401, 'bad_key', 'connection_rejected'], [403, 'insufficient_scope', 'connection_rejected'], [429, 'too_many_requests', 'rate_limited'], [400, 'conflicting_leg_outcomes', 'conflicting_leg_outcomes'], [500, 'internal', 'kalshi_unavailable']]) {
    const { options, calls } = harness(); const original = options.fetcher;
    options.fetcher = (url, init) => init?.method === 'POST' ? Promise.resolve(json({ error: { code, message: 'PRIVATE-SECRET-MARKER' } }, status)) : original(url, init);
    await assert.rejects(prepareCombo(options), error => error.code === expected && !error.message.includes('PRIVATE-SECRET-MARKER'));
    assert.ok(!calls.some(c => c.link));
  }
});

test('mismatched returned legs never produce a link and failed link lookup never produces a handoff', async () => {
  const { options, calls } = harness(); const original = options.fetcher;
  options.fetcher = (url, init) => url.includes('/markets/COMBO-AB') ? Promise.resolve(json({ market: { ...market, mve_selected_legs: [market.mve_selected_legs[0], market.mve_selected_legs[0]] } })) : original(url, init);
  await assert.rejects(prepareCombo(options), { code: 'combo_mismatch' }); assert.ok(!calls.some(c => c.link));
  await assert.rejects(prepareCombo(harness({ getLink: async () => { throw new Error('link unavailable'); } }).options), { code: 'link_unavailable' });
});

test('all link parameters must agree on exact market, YES side and buy direction', () => {
  const data = { side: 'yes', buy_url: buyLink };
  assert.equal(verifiedSelectionLink(data, 'COMBO-AB', 'yes'), buyLink);
  for (const extra of ['&op_market_ticker=OTHER', '&op_order_side=no', '&orderSide=no', '&marketTicker=OTHER', '&op_side=SELL']) {
    assert.throws(() => verifiedSelectionLink({ ...data, buy_url: buyLink + extra }, 'COMBO-AB', 'yes'));
  }
  assert.throws(() => verifiedSelectionLink({ ...data, side: 'no' }, 'COMBO-AB', 'yes'));
});

test('copied ticket includes only a matching, unexpired prepared combo and never claims a purchase', async () => {
  const { options } = harness(); const result = await prepareCombo(options);
  assert.ok(ticketText(ticket, result).includes(buyLink));
  assert.match(ticketText(ticket, result), /stake there; it is not prefilled/);
  assert.match(ticketText(ticket, result), /NO ORDER HAS BEEN PLACED/);
  assert.ok(!ticketText(ticket, { ...result, version: 'old' }).includes(buyLink));
  assert.ok(!ticketText(ticket, { ...result, expiresAt: 0 }).includes(buyLink));
});


test('a fresh creation payload is verified without depending on the delayed public index', async () => {
  const { options, calls } = harness(); const original = options.fetcher;
  options.fetcher = (url, init) => {
    if (init?.method === 'POST') return Promise.resolve(json({ market_ticker: market.ticker, event_ticker: market.event_ticker, market }));
    assert.ok(!url.includes('/markets/'), 'Do not require a redundant public market read');
    return original(url, init);
  };
  const result = await prepareCombo(options);
  assert.equal(result.ticker, market.ticker);
  assert.equal(result.url, buyLink);
  assert.ok(calls.some(call => call.link));
});

test('invalid supplied creation payloads cannot be replaced by a different public response', async () => {
  for (const invalid of [
    { ...market, mve_selected_legs: [market.mve_selected_legs[0], { ...market.mve_selected_legs[1], side: 'yes' }] },
    { ...market, ticker: 'OTHER' }, { ...market, status: 'closed' }, { ...market, close_time: '2000-01-01' }, {},
  ]) {
    const { options, calls } = harness(); const original = options.fetcher;
    options.fetcher = (url, init) => {
      if (init?.method === 'POST') return Promise.resolve(json({ market_ticker: market.ticker, event_ticker: market.event_ticker, market: invalid }));
      assert.ok(!url.includes('/markets/'));
      return original(url, init);
    };
    await assert.rejects(prepareCombo(options), error => ['combo_mismatch', 'combo_unverified'].includes(error.code));
    assert.ok(!calls.some(call => call.link));
  }
});

test('missing creation payload tolerates temporary 404s without repeating the signed request', async () => {
  const { options, calls } = harness(); const original = options.fetcher; let reads = 0;
  options.fetcher = (url, init) => {
    if (url.includes('/markets/') && ++reads < 3) return Promise.resolve(json({ error: { code: 'not_found' } }, 404));
    return original(url, init);
  };
  assert.equal((await prepareCombo(options)).url, buyLink);
  assert.equal(reads, 3);
  assert.equal(calls.filter(call => call.init?.method === 'POST').length, 1);
});

test('persistent indexing delay is bounded, actionable, and never returns a link', async () => {
  const { options, calls } = harness(); const original = options.fetcher; let reads = 0;
  options.fetcher = (url, init) => {
    if (url.includes('/markets/')) { reads++; return Promise.resolve(json({ error: { code: 'not_found', message: 'PRIVATE-SECRET-MARKER' } }, 404)); }
    return original(url, init);
  };
  await assert.rejects(prepareCombo(options), error => error.code === 'combo_pending' && error.upstreamStatus === 404 && !error.message.includes('PRIVATE-SECRET-MARKER'));
  assert.equal(reads, 4);
  assert.equal(calls.filter(call => call.init?.method === 'POST').length, 1);
  assert.ok(!calls.some(call => call.link));
});

test('non-404 and malformed verification responses fail without retrying or weakening validation', async () => {
  for (const [status, body, code] of [[429, {code:'too_many_requests'}, 'rate_limited'], [500, {}, 'kalshi_unavailable'], [200, {}, 'combo_unverified']]) {
    const { options, calls } = harness(); const original = options.fetcher; let reads = 0;
    options.fetcher = (url, init) => {
      if (url.includes('/markets/')) { reads++; return Promise.resolve(json(body, status)); }
      return original(url, init);
    };
    await assert.rejects(prepareCombo(options), { code });
    assert.equal(reads, 1); assert.ok(!calls.some(call => call.link));
  }
});


test('a verified combo with a pending official link produces a retryable availability response', async () => {
  const {options}=harness({getLink:async(ticker,side,signal)=>{
    assert.equal(ticker,market.ticker);assert.equal(side,'yes');assert.ok(signal instanceof AbortSignal);
    const error=new Error('Upstream private marker');error.code='link_pending';throw error;
  }});
  await assert.rejects(prepareCombo(options),error=>error.code==='link_pending'&&error.status===503&&error.upstreamStatus===404&&!error.message.includes('private marker'));
});


test('known overlap stops a locked ticket before credentials, creation, or link lookup',async()=>{
  let credentialReads=0;
  const conflict={kind:'redundant',keys:['A:yes','B:no'],labels:['Same stat 175+ — YES','Same stat 225+ — YES'],explanation:'Keep one of these picks.'};
  const {options,calls}=harness({getTicket:async()=>({...ticket,conflicts:[conflict]}),getCredentials:()=>{credentialReads++;return credentials;}});
  await assert.rejects(prepareCombo(options),e=>e.code==='overlapping_picks'&&e.status===409&&e.message.includes('175+')&&e.message.includes('225+'));
  assert.equal(credentialReads,0);assert.equal(calls.length,0);
});
