'use strict';
// Deterministic moving vehicles around Warsaw, for local work without the live API.
const LINES = { bus: ['175', '186', '523', '111', '500', 'N22'], tram: ['9', '17', '24', '33'] };

function mockVehicles(now = Date.now(), n = 120) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const type = i % 4 === 0 ? 'tram' : 'bus';
    const lines = LINES[type];
    const phase = (now / 60000 + i * 0.37) * (0.4 + (i % 5) * 0.1);
    const a = i * 2.399963;
    const r = 0.015 + (i % 17) * 0.004;
    out.push({
      id: `${type === 'bus' ? 1 : 2}-${1000 + i}`,
      type,
      line: lines[i % lines.length],
      vehicle: String(1000 + i),
      brigade: String(1 + (i % 9)),
      lat: 52.2297 + r * Math.sin(a + phase),
      lon: 21.0122 + r * 1.6 * Math.cos(a + phase),
      time: now,
    });
  }
  return out;
}

module.exports = { mockVehicles };
