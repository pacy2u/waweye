'use strict';
// Timelapse prediction (public/app.js, "Timelapse"): where a vehicle will be some time from now. The vehicle API has no
// trips or timetables, so the guess is simple: the vehicle keeps going along the variant of its line's route it is on
// (public/trasa.js picks it from its recent positions) at the average speed of its kind, stops included; at the end of
// the variant it waits a few minutes and comes back on a variant starting there (normally the other direction).
// Unit-tested in test/prognoza.test.js.
(function (root) {
  const trasa = typeof module === 'object' && module.exports ? require('./trasa.js') : root.wawTrasa;
  const SPEED = { bus: 5.5, tram: 5 }; // m/s: ~20 and ~18 km/h, the usual average speeds with stops in Warsaw
  const LAYOVER_S = 240, TURN_M = 400, NEAR_M = 150;
  const K = Math.PI / 180, R = 6371000;

  const metres = (a, b) => R * K * Math.hypot(b[0] - a[0], (b[1] - a[1]) * Math.cos(((a[0] + b[0]) / 2) * K));
  const cumCache = new WeakMap();
  // Distance from the start of the shape to each of its points, in metres.
  function cum(shape) {
    let c = cumCache.get(shape);
    if (!c) {
      c = new Float64Array(shape.length);
      for (let i = 1; i < shape.length; i++) c[i] = c[i - 1] + metres(shape[i - 1], shape[i]);
      cumCache.set(shape, c);
    }
    return c;
  }
  const length = (shape) => { const c = cum(shape); return c[c.length - 1]; };
  function pointAt(shape, s) {
    const c = cum(shape), n = shape.length - 1;
    if (s <= 0) return shape[0];
    if (s >= c[n]) return shape[n];
    let lo = 0, hi = n; // last point not further than s
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (c[mid] <= s) lo = mid; else hi = mid - 1; }
    const a = shape[lo], b = shape[lo + 1], f = (s - c[lo]) / (c[lo + 1] - c[lo] || 1);
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  }

  // The variant to continue on after the end of v: one starting near that end, another direction first, then the most trips.
  const nextCache = new WeakMap();
  function next(variants, v) {
    if (nextCache.has(v)) return nextCache.get(v);
    const end = v.shape[v.shape.length - 1];
    const c = variants.filter((x) => x !== v && metres(x.shape[0], end) <= TURN_M)
      .sort((a, b) => (a.dir === v.dir) - (b.dir === v.dir) || b.trips - a.trips);
    nextCache.set(v, c[0] || null);
    return c[0] || null;
  }

  // Where the vehicle is on its line: { variant, s (metres along it), known (direction clear from movement) },
  // or null when it is not near the route. track: its recent positions [[lat, lon], ...], oldest first.
  function plan(variants, track) {
    if (!variants || !variants.length || !track.length) return null;
    const last = track[track.length - 1], pick = trasa.chooseVariants(variants, track);
    if (pick.known) return { variant: pick.variants[0], s: trasa.project(last, pick.variants[0].shape).s, known: true };
    // Direction not clear yet: the variant along which it moved the most (even a little), then the busiest.
    const first = track[0];
    const near = variants.map((v) => ({ v, p: trasa.project(last, v.shape) })).filter((x) => x.p.d <= NEAR_M);
    if (!near.length) return null;
    for (const x of near) x.gain = track.length > 1 ? x.p.s - trasa.project(first, x.v.shape).s : 0;
    near.sort((a, b) => b.gain - a.gain || b.v.trips - a.v.trips);
    return { variant: near[0].v, s: near[0].p.s, known: false };
  }

  // Position [lat, lon] dt seconds after the plan was made.
  function positionAt(variants, p, type, dt) {
    const speed = SPEED[type] || SPEED.bus;
    let v = p.variant, s = p.s, left = Math.max(0, dt);
    for (let n = 0; n < 100; n++) {
      const ride = (length(v.shape) - s) / speed;
      if (left <= ride) return pointAt(v.shape, s + left * speed);
      left -= ride;
      const end = v.shape[v.shape.length - 1];
      if (left <= LAYOVER_S) return end;
      left -= LAYOVER_S;
      const nx = next(variants, v);
      if (!nx) return end; // nowhere to turn back: it stays at the terminus
      v = nx; s = 0;
    }
    return pointAt(v.shape, s);
  }

  const api = { SPEED, LAYOVER_S, plan, positionAt, pointAt, length, next };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.wawPrognoza = api;
})(this);
