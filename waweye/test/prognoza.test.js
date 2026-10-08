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
