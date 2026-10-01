'use strict';
const { fetchVehicles } = require('./warsaw');
const { mockVehicles } = require('./mock');

// Shared by the Vercel function and the local dev server.
async function vehiclesHandler(req, res, { env = process.env, fetchImpl = fetch } = {}) {
  const url = new URL(req.url, 'http://x');
  const wanted = (url.searchParams.get('types') || '1,2').split(',').map(Number).filter((t) => t === 1 || t === 2);
  const types = wanted.length ? wanted : [1, 2];
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  try {
    let vehicles, errors = [], source = 'live';
    if (env.MOCK === '1') {
      source = 'mock';
      const names = types.map((t) => (t === 1 ? 'bus' : 'tram'));
      vehicles = mockVehicles().filter((v) => names.includes(v.type));
    } else {
      ({ vehicles, errors } = await fetchVehicles({ apiKey: env.WARSAW_API_KEY, types, fetchImpl }));
    }
    res.setHeader('Cache-Control', 's-maxage=5, stale-while-revalidate=10');
    res.statusCode = 200;
    res.end(JSON.stringify({ updated: Date.now(), source, errors, vehicles }));
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.statusCode = 502;
    res.end(JSON.stringify({ error: e.message }));
  }
}

module.exports = { vehiclesHandler };
