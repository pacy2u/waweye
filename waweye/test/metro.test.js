'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chains, metres, buildMetro, checkMetro, overpass, EXPECTED, EXPECTED_TOTAL, COLOURS } = require('../scripts/metro');

// A synthetic network in the shape of an Overpass answer: M1 north–south and M2 west–east through the centre,
// with Świętokrzyska shared, the stations spread along the lines, and a square "Warsaw" of about the real size around them.
const CITY = [[52.10, 20.88], [52.10, 21.21], [52.31, 21.21], [52.31, 20.88]]; // ~525 km², like the real 517
const city = { type: 'relation', id: 336075, tags: { boundary: 'administrative', admin_level: '6', name: 'Warszawa' },
  members: [{ type: 'way', ref: 1, role: 'outer', geometry: [...CITY, CITY[0]].map(([lat, lon]) => ({ lat, lon })) }] };
const SWK = [52.2351, 21.0079], CEN = [52.2310, 21.0102];
// Builds the answer for a given number of stations per line (Świętokrzyska counted on both, Centrum on M1).
function answer({ m1 = EXPECTED.M1, m2 = EXPECTED.M2, swkAt = SWK, extraLine = false, cityRel = true } = {}) {
  let id = 100;
  const nodes = [];
  const station = (name, lat, lon) => { const s = { type: 'node', id: id++, lat, lon, tags: { railway: 'station', station: 'subway', name } }; nodes.push(s); return s; };
  const swk = station('Świętokrzyska', ...swkAt), cen = station('Centrum', ...CEN);
  const l1 = [swk, cen], l2 = [swk];
  for (let i = 0; l1.length < m1; i++) l1.push(station(`M1 ${i}`, 52.13 + i * 0.008, 21.04));
  for (let i = 0; l2.length < m2; i++) l2.push(station(`M2 ${i}`, 52.25, 20.90 + i * 0.012));
  // Proposed stations of future lines are in the answer too and must be ignored.
  nodes.push({ type: 'node', id: id++, lat: 52.21, lon: 20.97, tags: { railway: 'proposed', station: 'subway', name: 'Plac Narutowicza' } });
  const stops = (line) => line.map((s, i) => ({ type: 'node', ref: 9000 + s.id, role: i === 0 ? 'stop_entry_only' : 'stop', lat: s.lat + 0.0005, lon: s.lon, tags: {} }));
  const track = (line) => [...line].sort((a, b) => a.lat - b.lat || a.lon - b.lon).map((s) => ({ lat: s.lat, lon: s.lon }));
  const rel = (rid, ref, line, extra = {}) => ({ type: 'relation', id: rid, tags: { type: 'route', route: 'subway', ref, from: 'A', to: 'B', colour: 'blue', ...extra },
    members: [...stops(line), { type: 'way', ref: rid * 10, role: '', geometry: track(line).slice(0, 3) }, { type: 'way', ref: rid * 10 + 1, role: '', geometry: track(line).slice(2) },
      { type: 'way', ref: rid * 10 + 2, role: 'platform', geometry: [{ lat: 52.0, lon: 20.0 }, { lat: 52.0, lon: 20.1 }] }] });
  const els = [rel(1, 'M1', l1), rel(2, 'M1', [...l1].reverse()), rel(3, 'M2', l2), rel(4, 'M2', [...l2].reverse()), ...nodes];
  if (extraLine) els.push(rel(5, 'M3', [cen]));
  if (cityRel) els.push(city);
  return { osm3s: { timestamp_osm_base: '2026-10-05T17:00:00Z' }, elements: els };
}

test('chains joins ways that meet end to end in either direction', () => {
  assert.deepEqual(chains([[[0, 0], [1, 0]], [[2, 0], [1, 0]], [[3, 0], [2, 0]]]), [[[0, 0], [1, 0], [2, 0], [3, 0]]]);
  assert.deepEqual(chains([[[1, 0], [2, 0]], [[0, 0], [1, 0]]]), [[[0, 0], [1, 0], [2, 0]]]);
  assert.equal(chains([[[0, 0], [1, 0]], [[5, 5], [6, 6]]]).length, 2);
  assert.deepEqual(chains([[[0, 0]]]), []);
});
test('metres measures short distances', () => {
  const d = metres({ lat: 52.2351, lon: 21.0079 }, { lat: 52.2310, lon: 21.0102 });
  assert.ok(d > 470 && d < 500, 'Świętokrzyska–Centrum ' + d);
});
test('buildMetro makes 2 lines and the stations with the lines that stop there', () => {
  const { fc, boundary, problems } = buildMetro(answer(), 'T');
  assert.deepEqual(problems, []);
  const lines = fc.features.filter((f) => f.properties.kind === 'line');
  assert.deepEqual(lines.map((f) => f.properties.ref), ['M1', 'M2']);
  assert.equal(lines[0].properties.colour, COLOURS.M1); // not OSM's plain "blue"
  assert.equal(lines[0].geometry.type, 'MultiLineString');
  assert.equal(lines[0].geometry.coordinates.length, 1, 'the two track ways are joined, platforms left out');
  const st = fc.features.filter((f) => f.properties.kind === 'station');
  assert.equal(st.length, EXPECTED_TOTAL);
  assert.deepEqual(st.find((s) => s.properties.name === 'Świętokrzyska').properties.lines, ['M1', 'M2']);
  assert.ok(!st.some((s) => s.properties.name === 'Plac Narutowicza'), 'proposed stations are left out');
  assert.equal(st[0].geometry.type, 'Point');
  assert.match(fc.metadata.license, /OpenStreetMap/); assert.equal(fc.metadata.osm_timestamp, 'T');
  assert.deepEqual(checkMetro(fc, boundary), []);
});
test('buildMetro reports a stop with no station nearby', () => {
  const a = answer();
  a.elements[0].members.push({ type: 'node', ref: 1, role: 'stop', lat: 52.30, lon: 21.20, tags: {} });
  assert.match(buildMetro(a).problems.join(), /node\/1 bez stacji/);
});
test('checkMetro rejects wrong station counts', () => {
  const { fc, boundary } = buildMetro(answer({ m2: EXPECTED.M2 + 3 })); // e.g. an extension tagged before it opens
  const p = checkMetro(fc, boundary);
  assert.ok(p.some((x) => /M2: 21 stacji \(oczekiwane 18\)/.test(x)), p.join('; '));
  assert.ok(p.some((x) => /razem 41/.test(x)));
});
test('checkMetro rejects a third line', () => {
  const { fc, boundary } = buildMetro(answer({ extraLine: true }));
  assert.ok(checkMetro(fc, boundary).some((x) => /dokładnie M1 i M2/.test(x)));
});
test('checkMetro wants Świętokrzyska in the city centre and everything inside Warsaw', () => {
  const far = buildMetro(answer({ swkAt: [52.40, 21.0079] }));
  const p = checkMetro(far.fc, far.boundary);
  assert.ok(p.some((x) => /Świętokrzyska poza Śródmieściem/.test(x)), p.join('; '));
  assert.ok(p.some((x) => /poza granicami Warszawy: Świętokrzyska/.test(x)));
  const nocity = buildMetro(answer({ cityRel: false }));
  assert.ok(checkMetro(nocity.fc, nocity.boundary).some((x) => /brak granicy Warszawy/.test(x)));
});
test('overpass sends a User-Agent and falls back to the next server', async () => {
  const calls = [];
  const f = async (url, opts) => {
    calls.push({ url, ua: opts.headers['User-Agent'] });
    if (calls.length === 1) return { ok: false, status: 504, text: async () => 'Gateway Timeout' };
    return { ok: true, status: 200, json: async () => answer() };
  };
  const r = await overpass('q', f);
  assert.equal(calls.length, 2); assert.ok(calls.every((c) => /wawEye/.test(c.ua)));
  assert.equal(r.via, calls[1].url); assert.ok(r.data.elements.length);
  await assert.rejects(overpass('q', async () => ({ ok: true, json: async () => ({ elements: [] }) })), /pusta odpowiedź/);
});

// The committed file (written by scripts/metro.js in GitHub Actions) must still pass the same checks.
const FILE = path.join(__dirname, '..', 'public', 'data', 'metro.geojson');
test('committed metro layer is plausible', { skip: !fs.existsSync(FILE) && 'brak pliku – uruchom workflow waweye-dane-metra.yml' }, () => {
  const fc = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  // A square well around Warsaw stands in for the city boundary here (the real one is checked before writing).
  const box = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[20.84, 52.08], [21.3, 52.08], [21.3, 52.38], [20.84, 52.38], [20.84, 52.08]]] } };
  const p = checkMetro(fc, box).filter((x) => !/granica Warszawy ma/.test(x));
  assert.deepEqual(p, []);
  assert.match(fc.metadata.license, /OpenStreetMap/);
});
