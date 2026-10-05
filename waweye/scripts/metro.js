'use strict';
// Metro layer data (run in GitHub Actions: .github/workflows/waweye-dane-metra.yml).
// The vehicle API has no metro and no reachable official dataset has it either (checked 2026-10-05: the ZTM GTFS at
// gtfs.ztm.waw.pl has no route_type 1 and no metro platforms, dane.um.warszawa.pl and the city's WMS do not answer from
// GitHub's runners). So the lines and stations come from OpenStreetMap (route=subway relations, ODbL; a map, not a timetable)
// -> public/data/metro.geojson, checked against the state of October 2026 before it is written.
// Run: node scripts/metro.js  (prints a Markdown report in Polish; exit code 1 and no write when a check fails)

const fs = require('fs');
const path = require('path');
const { relationToFeature, containsLatLng, featureArea } = require('./strefy');

const OUT_FILE = path.join(__dirname, '..', 'public', 'data', 'metro.geojson');
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
// OSM services refuse requests without an identifying User-Agent (overpass-api.de answered 406 to Node's default).
const HEADERS = { 'User-Agent': 'wawEye/1.0 (+https://github.com/pacy2u/waweye)', Accept: 'application/json' };
const TIMEOUT_MS = 120000;
const BBOX = '52.09,20.85,52.37,21.28';
// State of October 2026 (checked 2026-10-05 against the OSM relations and the ZTM GTFS, whose surface stops are named
// after the stations): M1 Kabaty–Młociny 21 stations, M2 Bemowo–Bródno 18; Świętokrzyska is on both, so 38 in all.
// The M2 extension to Karolin (Lazurowa, Chrzanów, Karolin) is not open yet; change these numbers when it opens.
const EXPECTED = { M1: 21, M2: 18 };
const EXPECTED_TOTAL = 38;
const COLOURS = { M1: '#0071BC', M2: '#C60C30' }; // the operator's line colours (OSM has M1 as plain "blue")
const DOWNTOWN = { lat: [52.225, 52.240], lon: [21.000, 21.020] }; // Śródmieście around Centrum and Świętokrzyska
const WARSAW_KM2 = [480, 560]; // the city gives 517 km²
const MATCH_M = 400; // a stop position lies within this distance of its station node

// ---- Pure part (unit-tested) ----

const round = (x) => +x.toFixed(5); // ~1 m
const sameP = (a, b) => a[0] === b[0] && a[1] === b[1];
const norm = (s) => (s || '').toLowerCase().replace(/[^a-ząćęłńóśźż0-9]/g, '');

// Distance in metres (equirectangular, plenty for a few hundred metres).
function metres(a, b) {
  const k = Math.PI / 180, x = (b.lon - a.lon) * k * Math.cos(((a.lat + b.lat) / 2) * k), y = (b.lat - a.lat) * k;
  return Math.hypot(x, y) * 6371000;
}

// Joins open ways ([lon, lat] arrays) that share end points into as few chains as possible.
function chains(ways) {
  const left = ways.filter((w) => w.length > 1).map((w) => w.slice());
  const out = [];
  while (left.length) {
    const c = left.shift();
    for (let grown = true; grown;) {
      grown = false;
      for (let i = 0; i < left.length; i++) {
        const w = left[i], s = c[0], e = c[c.length - 1];
        if (sameP(w[0], e)) c.push(...w.slice(1));
        else if (sameP(w[w.length - 1], e)) c.push(...w.reverse().slice(1));
        else if (sameP(w[w.length - 1], s)) c.unshift(...w.slice(0, -1));
        else if (sameP(w[0], s)) c.unshift(...w.reverse().slice(0, -1));
        else continue;
        left.splice(i, 1); grown = true; break;
      }
    }
    out.push(c);
  }
  return out;
}

// Overpass answer (route=subway relations with "out geom", station nodes, the city boundary relation)
// -> { fc: FeatureCollection of 2 lines + stations, boundary: Feature or null, problems: [...] }.
function buildMetro(data, stamp) {
  const problems = [];
  const els = data.elements || [];
  const routes = els.filter((e) => e.type === 'relation' && e.tags && e.tags.route === 'subway' && /^M\d+$/.test(e.tags.ref || ''));
  const stations = els.filter((e) => e.type === 'node' && e.tags && e.tags.railway === 'station' && (e.tags.station === 'subway' || e.tags.subway === 'yes'));
  const city = els.find((e) => e.type === 'relation' && e.tags && e.tags.boundary === 'administrative' && e.tags.name === 'Warszawa');
  let boundary = null;
  if (city) { try { boundary = relationToFeature(city, { name: 'Warszawa' }); } catch (e) { problems.push('granica Warszawy: ' + e.message); } }

  const refs = [...new Set(routes.map((r) => r.tags.ref))].sort();
  const lineFeatures = [], byStation = new Map();
  for (const ref of refs) {
    const rels = routes.filter((r) => r.tags.ref === ref).sort((a, b) => a.id - b.id);
    const ways = new Map();
    for (const r of rels) for (const m of r.members) {
      if (m.type === 'way' && !m.role && m.geometry && !ways.has(m.ref)) ways.set(m.ref, m.geometry.map((g) => [round(g.lon), round(g.lat)]));
    }
    const t = rels[0].tags;
    lineFeatures.push({ type: 'Feature',
      properties: { kind: 'line', ref, name: `Linia ${ref}`, colour: COLOURS[ref] || t.colour || '#555', from: t.from || '', to: t.to || '', osm_relations: rels.map((r) => r.id) },
      geometry: { type: 'MultiLineString', coordinates: chains([...ways.values()]) } });
    // Stations in the order of the first direction; every stop position is matched to its station node.
    for (const m of rels[0].members) {
      if (m.type !== 'node' || !/^stop(_entry_only|_exit_only)?$/.test(m.role) || m.lat == null) continue;
      let best = null, bestD = Infinity;
      for (const s of stations) {
        const d = metres(m, s) - (m.tags && norm(m.tags.name) === norm(s.tags.name) ? 50 : 0);
        if (d < bestD) { best = s; bestD = d; }
      }
      if (!best || bestD > MATCH_M) { problems.push(`${ref}: przystanek node/${m.ref} bez stacji w promieniu ${MATCH_M} m`); continue; }
      const st = byStation.get(best.id) || { node: best, lines: [] };
      if (!st.lines.includes(ref)) st.lines.push(ref);
      byStation.set(best.id, st);
    }
  }
  const stationFeatures = [...byStation.values()].map(({ node, lines }) => ({ type: 'Feature',
    properties: { kind: 'station', name: node.tags.name, lines, osm_id: `node/${node.id}` },
    geometry: { type: 'Point', coordinates: [round(node.lon), round(node.lat)] } }));
  const fc = { type: 'FeatureCollection',
    metadata: { source: 'OpenStreetMap (relacje route=subway M1, M2)', license: 'ODbL 1.0, © współtwórcy OpenStreetMap', osm_timestamp: stamp || null },
    features: [...lineFeatures, ...stationFeatures] };
  return { fc, boundary, problems };
}

// Problems that make the layer unusable (empty list = fine). boundary: the city's polygon Feature.
function checkMetro(fc, boundary) {
  const problems = [];
  const lines = fc.features.filter((f) => f.properties.kind === 'line');
  const stations = fc.features.filter((f) => f.properties.kind === 'station');
  const refs = lines.map((f) => f.properties.ref).sort();
  if (refs.join(',') !== Object.keys(EXPECTED).join(',')) problems.push(`linie: ${refs.join(', ') || 'brak'} (oczekiwane dokładnie M1 i M2)`);
  for (const [ref, n] of Object.entries(EXPECTED)) {
    const got = stations.filter((s) => s.properties.lines.includes(ref)).length;
    if (got !== n) problems.push(`${ref}: ${got} stacji (oczekiwane ${n})`);
  }
  if (stations.length !== EXPECTED_TOTAL) problems.push(`razem ${stations.length} stacji (oczekiwane ${EXPECTED_TOTAL})`);
  for (const f of lines) if (!f.geometry.coordinates.length) problems.push(`${f.properties.ref}: brak przebiegu`);
  for (const name of ['Centrum', 'Świętokrzyska']) {
    const s = stations.find((x) => x.properties.name === name);
    if (!s) { problems.push(`brak stacji ${name}`); continue; }
    const [lon, lat] = s.geometry.coordinates;
    if (lat < DOWNTOWN.lat[0] || lat > DOWNTOWN.lat[1] || lon < DOWNTOWN.lon[0] || lon > DOWNTOWN.lon[1]) problems.push(`stacja ${name} poza Śródmieściem (${lat}, ${lon})`);
  }
  const swk = stations.find((x) => x.properties.name === 'Świętokrzyska');
  if (swk && swk.properties.lines.slice().sort().join(',') !== 'M1,M2') problems.push('Świętokrzyska nie jest stacją przesiadkową M1/M2');
  if (!boundary) problems.push('brak granicy Warszawy do sprawdzenia');
  else {
    const area = featureArea(boundary);
    if (area < WARSAW_KM2[0] || area > WARSAW_KM2[1]) problems.push(`granica Warszawy ma ${area.toFixed(0)} km² (oczekiwane ${WARSAW_KM2.join('–')})`);
    const outside = [];
    for (const s of stations) { const [lon, lat] = s.geometry.coordinates; if (!containsLatLng(boundary, [lat, lon])) outside.push(s.properties.name); }
    for (const f of lines) {
      const n = f.geometry.coordinates.flat().filter(([lon, lat]) => !containsLatLng(boundary, [lat, lon])).length;
      if (n) outside.push(`${f.properties.ref} (${n} pkt)`);
    }
    if (outside.length) problems.push('poza granicami Warszawy: ' + outside.join(', '));
  }
  return problems;
}

// ---- Network part ----

async function overpass(query, fetchImpl = fetch) {
  const errors = [];
  for (const url of OVERPASS) {
    try {
      const res = await fetchImpl(url, { method: 'POST', headers: HEADERS, body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
      const data = await res.json();
      if (!data.elements || !data.elements.length) throw new Error('pusta odpowiedź');
      return { data, via: url };
    } catch (e) { errors.push(`${url}: ${e.message}`); }
  }
  throw new Error(errors.join('; '));
}

const QUERY = `[out:json][timeout:120];
relation["route"="subway"](${BBOX});out geom;
(node["railway"="station"]["station"="subway"](${BBOX});node["railway"="station"]["subway"="yes"](${BBOX}););out body;
relation["boundary"="administrative"]["admin_level"="6"]["name"="Warszawa"];out geom;`;

async function main(log, opts = {}) {
  log('## Metro M1 i M2 (OpenStreetMap)\n');
  const { data, via } = opts.data ? { data: opts.data, via: 'plik' } : await overpass(QUERY);
  const stamp = data.osm3s && data.osm3s.timestamp_osm_base;
  log(`Źródło: ${via}, stan danych OSM: ${stamp || '?'}.`);
  const { fc, boundary, problems } = buildMetro(data, stamp);
  problems.push(...checkMetro(fc, boundary));
  for (const f of fc.features.filter((x) => x.properties.kind === 'line')) {
    const n = fc.features.filter((s) => s.properties.kind === 'station' && s.properties.lines.includes(f.properties.ref)).length;
    log(`- ${f.properties.ref} (${f.properties.from} – ${f.properties.to}): ${n} stacji, ${f.geometry.coordinates.length} odcinek(i) przebiegu, ${f.geometry.coordinates.flat().length} punktów, relacje ${f.properties.osm_relations.join(', ')}`);
  }
  log(`- stacji razem: ${fc.features.filter((x) => x.properties.kind === 'station').length}\n`);
  if (problems.length) throw new Error('dane nie przeszły kontroli, plik nie został zmieniony: ' + problems.join('; '));
  const out = opts.out || OUT_FILE;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(fc) + '\n');
  log(`Zapisano \`public/data/${path.basename(out)}\` (${Math.round(fs.statSync(out).size / 1024)} KB).\n`);
}

if (require.main === module) {
  const log = (s) => console.log(s);
  const file = process.argv[2]; // optional: a saved Overpass answer (local testing)
  main(log, file ? { data: JSON.parse(fs.readFileSync(file, 'utf8')) } : {})
    .then(() => process.exit(0), (e) => { log(`**Błąd metra:** ${e.message}\n`); process.exit(1); });
}

module.exports = { chains, metres, buildMetro, checkMetro, overpass, main, EXPECTED, EXPECTED_TOTAL, COLOURS, QUERY, HEADERS };
