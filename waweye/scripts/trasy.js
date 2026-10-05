'use strict';
// Route of the selected bus or tram: official ZTM GTFS (gtfs.ztm.waw.pl/last; the ZTM terms allow processing and
// publishing it) -> one small file per line in public/data/trasy/ plus index.json with the feed's validity.
// The GTFS server does not answer from GitHub's runners or the session sandbox (2026-10-05), so the feed is downloaded
// in a browser in Poland and processed here: node scripts/trasy.js <folder with routes, trips, shapes, stops, calendar,
// stop_times.txt or stop_times_part*.txt>. Prints a report in Polish; exit code 1 and nothing written when a check fails.
// The feed covers about 10 days; the app tells the user when its data is past that date.

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const OUT_DIR = path.join(__dirname, '..', 'public', 'data', 'trasy');
const TYPES = { 0: 'tram', 3: 'bus' }; // GTFS route_type; rail (2) is not in the vehicle API
const MIN_SHARE = 0.3; // a variant with at least this share of the main one's trips is kept (short turns, branches)
const MAX_VARIANTS = 3; // per direction
const AREA = { lat: [51.9, 52.6], lon: [20.5, 21.6] }; // Warsaw and the suburbs ZTM lines reach
const MIN_LINES = 250, MUST_HAVE = { 175: 'bus', 17: 'tram', N25: 'bus' };

// ---- Pure part (unit-tested) ----

const round = (x) => +(+x).toFixed(5); // ~1 m
const safeName = (line) => (/^[A-Za-z0-9-]+$/.test(line) ? line : null);

// One CSV line -> fields (quotes with "" inside, as in GTFS).
function splitCsv(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// counts: Map "dir|shape" -> trips. Returns per direction the main shape and the big other variants, most trips first.
function pickVariants(counts, minShare = MIN_SHARE, max = MAX_VARIANTS) {
  const byDir = new Map();
  for (const [key, n] of counts) {
    const [dir, shape] = key.split('|');
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push({ dir, shape, trips: n });
  }
  const out = [];
  for (const dir of [...byDir.keys()].sort()) {
    const list = byDir.get(dir).sort((a, b) => b.trips - a.trips || a.shape.localeCompare(b.shape));
    out.push(...list.filter((v) => v.trips >= list[0].trips * minShare).slice(0, max));
  }
  return out;
}

// Everything the line files need, from already parsed GTFS tables.
// routes: [{route_id, route_short_name, route_type}], trips: [{route_id, trip_id, direction_id, shape_id, trip_headsign}],
// stopTimes: Map trip_id -> [{stop_id, seq}], shapes: Map shape_id -> [[seq, lat, lon]], stops: Map stop_id -> {name, lat, lon}.
function buildLines({ routes, trips, stopTimes, shapes, stops }) {
  const routeOf = new Map(routes.filter((r) => TYPES[r.route_type]).map((r) => [r.route_id, r]));
  const lines = new Map();
  for (const t of trips) {
    const r = routeOf.get(t.route_id);
    if (!r || !t.shape_id) continue;
    const L = lines.get(r.route_short_name) || { line: r.route_short_name, type: TYPES[r.route_type], counts: new Map(), rep: new Map(), heads: new Map() };
    const key = `${t.direction_id || '0'}|${t.shape_id}`;
    L.counts.set(key, (L.counts.get(key) || 0) + 1);
    if (!L.rep.has(key)) L.rep.set(key, t.trip_id);
    const hk = key + '|' + t.trip_headsign;
    L.heads.set(hk, (L.heads.get(hk) || 0) + 1);
    lines.set(r.route_short_name, L);
  }
  const out = [];
  for (const L of lines.values()) {
    const variants = [];
    for (const v of pickVariants(L.counts)) {
      const key = `${v.dir}|${v.shape}`;
      const head = [...L.heads].filter(([k]) => k.startsWith(key + '|')).sort((a, b) => b[1] - a[1])[0];
      const pts = (shapes.get(v.shape) || []).slice().sort((a, b) => a[0] - b[0]).map(([, lat, lon]) => [round(lat), round(lon)]);
      const st = (stopTimes.get(L.rep.get(key)) || []).slice().sort((a, b) => a.seq - b.seq)
        .map((x) => stops.get(x.stop_id)).filter(Boolean).map((s) => [s.name, round(s.lat), round(s.lon)]);
      const variant = { dir: +v.dir, headsign: (head ? head[0].split('|').slice(2).join('|') : '').replace(/^.*?->\s*/, ''), trips: v.trips, shape: pts, stops: st };
      // The same stops under another shape_id (e.g. a weekday and a weekend copy) count as one variant.
      const same = variants.find((x) => x.dir === variant.dir && x.stops.map((q) => q[0]).join('|') === st.map((q) => q[0]).join('|'));
      if (same) same.trips += v.trips; else variants.push(variant);
    }
    out.push({ line: L.line, type: L.type, variants });
  }
  return out.sort((a, b) => a.line.localeCompare(b.line, 'pl', { numeric: true }));
}

// Problems that make the data unusable (empty list = fine).
function checkLines(lines) {
  const problems = [];
  if (lines.length < MIN_LINES) problems.push(`tylko ${lines.length} linii (oczekiwane co najmniej ${MIN_LINES})`);
  for (const [line, type] of Object.entries(MUST_HAVE)) {
    const L = lines.find((x) => x.line === line);
    if (!L) problems.push(`brak linii ${line}`); else if (L.type !== type) problems.push(`linia ${line} ma typ ${L.type}`);
  }
  for (const L of lines) {
    if (!safeName(L.line)) problems.push(`nazwa linii „${L.line}” nie nadaje się na nazwę pliku`);
    if (!L.variants.length) problems.push(`${L.line}: brak wariantów trasy`);
    for (const v of L.variants) {
      if (v.shape.length < 2) problems.push(`${L.line} (${v.headsign}): brak przebiegu`);
      if (v.stops.length < 2) problems.push(`${L.line} (${v.headsign}): mniej niż 2 przystanki`);
      const out = [...v.shape, ...v.stops.map((s) => [s[1], s[2]])].filter(([lat, lon]) => lat < AREA.lat[0] || lat > AREA.lat[1] || lon < AREA.lon[0] || lon > AREA.lon[1]);
      if (out.length) problems.push(`${L.line} (${v.headsign}): ${out.length} punktów poza okolicą Warszawy`);
    }
  }
  return problems;
}

// calendar.txt rows -> { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }.
function validity(calendar) {
  const d = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  const from = calendar.map((c) => c.start_date).sort()[0], to = calendar.map((c) => c.end_date).sort().pop();
  return from && to ? { from: d(from), to: d(to) } : null;
}

// ---- File part ----

// Streams a CSV file (or several parts with a header each) and calls onRow(object) for every data row.
async function readCsv(files, onRow) {
  for (const file of [].concat(files)) {
    let head = null;
    const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
    for await (const raw of rl) {
      const line = raw.replace(/^﻿/, '');
      if (!line) continue;
      if (!head) { head = splitCsv(line); continue; }
      const v = splitCsv(line), o = {};
      for (let i = 0; i < head.length; i++) o[head[i]] = v[i];
      onRow(o);
    }
  }
}

async function load(dir) {
  const f = (name) => path.join(dir, name);
  const parts = fs.readdirSync(dir).filter((n) => /^stop_times(_part\d+)?\.txt$/.test(n)).sort().map(f);
  if (!parts.length) throw new Error('brak stop_times.txt ani stop_times_part*.txt');
  const routes = [], trips = [], calendar = [];
  await readCsv(f('routes.txt'), (r) => routes.push(r));
  await readCsv(f('trips.txt'), (t) => trips.push({ route_id: t.route_id, trip_id: t.trip_id, direction_id: t.direction_id, shape_id: t.shape_id, trip_headsign: t.trip_headsign }));
  await readCsv(f('calendar.txt'), (c) => calendar.push(c));
  // Only the trips and shapes of the chosen variants are kept from the big files (stop_times is ~380 MB).
  const needTrips = new Set(), needShapes = new Set();
  const routeOf = new Map(routes.map((r) => [r.route_id, r]));
  const keyOf = new Map(); // line|dir|shape -> first trip
  for (const t of trips) {
    const r = routeOf.get(t.route_id);
    if (!r || !TYPES[r.route_type] || !t.shape_id) continue;
    const k = `${r.route_short_name}|${t.direction_id || '0'}|${t.shape_id}`;
    if (!keyOf.has(k)) keyOf.set(k, t.trip_id);
  }
  const counts = new Map();
  for (const t of trips) {
    const r = routeOf.get(t.route_id);
    if (!r || !TYPES[r.route_type] || !t.shape_id) continue;
    if (!counts.has(r.route_short_name)) counts.set(r.route_short_name, new Map());
    const m = counts.get(r.route_short_name), k = `${t.direction_id || '0'}|${t.shape_id}`;
    m.set(k, (m.get(k) || 0) + 1);
  }
  for (const [line, m] of counts) for (const v of pickVariants(m)) { needShapes.add(v.shape); needTrips.add(keyOf.get(`${line}|${v.dir}|${v.shape}`)); }
  const stopTimes = new Map(), shapes = new Map(), stops = new Map();
  await readCsv(parts, (s) => {
    if (!needTrips.has(s.trip_id)) return;
    if (!stopTimes.has(s.trip_id)) stopTimes.set(s.trip_id, []);
    stopTimes.get(s.trip_id).push({ stop_id: s.stop_id, seq: +s.stop_sequence });
  });
  await readCsv(f('shapes.txt'), (s) => {
    if (!needShapes.has(s.shape_id)) return;
    if (!shapes.has(s.shape_id)) shapes.set(s.shape_id, []);
    shapes.get(s.shape_id).push([+s.shape_pt_sequence, +s.shape_pt_lat, +s.shape_pt_lon]);
  });
  await readCsv(f('stops.txt'), (s) => stops.set(s.stop_id, { name: s.stop_name, lat: +s.stop_lat, lon: +s.stop_lon }));
  return { routes, trips, stopTimes, shapes, stops, calendar };
}

async function main(dir, log, outDir = OUT_DIR) {
  log('## Trasy linii z GTFS ZTM\n');
  const data = await load(dir);
  const valid = validity(data.calendar);
  log(`Rozkład ważny: ${valid ? `${valid.from} – ${valid.to}` : '?'}; kursów: ${data.trips.length}, przystanków: ${data.stops.size}.`);
  const lines = buildLines(data);
  const problems = checkLines(lines);
  if (!valid) problems.push('brak dat w calendar.txt');
  const nVar = lines.reduce((s, L) => s + L.variants.length, 0);
  log(`Linii: ${lines.length} (autobusy ${lines.filter((L) => L.type === 'bus').length}, tramwaje ${lines.filter((L) => L.type === 'tram').length}), wariantów tras: ${nVar}.`);
  if (problems.length) throw new Error('dane nie przeszły kontroli, pliki nie zostały zmienione: ' + problems.slice(0, 20).join('; ') + (problems.length > 20 ? ` (i ${problems.length - 20} więcej)` : ''));
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  let bytes = 0;
  for (const L of lines) {
    const body = JSON.stringify({ line: L.line, type: L.type, valid, variants: L.variants }) + '\n';
    fs.writeFileSync(path.join(outDir, `${L.line}.json`), body); bytes += body.length;
  }
  const index = { source: 'GTFS ZTM Warszawa (gtfs.ztm.waw.pl)', valid, generated: new Date().toISOString().slice(0, 10),
    lines: Object.fromEntries(lines.map((L) => [L.line, L.type])) };
  fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index) + '\n');
  log(`Zapisano ${lines.length} plików w \`public/data/trasy/\` (razem ${Math.round(bytes / 1024)} KB, średnio ${Math.round(bytes / lines.length / 1024)} KB) i \`index.json\`.\n`);
  return { lines, valid };
}

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) { console.error('Użycie: node scripts/trasy.js <folder z plikami GTFS>'); process.exit(2); }
  main(dir, (s) => console.log(s)).then(() => process.exit(0), (e) => { console.log(`**Błąd tras:** ${e.message}\n`); process.exit(1); });
}

module.exports = { splitCsv, pickVariants, buildLines, checkLines, validity, readCsv, main, TYPES };
