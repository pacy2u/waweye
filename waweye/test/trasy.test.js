'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { splitCsv, pickVariants, buildLines, checkLines, validity, main } = require('../scripts/trasy');
const { project, chooseVariants, mainPerDirection, expired } = require('../public/trasa');

test('splitCsv reads GTFS quoting', () => {
  assert.deepEqual(splitCsv('1,"Pl. Piłsudskiego","a,b","say ""hi""",'), ['1', 'Pl. Piłsudskiego', 'a,b', 'say "hi"', '']);
});
test('pickVariants keeps the main shape of each direction and the big others', () => {
  const v = pickVariants(new Map([['0|A', 100], ['0|B', 40], ['0|C', 10], ['1|D', 90], ['1|E', 5]]));
  assert.deepEqual(v.map((x) => x.shape), ['A', 'B', 'D']);
  assert.deepEqual(pickVariants(new Map([['0|A', 10], ['0|B', 10], ['0|C', 10], ['0|D', 10]])).length, 3, 'at most 3 per direction');
});

// A tiny network: bus 175 in two directions (+ a weekend copy with the same stops), tram 17, a train (left out).
const tables = () => ({
  routes: [{ route_id: '0_175', route_short_name: '175', route_type: '3' }, { route_id: '6_175', route_short_name: '175', route_type: '3' },
    { route_id: '0_17', route_short_name: '17', route_type: '0' }, { route_id: '0_S1', route_short_name: 'S1', route_type: '2' }],
  trips: [
    ...Array.from({ length: 5 }, (_, i) => ({ route_id: '0_175', trip_id: 'a' + i, direction_id: '0', shape_id: 'S0', trip_headsign: '175 -> Pl. Piłsudskiego' })),
    ...Array.from({ length: 3 }, (_, i) => ({ route_id: '6_175', trip_id: 'w' + i, direction_id: '0', shape_id: 'S0w', trip_headsign: '175 -> Pl. Piłsudskiego' })),
    ...Array.from({ length: 4 }, (_, i) => ({ route_id: '0_175', trip_id: 'b' + i, direction_id: '1', shape_id: 'S1', trip_headsign: '175 -> Lotnisko Chopina' })),
    { route_id: '0_17', trip_id: 't0', direction_id: '0', shape_id: 'T0', trip_headsign: '17 -> Winnica' },
    { route_id: '0_S1', trip_id: 'k0', direction_id: '0', shape_id: 'K0', trip_headsign: 'S1 -> Otwock' }],
  stopTimes: new Map([['a0', [{ stop_id: '2', seq: 1 }, { stop_id: '1', seq: 0 }]], ['w0', [{ stop_id: '1', seq: 0 }, { stop_id: '2', seq: 1 }]],
    ['b0', [{ stop_id: '2', seq: 0 }, { stop_id: '1', seq: 1 }]], ['t0', [{ stop_id: '1', seq: 0 }, { stop_id: '3', seq: 1 }]]]),
  shapes: new Map([['S0', [[1, 52.21, 21.0], [0, 52.20, 21.0]]], ['S0w', [[0, 52.20, 21.0], [1, 52.21, 21.0]]], ['S1', [[0, 52.21, 21.0], [1, 52.20, 21.0]]],
    ['T0', [[0, 52.20, 21.0], [1, 52.20, 21.02]]]]),
  stops: new Map([['1', { name: 'Lotnisko Chopina', lat: 52.2, lon: 21.0 }], ['2', { name: 'Pl. Piłsudskiego', lat: 52.21, lon: 21.0 }], ['3', { name: 'Winnica', lat: 52.2, lon: 21.02 }]]),
});
test('buildLines makes ordered variants per line, merges same-stop copies and leaves rail out', () => {
  const lines = buildLines(tables());
  assert.deepEqual(lines.map((L) => [L.line, L.type]), [['17', 'tram'], ['175', 'bus']]);
  const bus = lines[1];
  assert.equal(bus.variants.length, 2, 'the weekend copy is merged into the main variant');
  const [to, back] = bus.variants;
  assert.equal(to.headsign, 'Pl. Piłsudskiego'); assert.equal(to.trips, 8); assert.equal(to.dir, 0);
  assert.deepEqual(to.shape, [[52.2, 21], [52.21, 21]], 'shape points in sequence order');
  assert.deepEqual(to.stops.map((s) => s[0]), ['Lotnisko Chopina', 'Pl. Piłsudskiego'], 'stops in sequence order');
  assert.equal(back.headsign, 'Lotnisko Chopina');
});
test('checkLines wants enough lines, the known ones and usable variants', () => {
  const p = checkLines(buildLines(tables()));
  assert.ok(p.some((x) => /tylko 2 linii/.test(x)));
  assert.ok(p.some((x) => /brak linii N25/.test(x)));
  const bad = [{ line: '1/2', type: 'bus', variants: [{ headsign: 'X', shape: [[52.2, 21]], stops: [['A', 50.0, 19.9]] }] }];
  const q = checkLines(bad).join('; ');
  assert.match(q, /nazwę pliku/); assert.match(q, /brak przebiegu/); assert.match(q, /mniej niż 2 przystanki/); assert.match(q, /poza okolicą Warszawy/);
});
test('validity spans the calendar', () => {
  assert.deepEqual(validity([{ start_date: '20261006', end_date: '20261006' }, { start_date: '20261005', end_date: '20261014' }]), { from: '2026-10-05', to: '2026-10-14' });
  assert.equal(validity([]), null);
});
test('main reads GTFS files (stop_times in parts) and refuses to write unusable data', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtfs-'));
  const w = (n, s) => fs.writeFileSync(path.join(dir, n), '﻿' + s);
  w('routes.txt', 'route_id,agency_id,route_short_name,route_long_name,route_desc,route_type\n0_175,2,"175","","",3\n');
  w('trips.txt', 'route_id,service_id,trip_id,trip_headsign,direction_id,shape_id\n0_175,0_2,a0,"175 -> Pl. Piłsudskiego",0,S0\n');
  w('calendar.txt', 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n0_2,1,0,0,0,0,0,0,20261005,20261014\n');
  w('stops.txt', 'stop_id,stop_code,stop_name,stop_lat,stop_lon\n1,01,"Lotnisko Chopina",52.17,20.97\n2,01,"Pl. Piłsudskiego",52.24,21.01\n');
  w('shapes.txt', 'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\nS0,52.17,20.97,0\nS0,52.24,21.01,1\n');
  const h = 'trip_id,arrival_time,departure_time,stop_id,stop_sequence,stop_headsign,pickup_type,drop_off_type,shape_dist_traveled,timepoint\n';
  w('stop_times_part1.txt', h + 'a0,06:00:00,06:00:00,1,0,"",0,0,0.0,1\n');
  w('stop_times_part2.txt', h + 'a0,06:20:00,06:20:00,2,1,"",0,0,9.0,1\n');
  const out = path.join(dir, 'out'), logs = [];
  await assert.rejects(main(dir, (s) => logs.push(s), out), /nie przeszły kontroli/);
  assert.ok(!fs.existsSync(out), 'nothing written');
  assert.match(logs.join('\n'), /2026-10-05 – 2026-10-14/);
});

// Variant choice in the browser (public/trasa.js). Two directions on the same street, north–south.
const S = [[52.20, 21.0], [52.21, 21.0], [52.22, 21.0]];
const variants = [{ dir: 0, headsign: 'Północ', trips: 10, shape: S, stops: [] }, { dir: 1, headsign: 'Południe', trips: 9, shape: S.slice().reverse(), stops: [] },
  { dir: 0, headsign: 'Zjazd', trips: 2, shape: [[52.20, 21.0], [52.20, 21.03]], stops: [] }];
test('project gives the distance to a polyline and the position along it', () => {
  const p = project([52.21, 21.001], S);
  assert.ok(p.d > 60 && p.d < 75, 'about 68 m east of the line: ' + p.d);
  assert.ok(Math.abs(p.s - 1112) < 5, 'about 1.1 km along: ' + p.s);
});
test('chooseVariants follows the direction of movement', () => {
  const north = chooseVariants(variants, [[52.205, 21.0], [52.206, 21.0], [52.207, 21.0]]);
  assert.ok(north.known); assert.deepEqual(north.variants.map((v) => v.headsign), ['Północ']);
  const south = chooseVariants(variants, [[52.207, 21.0], [52.205, 21.0]]);
  assert.ok(south.known); assert.deepEqual(south.variants.map((v) => v.headsign), ['Południe']);
});
test('chooseVariants shows both directions while unsure', () => {
  const still = chooseVariants(variants, [[52.205, 21.0], [52.20501, 21.0]]);
  assert.ok(!still.known); assert.deepEqual(still.variants.map((v) => v.headsign), ['Północ', 'Południe']);
  const far = chooseVariants(variants, [[52.30, 21.2], [52.31, 21.2]]);
  assert.ok(!far.known); assert.equal(far.variants.length, 2, 'away from the route: the main variant of each direction');
  assert.deepEqual(mainPerDirection(variants).map((v) => v.headsign), ['Północ', 'Południe']);
});
test('expired compares the last day of the timetable with today in Warsaw', () => {
  assert.equal(expired({ to: '2026-10-14' }, '2026-10-14'), false);
  assert.equal(expired({ to: '2026-10-14' }, '2026-10-15'), true);
  assert.equal(expired(null, '2026-10-15'), false);
});

// The committed files (written by scripts/trasy.js from the ZTM GTFS) must still be usable.
const DIR = path.join(__dirname, '..', 'public', 'data', 'trasy');
test('committed route files are plausible', { skip: !fs.existsSync(path.join(DIR, 'index.json')) && 'brak plików – uruchom scripts/trasy.js' }, () => {
  const index = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8'));
  assert.match(index.source, /GTFS ZTM/); assert.match(index.valid.to, /^\d{4}-\d{2}-\d{2}$/);
  const names = Object.keys(index.lines);
  assert.ok(names.length >= 250);
  const lines = names.map((n) => JSON.parse(fs.readFileSync(path.join(DIR, n + '.json'), 'utf8')));
  assert.deepEqual(checkLines(lines), []);
  const L175 = lines.find((L) => L.line === '175');
  assert.ok(L175.variants.some((v) => v.stops.some((s) => /Lotnisko Chopina/.test(s[0]))));
});

// ---- Automatic refresh: ZIP reader, Worker route store, /api/trasa and /api/odswiez-trasy ----
const { readZip } = require('../lib/zip');
const { lineBody, lineHash, fromZip } = require('../scripts/trasy');
const MINI = fs.readFileSync(path.join(__dirname, 'dane', 'gtfs-mini.zip'));

test('readZip streams stored, deflated and ZIP64 entries', async () => {
  const z = readZip(MINI);
  assert.deepEqual([...z.keys()].sort(), ['calendar.txt', 'routes.txt', 'shapes.txt', 'stop_times.txt', 'stops.txt', 'trips.txt']);
  const text = async (n) => { let s = ''; for await (const c of z.get(n).open()) s += c; return s; };
  assert.match(await text('calendar.txt'), /20261005,20261014/); // stored
  assert.equal((await text('stop_times.txt')).trim().split('\n').length, 7); // deflated, ZIP64 local header
  assert.throws(() => readZip(Buffer.from('not a zip at all, definitely not')), /nie jest plik ZIP/);
});
test('fromZip runs the whole pipeline on a GTFS ZIP in memory', async () => {
  const r = await fromZip(MINI);
  assert.deepEqual(r.valid, { from: '2026-10-05', to: '2026-10-14' });
  assert.deepEqual(r.lines.map((L) => L.line), ['17', '175'], 'rail left out');
  assert.deepEqual(r.lines[1].variants.map((v) => v.stops.map((s) => s[0])), [['Lotnisko Chopina', 'Pl. Piłsudskiego'], ['Pl. Piłsudskiego', 'Lotnisko Chopina']]);
  assert.ok(r.problems.some((p) => /tylko 2 linii/.test(p)), 'the real checks run');
});
test('lineHash ignores trip counts and variant order, but not stops', () => {
  const L = { line: '175', type: 'bus', variants: [{ dir: 0, headsign: 'A', trips: 5, shape: [[1, 2]], stops: [['X', 1, 2]] }, { dir: 1, headsign: 'B', trips: 4, shape: [[3, 4]], stops: [['Y', 3, 4]] }] };
  const same = { ...L, variants: [{ ...L.variants[1], trips: 40 }, { ...L.variants[0], trips: 50 }] };
  assert.equal(lineHash(L), lineHash(same));
  assert.notEqual(lineHash(L), lineHash({ ...L, variants: [L.variants[0], { ...L.variants[1], stops: [['Z', 3, 4]] }] }));
  assert.deepEqual(Object.keys(lineBody(L)), ['line', 'type', 'variants']);
});

// A Worker with an in-memory KV, called the way Vercel calls it.
async function fakeWorker() {
  const { handle } = await import('../worker/index.js');
  const kv = new Map(), writes = [];
  const env = { PROXY_SECRET: 's', GEOKODY: { get: async (k) => (kv.has(k) ? kv.get(k) : null), put: async (k, v) => { writes.push(k); kv.set(k, v); }, delete: async (k) => { writes.push('-' + k); kv.delete(k); } } };
  const fetchImpl = async (url, init = {}) => {
    if (url.startsWith('https://w.dev')) return handle(new Request(url, { method: init.method || 'GET', headers: init.headers, body: init.body }), env, fetchImpl);
    if (url === 'https://gtfs.ztm.waw.pl/last') return new Response(MINI, { status: 200 });
    throw new Error('unexpected ' + url);
  };
  return { kv, writes, env, fetchImpl, handle };
}
const call = async (handler, url, opts, headers = {}) => {
  const res = { headers: {}, statusCode: 0, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  await handler({ method: 'GET', url, headers }, res, opts);
  return { status: res.statusCode, body: JSON.parse(res.body), cache: res.headers['Cache-Control'] };
};
const ENV = { UPSTREAM_URL: 'https://w.dev', UPSTREAM_SECRET: 's' };

test('worker route store: read, write in batches, delete, meta; needs the secret and valid names', async () => {
  const w = await fakeWorker();
  const req = (q, init = {}, secret = 's') => new Request('https://w.dev/?resource=trasy' + q, { ...init, headers: { 'x-proxy-secret': secret, ...(init.headers || {}) } });
  assert.equal((await w.handle(req('&linia=175', {}, 'x'), w.env)).status, 403);
  assert.equal((await w.handle(req('&linia=175'), w.env)).status, 404);
  assert.equal((await w.handle(req('&linia=../x'), w.env)).status, 400);
  const post = (body) => w.handle(req('', { method: 'POST', body: JSON.stringify(body) }), w.env);
  assert.equal((await post({ put: { 175: '{"line":"175"}' }, meta: '{"refreshed":"t"}' })).status, 200);
  assert.equal(await (await w.handle(req('&linia=175'), w.env)).text(), '{"line":"175"}');
  assert.equal(await (await w.handle(req('&meta=1'), w.env)).text(), '{"refreshed":"t"}');
  assert.equal((await post({ put: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [String(i), '{}'])) })).status, 400, 'at most 20 per request');
  assert.equal((await post({ put: { 175: { not: 'a string' } } })).status, 400);
  assert.equal((await post({ del: ['175'] })).status, 200);
  assert.equal((await w.handle(req('&linia=175'), w.env)).status, 404);
  assert.equal((await w.handle(req('&linia=175'), { PROXY_SECRET: 's' })).status, 501, 'no KV binding');
});

test('refresh: checks the data and writes nothing when it fails; then writes only changed lines and the meta last', async () => {
  const { routesRefreshHandler, routeHandler, resetRouteState } = require('../lib/handler');
  const w = await fakeWorker();
  let t = Date.parse('2026-10-06T02:00:00Z');
  const now = () => t;
  resetRouteState();
  // The mini GTFS has 2 lines, far below the real minimum: nothing is written.
  let r = await call(routesRefreshHandler, '/api/odswiez-trasy', { env: ENV, fetchImpl: w.fetchImpl, now });
  assert.equal(r.status, 502); assert.match(r.body.error, /nie przeszły kontroli/); assert.equal(w.writes.length, 0);
  // With the checks passing (build stands in for scripts/trasy.js on a full timetable):
  const built = await fromZip(MINI);
  const build = async () => ({ ...built, problems: [] });
  resetRouteState();
  r = await call(routesRefreshHandler, '/api/odswiez-trasy', { env: ENV, fetchImpl: w.fetchImpl, now, build });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.lines, 2); assert.equal(r.body.changed, 2); assert.equal(r.body.via, 'bezpośrednio');
  assert.equal(w.writes.at(-1), 'trasy:v1:meta', 'meta written last');
  // The app reads a line with the timetable's validity; CDN may keep it for an hour.
  const line = await call(routeHandler, '/api/trasa?linia=175', { env: ENV, fetchImpl: w.fetchImpl });
  assert.equal(line.status, 200); assert.equal(line.body.line, '175'); assert.deepEqual(line.body.valid, { from: '2026-10-05', to: '2026-10-14' });
  assert.match(line.cache, /s-maxage=3600/);
  assert.equal((await call(routeHandler, '/api/trasa?linia=999', { env: ENV, fetchImpl: w.fetchImpl })).status, 404);
  const meta = await call(routeHandler, '/api/trasa?meta=1', { env: ENV, fetchImpl: w.fetchImpl });
  assert.equal(meta.body.lines, 2); assert.equal(meta.body.refreshed, '2026-10-06T02:00:00.000Z'); assert.ok(!('hashes' in meta.body));
  // Called again within 12 h: nothing happens (anyone may call it when there is no CRON_SECRET).
  t += 3600e3;
  r = await call(routesRefreshHandler, '/api/odswiez-trasy', { env: ENV, fetchImpl: w.fetchImpl, now, build });
  assert.match(r.body.skipped, /niedawno/);
  // A day later with the same timetable: only the meta key is written again.
  t += 24 * 3600e3; resetRouteState(); w.writes.length = 0;
  r = await call(routesRefreshHandler, '/api/odswiez-trasy', { env: ENV, fetchImpl: w.fetchImpl, now, build });
  assert.equal(r.body.changed, 0); assert.deepEqual(w.writes, ['trasy:v1:meta']);
  // A line gone from the timetable is deleted.
  t += 24 * 3600e3; resetRouteState(); w.writes.length = 0;
  r = await call(routesRefreshHandler, '/api/odswiez-trasy', { env: ENV, fetchImpl: w.fetchImpl, now, build: async () => ({ ...built, lines: built.lines.slice(1), problems: [] }) });
  assert.equal(r.body.deleted, 1); assert.ok(w.writes.includes('-trasy:v1:line:17'));
  // With CRON_SECRET set only Vercel's cron (or the proxy secret) may run it.
  resetRouteState();
  assert.equal((await call(routesRefreshHandler, '/api/odswiez-trasy', { env: { ...ENV, CRON_SECRET: 'c' }, fetchImpl: w.fetchImpl, now, build })).status, 401);
  assert.notEqual((await call(routesRefreshHandler, '/api/odswiez-trasy', { env: { ...ENV, CRON_SECRET: 'c' }, fetchImpl: w.fetchImpl, now, build }, { authorization: 'Bearer c' })).status, 401);
});

test('refresh falls back to the Worker when the direct download fails; /api/trasa without a Worker is a 404', async () => {
  const { routesRefreshHandler, routeHandler, resetRouteState } = require('../lib/handler');
  const w = await fakeWorker();
  const built = await fromZip(MINI);
  const viaWorker = async (url, init) => {
    if (url === 'https://gtfs.ztm.waw.pl/last') throw new Error('connect timeout');
    if (url === 'https://w.dev?resource=gtfs') return new Response(MINI, { status: 200 });
    return w.fetchImpl(url, init);
  };
  resetRouteState();
  const r = await call(routesRefreshHandler, '/api/odswiez-trasy', { env: ENV, fetchImpl: viaWorker, now: () => Date.parse('2026-10-06T02:00:00Z'), build: async (buf) => { assert.ok(buf.length > 100); return { ...built, problems: [] }; } });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.match(r.body.via, /przez Workera \(bezpośrednio: connect timeout\)/);
  assert.equal((await call(routeHandler, '/api/trasa?linia=175', { env: {}, fetchImpl: viaWorker })).status, 404);
});

// ---- Departures per hour (timelapse) ----
const { serviceDates, departures, checkDays, dayHash } = require('../scripts/trasy');

test('serviceDates: weekdays within the range, plus and minus calendar_dates', () => {
  const cal = [{ service_id: 'W', monday: '1', tuesday: '0', wednesday: '0', thursday: '0', friday: '0', saturday: '1', sunday: '0', start_date: '20261005', end_date: '20261012' }];
  const d = serviceDates(cal, [{ service_id: 'W', date: '20261010', exception_type: '2' }, { service_id: 'X', date: '20261011', exception_type: '1' }]);
  assert.deepEqual([...d.get('W')], ['2026-10-05', '2026-10-12']);
  assert.deepEqual([...d.get('X')], ['2026-10-11']);
});
test('departures counts the trips leaving the first stop in each hour, per date, line and direction', async () => {
  const r = await fromZip(MINI);
  assert.deepEqual(Object.keys(r.days), ['2026-10-05', '2026-10-12'], 'the mini timetable runs on Mondays');
  assert.deepEqual(r.days['2026-10-05']['175'], [[0, 0, 0, 0, 0, 0, 1], [0, 0, 0, 0, 0, 0, 0, 1]], 'a0 at 6:00 north, b0 at 7:00 south; a1 has no stop times');
  assert.deepEqual(r.days['2026-10-05']['17'], [[0, 0, 0, 0, 0, 0, 0, 0, 1], []]);
  assert.ok(!r.days['2026-10-05'].S1, 'rail left out');
  assert.ok(r.problems.some((p) => /rozkład godzinowy tylko na 2 dni/.test(p)));
  // Night trips of a service day go past 24:00.
  const days = departures({ routes: [{ route_id: 'n', route_short_name: 'N25', route_type: '3' }], trips: [{ route_id: 'n', service_id: 'S', trip_id: 'x', direction_id: '1' }],
    calendar: [{ service_id: 'S', monday: '1', start_date: '20261005', end_date: '20261005' }], firstHour: new Map([['x', 25]]) });
  assert.deepEqual(days['2026-10-05'].N25[1].length, 26); assert.equal(days['2026-10-05'].N25[1][25], 1);
});
test('checkDays wants enough days and trips, the must-have lines and N25 at night', () => {
  const day = (n25) => ({ 175: [[5000], []], 17: [[1], []], N25: n25 });
  const ok = { '2026-10-05': day([[0, 0, 0, 1], []]), '2026-10-06': day([[0, 1], []]), '2026-10-07': day([[], Array(24).fill(0).concat([1])]) };
  assert.deepEqual(checkDays(ok), []);
  assert.ok(checkDays({ ...ok, '2026-10-08': day([[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1], []]) }).some((p) => /N25 bez kursów nocą/.test(p)));
  assert.ok(checkDays({ '2026-10-05': { 175: [[3], []] } }).some((p) => /tylko 3 kursów/.test(p)));
  assert.equal(dayHash(ok['2026-10-05']), dayHash(JSON.parse(JSON.stringify(ok['2026-10-05']))));
});
test('worker stores the days; refresh writes changed days only and deletes the old ones; /api/trasa?dzien= reads them', async () => {
  const { routesRefreshHandler, routeHandler, resetRouteState } = require('../lib/handler');
  const w = await fakeWorker();
  const req = (q, init = {}) => new Request('https://w.dev/?resource=trasy' + q, { ...init, headers: { 'x-proxy-secret': 's' } });
  assert.equal((await w.handle(req('&dzien=2026-1-5'), w.env)).status, 400);
  assert.equal((await w.handle(req('', { method: 'POST', body: JSON.stringify({ days: { a: '{}' } }) }), w.env)).status, 400);
  assert.equal((await w.handle(req('', { method: 'POST', body: JSON.stringify({ days: Object.fromEntries(['01', '02', '03', '04'].map((d) => ['2026-10-' + d, '{}'])) }) }), w.env)).status, 400, 'at most 3 days per request');
  const built = await fromZip(MINI);
  const days = { '2026-10-05': { 175: [[0, 1], [2]] }, '2026-10-06': { 175: [[3], []] }, '2026-10-07': { 175: [[], [4]] }, '2026-10-08': { 175: [[5], []] } };
  let t = Date.parse('2026-10-06T02:00:00Z');
  const now = () => t;
  resetRouteState();
  let r = await call(routesRefreshHandler, '/api/odswiez-trasy', { env: ENV, fetchImpl: w.fetchImpl, now, build: async () => ({ ...built, days, problems: [] }) });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.days, 4); assert.equal(r.body.changedDays, 4);
  assert.ok(w.writes.includes('trasy:v1:day:2026-10-08')); assert.equal(w.writes.at(-1), 'trasy:v1:meta');
  const day = await call(routeHandler, '/api/trasa?dzien=2026-10-06', { env: ENV, fetchImpl: w.fetchImpl });
  assert.equal(day.status, 200); assert.deepEqual(day.body, { date: '2026-10-06', lines: { 175: [[3], []] } }); assert.match(day.cache, /s-maxage=3600/);
  assert.equal((await call(routeHandler, '/api/trasa?dzien=2026-11-01', { env: ENV, fetchImpl: w.fetchImpl })).status, 404);
  assert.equal((await call(routeHandler, '/api/trasa?dzien=jutro', { env: ENV, fetchImpl: w.fetchImpl })).status, 400);
  assert.deepEqual((await call(routeHandler, '/api/trasa?meta=1', { env: ENV, fetchImpl: w.fetchImpl })).body.days, Object.keys(days));
  // Next day: the window moved by a day and one day changed.
  t += 24 * 3600e3; resetRouteState(); w.writes.length = 0;
  const next = { '2026-10-06': days['2026-10-06'], '2026-10-07': { 175: [[], [9]] }, '2026-10-08': days['2026-10-08'], '2026-10-09': { 175: [[1], [1]] } };
  r = await call(routesRefreshHandler, '/api/odswiez-trasy', { env: ENV, fetchImpl: w.fetchImpl, now, build: async () => ({ ...built, days: next, problems: [] }) });
  assert.equal(r.body.changedDays, 2);
  assert.deepEqual(w.writes.filter((k) => /day:/.test(k)).sort(), ['-trasy:v1:day:2026-10-05', 'trasy:v1:day:2026-10-07', 'trasy:v1:day:2026-10-09']);
  // A Worker without day support (deployed before this feature) stores nothing: the meta records no days, so it retries.
  const oldWorker = async (url, init = {}) => {
    if (init.method === 'POST' && /"days"/.test(init.body)) return new Response(JSON.stringify({ saved: 0, deleted: 0, meta: false }), { status: 200 });
    return w.fetchImpl(url, init);
  };
  t += 24 * 3600e3; resetRouteState();
  r = await call(routesRefreshHandler, '/api/odswiez-trasy', { env: ENV, fetchImpl: oldWorker, now, build: async () => ({ ...built, days: { ...next, '2026-10-10': { 175: [[2], []] } }, problems: [] }) });
  assert.equal(r.status, 200); assert.match(r.body.daysNote, /nie obsługuje dni/);
  assert.deepEqual(JSON.parse(w.kv.get('trasy:v1:meta')).dayHashes, {});
});
