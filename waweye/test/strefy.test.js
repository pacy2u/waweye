'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { stitch, relationToFeature, fullToGeom, osmRelation, containsLatLng, featureArea, checkSct, checkSppn, wmsLayers } = require('../scripts/strefy');

// A square of about 6 x 6.7 km around the centre of Warsaw, split into ways the way OSM does it (one way reversed).
const g = (pts) => pts.map(([lat, lon]) => ({ lat, lon }));
const A = [52.20, 20.97], B = [52.20, 21.06], C = [52.26, 21.06], D = [52.26, 20.97];
const rel = (members) => ({ type: 'relation', id: 1, members });
const way = (role, pts) => ({ type: 'way', role, geometry: g(pts) });

test('stitch joins ways running in either direction into a closed ring', () => {
  const [ring] = stitch([[[0, 0], [1, 0]], [[1, 1], [1, 0]], [[1, 1], [0, 1], [0, 0]]]);
  assert.deepEqual(ring, [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]);
});
test('stitch reports a boundary with a gap', () => {
  assert.throws(() => stitch([[[0, 0], [1, 0]], [[1, 1], [0, 1]]]), /niedomknięty/);
});
test('relationToFeature builds a polygon with its hole, in [lon, lat]', () => {
  const hole = [[52.22, 21.0], [52.23, 21.0], [52.23, 21.01], [52.22, 21.0]];
  const f = relationToFeature(rel([way('outer', [A, B]), way('outer', [C, B]), way('outer', [C, D, A]), way('inner', hole), { type: 'node', role: 'label' }]), { name: 'X' });
  assert.equal(f.geometry.type, 'Polygon');
  assert.equal(f.geometry.coordinates.length, 2);
  assert.deepEqual(f.geometry.coordinates[0][0], [20.97, 52.2]);
  assert.equal(f.properties.name, 'X');
  assert.ok(containsLatLng(f, [52.2318, 21.0060]));
  assert.ok(!containsLatLng(f, [52.225, 21.004]), 'point in the hole');
  assert.ok(!containsLatLng(f, [52.165, 21.09]));
  const km2 = featureArea(f);
  assert.ok(km2 > 40 && km2 < 41, 'area ' + km2); // 6.15 km x 6.67 km minus a tiny hole
});
test('relationToFeature makes a MultiPolygon from separate outer rings', () => {
  const f = relationToFeature(rel([way('outer', [A, B, C, A]), way('outer', [[52.3, 21.1], [52.3, 21.2], [52.35, 21.2], [52.3, 21.1]])]));
  assert.equal(f.geometry.type, 'MultiPolygon');
  assert.equal(f.geometry.coordinates.length, 2);
});
test('checkSct accepts a plausible zone and rejects a wrong one', () => {
  assert.deepEqual(checkSct(relationToFeature(rel([way('outer', [A, B, C, D, A])]))), []);
  const tiny = relationToFeature(rel([way('outer', [[52.25, 21.0], [52.25, 21.01], [52.26, 21.01], [52.25, 21.0]])]));
  const p = checkSct(tiny);
  assert.ok(p.some((x) => /powierzchnia/.test(x))); assert.ok(p.some((x) => /Pałac Kultury/.test(x)));
});
test('wmsLayers lists named layers with titles and inherited CRS', () => {
  const xml = `<?xml version="1.0"?><WMS_Capabilities><Capability><Layer><Title>Mapa</Title><CRS>EPSG:2178</CRS><CRS>EPSG:3857</CRS>
    <Layer queryable="1"><Name>SPPN</Name><Title>Strefa płatnego parkowania &amp; abonamenty</Title><CRS>EPSG:4326</CRS></Layer>
    <Layer><Title>Grupa</Title><Layer><Name>ulice</Name><Title>Ulice</Title></Layer></Layer>
  </Layer></Capability></WMS_Capabilities>`;
  assert.deepEqual(wmsLayers(xml), [
    { name: 'SPPN', title: 'Strefa płatnego parkowania & abonamenty', crs: ['EPSG:2178', 'EPSG:3857', 'EPSG:4326'] },
    { name: 'ulice', title: 'Ulice', crs: ['EPSG:2178', 'EPSG:3857'] },
  ]);
});

// The committed boundary (written by scripts/strefy.js in GitHub Actions) must still pass the same checks.
const SCT_FILE = path.join(__dirname, '..', 'public', 'data', 'strefa-czystego-transportu.geojson');
test('committed SCT boundary is plausible', { skip: !fs.existsSync(SCT_FILE) && 'brak pliku – uruchom workflow waweye-dane-stref.yml' }, () => {
  const fc = JSON.parse(fs.readFileSync(SCT_FILE, 'utf8'));
  assert.equal(fc.type, 'FeatureCollection'); assert.equal(fc.features.length, 1);
  assert.deepEqual(checkSct(fc.features[0]), []);
  assert.match(fc.features[0].properties.license, /OpenStreetMap/);
});

const SPPN_FILE = path.join(__dirname, '..', 'public', 'data', 'strefa-platnego-parkowania.geojson');
test('committed SPPN boundary is plausible', { skip: !fs.existsSync(SPPN_FILE) && 'brak pliku – uruchom workflow waweye-dane-stref.yml' }, () => {
  const fc = JSON.parse(fs.readFileSync(SPPN_FILE, 'utf8'));
  assert.equal(fc.type, 'FeatureCollection'); assert.equal(fc.features.length, 1);
  assert.deepEqual(checkSppn(fc.features), []);
  assert.match(fc.features[0].properties.license, /OpenStreetMap/);
});

test('checkSppn: the zone must cover the centre, Praga and Stary Mokotów, not Wilanów or Bemowo, at a sane size', () => {
  const box = (s, w, n, e) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } });
  assert.deepEqual(checkSppn([box(52.19, 20.96, 52.27, 21.06)]), []); // ~60 km² around the centre, Praga and Mokotów
  assert.match(checkSppn([box(52.22, 20.99, 52.24, 21.02)]).join('; '), /powierzchnia.*Praga.*nie leży.*Stary Mokotów.*nie leży/);
  assert.match(checkSppn([box(52.15, 20.90, 52.27, 21.10)]).join('; '), /powierzchnia|Wilanów leży/);
  assert.deepEqual(checkSppn([box(52.19, 20.96, 52.235, 21.03), box(52.235, 20.98, 52.27, 21.06)]), []); // several relations together
});

test('fullToGeom turns an OSM API "full" answer into way geometries', () => {
  const full = { elements: [{ type: 'node', id: 1, lat: 52.2, lon: 21.0 }, { type: 'node', id: 2, lat: 52.3, lon: 21.1 },
    { type: 'way', id: 10, nodes: [1, 2] }, { type: 'relation', id: 5, tags: { name: 'Z' }, members: [{ type: 'way', ref: 10, role: 'outer' }, { type: 'node', ref: 1, role: 'label' }] }] };
  const rel = fullToGeom(full, 5);
  assert.equal(rel.tags.name, 'Z');
  assert.deepEqual(rel.members[0].geometry, [{ lat: 52.2, lon: 21.0 }, { lat: 52.3, lon: 21.1 }]);
  assert.equal(rel.members[1].geometry, undefined);
  assert.equal(fullToGeom(full, 6), null);
});
test('osmRelation sends a User-Agent and falls back to the OSM API when Overpass refuses', async () => {
  const calls = [];
  const f = async (url, opts) => {
    calls.push({ url, ua: opts.headers['User-Agent'] });
    if (url.includes('interpreter')) return { ok: false, status: 429, text: async () => 'Too Many Requests' };
    return { ok: true, status: 200, json: async () => ({ elements: [{ type: 'relation', id: 7, members: [], timestamp: 't' }] }) };
  };
  const r = await osmRelation(7, f);
  assert.equal(r.rel.id, 7); assert.match(r.via, /api\.openstreetmap\.org/);
  assert.equal(calls.length, 3); assert.ok(calls.every((c) => /wawEye/.test(c.ua)));
  assert.match(calls[2].url, /relation\/7\/full\.json$/);
});

// Reference values from proj4 (+proj=tmerc +lon_0=21 +k=0.999923 +x_0=7500000 +ellps=GRS80), 2026-10-05.
test('toPL2000z7 matches proj4 for EPSG:2178 to within a few centimetres', () => {
  const { toPL2000z7 } = require('../public/pl2000');
  for (const [lat, lon, e, n] of [[52.2318, 21.006, 7500409.904786531, 5788690.086006144], [52.0976, 20.8516, 7489831.147831967, 5773769.111511815],
    [52.3666, 21.2672, 7518199.067818733, 5803722.125117395], [52.25, 20.5, 7465855.346749933, 5790832.8636836875]]) {
    const [north, east] = toPL2000z7(lat, lon);
    assert.ok(Math.abs(north - n) < 0.05 && Math.abs(east - e) < 0.05, `${lat},${lon}: ${north},${east} vs ${n},${e}`);
  }
});
