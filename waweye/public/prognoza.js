'use strict';
// Timelapse prediction (public/app.js, "Timelapse"): where a vehicle will be some time from now. The vehicle API has no
// trips or timetables, so the guess is simple: the vehicle keeps going along the variant of its line's route it is on
// (public/trasa.js picks it from its recent positions) at the average speed of its kind, stops included; at the end of
// the variant it waits a few minutes and comes back on a variant starting there (normally the other direction).
// With the timetable's departures per hour (simulate) a line runs as many trips as ZTM plans: a vehicle at a terminus
// takes the next planned departure or, when there is none for a while, goes off to the depot; when more trips are
// planned than vehicles are around, new ones start at the terminus. Without it (positionAt) vehicles keep going.
// Unit-tested in test/prognoza.test.js.
(function (root) {
  const trasa = typeof module === 'object' && module.exports ? require('./trasa.js') : root.wawTrasa;
  const SPEED = { bus: 5.5, tram: 5 }; // m/s: ~20 and ~18 km/h, the usual average speeds with stops in Warsaw
  const LAYOVER_S = 240, TURN_M = 400, NEAR_M = 150;
  const MIN_LAYOVER_S = 120, MAX_WAIT_S = 1800, TERMINUS_TURN_M = 700, AT_START_M = 300;
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

  // ---- With the timetable ----

  // Departure times (seconds from now) of one direction, spread evenly within each hour.
  // hours: [{ at: seconds from now when the hour starts, n: departures in it }], horizon: seconds.
  function slots(hours, horizon) {
    const out = [];
    for (const { at, n } of hours) for (let i = 0; i < n; i++) { const t = at + ((i + 0.5) / n) * 3600; if (t >= 0 && t <= horizon) out.push(t); }
    return out.sort((a, b) => a - b);
  }

  // The vehicles of one line over the horizon. live: [{ key, plan }] (plans from plan(), not null);
  // departures: [[times of dir 0], [times of dir 1]] from slots(). Returns entities
  // { key, live, start, end, segs: [{ a, b, v, s0 } riding | { a, b, at } waiting] }; positionOf() reads them.
  function simulate(variants, type, live, departures) {
    const speed = SPEED[type] || SPEED.bus, ents = [], free = [];
    const near = (p, q, m) => metres(p, q) <= m;
    const ride = (e, v, s0, a) => { const b = a + (length(v.shape) - s0) / speed; e.segs.push({ a, b, v, s0 }); free.push({ e, at: v.shape[v.shape.length - 1], t: b }); };
    for (const { key, plan: p } of live) {
      const e = { key, live: true, start: 0, end: Infinity, segs: [] };
      ents.push(e);
      // Standing near the start of its variant: waiting at the terminus for its departure, not leaving right now.
      if (p.s < AT_START_M && departures[p.variant.dir] && departures[p.variant.dir].length) free.push({ e, at: p.variant.shape[0], t: 0, ready: 0 });
      else ride(e, p.variant, p.s, 0);
    }
    const byDir = [0, 1].map((d) => variants.filter((v) => v.dir === d).sort((a, b) => b.trips - a.trips));
    const events = [];
    for (const d of [0, 1]) for (const t of departures[d] || []) if (byDir[d].length) events.push({ t, d });
    events.sort((a, b) => a.t - b.t);
    let spawned = 0;
    const leave = (f) => { f.e.segs.push({ a: f.t, b: f.t + MAX_WAIT_S, at: f.at }); f.e.end = f.t + MAX_WAIT_S; };
    for (const { t, d } of events) {
      // Vehicles nobody needed for too long leave for the depot.
      for (let i = free.length - 1; i >= 0; i--) if (t - free[i].t > MAX_WAIT_S) leave(free.splice(i, 1)[0]);
      // The vehicle waiting longest at a terminus where a variant of this direction starts.
      let pick = null;
      for (const f of free) {
        if ((f.ready ?? f.t + MIN_LAYOVER_S) > t) continue;
        if (!f.v) f.v = [0, 1].map((dd) => byDir[dd].find((x) => near(x.shape[0], f.at, TERMINUS_TURN_M)) || null);
        if (f.v[d] && (!pick || f.t < pick.t)) pick = f;
      }
      if (pick) {
        free.splice(free.indexOf(pick), 1);
        if (t > pick.t) pick.e.segs.push({ a: pick.t, b: t, at: pick.at });
        ride(pick.e, pick.v[d], 0, t);
      } else {
        const e = { key: 'r' + d + '-' + spawned++, live: false, start: t, end: Infinity, segs: [] };
        ents.push(e); ride(e, byDir[d][0], 0, t);
      }
    }
    // Vehicles nobody needed: they wait, then leave for the depot.
    for (const f of free) leave(f);
    for (const e of ents) e.segs.sort((x, y) => x.a - y.a);
    return ents;
  }

  // Position [lat, lon] of a simulated vehicle t seconds from now, or null when it is not on the map then.
  function positionOf(e, t, type) {
    if (t < e.start || t >= e.end) return null;
    const speed = SPEED[type] || SPEED.bus;
    for (let i = e.segs.length - 1; i >= 0; i--) {
      const g = e.segs[i];
      if (t < g.a) continue;
      if (g.at) return t < g.b ? g.at : null;
      return t < g.b ? pointAt(g.v.shape, g.s0 + (t - g.a) * speed) : g.v.shape[g.v.shape.length - 1]; // past the horizon: at the terminus
    }
    return null;
  }

  const api = { SPEED, LAYOVER_S, MIN_LAYOVER_S, MAX_WAIT_S, plan, positionAt, pointAt, length, next, slots, simulate, positionOf };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.wawPrognoza = api;
})(this);
