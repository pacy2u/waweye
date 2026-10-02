'use strict';
const { fetchVehicles, fetchParkings, normalizeParkings } = require('./warsaw');
const { mockVehicles, mockParkings } = require('./mock');

// Shared by the Vercel function and the local dev server.
async function vehiclesHandler(req, res, { env = process.env, fetchImpl = fetch } = {}) {
  const url = new URL(req.url, 'http://x');
  const wanted = (url.searchParams.get('types') || '1,2').split(',').map(Number).filter((t) => t === 1 || t === 2);
  const types = wanted.length ? wanted : [1, 2];
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  try {
    let vehicles, errors = [], source = 'live', received;
    if (env.MOCK === '1') {
      source = 'mock';
      const names = types.map((t) => (t === 1 ? 'bus' : 'tram'));
      vehicles = mockVehicles().filter((v) => names.includes(v.type));
    } else {
      ({ vehicles, errors, received } = await fetchVehicles({
        apiKey: env.WARSAW_API_KEY, types, fetchImpl,
        upstream: env.UPSTREAM_URL ? { url: env.UPSTREAM_URL, secret: env.UPSTREAM_SECRET || '' } : undefined,
      }));
    }
    res.setHeader('Cache-Control', 's-maxage=5, stale-while-revalidate=10');
    res.statusCode = 200;
    res.end(JSON.stringify({ updated: Date.now(), source, errors, received: received ?? vehicles.length, vehicles }));
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.statusCode = 502;
    res.end(JSON.stringify({ error: e.message }));
  }
}

async function parkingHandler(req, res, { env = process.env, fetchImpl = fetch } = {}) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  try {
    let parkings, source = 'live';
    if (env.MOCK === '1') { source = 'mock'; parkings = normalizeParkings(mockParkings()); }
    else {
      parkings = await fetchParkings({
        apiKey: env.WARSAW_API_KEY, fetchImpl,
        upstream: env.UPSTREAM_URL ? { url: env.UPSTREAM_URL, secret: env.UPSTREAM_SECRET || '' } : undefined,
      });
    }
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60'); // data refreshes every minute
    res.statusCode = 200;
    res.end(JSON.stringify({ updated: Date.now(), source, parkings }));
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.statusCode = 502;
    res.end(JSON.stringify({ error: e.message }));
  }
}

module.exports = { vehiclesHandler, parkingHandler };
