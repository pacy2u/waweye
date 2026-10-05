'use strict';
// Which variant of a line's route (public/data/trasy/<line>.json) the selected vehicle is on. The vehicle API gives the line
// and brigade but no trip or direction, so the variant is the one the vehicle is close to and moves along (by the order
// of its recent positions). Until that is clear, the main variant of each direction near the vehicle is shown.
// Unit-tested in test/trasy.test.js.
(function (root) {
  const NEAR_M = 150, MOVED_M = 30, ALONG_M = 15;
  const K = Math.PI / 180;

  // Point [lat, lon] against a polyline [[lat, lon], ...]: distance to it and position along it, both in metres.
  function project(pt, shape) {
    const ky = 6371000 * K, kx = ky * Math.cos(pt[0] * K);
    const xy = (p) => [(p[1] - pt[1]) * kx, (p[0] - pt[0]) * ky]; // the point itself is the origin
    let best = { d: Infinity, s: 0 }, along = 0;
    for (let i = 1; i < shape.length; i++) {
      const [ax, ay] = xy(shape[i - 1]), [bx, by] = xy(shape[i]);
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy, len = Math.sqrt(len2);
      const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
      const d = Math.hypot(ax + t * dx, ay + t * dy);
      if (d < best.d) best = { d, s: along + t * len };
      along += len;
    }
    return best;
  }
  const metres = (a, b) => project(a, [b, b]).d;

  // variants: from the line file; track: the vehicle's recent positions [[lat, lon], ...], oldest first.
  // Returns { variants: [...], known: true when the direction is clear }.
  function chooseVariants(variants, track) {
    if (!variants.length || !track.length) return { variants: mainPerDirection(variants), known: false };
    const last = track[track.length - 1], first = track[0];
    const near = variants.map((v) => ({ v, p: project(last, v.shape) })).filter((x) => x.p.d <= NEAR_M);
    if (!near.length) return { variants: mainPerDirection(variants), known: false };
    if (track.length > 1 && metres(first, last) >= MOVED_M) {
      const forward = near.filter((x) => x.p.s - project(first, x.v.shape).s >= ALONG_M);
      if (forward.length) {
        forward.sort((a, b) => a.p.d - b.p.d || b.v.trips - a.v.trips);
        return { variants: [forward[0].v], known: true };
      }
    }
    return { variants: mainPerDirection(near.map((x) => x.v)), known: false };
  }
  // The variant with the most trips in each direction.
  function mainPerDirection(variants) {
    const best = new Map();
    for (const v of variants) if (!best.has(v.dir) || v.trips > best.get(v.dir).trips) best.set(v.dir, v);
    return [...best.values()];
  }
  // Is the timetable past its last day? today: 'YYYY-MM-DD' in Warsaw.
  const expired = (valid, today) => !!(valid && valid.to && today > valid.to);

  const api = { project, chooseVariants, mainPerDirection, expired };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.wawTrasa = api;
})(this);
