import assert from 'node:assert/strict';
const base = process.env.TEST_URL || 'http://127.0.0.1:5173';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Local test database only.');
const headers = { 'Content-Type': 'application/json', Cookie: '__sites_local_auth=1', Origin: base };
async function call(path, method = 'GET', body, extra = {}) {
  const response = await fetch(base + path, { method, headers: { ...headers, ...extra }, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = { error: text }; }
  return { status: response.status, data };
}
for (const [path, method] of [['/api/parlay/connection', 'GET'], ['/api/parlay/combo', 'POST']]) {
  assert.equal((await call(path, method, method === 'POST' ? { version: 'unknown' } : undefined, { Cookie: '' })).status, 401);
}
const connection = await call('/api/parlay/connection');
assert.equal(connection.status, 200);
assert.equal(connection.data.code, 'setup_required', 'This smoke test requires NO configured API key; it never sends a signed live request.');
assert.deepEqual(Object.keys(connection.data).sort(), ['code', 'configured', 'message']);
let group = (await call('/api/group')).data;
assert.equal(group.votes.length, 0, 'Use a fresh local round so local votes are not overwritten.');
const original = { name: group.group.name, budget: group.group.budget, topN: group.group.topN };
let voted = false;
try {
  if (group.locked) group = (await call('/api/group', 'PATCH', { action: 'new-round' })).data;
  const feed = await call('/api/markets?series=KXNFLGAME'); assert.equal(feed.status, 200);
  const events = new Set();
  const markets = feed.data.markets.filter(m => { if (events.has(m.event)) return false; events.add(m.event); return true; }).slice(0, 2);
  assert.equal(markets.length, 2);
  for (const [index, market] of markets.entries()) {
    const result = await call('/api/vote', 'POST', { ticker: market.ticker, side: index ? 'no' : 'yes', direction: 1, action: 'add', revision: group.revision, round: group.group.round });
    assert.equal(result.status, 200); group = result.data; voted = true;
  }
  const draft = (await call('/api/parlay')).data;
  assert.equal((await call('/api/parlay/combo', 'POST', { version: draft.version })).data.code, 'voting_open');
  assert.equal((await call('/api/group', 'PATCH', { action: 'lock' })).status, 200);
  const final = (await call('/api/parlay')).data;
  assert.equal((await call('/api/parlay/combo', 'POST', { version: draft.version })).status, 409);
  assert.equal((await call('/api/parlay/combo', 'POST', { version: final.version, legs: [] })).status, 409);
  assert.equal((await call('/api/parlay/combo', 'POST', { version: final.version }, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await call('/api/parlay/combo', 'POST', { version: final.version }, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  const missing = await call('/api/parlay/combo', 'POST', { version: final.version });
  assert.equal(missing.status, 503); assert.equal(missing.data.code, 'setup_required');
  await call('/api/group', 'PATCH', { action: 'new-round' }); voted = false;
  assert.equal((await call('/api/parlay/combo', 'POST', { version: final.version })).status, 409);
  console.log('Combo API passed: authenticated status, draft/stale/client-leg/origin rejection, missing-secret state, new-round invalidation. No signed Kalshi requests or trades.');
} finally {
  if (voted) { await call('/api/group', 'PATCH', { action: 'lock' }); await call('/api/group', 'PATCH', { action: 'new-round' }); }
  const current = (await call('/api/group')).data;
  await call('/api/group', 'PATCH', { ...original });
}
