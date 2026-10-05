'use strict';
// WGS84 latitude/longitude -> PL-2000 zone 7 (EPSG:2178): transverse Mercator on GRS80, central meridian 21°, k0 0.999923,
// false easting 7 500 000 m. The city's WMS draws the paid parking zone correctly only in its own grids (2178/2180);
// zone 7 runs through Warsaw, so a map tile is a square there, turned by under 0.3°. Checked against proj4 in test/strefy.test.js.
(function (root) {
  const a = 6378137, f = 1 / 298.257222101, e2 = f * (2 - f), ep2 = e2 / (1 - e2), k0 = 0.999923, lon0 = 21, FE = 7500000;
  const e4 = e2 * e2, e6 = e4 * e2, rad = Math.PI / 180;
  const M = (p) => a * ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * p - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * p)
    + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * p) - (35 * e6 / 3072) * Math.sin(6 * p));
  // Returns [northing, easting] in metres: the axis order of EPSG:2178 in WMS 1.3.0.
  function toPL2000z7(lat, lon) {
    const p = lat * rad, s = Math.sin(p), c = Math.cos(p), t = Math.tan(p);
    const N = a / Math.sqrt(1 - e2 * s * s), T = t * t, C = ep2 * c * c, A = (lon - lon0) * rad * c;
    const east = FE + k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120);
    const north = k0 * (M(p) + N * t * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720));
    return [north, east];
  }
  if (typeof module === 'object' && module.exports) module.exports = { toPL2000z7 };
  else root.toPL2000z7 = toPL2000z7;
})(this);
