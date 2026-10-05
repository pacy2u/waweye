'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize, fetchVehicles, fetchParkings, normalizeParkings, fetchIncidents, normalizeIncidents, fetchFleet, normalizeFleet, fetchSport, normalizeSport, fetchEvents, normalizeEvents, organizer, plainText, streetQuery, warsawDate } = require('../lib/warsaw');
const { vehiclesHandler, parkingHandler, incidentsHandler, fleetHandler, sportHandler, eventsHandler } = require('../lib/handler');
const { createGeocoder, workerStore } = require('../lib/geocoding');

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
  for (const handler of [vehiclesHandler, parkingHandler, incidentsHandler, fleetHandler, sportHandler, eventsHandler]) {
    const r = await new Promise((resolve) => {
      const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, end(b) { resolve({ status: this.statusCode, headers: this.headers, body: JSON.parse(b) }); } };
      handler({ url: '/x', method: 'POST' }, res, { env: { MOCK: '1' } });
    });
    assert.equal(r.status, 405); assert.equal(r.headers.Allow, 'GET, HEAD');
  }
});

// ---- Fleet details ("Pojazdy transportu publicznego") ----
const FLEET_DOC = {
  busy: [{ nazwaSkroconaOperatora: 'KMŁ', schematMalowania: 'ZTM', rokProdukcji: 2016, numerTaborowy: '761', nazwaOperatora: 'Komunikacja Miejska Łomianki Sp. z o.o.',
    trakcja: 'Bus', numerRejestracyjny: 'WZ 2961M', idMarki: 74, kolorPojazdu: 'RAL 1003+3020', kolorTapicerki: 'niebieski', nazwaZajezdni: 'Rolnicza' }],
  tramwaje: [{ nazwaSkroconaOperatora: 'TW', rokProdukcji: 2010, numerTaborowy: '3137', nazwaOperatora: 'Tramwaje Warszawskie Sp. z o.o.', trakcja: 'Tram', idMarki: 85, nazwaZajezdni: 'R-5 "Annopol"' }],
  metro: [{ numerTaborowy: '6530', idMarki: 142 }], kolej: [],
  markiBus: [{ idMarki: 74, marka: 'Jelcz', typ: 'M121', wersja: 'I', wariant: 'I4', producent: 'Zakłady Samochodowe JELCZ S.A.', dlugosc: 11947, szerokosc: 2500,
    liczMiejscSiedzacychTab: 30, liczMiejscStojacychTab: 74, liczMiejscTab: 104, klimatyzacja: false, rodzajZasilania: 'Spalinowy', zasilanie: 'ON', podloga: 'LE', liczMiejscWozekInwalid: 1 }],
  markiTramwaje: [{ idMarki: 85, marka: 'Konstal', typ: '105N', wersja: null, wariant: 'i', liczMiejscTab: 125, klimatyzacja: null }],
};

test('fleet: normalize keys vehicles and brands by type, drops metro/rail', () => {
  const { vehicles, brands } = normalizeFleet(FLEET_DOC);
  assert.deepEqual(Object.keys(vehicles).sort(), ['bus:761', 'tram:3137']);
  assert.equal(vehicles['bus:761'].plate, 'WZ 2961M'); assert.equal(vehicles['bus:761'].year, 2016); assert.equal(vehicles['bus:761'].brand, 74);
  assert.equal(vehicles['tram:3137'].plate, ''); assert.equal(vehicles['tram:3137'].depot, 'R-5 "Annopol"');
  assert.equal(brands['bus:74'].make, 'Jelcz'); assert.equal(brands['bus:74'].model, 'M121 I I4'); assert.equal(brands['bus:74'].seats, 30); assert.equal(brands['bus:74'].ac, false);
  assert.equal(brands['tram:85'].model, '105N i'); assert.equal(brands['tram:85'].ac, null); assert.equal(brands['tram:85'].length, null);
});

test('fleet: direct POST without body, relay uses resource=fleet, wrong shape gives a readable error', async () => {
  let seen;
  const f = async (url, opts) => { seen = { url, opts }; return { ok: true, json: async () => FLEET_DOC }; };
  const r = await fetchFleet({ apiKey: 'TOK', fetchImpl: f });
  assert.equal(seen.url, 'https://dane.um.warszawa.pl/api/action/get_ztm_pojazdy'); assert.equal(seen.opts.headers.Authorization, 'TOK'); assert.equal(seen.opts.body, undefined);
  assert.ok(r.vehicles['bus:761']);
  await fetchFleet({ fetchImpl: f, upstream: { url: 'https://w.dev', secret: 's' } });
  assert.equal(seen.url, 'https://w.dev?resource=fleet'); assert.equal(seen.opts.headers['x-proxy-secret'], 's');
  const wrapped = await fetchFleet({ apiKey: 'k', fetchImpl: async () => ({ ok: true, json: async () => ({ result: FLEET_DOC }) }) });
  assert.ok(wrapped.vehicles['tram:3137']);
  await assert.rejects(fetchFleet({ apiKey: 'k', fetchImpl: async () => ({ ok: true, json: async () => ({ foo: 1 }) }) }), /Unexpected API response/);
});

test('fleet handler: mock mode, long cache, error path', async () => {
  const call = (opts) => new Promise((resolve) => {
    const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, end(b) { resolve({ status: this.statusCode, body: JSON.parse(b), headers: this.headers }); } };
    fleetHandler({ url: '/api/fleet' }, res, opts);
  });
  const ok = await call({ env: { MOCK: '1' } });
  assert.equal(ok.status, 200); assert.ok(ok.body.vehicles['bus:1001'] && ok.body.vehicles['tram:1000']); assert.ok(ok.body.brands['bus:1']);
  assert.match(ok.headers['Cache-Control'], /s-maxage=3600/);
  assert.equal((await call({ env: {} })).status, 502);
});

test('worker: fleet resource uses get_ztm_pojazdy without a body', async () => {
  const { handle } = await import('../worker/index.js');
  let seen;
  const res = await handle(new Request('https://w.dev/?resource=fleet', { headers: { 'x-proxy-secret': 's' } }), { PROXY_SECRET: 's', WARSAW_API_KEY: 'TOK' },
    async (u, init) => { seen = { u, init }; return new Response('{"busy":[]}', { status: 200 }); });
  assert.equal(res.status, 200); assert.equal(seen.u, 'https://dane.um.warszawa.pl/api/action/get_ztm_pojazdy'); assert.equal(seen.init.body, undefined);
});

// ---- Production health check (scripts/check-production.js) ----
const { evaluate, report } = require('../scripts/check-production');
const okResp = (body, ms = 100) => ({ status: 200, body, ms });
const liveSet = () => {
  const vehicles = [];
  for (let i = 0; i < 40; i++) vehicles.push({ type: i % 2 ? 'tram' : 'bus', vehicle: String(i % 2 ? 100 + i : '0' + (1000 + i)) });
  const fleet = { vehicles: {}, brands: {} };
  for (const v of vehicles) fleet.vehicles[`${v.type}:${v.vehicle.replace(/^0+/, '')}`] = {};
  return {
    vehicles: okResp({ source: 'live', errors: [], received: 40, vehicles }),
    parking: okResp({ parkings: [{}] }), incidents: okResp({ incidents: [] }), fleet: okResp(fleet),
  };
};

test('health check: all sources fine, fleet numbers match also without leading zeros', () => {
  const r = evaluate(liveSet());
  assert.ok(r.ok, JSON.stringify(r.rows));
  assert.match(r.rows[3].detail, /autobusy: 20\/20 \(100,0%\), tramwaje: 20\/20/);
  assert.match(report('https://x', r), /wszystko działa[\s\S]*\| Tabor \(\/api\/fleet\) \| OK \|/);
});

test('health check: HTTP errors, mock data, empty lists and partial failures are problems', () => {
  const cases = [
    [(d) => { d.vehicles = { status: 502, body: { error: 'HTTP 403 (forbidden)' }, ms: 1 }; }, /Pojazdy[\s\S]*HTTP 502 \(HTTP 403 \(forbidden\)\)/],
    [(d) => { d.parking = { status: 0, body: null, error: 'timeout', ms: 1 }; }, /brak odpowiedzi \(timeout\)/],
    [(d) => { d.vehicles.body.source = 'mock'; }, /źródło "mock"/],
    [(d) => { d.vehicles.body.vehicles = []; }, /0 pojazdów \(API zwróciło 40/],
    [(d) => { d.vehicles.body.errors = ['tram: HTTP 500']; }, /część danych niedostępna: tram: HTTP 500/],
    [(d) => { d.fleet.body.vehicles = {}; }, /pusty zbiór/],
    [(d) => { d.incidents.body = { error: 'x' }; d.incidents.status = 200; }, /bez listy utrudnień/],
  ];
  for (const [spoil, re] of cases) {
    const d = liveSet(); spoil(d);
    const r = evaluate(d);
    assert.equal(r.ok, false, String(re));
    assert.match(report('https://x', r), re);
  }
});

test('health check: low fleet match fails, too few live vehicles of a type are not judged', () => {
  const d = liveSet();
  for (const k of Object.keys(d.fleet.body.vehicles).filter((k) => k.startsWith('bus:')).slice(0, 5)) delete d.fleet.body.vehicles[k];
  const r = evaluate(d);
  assert.equal(r.ok, false); assert.match(r.rows[3].detail, /autobusy 75,0%/);
  const night = liveSet(); night.vehicles.body.vehicles = night.vehicles.body.vehicles.filter((v, i) => v.type === 'bus' || i < 6);
  const n = evaluate(night);
  assert.ok(n.ok); assert.match(n.rows[3].detail, /tramwaje: za mało pojazdów na żywo \(3\)/);
});

// ---- Sport classes ("Zajęcia sportowe") ----
// Records as the live API returned them on 2026-10-05 (text shortened).
const LIVE_SPORT = [
  { address: [{ name: 'Korty Falenica', postCodeAndOffice: 'Warszawa', street: 'Lokalna 33' }], availableLanguages: ['pl_PL'],
    category: [{ id: 'category_147', name: 'Inne' }], date: ['2026-10-07', '2026-10-14', '2026-09-30'], day: [{ id: 'wednesday', name: 'Środa' }],
    dedicated: [{ id: 'value_5', name: 'Seniorzy' }], image: { small: { path: 'http://um.warszawa.pl/x.png' } }, language: 'pl_PL',
    localization: [{}, { id: 'wawer', name: 'Wawer' }], time: '11:00', title: 'Tenisowe środy dla Seniorów - aktywny senior',
    text: '<h3>Dla kogo są zajęcia?</h3>\n<p>Zapraszamy na bezpłatne, grupowe zajęcia tenisowe dla seniorów na Kortach Falenica</p>\n<h3>Kiedy?</h3><p>Cykl zajęć trwa od&nbsp;7&nbsp;październ</p>',
    url: 'https://sport.um.warszawa.pl/waw/osir-wawer/-/tenisowe-srody-dla-seniorow-aktywny-senior' },
  { title: 'Cykl spacerów jogicznych „Od jesieni do zimy”', day: [{ id: 'saturday', name: 'Sobota' }], time: '09:30',
    address: [{ email: ['sekretariat@parkpowsin.pl'], name: 'Park Kultury w Powsinie', phone: ['22648 48 11'], postCodeAndOffice: '02-973, Warszawa', street: 'Maślaków 1' }],
    map: { features: [{ geometry: { coordinates: [21.091389, 52.116374], type: 'Point' }, properties: { details: 'Zbiórka przy KluboKawiarni Powsin' }, type: 'Feature' }], type: 'FeatureCollection' } },
  { title: 'Taneczne piątki dla seniorów', day: [{ id: 'friday', name: 'Piątek' }],
    map: { features: [{ geometry: { coordinates: [21.035758, 52.25002], type: 'Point' }, properties: { district: 'Praga-Północ', fullStreetName: 'ulica Jagiellońska', shortStreetName: 'ul. Jagiellońska', streetNumber: '7' }, type: 'Feature' }], type: 'FeatureCollection' } },
  { title: 'Fit Mama w OSiR Wawer', day: [{ id: 'monday', name: 'Poniedziałek' }], category: [{ id: 'x' }] },
  { title: 'Stary turniej', date: ['2026-01-09'], map: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [21, 52.2] } }] } },
  { title: 'Bez terminu', date: [], day: [] },
  { title: 'Punkt poza Warszawą', day: [{ id: 'monday' }], map: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] } }] },
    address: [{ name: 'Hala', street: 'ul. Kadetów 15', postCodeAndOffice: '03-987 Warszawa' }], url: 'javascript:alert(1)' },
];

test('sport: live records normalise; finished and undated ones are dropped', () => {
  const out = normalizeSport(LIVE_SPORT, '2026-10-05');
  assert.deepEqual(out.map((i) => i.title), ['Tenisowe środy dla Seniorów - aktywny senior', 'Cykl spacerów jogicznych „Od jesieni do zimy”', 'Taneczne piątki dla seniorów', 'Fit Mama w OSiR Wawer', 'Punkt poza Warszawą']);
  const [tenis, joga, taniec, mama, poza] = out;
  assert.deepEqual(tenis.dates, ['2026-10-07', '2026-10-14']); // past date dropped
  assert.deepEqual(tenis.days, ['wednesday']);
  assert.equal(tenis.lat, null); assert.deepEqual(tenis.queries, ['Lokalna 33, Warszawa', 'Korty Falenica, Warszawa']);
  assert.equal(tenis.district, 'Wawer'); assert.deepEqual(tenis.categories, ['Inne']); assert.deepEqual(tenis.audience, ['Seniorzy']);
  assert.equal(tenis.address, 'Lokalna 33'); assert.equal(tenis.time, '11:00');
  assert.match(tenis.text, /^Dla kogo są zajęcia\? Zapraszamy .* Cykl zajęć trwa od 7 październ$/);
  assert.deepEqual([joga.lat, joga.lon, joga.located], [52.116374, 21.091389, 'map']);
  assert.equal(joga.place, 'Zbiórka przy KluboKawiarni Powsin'); assert.equal(joga.address, 'Maślaków 1, 02-973 Warszawa');
  assert.equal(joga.phone, '22648 48 11'); assert.equal(joga.email, 'sekretariat@parkpowsin.pl'); assert.equal(joga.queries, undefined);
  assert.equal(taniec.place, 'ul. Jagiellońska 7'); assert.equal(taniec.district, 'Praga-Północ');
  assert.deepEqual(mama.queries, []); assert.deepEqual(mama.categories, []);
  assert.equal(poza.lat, null); assert.deepEqual(poza.queries, ['Kadetów 15, Warszawa', 'Hala, Warszawa']); assert.equal(poza.url, '');
});

test('sport: descriptions become plain text; addresses become Nominatim-friendly', () => {
  assert.equal(plainText('<p>A&nbsp;&amp;&#243;&#x142; <b>B</b></p><script>alert(1)</script><a href="tel:1">1</a>'), 'A &ół B 1');
  assert.equal(plainText('a&#99999999;b&#0;c'), 'a b c');
  assert.equal(streetQuery('Michała Kajki 80/82'), 'Michała Kajki 80, Warszawa');
  assert.equal(streetQuery('Węglarska 41 a'), 'Węglarska 41a, Warszawa');
  assert.equal(streetQuery('ul. Kadetów 15'), 'Kadetów 15, Warszawa');
  assert.equal(streetQuery(''), '');
  assert.equal(warsawDate(Date.parse('2026-10-05T22:30:00Z')), '2026-10-06'); // already Tuesday in Warsaw
});

test('sport: direct POST to get_bmm_zajecia_sportowe; relay uses resource=sport', async () => {
  let seen;
  const f = async (url, opts) => { seen = { url, opts }; return { ok: true, json: async () => LIVE_SPORT }; };
  assert.equal((await fetchSport({ apiKey: 'TOK', fetchImpl: f })).length, LIVE_SPORT.length);
  assert.equal(seen.url, 'https://dane.um.warszawa.pl/api/action/get_bmm_zajecia_sportowe'); assert.equal(seen.opts.method, 'POST');
  await fetchSport({ fetchImpl: f, upstream: { url: 'https://w.dev', secret: 's' } });
  assert.equal(seen.url, 'https://w.dev?resource=sport');
});

// A fake clock: sleep() moves time forward, so throttling is checked without waiting.
function fakeGeo(answers, { budgetMs } = {}) {
  let t = 1000; const calls = [];
  const fetchImpl = async (url, init) => {
    const q = new URL(url).searchParams.get('q'); calls.push({ q, at: t, ua: init.headers['User-Agent'], url });
    const a = answers[q];
    if (a instanceof Error) throw a;
    if (typeof a === 'number') return new Response('{}', { status: a });
    t += 200; // a lookup takes a while
    return new Response(JSON.stringify(a ? [{ lat: String(a[0]), lon: String(a[1]) }] : []), { status: 200 });
  };
  const g = createGeocoder({ fetchImpl, now: () => t, sleep: async (ms) => { t += ms; } });
  return { g, calls, tick: (ms) => { t += ms; } };
}

test('geocoding: at most one Nominatim call per 1.1 s, identified, inside Warsaw; answers cached, "not found" too', async () => {
  const { g, calls } = fakeGeo({ 'Lokalna 33, Warszawa': [52.16, 21.2], 'Nowa 1, Warszawa': null, 'Hala, Warszawa': [52.3, 21.1] });
  const items = [{ queries: ['Lokalna 33, Warszawa'] }, { queries: ['Nowa 1, Warszawa', 'Hala, Warszawa'] }, { queries: ['Lokalna 33, Warszawa'] }, { lat: 1, lon: 2, queries: ['x'] }, { queries: [] }];
  assert.equal(await g.locate(items), 0);
  assert.deepEqual(items.map((i) => [i.lat, i.located]), [[52.16, 'address'], [52.3, 'address'], [52.16, 'address'], [1, undefined], [undefined, undefined]]);
  assert.deepEqual(calls.map((c) => c.q), ['Lokalna 33, Warszawa', 'Nowa 1, Warszawa', 'Hala, Warszawa']);
  for (let k = 1; k < calls.length; k++) assert.ok(calls[k].at - calls[k - 1].at >= 1100, 'gap between calls');
  assert.match(calls[0].ua, /^wawEye\/.*waweye\.vercel\.app/);
  assert.match(calls[0].url, /countrycodes=pl&bounded=1&viewbox=20\.85,52\.37,21\.28,52\.09/);
  const again = [{ queries: ['Nowa 1, Warszawa', 'Hala, Warszawa'] }];
  await g.locate(again);
  assert.equal(calls.length, 3); assert.equal(again[0].lat, 52.3); // all from the cache
});

test('geocoding: a spent time budget leaves the rest pending; errors are retried, 429 pauses lookups', async () => {
  const { g, calls, tick } = fakeGeo({ 'A, Warszawa': [52.2, 21], 'B, Warszawa': [52.21, 21], 'C, Warszawa': [52.22, 21], 'E, Warszawa': new Error('reset'), 'F, Warszawa': 429 });
  const items = ['A', 'B', 'C'].map((x) => ({ queries: [`${x}, Warszawa`] }));
  assert.equal(await g.locate(items, { budgetMs: 1500 }), 1); // A at once, B after 1.1 s, then the budget is gone
  assert.deepEqual(items.map((i) => i.lat), [52.2, 52.21, undefined]);
  assert.equal(await g.locate(items, { budgetMs: 5000 }), 0); assert.equal(items[2].lat, 52.22);
  const e = [{ queries: ['E, Warszawa'] }];
  assert.equal(await g.locate(e), 1); assert.equal(await g.locate(e), 1); // not cached, tried again
  assert.equal(calls.filter((c) => c.q === 'E, Warszawa').length, 2);
  const f = [{ queries: ['F, Warszawa'] }, { queries: ['A, Warszawa'] }, { queries: ['G, Warszawa'] }];
  assert.equal(await g.locate(f), 2); // F refused, A cached, G not even tried
  assert.equal(f[1].lat, 52.2); assert.ok(!calls.some((c) => c.q === 'G, Warszawa'));
  tick(11 * 60000);
  await g.locate([{ queries: ['G, Warszawa'] }]); assert.ok(calls.some((c) => c.q === 'G, Warszawa')); // the pause is over
});

test('sport handler: mock mode places classes (also from addresses) and drops the unplaceable; caching follows pending lookups', async () => {
  const call = (opts) => new Promise((resolve) => {
    const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, end(b) { resolve({ status: this.statusCode, body: JSON.parse(b), headers: this.headers }); } };
    sportHandler({ url: '/api/sport' }, res, opts);
  });
  const ok = await call({ env: { MOCK: '1' } });
  assert.equal(ok.status, 200); assert.equal(ok.body.source, 'mock'); assert.equal(ok.body.pending, 0); assert.equal(ok.body.unlocated, 1);
  assert.ok(ok.body.items.every((i) => Number.isFinite(i.lat) && Number.isFinite(i.lon) && !('queries' in i)));
  assert.ok(ok.body.items.some((i) => i.located === 'address'));
  assert.ok(!ok.body.items.some((i) => i.title === 'Zakończony turniej' || i.title === 'Fit Mama w OSiR Wawer'));
  assert.ok(!JSON.stringify(ok.body).includes('<script'));
  assert.match(ok.headers['Cache-Control'], /s-maxage=1800/);
  let budget, store;
  const live = await call({ env: { UPSTREAM_URL: 'https://w.dev', UPSTREAM_SECRET: 's' }, fetchImpl: async () => ({ ok: true, json: async () => LIVE_SPORT }),
    geo: { locate: async (items, opts) => { budget = opts.budgetMs; store = opts.store; return 2; } } });
  assert.equal(live.status, 200); assert.equal(live.body.pending, 2); assert.equal(live.headers['Cache-Control'], 's-maxage=15');
  assert.equal(budget, 3000); // a reply waits at most ~3 s for address lookups, the rest goes on in the background
  assert.equal(typeof store.get, 'function'); // with the Worker in use, geocodes go through its KV first
  await call({ env: { MOCK: '1' }, geo: { locate: async (items, opts) => { store = opts.store; return 0; } } });
  assert.equal(store, undefined); // no Worker, no store
  assert.equal((await call({ env: {} })).status, 502);
});

test('worker: sport resource', async () => {
  const { handle } = await import('../worker/index.js');
  let seen;
  const ok = await handle(new Request('https://w.dev/?resource=sport', { headers: { 'x-proxy-secret': 's' } }), { PROXY_SECRET: 's', WARSAW_API_KEY: 'TOK' },
    async (u, init) => { seen = { u, init }; return new Response('[]', { status: 200 }); });
  assert.equal(ok.status, 200); assert.equal(seen.u, 'https://dane.um.warszawa.pl/api/action/get_bmm_zajecia_sportowe'); assert.equal(seen.init.method, 'POST');
});

// ---- City events ("Kalendarz wydarzeń", layer "DziejeSię") ----
// Records as the live API returned them on 2026-10-05 (text shortened), plus the example from the docs.
const pt = (lon, lat, properties = {}) => ({ geometry: { coordinates: [lon, lat], type: 'Point' }, properties, type: 'Feature' });
const LIVE_EVENTS = [
  { address: [{ name: 'OCH-Teatr' }], availableLanguages: ['pl_PL'], category: [{ id: '34057', name: 'Kultura' }], image: { small: { path: 'http://um.warszawa.pl/x.png' } },
    language: 'pl_PL', lead: 'Och-Teatr zaprasza na popremierowe spektakle „Oskarżonego” Jeffreya Archera.', localization: [{ id: '33974', name: 'Ochota' }],
    map: { type: 'FeatureCollection', features: [pt(20.9799983868717, 52.2141938100175, { district: 'Ochota', fullStreetName: 'ulica Grójecka', shortStreetName: 'ul. Grójecka', streetNumber: '65' })] },
    occurrence: [{ daily: false, from: '2027-01-29T19:00:00+01', to: '2027-01-29T21:00:00+01' }, { daily: false, from: '2026-01-29T19:00:00+01', to: '2026-01-29T21:00:00+01' }],
    text: '<p>Zeznania świadków, podejrzenie romansu…</p>', title: 'Oskarżony – popremierowe spektakle', url: 'https://kultura.um.warszawa.pl/-/oskarzony-popremierowe-w-och-teatrze' },
  { address: [{ name: 'Plac Czerwca 1976 roku' }], category: [{ id: '15731396', name: 'Historia' }, { id: '34079', name: 'Dla seniorów' }], localization: [{ id: '33987', name: 'Ursus' }],
    map: { type: 'FeatureCollection', features: [pt(20.8941954845309, 52.1999348114248, {})] },
    occurrence: [{ daily: true, from: '2026-12-14T00:00:00+01', to: '2026-12-14T23:59:59+01' }],
    text: '<p>Na placu Czerwca 1976 roku odbędą się uroczystości.</p>', title: '45. rocznica ogłoszenia stanu wojennego', url: 'https://ursus.um.warszawa.pl/-/45-rocznica' },
  { address: [{ name: 'Dom Kultury Zacisze', postCodeAndOffice: 'Warszawa', street: 'ul. Blokowa 1' }], title: 'Niepodległościowy Bal Kostiumowy',
    occurrence: [{ daily: false, from: '2026-11-11T11:00:00+01', to: '2026-11-11T11:00:00+01' }],
    map: { type: 'FeatureCollection', features: [1, 2, 3, 4, 5, 6].map(() => pt(21.071652391045, 52.2834103762377, { district: 'Targówek', shortStreetName: 'ul. Blokowa', streetNumber: '1' })) } },
  { address: [{ name: 'Teatr Syrena', street: 'Litewska 3' }], language: 'pl_PL', title: 'Starzyński. Prezydent z pomnika', url: 'https://um.warszawa.pl/waw/80-rocznica/-/starzynski-prezydent-z-pomnika',
    map: { type: 'FeatureCollection', features: [pt(21.038453, 52.252014, { district: 'Praga-Północ', shortStreetName: 'ul. Targowa', streetNumber: '56' }), pt(21.049415, 52.272562, { district: 'Targówek', shortStreetName: 'ul. Kołowa', streetNumber: '20' }), pt(21.022151, 52.216486, { district: 'Śródmieście', shortStreetName: 'ul. Litewska', streetNumber: '3' })] },
    occurrence: [{ daily: true, from: '2026-02-26T00:00:00+01', to: '2027-02-26T23:59:59+01' }],
    text: '<p>Legendarny prezydent Warszawy Stefan Starzyński w&nbsp;Teatrze Syrena.</p><p>Organizator: <a href="https://teatrsyrena.pl/" target="_blank">Teatr Syrena</a></p>' },
  { address: [{ name: 'Szkoła Podstawowa nr 218', street: 'Michała Kajki 80/82' }], title: 'Bez punktu', occurrence: [{ daily: false, from: '2026-10-20T17:00:00+02', to: '2026-10-20T18:30:00+02' }] },
  { title: 'Po terminie', occurrence: [{ daily: false, from: '2023-07-05T09:00:00+02', to: '2023-07-05T10:00:00+02' }], map: { type: 'FeatureCollection', features: [pt(21, 52.23)] } },
  { title: 'Bez terminu', occurrence: [], map: { type: 'FeatureCollection', features: [pt(21, 52.23)] } },
];

test('events: live records normalise; times read from "+01" strings; past occurrences and events dropped', () => {
  const out = normalizeEvents(LIVE_EVENTS, '2026-10-05');
  assert.deepEqual(out.map((e) => e.title), ['Oskarżony – popremierowe spektakle', '45. rocznica ogłoszenia stanu wojennego', 'Niepodległościowy Bal Kostiumowy', 'Starzyński. Prezydent z pomnika', 'Bez punktu']);
  const [och, ursus, bal, syrena, bez] = out;
  assert.deepEqual(och.occurrences, [{ from: '2027-01-29', to: '2027-01-29', start: '19:00', end: '21:00' }]);
  assert.equal(och.text, 'Och-Teatr zaprasza na popremierowe spektakle „Oskarżonego” Jeffreya Archera.'); // the lead
  assert.deepEqual(och.points, [{ lat: 52.2141938100175, lon: 20.9799983868717, label: 'OCH-Teatr', street: 'ul. Grójecka 65', district: 'Ochota' }]);
  assert.equal(och.district, 'Ochota'); assert.deepEqual(och.categories, ['Kultura']); assert.equal(och.located, 'map');
  assert.deepEqual(ursus.occurrences, [{ from: '2026-12-14', to: '2026-12-14', start: '', end: '' }]); // daily: all day
  assert.deepEqual(bal.occurrences[0], { from: '2026-11-11', to: '2026-11-11', start: '11:00', end: '' });
  assert.equal(bal.points.length, 1); assert.equal(bal.points[0].label, 'Dom Kultury Zacisze'); // six copies of one point
  assert.deepEqual(syrena.points.map((p) => p.label), ['ul. Targowa 56', 'ul. Kołowa 20', 'ul. Litewska 3']); // venue name only fits one place
  assert.deepEqual(syrena.occurrences, [{ from: '2026-02-26', to: '2027-02-26', start: '', end: '' }]);
  assert.equal(syrena.organizer, 'Teatr Syrena'); assert.equal(syrena.text, 'Legendarny prezydent Warszawy Stefan Starzyński w Teatrze Syrena.');
  assert.deepEqual(bez.points, []); assert.deepEqual(bez.queries, ['Michała Kajki 80, Warszawa', 'Szkoła Podstawowa nr 218, Warszawa']);
  assert.equal(organizer('<p>x</p><p>Organizatorzy: Dom Kultury, <b>OSiR</b>.</p>'), 'Dom Kultury, OSiR');
  assert.equal(organizer('<p>bez</p>'), '');
});

test('events: direct POST to get_bmm_kalendarz_wydarzen; relay uses resource=wydarzenia; worker knows it', async () => {
  let seen;
  const f = async (url, opts) => { seen = { url, opts }; return { ok: true, json: async () => LIVE_EVENTS }; };
  await fetchEvents({ apiKey: 'TOK', fetchImpl: f });
  assert.equal(seen.url, 'https://dane.um.warszawa.pl/api/action/get_bmm_kalendarz_wydarzen'); assert.equal(seen.opts.method, 'POST');
  await fetchEvents({ fetchImpl: f, upstream: { url: 'https://w.dev', secret: 's' } });
  assert.equal(seen.url, 'https://w.dev?resource=wydarzenia');
  const { handle } = await import('../worker/index.js');
  let w;
  const ok = await handle(new Request('https://w.dev/?resource=wydarzenia', { headers: { 'x-proxy-secret': 's' } }), { PROXY_SECRET: 's', WARSAW_API_KEY: 'T' },
    async (u) => { w = u; return new Response('[]', { status: 200 }); });
  assert.equal(ok.status, 200); assert.equal(w, 'https://dane.um.warszawa.pl/api/action/get_bmm_kalendarz_wydarzen');
});

test('events handler: mock mode places events (one from an address), drops the unplaceable; short cache while pending', async () => {
  const call = (opts) => new Promise((resolve) => {
    const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, end(b) { resolve({ status: this.statusCode, body: JSON.parse(b), headers: this.headers }); } };
    eventsHandler({ url: '/api/wydarzenia' }, res, opts);
  });
  const ok = await call({ env: { MOCK: '1' } });
  assert.equal(ok.status, 200); assert.equal(ok.body.pending, 0); assert.equal(ok.body.unlocated, 1);
  assert.ok(ok.body.items.every((e) => e.points.length && !('queries' in e) && !('lat' in e)));
  const addr = ok.body.items.find((e) => e.located === 'address');
  assert.equal(addr.title, 'Koncert w SP 218'); assert.equal(addr.points[0].label, 'Szkoła Podstawowa nr 218');
  assert.ok(!JSON.stringify(ok.body).includes('<script'));
  assert.match(ok.headers['Cache-Control'], /s-maxage=1800/);
  let budget;
  const live = await call({ env: { UPSTREAM_URL: 'https://w.dev' }, fetchImpl: async () => ({ ok: true, json: async () => LIVE_EVENTS }),
    geo: { locate: async (items, o) => { budget = o.budgetMs; return 1; } } });
  assert.equal(live.body.pending, 1); assert.equal(live.headers['Cache-Control'], 's-maxage=15'); assert.equal(budget, 3000);
  assert.equal((await call({ env: {} })).status, 502);
});

// A fake Workers KV namespace: get(key, 'json') and put(key, value, options), as Cloudflare provides them.
function fakeKv() {
  const data = new Map(), opts = new Map();
  return { data, opts, reads: 0,
    async get(k, type) { this.reads++; const v = data.get(k); return v === undefined ? null : type === 'json' ? JSON.parse(v) : v; },
    async put(k, v, o) { data.set(k, v); opts.set(k, o); } };
}

test('worker geokody: KV store behind the secret, POST only, validated; "not found" expires after 30 days', async () => {
  const { handle } = await import('../worker/index.js');
  const kv = fakeKv();
  const env = { PROXY_SECRET: 's', GEOKODY: kv };
  const post = (body, e = env, secret = 's') => handle(new Request('https://w.dev/?resource=geokody', { method: 'POST', headers: { 'x-proxy-secret': secret }, body: JSON.stringify(body) }), e,
    async () => { throw new Error('the store never calls the Warsaw API'); });
  assert.equal((await post({ get: ['A'] }, env, 'zly')).status, 403);
  const none = await post({ get: ['A'] }, { PROXY_SECRET: 's' });
  assert.equal(none.status, 501); assert.match((await none.json()).error, /GEOKODY/);
  assert.equal((await handle(new Request('https://w.dev/?resource=geokody', { headers: { 'x-proxy-secret': 's' } }), env)).status, 405);
  assert.deepEqual(await (await post({ get: ['Lokalna 33, Warszawa', 'Nowa 1, Warszawa'] })).json(), { found: {} });
  const saved = await post({ put: { 'Lokalna 33, Warszawa': { lat: 52.16, lon: 21.2 }, 'Nowa 1, Warszawa': null } });
  assert.deepEqual(await saved.json(), { saved: 2 });
  assert.equal(kv.opts.get('v1:Lokalna 33, Warszawa'), undefined); // coordinates are kept for good
  assert.equal(kv.opts.get('v1:Nowa 1, Warszawa').expirationTtl, 30 * 86400);
  const got = await post({ get: ['Lokalna 33, Warszawa', 'Nowa 1, Warszawa', 'Inna 2, Warszawa', 'Lokalna 33, Warszawa'] });
  assert.equal(got.status, 200);
  assert.deepEqual(await got.json(), { found: { 'Lokalna 33, Warszawa': { lat: 52.16, lon: 21.2 }, 'Nowa 1, Warszawa': null } });
  // Nothing outside Warsaw, no odd keys, bounded requests.
  for (const bad of [{ put: { X: { lat: 50, lon: 19 } } }, { put: { X: { lat: '52.2', lon: 21 } } }, { put: { '': null } }, { put: { ['x'.repeat(301)]: null } },
    { put: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`A${i}`, null])) }, { get: Array.from({ length: 101 }, (_, i) => `A${i}`) }, { get: [1] }, { put: [] }, {}]) {
    assert.equal((await post(bad)).status, 400, JSON.stringify(bad).slice(0, 60));
  }
  assert.ok(![...kv.data.keys()].some((k) => k.startsWith('v1:X') || k.startsWith('v1:A')));
  const broken = await post({ get: ['A'] }, { PROXY_SECRET: 's', GEOKODY: { get: async () => { throw new Error('KV down'); } } });
  assert.equal(broken.status, 502);
});

test('geocoding store: known answers skip Nominatim, new ones (also "not found") are saved, a broken store is skipped', async () => {
  const { g, calls } = fakeGeo({ 'A, Warszawa': [52.2, 21], 'B, Warszawa': null, 'C, Warszawa': [52.22, 21] });
  const kept = { 'A, Warszawa': { lat: 52.25, lon: 21.05 }, 'Z, Warszawa': null };
  const asked = [], puts = [];
  const store = { get: async (qs) => { asked.push(qs); return Object.fromEntries(qs.filter((q) => q in kept).map((q) => [q, kept[q]])); },
    put: async (e) => { puts.push(e); Object.assign(kept, e); } };
  const items = [{ queries: ['A, Warszawa'] }, { queries: ['Z, Warszawa', 'B, Warszawa', 'C, Warszawa'] }];
  assert.equal(await g.locate(items, { store }), 0);
  assert.deepEqual(asked, [['A, Warszawa', 'Z, Warszawa', 'B, Warszawa', 'C, Warszawa']]); // one batch for everything
  assert.equal(items[0].lat, 52.25); // from the store, not from Nominatim
  assert.deepEqual(calls.map((c) => c.q), ['B, Warszawa', 'C, Warszawa']); // Z is a known "not found"
  assert.deepEqual(puts, [{ 'B, Warszawa': null, 'C, Warszawa': { lat: 52.22, lon: 21 } }]);
  await g.locate([{ queries: ['A, Warszawa'] }, { queries: ['B, Warszawa'] }], { store });
  assert.equal(asked.length, 1); assert.equal(puts.length, 1); // all in memory already
  // A fresh instance (cold start, new deploy) takes everything from the store.
  const fresh = fakeGeo({});
  const again = [{ queries: ['B, Warszawa', 'C, Warszawa'] }];
  assert.equal(await fresh.g.locate(again, { store }), 0);
  assert.equal(again[0].lat, 52.22); assert.equal(fresh.calls.length, 0);
  // Store down: Nominatim as before, the answers wait in memory and are saved once the store is back.
  const down = fakeGeo({ 'D, Warszawa': [52.3, 21.1], 'E, Warszawa': [52.31, 21.1] });
  let up = false, gets = 0; const saved = [];
  const flaky = { get: async () => { gets++; if (!up) throw new Error('HTTP 501'); return {}; }, put: async (e) => { if (!up) throw new Error('HTTP 501'); saved.push(e); } };
  const d = [{ queries: ['D, Warszawa'] }];
  assert.equal(await down.g.locate(d, { store: flaky }), 0); assert.equal(d[0].lat, 52.3);
  await down.g.locate([{ queries: ['E, Warszawa'] }], { store: flaky });
  assert.equal(gets, 1); // paused after the failure instead of asking on every request
  up = true; down.tick(11 * 60000);
  await down.g.locate([{ queries: ['E, Warszawa'] }], { store: flaky });
  assert.deepEqual(saved, [{ 'D, Warszawa': { lat: 52.3, lon: 21.1 }, 'E, Warszawa': { lat: 52.31, lon: 21.1 } }]); // found while the store was down
});

test('geocoding workerStore: POSTs to the Worker with the secret, in chunks, and keeps only sane answers', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body); seen.push({ url, secret: init.headers['x-proxy-secret'], method: init.method, body });
    if (body.get) return new Response(JSON.stringify({ found: Object.fromEntries(body.get.map((q, i) => [q, i === 0 ? { lat: 52.2, lon: 21 } : i === 1 ? null : { lat: 'x' }])) }));
    return new Response(JSON.stringify({ saved: Object.keys(body.put).length }));
  };
  const store = workerStore({ url: 'https://w.example.workers.dev', secret: 's3', fetchImpl });
  const qs = Array.from({ length: 150 }, (_, i) => `Ulica ${i}, Warszawa`);
  const found = await store.get(qs);
  assert.equal(seen.length, 2); assert.deepEqual(seen.map((c) => c.body.get.length), [100, 50]);
  assert.ok(seen.every((c) => c.url === 'https://w.example.workers.dev?resource=geokody' && c.secret === 's3' && c.method === 'POST'));
  assert.deepEqual(found['Ulica 0, Warszawa'], { lat: 52.2, lon: 21 }); assert.equal(found['Ulica 1, Warszawa'], null);
  assert.ok(!('Ulica 2, Warszawa' in found)); // malformed answers are dropped
  await store.put(Object.fromEntries(qs.slice(0, 25).map((q) => [q, null])));
  assert.deepEqual(seen.slice(2).map((c) => Object.keys(c.body.put).length), [20, 5]);
  await assert.rejects(workerStore({ url: 'https://w.dev', secret: 's', fetchImpl: async () => new Response('{}', { status: 501 }) }).get(['A']), /HTTP 501/);
});

test('geocoding: what a reply leaves pending goes on in the background, one run per instance', async () => {
  const { g, calls } = fakeGeo({ 'A, Warszawa': [52.2, 21], 'B, Warszawa': [52.21, 21], 'C, Warszawa': [52.22, 21] });
  const items = ['A', 'B', 'C'].map((x) => ({ queries: [`${x}, Warszawa`] }));
  const first = g.locateLater(items, { budgetMs: 60000 });
  assert.ok(first); assert.equal(g.locateLater(items), null); // already running
  assert.equal(await first, 0); assert.deepEqual(items.map((i) => i.lat), [52.2, 52.21, 52.22]);
  assert.equal(calls.length, 3);
  assert.ok(g.locateLater([{ queries: ['A, Warszawa'] }])); // free again
});

test('sport and events handlers hand pending lookups to waitUntil, after a short wait in the reply', async () => {
  for (const [handler, raw] of [[sportHandler, LIVE_SPORT], [eventsHandler, LIVE_EVENTS]]) {
    const later = [], bg = [];
    const geo = { locate: async (items, o) => { assert.equal(o.budgetMs, 3000); return 2; }, locateLater: (items, o) => { later.push(o.budgetMs); assert.equal(typeof o.store.put, 'function'); return Promise.resolve(0); } }; // the background run saves to the KV too
    const r = await new Promise((resolve) => {
      const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, end(b) { resolve({ status: this.statusCode, body: JSON.parse(b) }); } };
      handler({ url: '/x' }, res, { env: { UPSTREAM_URL: 'https://w.dev' }, fetchImpl: async () => ({ ok: true, json: async () => raw }), geo, background: (p) => bg.push(p) });
    });
    assert.equal(r.status, 200); assert.equal(r.body.pending, 2);
    assert.deepEqual(later, [45000]); assert.equal(bg.length, 1); assert.ok(typeof bg[0].then === 'function');
  }
});

test('worker: GTFS resource streams the ZTM timetable, probes it, needs the secret but not the API key', async () => {
  const { handle } = await import('../worker/index.js');
  const env = { PROXY_SECRET: 's' }; // no WARSAW_API_KEY: GTFS does not use it
  const req = (q, secret = 's') => new Request('https://w.dev/' + q, { headers: { 'x-proxy-secret': secret } });
  let seen;
  const up = async (u, init) => { seen = { u, init }; return new Response('PK\u0003\u0004zip', { status: 200, headers: { 'content-type': 'application/zip', 'content-length': '7', 'last-modified': 'Mon, 05 Oct 2026 03:00:00 GMT' } }); };
  assert.equal((await handle(req('?resource=gtfs', 'x'), env, up)).status, 403);
  const full = await handle(req('?resource=gtfs'), env, up);
  assert.equal(full.status, 200); assert.equal(await full.text(), 'PK\u0003\u0004zip');
  assert.equal(full.headers.get('x-gtfs-modified'), 'Mon, 05 Oct 2026 03:00:00 GMT');
  assert.equal(seen.u, 'https://gtfs.ztm.waw.pl/last'); assert.match(seen.init.headers['User-Agent'], /wawEye/);
  const probe = await (await handle(req('?resource=gtfs&probe=1'), env, up)).json();
  assert.equal(probe.status, 200); assert.equal(probe.length, '7'); assert.equal(probe.type, 'application/zip'); assert.ok('colo' in probe);
  const down = await handle(req('?resource=gtfs'), env, async () => new Response('no', { status: 404 }));
  assert.equal(down.status, 502); assert.match((await down.json()).error, /HTTP 404/);
  const dead = await handle(req('?resource=gtfs&probe=1'), env, async () => { throw new Error('timed out'); });
  assert.equal(dead.status, 502); assert.match((await dead.json()).error, /upstream: timed out/);
});

test('gtfsProbeHandler: checks GTFS through the Worker and directly, read-only', async () => {
  const { gtfsProbeHandler } = require('../lib/handler');
  const run = async (env, fetchImpl, method = 'GET') => {
    const res = { headers: {}, statusCode: 0, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
    await gtfsProbeHandler({ method, url: '/api/sprawdz-gtfs' }, res, { env, fetchImpl });
    return res;
  };
  const calls = [];
  const f = async (u, init) => {
    calls.push({ u, init });
    if (u.startsWith('https://w.dev')) return new Response(JSON.stringify({ status: 200, colo: 'FRA', length: '100' }), { status: 200 });
    throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } });
  };
  const r = await run({ UPSTREAM_URL: 'https://w.dev', UPSTREAM_SECRET: 'sek', VERCEL_REGION: 'fra1' }, f);
  const b = JSON.parse(r.body);
  assert.equal(b.region, 'fra1'); assert.equal(b.viaWorker.httpStatus, 200); assert.equal(b.viaWorker.worker.colo, 'FRA');
  assert.match(b.direct.error, /UND_ERR_CONNECT_TIMEOUT/);
  assert.equal(calls[0].u, 'https://w.dev?resource=gtfs&probe=1'); assert.equal(calls[0].init.headers['x-proxy-secret'], 'sek');
  assert.ok(!r.body.includes('sek'), 'the secret is not echoed');
  assert.equal(r.headers['Cache-Control'], 'no-store');
  assert.match(JSON.parse((await run({}, f)).body).viaWorker.error, /brak UPSTREAM_URL/);
  assert.equal((await run({}, f, 'POST')).statusCode, 405);
});

test('health check: route store freshness (optional row)', () => {
  const now = Date.parse('2026-10-08T10:00:00Z');
  const routes = (body, status = 200) => ({ status, body, ms: 50 });
  const fresh = { source: 'GTFS ZTM', valid: { from: '2026-10-08', to: '2026-10-17' }, refreshed: '2026-10-08T02:10:00Z', lines: 317 };
  let r = evaluate({ ...liveSet(), routes: routes(fresh) }, now);
  assert.ok(r.ok, JSON.stringify(r.rows)); assert.match(r.rows[4].detail, /317 linii, rozkład 2026-10-08 – 2026-10-17, odświeżone 8 h temu/);
  r = evaluate({ ...liveSet(), routes: routes({ ...fresh, refreshed: '2026-10-05T02:10:00Z' }) }, now);
  assert.ok(!r.ok); assert.match(report('https://x', r), /Trasy linii[^\n]*BŁĄD[^\n]*nieodświeżane od 80 h[^\n]*cron \/api\/odswiez-trasy/);
  r = evaluate({ ...liveSet(), routes: routes({ ...fresh, valid: { from: '2026-09-28', to: '2026-10-07' } }) }, now);
  assert.match(report('https://x', r), /ważny tylko do 2026-10-07/);
  r = evaluate({ ...liveSet(), routes: routes({ error: 'magazyn tras jest pusty' }, 404) }, now);
  assert.match(report('https://x', r), /HTTP 404 \(magazyn tras jest pusty\)/);
  assert.equal(evaluate(liveSet(), now).rows.length, 4, 'without the routes response no row');
});
