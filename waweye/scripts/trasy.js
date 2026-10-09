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
const HOURS = 30; // GTFS times of a service day go past 24:00 (night trips), up to ~29:59
const MIN_DAYS = 3, MIN_DEPARTURES = 5000; // per day in the real timetable (~20 thousand)

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

// ---- Departures per hour (the timelapse in the app: how many vehicles a line runs at a given time) ----

// Dates 'YYYY-MM-DD' a service runs on, from calendar.txt (weekdays within a range) and calendar_dates.txt (1 = added,
// 2 = removed). Returns Map service_id -> Set of dates.
function serviceDates(calendar, calendarDates = []) {
  const iso = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  const DAY_COL = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const out = new Map();
  const add = (sid, date) => { if (!out.has(sid)) out.set(sid, new Set()); out.get(sid).add(date); };
  for (const c of calendar) {
    if (!/^\d{8}$/.test(c.start_date || '') || !/^\d{8}$/.test(c.end_date || '')) continue;
    const end = Date.parse(iso(c.end_date) + 'T12:00:00Z');
    for (let t = Date.parse(iso(c.start_date) + 'T12:00:00Z'), n = 0; t <= end && n < 400; t += 864e5, n++) {
      if (c[DAY_COL[new Date(t).getUTCDay()]] === '1') add(c.service_id, new Date(t).toISOString().slice(0, 10));
    }
  }
  for (const d of calendarDates) {
    if (!/^\d{8}$/.test(d.date || '')) continue;
    if (d.exception_type === '1') add(d.service_id, iso(d.date));
    else if (d.exception_type === '2' && out.has(d.service_id)) out.get(d.service_id).delete(iso(d.date));
  }
  return out;
}

// Trips leaving the first stop in each hour of the service day, per date, line and direction:
// { 'YYYY-MM-DD': { '175': [[...dir 0], [...dir 1]] } }; index = hour (0–29), trailing zeros dropped.
// firstHour: Map trip_id -> hour of its first departure.
function departures({ routes, trips, calendar, calendarDates, firstHour }) {
  const routeOf = new Map(routes.filter((r) => TYPES[r.route_type]).map((r) => [r.route_id, r]));
  const dates = serviceDates(calendar, calendarDates);
  const days = {};
  for (const t of trips) {
    const r = routeOf.get(t.route_id), h = firstHour.get(t.trip_id), on = dates.get(t.service_id);
    if (!r || h == null || h >= HOURS || !on) continue;
    const dir = +(t.direction_id || 0) ? 1 : 0;
    for (const date of on) {
      const day = days[date] || (days[date] = {});
      const L = day[r.route_short_name] || (day[r.route_short_name] = [[], []]);
      const a = L[dir];
      while (a.length <= h) a.push(0);
      a[h]++;
    }
  }
  return Object.fromEntries(Object.keys(days).sort().map((d) => [d, days[d]]));
}
const dayTotal = (day) => Object.values(day).reduce((n, L) => n + L[0].reduce((a, b) => a + b, 0) + L[1].reduce((a, b) => a + b, 0), 0);
const dayHash = (day) => require('crypto').createHash('sha1').update(JSON.stringify(day)).digest('hex').slice(0, 16);

function checkDays(days) {
  const problems = [], dates = Object.keys(days);
  if (dates.length < MIN_DAYS) problems.push(`rozkład godzinowy tylko na ${dates.length} dni (oczekiwane co najmniej ${MIN_DAYS})`);
  for (const d of dates) {
    const n = dayTotal(days[d]);
    if (n < MIN_DEPARTURES) problems.push(`${d}: tylko ${n} kursów (oczekiwane co najmniej ${MIN_DEPARTURES})`);
    for (const line of Object.keys(MUST_HAVE)) if (!days[d][line]) problems.push(`${d}: brak kursów linii ${line}`);
    // Night lines run at night: N25 has departures after 23:00 or before 5:00.
    const N = days[d].N25;
    if (N && !N.some((a) => a.some((x, h) => x && (h >= 23 || h < 5)))) problems.push(`${d}: linia N25 bez kursów nocą`);
  }
  return problems;
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

// What is stored for a line (public/data/trasy/<line>.json and the route store in Cloudflare KV); the timetable's
// validity is kept beside it, so a new day of the same timetable does not change the line.
const lineBody = (L) => ({ line: L.line, type: L.type, variants: L.variants });
// Fingerprint of a line that ignores the trip counts and the variant order (they shift every day with the calendar
// window), so only real changes of a route or its stops are written again.
function lineHash(L) {
  const canon = L.variants.map((v) => JSON.stringify([v.dir, v.headsign, v.shape, v.stops])).sort();
  return require('crypto').createHash('sha1').update(JSON.stringify([L.line, L.type, canon])).digest('hex').slice(0, 16);
}

// The whole pipeline from a GTFS ZIP in memory: { lines, valid, problems } (problems empty = usable).
async function fromZip(buf) {
  const data = await load(require('../lib/zip').readZip(buf));
  const valid = validity(data.calendar);
  const lines = buildLines(data);
  const days = departures(data);
  const problems = [...checkLines(lines), ...checkDays(days)];
  if (!valid) problems.push('brak dat w calendar.txt');
  return { lines, valid, problems, trips: data.trips.length, days };
}

// ---- File part ----

// Streams CSV sources (file paths or functions returning a readable stream; several parts with a header each)
// and calls onRow(object) for every data row.
async function readCsv(sources, onRow) {
  for (const source of [].concat(sources)) {
    let head = null;
    const input = typeof source === 'function' ? source() : fs.createReadStream(source);
    input.setEncoding('utf8');
    const rl = readline.createInterface({ input, crlfDelay: Infinity });
    for await (const raw of rl) {
      const line = raw.replace(/^\uFEFF/, '');
      if (!line) continue;
      if (!head) { head = splitCsv(line); continue; }
      const v = splitCsv(line), o = {};
      for (let i = 0; i < head.length; i++) o[head[i]] = v[i];
      onRow(o);
    }
  }
}

// GTFS files from a folder (path) or from a ZIP read by lib/zip.js (Map name -> { open }), by base name.
function gtfsFiles(src) {
  if (typeof src === 'string') {
    const names = fs.readdirSync(src);
    return { names, open: (n) => path.join(src, n) };
  }
  const byBase = new Map([...src].map(([name, f]) => [path.posix.basename(name), f]));
  return { names: [...byBase.keys()], open: (n) => { const f = byBase.get(n); if (!f) throw new Error(`brak pliku ${n} w GTFS`); return () => f.open(); } };
}

async function load(src) {
  const g = gtfsFiles(src), f = g.open;
  const parts = g.names.filter((n) => /^stop_times(_part\d+)?\.txt$/.test(n)).sort().map(f);
  if (!parts.length) throw new Error('brak stop_times.txt ani stop_times_part*.txt');
  const routes = [], trips = [], calendar = [], calendarDates = [];
  await readCsv(f('routes.txt'), (r) => routes.push(r));
  await readCsv(f('trips.txt'), (t) => trips.push({ route_id: t.route_id, service_id: t.service_id, trip_id: t.trip_id, direction_id: t.direction_id, shape_id: t.shape_id, trip_headsign: t.trip_headsign }));
  await readCsv(f('calendar.txt'), (c) => calendar.push(c));
  if (g.names.includes('calendar_dates.txt')) await readCsv(f('calendar_dates.txt'), (c) => calendarDates.push(c));
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
  // First departure of every bus and tram trip (the row with the lowest stop_sequence), packed as seq * 64 + hour.
  const busTram = new Set(trips.filter((t) => { const r = routeOf.get(t.route_id); return r && TYPES[r.route_type]; }).map((t) => t.trip_id));
  const first = new Map();
  await readCsv(parts, (s) => {
    if (busTram.has(s.trip_id)) {
      const seq = +s.stop_sequence, h = parseInt(s.departure_time || s.arrival_time, 10), old = first.get(s.trip_id);
      if (Number.isFinite(seq) && h >= 0 && (old === undefined || seq < Math.floor(old / 64))) first.set(s.trip_id, seq * 64 + Math.min(h, 63));
    }
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
  const firstHour = new Map([...first].map(([k, v]) => [k, v % 64]));
  return { routes, trips, stopTimes, shapes, stops, calendar, calendarDates, firstHour };
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
  const days = departures(data);
  problems.push(...checkDays(days));
  log(`Kursy z pętli na godziny: ${Object.keys(days).length} dni (${Object.entries(days).map(([d, x]) => `${d}: ${dayTotal(x)}`).join(', ')}); w aplikacji z magazynu tras (/api/trasa?dzien=), bez plików.`);
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

module.exports = { splitCsv, pickVariants, buildLines, checkLines, validity, readCsv, load, main, fromZip, lineBody, lineHash, TYPES, serviceDates, departures, checkDays, dayHash, dayTotal };
