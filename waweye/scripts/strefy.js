'use strict';
// Zone data for the map layers (run in GitHub Actions: .github/workflows/waweye-dane-stref.yml).
// 1. Clean Transport Zone (SCT): the boundary from OpenStreetMap (relation 17792822, boundary=low_emission_zone)
//    -> public/data/strefa-czystego-transportu.geojson, checked for plausibility before it is written.
// 2. Paid parking zone (SPPN): the city publishes it only as a map layer, so this lists the layers of the city's WMS
//    services that look like parking or emission zones (name, title, whether they serve EPSG:3857 for Leaflet).
// Run: node scripts/strefy.js  (prints a Markdown report in Polish; exit code 1 when the SCT boundary is not usable)

const fs = require('fs');
const path = require('path');

const SCT_RELATION = 17792822;
const SCT_FILE = path.join(__dirname, '..', 'public', 'data', 'strefa-czystego-transportu.geojson');
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const WMS = ['https://wms.um.warszawa.pl/serwis', 'https://wms2.um.warszawa.pl/geoserver/wms/wms'];
const ZONE_RE = /parkow|sppn|p[łl]atn|czyst|\bsct\b|emisj/i;
const INSIDE = [52.2318, 21.0060]; // Palace of Culture: in the middle of the SCT
const OUTSIDE = [52.1650, 21.0900]; // Wilanów: well outside it
const AREA_KM2 = [25, 60]; // the city gives 37 km²
const TIMEOUT_MS = 90000;

// ---- Pure part (unit-tested) ----

const same = (a, b) => a[0] === b[0] && a[1] === b[1];

// Joins the ways of a multipolygon relation into closed rings (ways may run in either direction).
function stitch(ways) {
  const left = ways.filter((w) => w.length > 1).map((w) => w.slice());
  const rings = [];
  while (left.length) {
    const ring = left.shift();
    while (!same(ring[0], ring[ring.length - 1])) {
      const end = ring[ring.length - 1];
      const i = left.findIndex((w) => same(w[0], end) || same(w[w.length - 1], end));
      if (i < 0) throw new Error(`niedomknięty pierścień granicy (koniec w ${end[1]}, ${end[0]})`);
      const w = left.splice(i, 1)[0];
      ring.push(...(same(w[0], end) ? w : w.reverse()).slice(1));
    }
    if (ring.length < 4) throw new Error('pierścień granicy ma mniej niż 3 punkty');
    rings.push(ring);
  }
  return rings;
}

// Ray casting; ring and point are [lon, lat].
function inRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Area in km² (equirectangular projection around the ring, plenty for a city-sized zone).
function ringArea(ring) {
  const lat0 = (ring.reduce((s, p) => s + p[1], 0) / ring.length) * Math.PI / 180;
  const kx = 111.32 * Math.cos(lat0), ky = 110.57;
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] * kx) * (ring[i][1] * ky) - (ring[i][0] * kx) * (ring[j][1] * ky);
  return Math.abs(a) / 2;
}

// Overpass "out geom" relation -> GeoJSON Feature (Polygon or MultiPolygon), coordinates rounded to ~10 cm.
function relationToFeature(rel, props = {}) {
  const ways = (role) => rel.members.filter((m) => m.type === 'way' && (m.role || 'outer') === role && m.geometry)
    .map((m) => m.geometry.map((g) => [+g.lon.toFixed(6), +g.lat.toFixed(6)]));
  const outers = stitch(ways('outer')), inners = stitch(ways('inner'));
  if (!outers.length) throw new Error('relacja nie ma zewnętrznej granicy (role=outer)');
  const polys = outers.map((o) => [o]);
  for (const r of inners) {
    const owner = polys.find((p) => inRing(r[0], p[0]));
    if (owner) owner.push(r);
  }
  const geometry = polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys };
  return { type: 'Feature', properties: { ...props }, geometry };
}

const polygonsOf = (f) => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates);
const containsLatLng = (f, [lat, lon]) => polygonsOf(f).some((p) => inRing([lon, lat], p[0]) && !p.slice(1).some((h) => inRing([lon, lat], h)));
const featureArea = (f) => polygonsOf(f).reduce((s, p) => s + ringArea(p[0]) - p.slice(1).reduce((h, r) => h + ringArea(r), 0), 0);

// Problems that make the boundary unusable (empty list = fine).
function checkSct(f) {
  const problems = [], area = featureArea(f);
  if (area < AREA_KM2[0] || area > AREA_KM2[1]) problems.push(`powierzchnia ${area.toFixed(1)} km² poza zakresem ${AREA_KM2.join('–')} km²`);
  if (!containsLatLng(f, INSIDE)) problems.push('Pałac Kultury nie leży w strefie');
  if (containsLatLng(f, OUTSIDE)) problems.push('Wilanów leży w strefie');
  return problems;
}

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();

// WMS GetCapabilities XML -> [{ name, title, crs: [...] }] for every named layer (CRS inherited from parent layers).
function wmsLayers(xml) {
  const out = [], stack = [];
  const re = /<(\/?)(?:\w+:)?Layer\b[^>]*>/g;
  let m, last = 0;
  const own = (chunk, tag) => { const r = new RegExp(`<(?:\\w+:)?${tag}>([^<]*)</(?:\\w+:)?${tag}>`, 'g'); const v = []; let x; while ((x = r.exec(chunk))) v.push(decode(x[1])); return v; };
  const flush = (end) => {
    const top = stack[stack.length - 1];
    if (!top || top.done) return;
    const chunk = xml.slice(last, end);
    if (top.name == null) { top.name = own(chunk, 'Name')[0] || ''; top.title = own(chunk, 'Title')[0] || ''; }
    top.crs.push(...own(chunk, 'CRS'), ...own(chunk, 'SRS'));
  };
  while ((m = re.exec(xml))) {
    flush(m.index);
    if (m[1]) {
      const l = stack.pop();
      if (l && l.name) out.push({ name: l.name, title: l.title, crs: [...new Set(l.crs)] });
      if (stack.length) stack[stack.length - 1].done = true; // text after a child layer belongs to no Name/Title of the parent
    } else stack.push({ name: null, title: '', crs: stack.length ? [...stack[stack.length - 1].crs] : [], done: false });
    last = re.lastIndex;
  }
  return out;
}

// ---- Network part ----

async function overpass(query, fetchImpl = fetch) {
  const errors = [];
  for (const url of OVERPASS) {
    try {
      const res = await fetchImpl(url, { method: 'POST', body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) { errors.push(`${url}: ${e.message}`); }
  }
  throw new Error(errors.join('; '));
}

async function sct(log) {
  log('## Strefa Czystego Transportu (OpenStreetMap)\n');
  const data = await overpass(`[out:json][timeout:60];relation(${SCT_RELATION});out geom;`);
  const rel = data.elements && data.elements.find((e) => e.type === 'relation');
  if (!rel) throw new Error(`Overpass nie zwrócił relacji ${SCT_RELATION}`);
  const t = rel.tags || {};
  log(`Relacja [${SCT_RELATION}](https://www.openstreetmap.org/relation/${SCT_RELATION}): ${t.name || '(bez nazwy)'}, boundary=${t.boundary || '?'}, członków: ${rel.members.length}.`);
  const f = relationToFeature(rel, { name: t.name || 'Strefa Czystego Transportu', source: `OpenStreetMap, relacja ${SCT_RELATION}`,
    license: 'ODbL 1.0, © współtwórcy OpenStreetMap', osm_timestamp: data.osm3s && data.osm3s.timestamp_osm_base });
  const problems = checkSct(f);
  const points = polygonsOf(f).reduce((s, p) => s + p.reduce((n, r) => n + r.length, 0), 0);
  log(`Powierzchnia ${featureArea(f).toFixed(1).replace('.', ',')} km², ${polygonsOf(f).length} wielokąt(y), ${points} punktów.`);
  if (problems.length) throw new Error('granica nie przeszła kontroli: ' + problems.join('; '));
  fs.mkdirSync(path.dirname(SCT_FILE), { recursive: true });
  fs.writeFileSync(SCT_FILE, JSON.stringify({ type: 'FeatureCollection', features: [f] }) + '\n');
  log(`Zapisano \`public/data/${path.basename(SCT_FILE)}\` (${Math.round(fs.statSync(SCT_FILE).size / 1024)} KB).\n`);
}

async function wms(log) {
  log('## Warstwy stref w usługach WMS miasta\n');
  for (const base of WMS) {
    const url = `${base}?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      const xml = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${xml.slice(0, 200)}`);
      const layers = wmsLayers(xml), hits = layers.filter((l) => ZONE_RE.test(l.name + ' ' + l.title));
      log(`### ${base}\n\nWarstw: ${layers.length}, pasujących do stref: ${hits.length}.\n`);
      for (const l of hits) log(`- \`${l.name}\` – ${l.title} (EPSG:3857: ${l.crs.includes('EPSG:3857') ? 'tak' : 'nie'}; ${l.crs.slice(0, 6).join(', ')})`);
      log(`\n<details><summary>Wszystkie warstwy</summary>\n\n${layers.map((l) => `- \`${l.name}\` – ${l.title}`).join('\n')}\n</details>\n`);
    } catch (e) {
      log(`### ${base}\n\nBrak odpowiedzi: ${e.message}\n`);
    }
  }
}

if (require.main === module) {
  const log = (s) => console.log(s);
  (async () => {
    let ok = true;
    try { await sct(log); } catch (e) { ok = false; log(`**Błąd SCT:** ${e.message}\n`); }
    await wms(log);
    process.exit(ok ? 0 : 1);
  })();
}

module.exports = { stitch, inRing, ringArea, relationToFeature, containsLatLng, featureArea, checkSct, wmsLayers };
