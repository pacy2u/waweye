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
