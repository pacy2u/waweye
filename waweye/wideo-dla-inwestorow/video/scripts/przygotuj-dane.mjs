// Prawdziwe dane z migawki 2 października 2026 (22:12–22:51 czasu warszawskiego), zebrane dla showreelu
// (../../wideo-promocyjne/zasoby). Rzutuje je raz na płaszczyznę 1920×1080, żeby render nie liczył geografii
// i nie potrzebował sieci. Wynik: src/dane.json.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ZASOBY = path.resolve(ROOT, '../../../wideo-promocyjne/zasoby');
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(ZASOBY, 'dane-wideo.js'), 'utf8'), ctx);
vm.runInNewContext(fs.readFileSync(path.join(ZASOBY, 'woda.js'), 'utf8'), ctx);
const { DANE, WODA } = ctx.window;

// Rzut równoodległościowy wokół środka Warszawy; 1 jednostka = 1 px kadru przy pełnym widoku miasta.
const LAT0 = 52.232, LON0 = 21.02, SCALE = 3300; // px na stopień szerokości
const K = Math.cos((LAT0 * Math.PI) / 180);
const X = (lon) => 960 + (lon - LON0) * SCALE * K;
const Y = (lat) => 540 - (lat - LAT0) * SCALE;
const r1 = (v) => Math.round(v * 10) / 10;

const veh = DANE.veh.map(([tram, line, d]) => {
  const pts = [];
  let a = 0, o = 0;
  for (let k = 0; k < DANE.K; k++) { a += d[2 * k]; o += d[2 * k + 1]; pts.push([r1(X(o / 1e5)), r1(Y(a / 1e5))]); }
  return { tram: !!tram, line, pts };
});

const water = [];
{ let a = 0, o = 0; for (let i = 0; i < WODA.length / 2; i++) { a += WODA[2 * i]; o += WODA[2 * i + 1]; water.push([r1(X(o / 1e4)), r1(Y(a / 1e4))]); } }

const parkings = DANE.parkings.map(([la, lo, free]) => ({ x: r1(X(lo)), y: r1(Y(la)), free }));
const incidents = DANE.incidents.map((pts) => pts.map(([la, lo]) => [r1(X(lo)), r1(Y(la))]));

// Bohater: autobus, który przejeżdża najdalej i mija najbliżej zarówno parking z wolnymi miejscami, jak i utrudnienie.
const len = (p) => p.reduce((s, q, i) => (i ? s + Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) : 0), 0);
const near = (p, x, y) => Math.min(...p.map((q) => Math.hypot(q[0] - x, q[1] - y)));
let best = null;
veh.forEach((v, i) => {
  if (v.tram) return;
  const L = len(v.pts);
  if (L < 40) return;
  const dp = Math.min(...parkings.filter((p) => p.free > 0).map((p) => near(v.pts, p.x, p.y)));
  const di = Math.min(...incidents.map((inc) => Math.min(...inc.map(([x, y]) => near(v.pts, x, y)))));
  const score = L - 6 * dp - 6 * di;
  if (!best || score > best.score) best = { i, score, L, dp, di };
});
const hero = veh[best.i];
const heroParking = parkings.filter((p) => p.free > 0).sort((a, b) => near(hero.pts, a.x, a.y) - near(hero.pts, b.x, b.y))[0];
const heroIncident = incidents.slice().sort((a, b) =>
  Math.min(...a.map(([x, y]) => near(hero.pts, x, y))) - Math.min(...b.map(([x, y]) => near(hero.pts, x, y))))[0];

const out = {
  zrodlo: 'dane.um.warszawa.pl przez waweye.vercel.app, migawka 2026-10-02 22:12–22:51 (Europe/Warsaw)',
  stats: DANE.stats,
  veh, water, parkings, incidents,
  hero: { index: best.i, line: hero.line, parking: heroParking, incident: heroIncident },
};
fs.writeFileSync(path.join(ROOT, '../src/dane.json'), JSON.stringify(out));
console.log('pojazdy', veh.length, 'woda', water.length, 'bohater: linia', hero.line, best, 'parking', heroParking);
