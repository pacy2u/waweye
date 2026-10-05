'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { stitch, relationToFeature, containsLatLng, featureArea, checkSct, wmsLayers } = require('../scripts/strefy');

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
