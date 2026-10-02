'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize, fetchVehicles } = require('../lib/warsaw');
const { vehiclesHandler } = require('../lib/handler');

const NOW = Date.parse('2026-10-01T12:00:30+02:00');
const row = (o = {}) => ({ Lines: '175', Lon: 21.0, Lat: 52.2, VehicleNumber: '1234', Brigade: '3', Time: '2026-10-01 12:00:00', ...o });

test('normalize maps fields', () => {
  const [v] = normalize([row()], 1, NOW);
  assert.deepEqual({ ...v, time: undefined }, { id: '1-1234', type: 'bus', line: '175', vehicle: '1234', brigade: '3', lat: 52.2, lon: 21.0, time: undefined });
  assert.equal(v.time, Date.parse('2026-10-01T12:00:00+02:00'));
});
test('normalize drops stale, invalid and out-of-area vehicles', () => {
  const out = normalize([row({ Time: '2026-10-01 11:00:00' }), row({ Lat: 'x' }), row({ Lat: 0, Lon: 0 }), row({ VehicleNumber: '9' })], 2, NOW);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'tram');
});
const fakeFetch = (bodyFor) => async (url) => {
  const type = new URL(url).searchParams.get('type');
  const b = bodyFor(type, url);
  return { ok: true, status: 200, json: async () => b };
};
test('fetchVehicles merges bus and tram', async () => {
  const now = new Date(); const t = new Date(now.getTime() + 2 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
  const f = fakeFetch((type) => ({ result: [row({ VehicleNumber: 't' + type, Time: t })] }));
  const { vehicles, errors } = await fetchVehicles({ apiKey: 'k', fetchImpl: f });
  assert.equal(errors.length, 0);
  assert.deepEqual(vehicles.map((v) => v.type).sort(), ['bus', 'tram']);
});
test('API error string (bad key) is surfaced', async () => {
  const f = fakeFetch(() => ({ result: 'false', error: 'Błędny apikey' }));
  await assert.rejects(fetchVehicles({ apiKey: 'bad', fetchImpl: f }), /false|Błędny/);
});
test('partial failure keeps working type', async () => {
  const t = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
  const f = async (url) => {
    if (new URL(url).searchParams.get('type') === '2') throw new Error('boom');
    return { ok: true, json: async () => ({ result: [row({ Time: t })] }) };
  };
  const r = await fetchVehicles({ apiKey: 'k', fetchImpl: f });
  assert.equal(r.vehicles.length, 1); assert.equal(r.errors.length, 1);
});
test('missing key throws', async () => { await assert.rejects(fetchVehicles({ apiKey: '' }), /Missing/); });

function call(url, opts) {
  return new Promise((resolve) => {
    const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, end(b) { resolve({ status: this.statusCode, body: JSON.parse(b), headers: this.headers }); } };
    vehiclesHandler({ url }, res, opts);
  });
}
test('handler: mock mode and type filter', async () => {
  const r = await call('/api/vehicles?types=2', { env: { MOCK: '1' } });
  assert.equal(r.status, 200); assert.equal(r.body.source, 'mock');
  assert.ok(r.body.vehicles.length > 0 && r.body.vehicles.every((v) => v.type === 'tram'));
  assert.match(r.headers['Cache-Control'], /s-maxage/);
});
test('handler: 502 without key, never leaks key', async () => {
  const r = await call('/api/vehicles', { env: {} });
  assert.equal(r.status, 502);
  const r2 = await call('/api/vehicles', { env: { WARSAW_API_KEY: 'SECRETKEY' }, fetchImpl: async () => { throw new Error('down'); } });
  assert.equal(r2.status, 502); assert.ok(!JSON.stringify(r2.body).includes('SECRETKEY'));
});

test('retries once on timeout, but not on bad key', async () => {
  const t = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
  let calls = 0;
  const flaky = async () => { if (++calls === 1) throw new Error('The operation was aborted due to timeout'); return { ok: true, json: async () => ({ result: [row({ Time: t })] }) }; };
  const r = await fetchVehicles({ apiKey: 'k', types: [1], fetchImpl: flaky });
  assert.equal(r.vehicles.length, 1); assert.equal(calls, 2);
  let bad = 0;
  const badKey = async () => { bad++; return { ok: true, json: async () => ({ result: 'false', error: 'Błędny apikey lub jego brak' }) }; };
  await assert.rejects(fetchVehicles({ apiKey: 'x', types: [1], fetchImpl: badKey }));
  assert.equal(bad, 1);
});

test('network errors expose the underlying cause', async () => {
  const f = async () => { const e = new TypeError('fetch failed'); e.cause = { code: 'ECONNRESET' }; throw e; };
  await assert.rejects(fetchVehicles({ apiKey: 'k', types: [1], fetchImpl: f }), /fetch failed \(ECONNRESET\)/);
});

test('upstream relay: no API key on Vercel side, secret header sent', async () => {
  const t = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
  const seen = [];
  const f = async (url, opts) => { seen.push({ url, h: opts.headers }); return { ok: true, json: async () => ({ result: [row({ Time: t })] }) }; };
  const r = await fetchVehicles({ types: [1, 2], fetchImpl: f, upstream: { url: 'https://w.example.workers.dev', secret: 's3' } });
  assert.equal(r.vehicles.length, 2);
  assert.ok(seen.every((c) => c.h['x-proxy-secret'] === 's3' && c.url.startsWith('https://w.example.workers.dev?type=') && !c.url.includes('apikey')));
});

test('worker: rejects bad secret/type, relays with key', async () => {
  const { handle } = await import('../worker/index.js');
  const env = { PROXY_SECRET: 's3', WARSAW_API_KEY: 'KEY' };
  const req = (q, secret) => new Request('https://w.dev/' + q, { headers: secret ? { 'x-proxy-secret': secret } : {} });
  assert.equal((await handle(req('?type=1'), env)).status, 403);
  assert.equal((await handle(req('?type=1', 'wrong'), env)).status, 403);
  assert.equal((await handle(req('?type=9', 's3'), env)).status, 400);
  assert.equal((await handle(req('?type=1', 's3'), { PROXY_SECRET: 's3' })).status, 500);
  let called;
  const ok = await handle(req('?type=2', 's3'), env, async (u) => { called = u; return new Response('{"result":[]}', { status: 200 }); });
  assert.equal(ok.status, 200); assert.match(called, /apikey=KEY&type=2/);
  const bad = await handle(req('?type=1', 's3'), env, async () => { throw new Error('boom'); });
  assert.equal(bad.status, 502);
});

test('worker: default export works the way Cloudflare calls it (request, env, ctx)', async () => {
  const worker = (await import('../worker/index.js')).default;
  const realFetch = globalThis.fetch; let called;
  globalThis.fetch = async (u) => { called = u; return new Response('{"result":[]}'); };
  try {
    const res = await worker.fetch(new Request('https://w.dev/?type=1', { headers: { 'x-proxy-secret': 's3' } }), { PROXY_SECRET: 's3', WARSAW_API_KEY: 'KEY' }, { waitUntil() {} });
    assert.equal(res.status, 200); assert.match(called, /apikey=KEY/);
  } finally { globalThis.fetch = realFetch; }
});

test('HTTP errors include the JSON error body (e.g. relay 403 forbidden)', async () => {
  const f = async () => ({ ok: false, status: 403, json: async () => ({ error: 'forbidden' }) });
  await assert.rejects(fetchVehicles({ types: [1], fetchImpl: f, upstream: { url: 'https://w.dev', secret: 'x' } }), /HTTP 403 \(forbidden\)/);
});

test('bad-key message shows the API error text, not just "false"', async () => {
  const f = async () => ({ ok: true, json: async () => ({ result: 'false', error: 'Błędny apikey lub jego brak' }) });
  await assert.rejects(fetchVehicles({ apiKey: 'x', types: [1], fetchImpl: f }), /Błędny apikey/);
});
