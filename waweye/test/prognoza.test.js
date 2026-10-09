'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SPEED, LAYOVER_S, plan, positionAt, length } = require('../public/prognoza');

// Line along a meridian: north from 52.20 to 52.21 (~1.1 km) and back the same way.
const north = { dir: 0, trips: 10, shape: [[52.2, 21.0], [52.205, 21.0], [52.21, 21.0]] };
const south = { dir: 1, trips: 8, shape: [[52.21, 21.0], [52.205, 21.0], [52.2, 21.0]] };
const variants = [north, south];
const near = (a, b, m = 3) => assert.ok(Math.abs(a[0] - b[0]) * 111320 < m && Math.abs(a[1] - b[1]) * 68000 < m, `${a} vs ${b}`);

test('plan follows the direction of movement', () => {
  const p = plan(variants, [[52.202, 21.0], [52.203, 21.0], [52.204, 21.0]]);
  assert.equal(p.variant, north); assert.equal(p.known, true);
  assert.ok(Math.abs(p.s - 0.004 * 111195) < 5);
  assert.equal(plan(variants, [[52.204, 21.0], [52.2035, 21.0]]).variant, south, 'small movement still picks the direction');
});
test('plan without movement takes the busiest variant; off the route or without a route: null', () => {
  assert.equal(plan(variants, [[52.204, 21.0]]).variant, north);
  assert.equal(plan(variants, [[52.204, 21.01]]), null, '~680 m away');
  assert.equal(plan(null, [[52.204, 21.0]]), null);
  assert.equal(plan([], [[52.204, 21.0]]), null);
});
test('positionAt moves along the route at the average speed, waits at the terminus and comes back', () => {
  const p = { variant: north, s: 0 }, L = length(north.shape);
  assert.ok(Math.abs(L - 0.01 * 111195) < 5, 'length ' + L);
  near(positionAt(variants, p, 'bus', 0), [52.2, 21.0]);
  near(positionAt(variants, p, 'bus', 100), [52.2 + (100 * SPEED.bus) / 111195, 21.0]);
  near(positionAt(variants, p, 'tram', 100), [52.2 + (100 * SPEED.tram) / 111195, 21.0]);
  const end = L / SPEED.bus;
  near(positionAt(variants, p, 'bus', end + LAYOVER_S / 2), [52.21, 21.0]);
  near(positionAt(variants, p, 'bus', end + LAYOVER_S + 100), [52.21 - (100 * SPEED.bus) / 111195, 21.0]);
  near(positionAt([north], p, 'bus', 10 * end), [52.21, 21.0]); // no way back: stays at the terminus
  near(positionAt(variants, p, 'bus', 6 * 3600), positionAt(variants, p, 'bus', 6 * 3600)); // finite, deterministic
});

// ---- With the timetable: departures per hour ----
const { slots, simulate, positionOf, MIN_LAYOVER_S, MAX_WAIT_S } = require('../public/prognoza');
const ride = length(north.shape) / SPEED.bus; // ~200 s

test('slots spreads the departures of each hour evenly, within the horizon', () => {
  assert.deepEqual(slots([{ at: 0, n: 2 }], 99999), [900, 2700]);
  assert.deepEqual(slots([{ at: -1800, n: 2 }, { at: 1800, n: 4 }], 4000), [900, 2250, 3150]);
});
test('simulate: a vehicle takes the next departure at the terminus, extra trips start new vehicles, idle ones leave', () => {
  // One bus going north, 100 s from the end; departures south at 600 s (it takes it) and 650 s (a new vehicle).
  const live = [{ key: 'v1', plan: { variant: north, s: length(north.shape) - 100 * SPEED.bus } }];
  const ents = simulate(variants, 'bus', live, [[], [600, 650]]);
  assert.equal(ents.length, 2);
  const [v1, extra] = ents;
  assert.equal(v1.live, true); assert.equal(extra.live, false); assert.equal(extra.start, 650);
  near(positionOf(v1, 50, 'bus'), [52.21 - (50 * SPEED.bus) / 111195, 21.0]);
  near(positionOf(v1, 300, 'bus'), [52.21, 21.0]); // waits at the terminus
  near(positionOf(v1, 700, 'bus'), [52.21 - (100 * SPEED.bus) / 111195, 21.0]); // on the way back
  assert.equal(positionOf(extra, 600, 'bus'), null, 'not out yet');
  near(positionOf(extra, 650, 'bus'), [52.21, 21.0]);
  // Both reach the south end and nobody needs them: they wait, then go to the depot.
  const back = 600 + ride;
  near(positionOf(v1, back + 60, 'bus'), [52.2, 21.0]);
  assert.equal(positionOf(v1, back + MAX_WAIT_S + 1, 'bus'), null);
  assert.equal(v1.end, back + MAX_WAIT_S);
});
test('simulate: no departures at all = everyone goes to the depot; a waiting vehicle leaves on its departure', () => {
  const live = [{ key: 'v1', plan: { variant: north, s: 0 } }, { key: 'v2', plan: { variant: south, s: 500 } }];
  let [a, b] = simulate(variants, 'bus', live, [[], []]);
  assert.ok(Number.isFinite(a.end) && Number.isFinite(b.end));
  assert.ok(b.end <= (length(south.shape) - 500) / SPEED.bus + MAX_WAIT_S + 1);
  // v1 stands at the start of the northbound variant: it waits for the departure at 900 s instead of leaving now.
  [a] = simulate(variants, 'bus', live.slice(0, 1), [[900], []]);
  near(positionOf(a, 600, 'bus'), [52.2, 21.0]);
  near(positionOf(a, 1000, 'bus'), [52.2 + (100 * SPEED.bus) / 111195, 21.0]);
  assert.ok(MIN_LAYOVER_S > 0);
});
