'use strict';
// Zamienia serię migawek z /api/vehicles (+ parkingi, utrudnienia, tabor) w kompaktowy plik danych dla kompozycji.
// Uruchom: node wideo-promocyjne/przygotuj-dane.js <katalog z t*.json> <katalog z parking.json, incidents.json, fleet.json>
// Wynik: wideo-promocyjne/zasoby/dane-wideo.js  (window.DANE = {...})
const fs = require('fs');
const path = require('path');

const [snapDir, extraDir] = process.argv.slice(2);
if (!snapDir || !extraDir) { console.error('użycie: node przygotuj-dane.js <migawki> <dodatkowe>'); process.exit(1); }
const K = 100; // time samples per vehicle in the output

const snaps = fs.readdirSync(snapDir).filter((f) => /^t\d+\.json$/.test(f)).sort()
  .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(snapDir, f), 'utf8')); } catch { return null; } })
  .filter((s) => s && Array.isArray(s.vehicles) && s.vehicles.length);
console.log('migawek:', snaps.length);

// Every GPS fix per vehicle, keyed by the vehicle's own timestamp.
const tracks = new Map();
for (const s of snaps) for (const v of s.vehicles) {
  let tr = tracks.get(v.id);
  if (!tr) tracks.set(v.id, (tr = { type: v.type, line: v.line, vehicle: v.vehicle, fixes: new Map() }));
  if (v.time) tr.fixes.set(v.time, [v.lat, v.lon]);
}
const allT = [...tracks.values()].flatMap((t) => [...t.fixes.keys()]).sort((a, b) => a - b);
const T0 = allT[Math.floor(allT.length * 0.02)], T1 = allT[Math.floor(allT.length * 0.98)];
const grid = Array.from({ length: K }, (_, i) => T0 + (T1 - T0) * i / (K - 1));

const veh = [];
for (const tr of tracks.values()) {
  const fx = [...tr.fixes.entries()].sort((a, b) => a[0] - b[0]);
  if (!fx.length) continue;
  // Drop teleports (> 120 km/h between fixes): GPS glitches would draw long streaks across the city.
  const clean = [fx[0]];
  for (const f of fx.slice(1)) {
    const p = clean[clean.length - 1], dt = (f[0] - p[0]) / 3600000;
    const km = Math.hypot((f[1][0] - p[1][0]) * 111.2, (f[1][1] - p[1][1]) * 68.2);
    if (dt > 0 && km / dt < 120) clean.push(f);
  }
  const pos = grid.map((t) => {
    if (t <= clean[0][0]) return clean[0][1];
    if (t >= clean[clean.length - 1][0]) return clean[clean.length - 1][1];
    let j = 1; while (clean[j][0] < t) j++;
    const a = clean[j - 1], b = clean[j], k = (t - a[0]) / (b[0] - a[0]);
    return [a[1][0] + (b[1][0] - a[1][0]) * k, a[1][1] + (b[1][1] - a[1][1]) * k];
  });
  // Delta-encode in 1e-5 degrees to keep the file small.
  const flat = [];
  let pl = 0, pn = 0;
  for (const [la, lo] of pos) { const a = Math.round(la * 1e5), o = Math.round(lo * 1e5); flat.push(a - pl, o - pn); pl = a; pn = o; }
  veh.push([tr.type === 'tram' ? 1 : 0, tr.line, flat]);
}

const parking = JSON.parse(fs.readFileSync(path.join(extraDir, 'parking.json'), 'utf8'));
const incidents = JSON.parse(fs.readFileSync(path.join(extraDir, 'incidents.json'), 'utf8'));
const fleet = JSON.parse(fs.readFileSync(path.join(extraDir, 'fleet.json'), 'utf8'));
const sum = (o) => o.standard + o.disabled + o.electric;
const last = snaps[0].vehicles; // stats from the first snapshot (closest to the app screenshots)
const fleetKeys = Object.keys(fleet.vehicles);
const live = last.filter((v) => fleet.vehicles[`${v.type}:${v.vehicle}`]).length;

const DANE = {
  T0, T1, K,
  veh,
  stats: {
    live: last.length,
    buses: last.filter((v) => v.type === 'bus').length,
    trams: last.filter((v) => v.type === 'tram').length,
    lines: new Set(last.map((v) => v.line)).size,
    fleet: fleetKeys.length,
    fleetMatchPct: Math.round(live / last.length * 1000) / 10,
    parkings: parking.parkings.length,
    parkingFree: parking.parkings.reduce((a, p) => a + sum(p.free), 0),
    incidents: incidents.incidents.length,
    incidentsActive: incidents.incidents.filter((i) => i.status === 'active').length,
    depots: new Set(fleetKeys.map((k) => fleet.vehicles[k].depot)).size,
  },
  parkings: parking.parkings.map((p) => [Math.round(p.lat * 1e5) / 1e5, Math.round(p.lon * 1e5) / 1e5, sum(p.free)]),
  incidents: incidents.incidents.filter((i) => i.status !== 'ended').flatMap((i) => i.shapes.filter((s) => s.type === 'line')
    .map((s) => s.points.filter((_, j, a) => j % Math.max(1, Math.floor(a.length / 40)) === 0 || j === a.length - 1).map(([a, o]) => [Math.round(a * 1e5) / 1e5, Math.round(o * 1e5) / 1e5]))),
};
const out = path.join(__dirname, 'zasoby', 'dane-wideo.js');
fs.writeFileSync(out, '// Wygenerowane przez przygotuj-dane.js z danych na żywo (pasibus.vercel.app).\nwindow.DANE = ' + JSON.stringify(DANE) + ';\n');
console.log('zapisano', out, (fs.statSync(out).size / 1024).toFixed(0) + ' KB', 'pojazdów', veh.length,
  'okno', new Date(T0).toISOString(), '→', new Date(T1).toISOString(), DANE.stats);
