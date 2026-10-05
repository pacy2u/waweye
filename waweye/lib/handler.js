'use strict';
const { fetchVehicles, fetchParkings, fetchIncidents, fetchFleet, fetchSport, normalizeFleet, normalizeParkings, normalizeIncidents, normalizeSport } = require('./warsaw');
const { mockVehicles, mockParkings, mockIncidents, mockFleet, mockSport, MOCK_GEOCODES } = require('./mock');
const { createGeocoder } = require('./geocoding');

// Read-only API: anything but GET/HEAD gets 405. Returns true when the request was rejected.
function rejectUnlessRead(req, res) {
  if (!req.method || req.method === 'GET' || req.method === 'HEAD') return false;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Allow', 'GET, HEAD');
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = 405;
  res.end(JSON.stringify({ error: 'Method not allowed' }));
  return true;
}

// Shared by the Vercel function and the local dev server.
async function vehiclesHandler(req, res, { env = process.env, fetchImpl = fetch } = {}) {
  if (rejectUnlessRead(req, res)) return;
  const url = new URL(req.url, 'http://x');
  const wanted = (url.searchParams.get('types') || '1,2').split(',').map(Number);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (!wanted.length || wanted.some((t) => t !== 1 && t !== 2)) {
    res.setHeader('Cache-Control', 'no-store');
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: 'Invalid types: use 1 (bus), 2 (tram) or 1,2' }));
  }
  const types = [...new Set(wanted)];
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
  if (rejectUnlessRead(req, res)) return;
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

async function incidentsHandler(req, res, { env = process.env, fetchImpl = fetch } = {}) {
  if (rejectUnlessRead(req, res)) return;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  try {
    let incidents, source = 'live';
    if (env.MOCK === '1') { source = 'mock'; incidents = normalizeIncidents(mockIncidents()); }
    else {
      incidents = await fetchIncidents({
        apiKey: env.WARSAW_API_KEY, fetchImpl,
        upstream: env.UPSTREAM_URL ? { url: env.UPSTREAM_URL, secret: env.UPSTREAM_SECRET || '' } : undefined,
      });
    }
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120'); // data refreshes every minute
    res.statusCode = 200;
    res.end(JSON.stringify({ updated: Date.now(), source, incidents }));
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.statusCode = 502;
    res.end(JSON.stringify({ error: e.message }));
  }
}

async function fleetHandler(req, res, { env = process.env, fetchImpl = fetch } = {}) {
  if (rejectUnlessRead(req, res)) return;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  try {
    let fleet, source = 'live';
    if (env.MOCK === '1') { source = 'mock'; fleet = normalizeFleet(mockFleet()); }
    else {
      fleet = await fetchFleet({
        apiKey: env.WARSAW_API_KEY, fetchImpl,
        upstream: env.UPSTREAM_URL ? { url: env.UPSTREAM_URL, secret: env.UPSTREAM_SECRET || '' } : undefined,
      });
    }
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400'); // dataset is updated daily
    res.statusCode = 200;
    res.end(JSON.stringify({ updated: Date.now(), source, ...fleet }));
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.statusCode = 502;
    res.end(JSON.stringify({ error: e.message }));
  }
}

// Sport classes: geocoding answers live as long as this server instance, shared by its requests.
const geocoder = createGeocoder();
const mockGeocoder = createGeocoder({ minGapMs: 0, fetchImpl: async (url) => {
  const hit = MOCK_GEOCODES[new URL(url).searchParams.get('q')];
  return new Response(JSON.stringify(hit ? [{ lat: String(hit.lat), lon: String(hit.lon) }] : []), { status: 200 });
} });

async function sportHandler(req, res, { env = process.env, fetchImpl = fetch, geo, geoBudgetMs = 5000 } = {}) {
  if (rejectUnlessRead(req, res)) return;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  try {
    let raw, source = 'live';
    if (env.MOCK === '1') { source = 'mock'; raw = mockSport(); }
    else {
      raw = await fetchSport({
        apiKey: env.WARSAW_API_KEY, fetchImpl,
        upstream: env.UPSTREAM_URL ? { url: env.UPSTREAM_URL, secret: env.UPSTREAM_SECRET || '' } : undefined,
      });
    }
    const all = normalizeSport(raw);
    const pending = await (geo || (source === 'mock' ? mockGeocoder : geocoder)).locate(all, { budgetMs: geoBudgetMs });
    const items = all.filter((i) => i.lat != null).map(({ queries, ...i }) => i);
    // Each reply spends at most ~5 s on lookups (about 4 addresses), so nobody waits long; while some are left,
    // the CDN keeps the reply for 15 s only and the next request carries on. The dataset itself changes every 2 h.
    res.setHeader('Cache-Control', pending ? 's-maxage=15' : 's-maxage=1800, stale-while-revalidate=3600');
    res.statusCode = 200;
    res.end(JSON.stringify({ updated: Date.now(), source, received: raw.length, pending, unlocated: all.length - items.length - pending, items }));
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.statusCode = 502;
    res.end(JSON.stringify({ error: e.message }));
  }
}

module.exports = { fleetHandler, vehiclesHandler, parkingHandler, incidentsHandler, sportHandler };
