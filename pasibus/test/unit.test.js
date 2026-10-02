'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize, fetchVehicles, fetchParkings, normalizeParkings, fetchIncidents, normalizeIncidents } = require('../lib/warsaw');
const { vehiclesHandler, parkingHandler, incidentsHandler } = require('../lib/handler');

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
const typeOf = (url, opts) => (opts && opts.body ? String(JSON.parse(opts.body).type) : new URL(url).searchParams.get('type'));
const fakeFetch = (bodyFor) => async (url, opts) => {
  const type = typeOf(url, opts);
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
  const f = async (url, opts) => {
    if (typeOf(url, opts) === '2') throw new Error('boom');
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

test('retries once on a network error, but not on timeout or bad key', async () => {
  const t = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
  let calls = 0;
  const flaky = async () => { if (++calls === 1) throw new Error('fetch failed (ECONNRESET)'); return { ok: true, json: async () => ({ result: [row({ Time: t })] }) }; };
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
  const ok = await handle(req('?type=2', 's3'), env, async (u, init) => { called = { url: u, init }; return new Response('{"result":[]}', { status: 200 }); });
  assert.equal(ok.status, 200); assert.equal(called.url, 'https://dane.um.warszawa.pl/api/action/get_ztm_lokalizacja_pojazdow'); assert.equal(called.init.method, 'POST'); assert.equal(called.init.headers.Authorization, 'KEY'); assert.deepEqual(JSON.parse(called.init.body), { type: 2 });
  const bad = await handle(req('?type=1', 's3'), env, async () => { throw new Error('boom'); });
  assert.equal(bad.status, 502);
});

test('worker: default export works the way Cloudflare calls it (request, env, ctx)', async () => {
  const worker = (await import('../worker/index.js')).default;
  const realFetch = globalThis.fetch; let called;
  globalThis.fetch = async (u, init) => { called = { u, init }; return new Response('{"result":[]}'); };
  try {
    const res = await worker.fetch(new Request('https://w.dev/?type=1', { headers: { 'x-proxy-secret': 's3' } }), { PROXY_SECRET: 's3', WARSAW_API_KEY: 'KEY' }, { waitUntil() {} });
    assert.equal(res.status, 200); assert.equal(called.init.headers.Authorization, 'KEY');
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

test('direct mode: POST with Authorization token and JSON type; falls back to Bearer on 403', async () => {
  const t = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
  const calls = [];
  const f = async (url, opts) => {
    calls.push({ url, opts });
    if (opts.headers.Authorization === 'TOK') return { ok: false, status: 403, json: async () => ({ error: 'forbidden' }) };
    return { ok: true, json: async () => ({ result: [row({ Time: t })] }) };
  };
  const r = await fetchVehicles({ apiKey: 'TOK', types: [1], fetchImpl: f });
  assert.equal(r.vehicles.length, 1);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.opts.method === 'POST' && c.url === 'https://dane.um.warszawa.pl/api/action/get_ztm_lokalizacja_pojazdow' && !c.url.includes('TOK')));
  assert.deepEqual(JSON.parse(calls[0].opts.body), { type: 1 });
  assert.equal(calls[1].opts.headers.Authorization, 'Bearer TOK');
});

test('worker: falls back to Bearer on 401/403 from the API', async () => {
  const { handle } = await import('../worker/index.js');
  const seen = [];
  const res = await handle(new Request('https://w.dev/?type=1', { headers: { 'x-proxy-secret': 's' } }), { PROXY_SECRET: 's', WARSAW_API_KEY: 'TOK' },
    async (u, init) => { seen.push(init.headers.Authorization); return seen.length === 1 ? new Response('{"error":"no"}', { status: 401 }) : new Response('{"result":[]}', { status: 200 }); });
  assert.equal(res.status, 200); assert.deepEqual(seen, ['TOK', 'Bearer TOK']);
});

test('timeouts are not retried; odd responses are shown with a preview', async () => {
  let n = 0;
  const slow = async () => { n++; throw new Error('The operation was aborted due to timeout'); };
  await assert.rejects(fetchVehicles({ apiKey: 'k', types: [1], fetchImpl: slow }), /timeout/);
  assert.equal(n, 1);
  const odd = async () => ({ ok: true, json: async () => ({ success: true, result: null }) });
  await assert.rejects(fetchVehicles({ apiKey: 'k', types: [2], fetchImpl: odd }), /Unexpected API response: \{"success":true,"result":null\}/);
});

test('accepts a bare array response (new API) as well as {result: [...]}', async () => {
  const t = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
  const bare = async () => ({ ok: true, json: async () => [row({ Time: t })] });
  const r = await fetchVehicles({ apiKey: 'k', types: [1], fetchImpl: bare });
  assert.equal(r.vehicles.length, 1);
});

test('Warsaw local time is converted correctly in summer and winter', () => {
  const { normalize } = require('../lib/warsaw');
  const summer = normalize([row({ Time: '2026-07-01 12:00:00' })], 1, Date.parse('2026-07-01T10:00:30Z'));
  assert.equal(summer[0].time, Date.parse('2026-07-01T10:00:00Z')); // CEST = UTC+2
  const winter = normalize([row({ Time: '2026-01-15 12:00:00' })], 1, Date.parse('2026-01-15T11:00:30Z'));
  assert.equal(winter.length, 1);
  assert.equal(winter[0].time, Date.parse('2026-01-15T11:00:00Z')); // CET = UTC+1
});

// Example record copied from the dataset documentation ("Wolne miejsca parkingowe").
const DOC_PARKING = {
  name: 'Parking na Pl. Żelaznej Bramy', latitude: '52.239560', longitude: '21.001779', adress: '',
  opening_hours: [{ monday: '00:00-23:59', sunday: '00:00-23:59' }],
  tariffs: [{ VehicleType: 'Motor', Prices: [{ StayLength: '1.00', StayPrice: '5.00' }] },
    { VehicleType: 'Samochód osobowy', Prices: [{ StayLength: '1.00', StayPrice: '5.00' }, { StayLength: '2.00', StayPrice: '11.00' }] }],
  levels: 1, total_places: [{ level: '0', standard: 47, disabled: 0, electric: 0 }],
  free_places_total: { public: 0, disabled: 0, electric: 0 },
  acceptedPaymentMethod: 'Gotówka, karta płatnicza', additionalSecurity: 'Parking strzeżony',
  manager: 'Zarząd Terenów Publicznych', operatorTelephone: '+48 730-255-220', parkingCategory: 'Publiczny',
};

test('parkings: normalize the documented record', () => {
  const [p] = normalizeParkings([DOC_PARKING]);
  assert.equal(p.name, 'Parking na Pl. Żelaznej Bramy');
  assert.equal(p.lat, 52.23956); assert.equal(p.lon, 21.001779);
  assert.deepEqual(p.free, { standard: 0, disabled: 0, electric: 0 });
  assert.deepEqual(p.capacity, { standard: 47, disabled: 0, electric: 0 });
  assert.deepEqual(p.carTariff, [{ hours: 1, price: 5 }, { hours: 2, price: 11 }]);
  assert.equal(p.phone, '+48 730-255-220');
});

test('parkings: sums capacity over levels, skips bad coordinates', () => {
  const multi = { ...DOC_PARKING, total_places: [{ standard: 10, disabled: 1, electric: 2 }, { standard: 5, disabled: 0, electric: 0 }], free_places_total: { public: '7', disabled: 1, electric: 0 } };
  const out = normalizeParkings([multi, { ...DOC_PARKING, latitude: 'x' }, { ...DOC_PARKING, latitude: '0', longitude: '0' }]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].capacity, { standard: 15, disabled: 1, electric: 2 });
  assert.equal(out[0].free.standard, 7);
});

test('parkings: direct mode POSTs without a body, token in Authorization, accepts several reply shapes', async () => {
  for (const reply of [{ Parkings: [DOC_PARKING] }, [DOC_PARKING], { result: { Parkings: [DOC_PARKING] } }, { result: [DOC_PARKING] }]) {
    let seen;
    const f = async (url, opts) => { seen = { url, opts }; return { ok: true, json: async () => reply }; };
    const r = await fetchParkings({ apiKey: 'TOK', fetchImpl: f });
    assert.equal(r.length, 1);
    assert.equal(seen.url, 'https://dane.um.warszawa.pl/api/action/get_m_parkingi_wolne_miejsca');
    assert.equal(seen.opts.method, 'POST'); assert.equal(seen.opts.headers.Authorization, 'TOK'); assert.equal(seen.opts.body, undefined);
  }
});

test('parkings: relay mode asks the worker for resource=parking', async () => {
  let seen;
  const f = async (url, opts) => { seen = { url, opts }; return { ok: true, json: async () => ({ Parkings: [DOC_PARKING] }) }; };
  await fetchParkings({ fetchImpl: f, upstream: { url: 'https://w.dev', secret: 's' } });
  assert.equal(seen.url, 'https://w.dev?resource=parking'); assert.equal(seen.opts.headers['x-proxy-secret'], 's');
  await assert.rejects(fetchParkings({ fetchImpl: async () => ({ ok: true, json: async () => ({ foo: 1 }) }), apiKey: 'k' }), /Unexpected API response: \{"foo":1\}/);
});

test('parking handler: mock mode and error path', async () => {
  const call = (opts) => new Promise((resolve) => {
    const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, end(b) { resolve({ status: this.statusCode, body: JSON.parse(b), headers: this.headers }); } };
    parkingHandler({ url: '/api/parking' }, res, opts);
  });
  const ok = await call({ env: { MOCK: '1' } });
  assert.equal(ok.status, 200); assert.ok(ok.body.parkings.length >= 5); assert.match(ok.headers['Cache-Control'], /s-maxage=30/);
  const bad = await call({ env: {} });
  assert.equal(bad.status, 502);
});

test('worker: parking resource uses the parking endpoint without a body', async () => {
  const { handle } = await import('../worker/index.js');
  let seen;
  const res = await handle(new Request('https://w.dev/?resource=parking', { headers: { 'x-proxy-secret': 's' } }), { PROXY_SECRET: 's', WARSAW_API_KEY: 'TOK' },
    async (u, init) => { seen = { u, init }; return new Response('{"Parkings":[]}', { status: 200 }); });
  assert.equal(res.status, 200);
  assert.equal(seen.u, 'https://dane.um.warszawa.pl/api/action/get_m_parkingi_wolne_miejsca');
  assert.equal(seen.init.body, undefined); assert.equal(seen.init.headers.Authorization, 'TOK');
});

test('parkings: live API wraps the list in "carParks"', async () => {
  const reply = { Status: 1, Timestamp: '2026-10-02T17:53:05', carParks: [DOC_PARKING] };
  const f = async () => ({ ok: true, json: async () => reply });
  const r = await fetchParkings({ apiKey: 'k', fetchImpl: f });
  assert.equal(r.length, 1); assert.equal(r[0].name, 'Parking na Pl. Żelaznej Bramy');
  const other = async () => ({ ok: true, json: async () => ({ Status: 1, whatever: [DOC_PARKING] }) });
  assert.equal((await fetchParkings({ apiKey: 'k', fetchImpl: other })).length, 1);
});

test('vehicles: reports how many raw records the API returned, even when all are filtered out', async () => {
  const stale = async () => ({ ok: true, json: async () => [row({ Time: '2020-01-01 10:00:00' }), row({ VehicleNumber: '2', Time: '2020-01-01 10:00:00' })] });
  const r = await fetchVehicles({ apiKey: 'k', types: [1], fetchImpl: stale });
  assert.equal(r.vehicles.length, 0); assert.equal(r.received, 2);
});

// Records copied from the dataset documentation ("Utrudnienia w ruchu drogowym").
const DOC_INCIDENTS = [
  { start_date: '2025-10-27 08:15:00', end_date: '2025-10-31 04:30:00', name: 'Wymienią nawierzchnię na bielańskim skrzyżowaniu', id: 8144,
    content: ['W środę rano drogowcy rozpoczną wymianę nawierzchni.', 'Ruch wróci w piątek.'],
    geo: [[{ geomType: 0, latlngs: [{ lat: 52.2821269608705, lng: 20.9699285030365 }] }]] },
  { start_date: '2025-10-24 14:17:10', end_date: '2025-10-31 12:15:30', name: 'Remont ulicy Sęczkowej', id: 8146, content: ['Ulica zamknięta.'],
    geo: [[{ geomType: 1, latlngs: [{ lat: 52.2196333738311, lng: 21.1044466495514 }, { lat: 52.2209446428302, lng: 21.1036688089371 }] }]] },
];

test('incidents: point and line from the documented examples', () => {
  const out = normalizeIncidents(DOC_INCIDENTS, Date.parse('2025-10-29T12:00:00+01:00'));
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].shapes, [{ type: 'point', points: [[52.2821269608705, 20.9699285030365]] }]);
  assert.equal(out[1].shapes[0].type, 'line'); assert.equal(out[1].shapes[0].points.length, 2);
  assert.equal(out[0].id, 8144); assert.equal(out[0].content.length, 2);
  assert.equal(out[0].start, Date.parse('2025-10-27T08:15:00+01:00')); // 27 Oct 2025 is CET (summer time ended 26 Oct)
});

test('incidents: status active / planned / ended, and bad geometry is skipped', () => {
  const now = Date.parse('2025-10-29T12:00:00+01:00');
  const mk = (s, e) => ({ ...DOC_INCIDENTS[0], start_date: s, end_date: e });
  const out = normalizeIncidents([mk('2025-10-27 08:00:00', '2025-10-31 04:00:00'), mk('2025-11-02 08:00:00', '2025-11-03 04:00:00'), mk('2025-10-20 08:00:00', '2025-10-21 04:00:00'),
    { ...DOC_INCIDENTS[0], geo: [] }, { ...DOC_INCIDENTS[0], geo: [[{ geomType: 0, latlngs: [{ lat: 'x', lng: 1 }] }]] }, { ...DOC_INCIDENTS[0], geo: null }], now);
  assert.deepEqual(out.map((i) => i.status), ['active', 'planned', 'ended']);
});

test('incidents: a one-point "line" degrades to a point; geo may be nested or flat', () => {
  const one = { ...DOC_INCIDENTS[1], geo: [[{ geomType: 1, latlngs: [{ lat: 52.2, lng: 21 }] }]] };
  const flat = { ...DOC_INCIDENTS[0], geo: [{ geomType: 0, latlngs: [{ lat: 52.2, lng: 21 }] }] };
  const out = normalizeIncidents([one, flat]);
  assert.equal(out[0].shapes[0].type, 'point'); assert.equal(out.length, 2);
});

test('incidents: direct POST without body; relay uses resource=incidents; accepts wrapped replies', async () => {
  let seen;
  const f = (reply) => async (url, opts) => { seen = { url, opts }; return { ok: true, json: async () => reply }; };
  for (const reply of [DOC_INCIDENTS, { result: DOC_INCIDENTS }, { Status: 1, items: DOC_INCIDENTS }]) {
    const out = await fetchIncidents({ apiKey: 'TOK', fetchImpl: f(reply) });
    assert.equal(out.length, 2);
    assert.equal(seen.url, 'https://dane.um.warszawa.pl/api/action/get_bin_utrudnienia_drogowe');
    assert.equal(seen.opts.method, 'POST'); assert.equal(seen.opts.headers.Authorization, 'TOK'); assert.equal(seen.opts.body, undefined);
  }
  await fetchIncidents({ fetchImpl: f(DOC_INCIDENTS), upstream: { url: 'https://w.dev', secret: 's' } });
  assert.equal(seen.url, 'https://w.dev?resource=incidents');
  await assert.rejects(fetchIncidents({ apiKey: 'k', fetchImpl: f({ foo: 1 }) }), /Unexpected API response/);
});

test('incidents handler: mock mode returns all three statuses; errors give 502', async () => {
  const call = (opts) => new Promise((resolve) => {
    const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, end(b) { resolve({ status: this.statusCode, body: JSON.parse(b), headers: this.headers }); } };
    incidentsHandler({ url: '/api/incidents' }, res, opts);
  });
  const ok = await call({ env: { MOCK: '1' } });
  assert.equal(ok.status, 200); assert.deepEqual([...new Set(ok.body.incidents.map((i) => i.status))].sort(), ['active', 'ended', 'planned']);
  assert.match(ok.headers['Cache-Control'], /s-maxage=60/);
  assert.equal((await call({ env: {} })).status, 502);
});

test('worker: incidents resource, and prototype keys are not treated as resources', async () => {
  const { handle } = await import('../worker/index.js');
  const env = { PROXY_SECRET: 's', WARSAW_API_KEY: 'TOK' };
  let seen;
  const f = async (u, init) => { seen = { u, init }; return new Response('[]', { status: 200 }); };
  const ok = await handle(new Request('https://w.dev/?resource=incidents', { headers: { 'x-proxy-secret': 's' } }), env, f);
  assert.equal(ok.status, 200); assert.equal(seen.u, 'https://dane.um.warszawa.pl/api/action/get_bin_utrudnienia_drogowe'); assert.equal(seen.init.body, undefined);
  const bad = await handle(new Request('https://w.dev/?resource=constructor', { headers: { 'x-proxy-secret': 's' } }), env, f);
  assert.equal(bad.status, 400);
});

test('handler: rejects invalid types with 400 and non-GET methods with 405', async () => {
  const bad = await call('/api/vehicles?types=abc', { env: { MOCK: '1' } });
  assert.equal(bad.status, 400);
  const mixed = await call('/api/vehicles?types=1,3', { env: { MOCK: '1' } });
  assert.equal(mixed.status, 400);
  const dup = await call('/api/vehicles?types=1,1', { env: { MOCK: '1' } });
  assert.equal(dup.status, 200);
  for (const handler of [vehiclesHandler, parkingHandler, incidentsHandler]) {
    const r = await new Promise((resolve) => {
      const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, end(b) { resolve({ status: this.statusCode, headers: this.headers, body: JSON.parse(b) }); } };
      handler({ url: '/x', method: 'POST' }, res, { env: { MOCK: '1' } });
    });
    assert.equal(r.status, 405); assert.equal(r.headers.Allow, 'GET, HEAD');
  }
});
