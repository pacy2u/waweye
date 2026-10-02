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
