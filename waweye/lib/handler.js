'use strict';
const { fetchVehicles, fetchParkings, fetchIncidents, fetchFleet, fetchSport, fetchEvents, normalizeFleet, normalizeParkings, normalizeIncidents, normalizeSport, normalizeEvents } = require('./warsaw');
const { mockVehicles, mockParkings, mockIncidents, mockFleet, mockSport, mockEvents, MOCK_GEOCODES } = require('./mock');
const { createGeocoder } = require('./geocoding');
// Vercel's waitUntil (what @vercel/functions does, without its dependencies): keeps the function alive for work that
// goes on after the reply. Outside Vercel (dev server, tests) there is no context and the promise just runs.
const waitUntil = (p) => globalThis[Symbol.for('@vercel/request-context')]?.get?.()?.waitUntil?.(p);

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

// Sport classes and events: geocoding answers live as long as this server instance, shared by its requests.
// /api/sport and /api/wydarzenia run as separate Vercel functions, each with its own queue, so each keeps to one
// Nominatim call per 2.2 s: together still under the policy's one per second.
const geocoder = createGeocoder({ minGapMs: 2200 });
const mockGeocoder = createGeocoder({ minGapMs: 0, fetchImpl: async (url) => {
  const hit = MOCK_GEOCODES[new URL(url).searchParams.get('q')];
  return new Response(JSON.stringify(hit ? [{ lat: String(hit.lat), lon: String(hit.lon) }] : []), { status: 200 });
} });

// A reply waits at most geoBudgetMs for address lookups; whatever is left goes on in the background for up to
// backgroundMs (within the functions' 60 s limit), so places fill in within minutes, not one batch per request.
async function locate(geo, items, { geoBudgetMs, backgroundMs, background }) {
  const pending = await geo.locate(items, { budgetMs: geoBudgetMs });
  if (pending && geo.locateLater) {
    const later = geo.locateLater(items, { budgetMs: backgroundMs });
    if (later) background(later);
  }
  return pending;
}

async function sportHandler(req, res, { env = process.env, fetchImpl = fetch, geo, geoBudgetMs = 3000, backgroundMs = 45000, background = waitUntil } = {}) {
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
    const pending = await locate(geo || (source === 'mock' ? mockGeocoder : geocoder), all, { geoBudgetMs, backgroundMs, background });
    const items = all.filter((i) => i.lat != null).map(({ queries, ...i }) => i);
    // While addresses are still being looked up (in the background, see locate), the CDN keeps the reply for 15 s
    // only, so the next request shows the newly found places. The dataset itself changes every 2 h.
    res.setHeader('Cache-Control', pending ? 's-maxage=15' : 's-maxage=1800, stale-while-revalidate=3600');
    res.statusCode = 200;
    res.end(JSON.stringify({ updated: Date.now(), source, received: raw.length, pending, unlocated: all.length - items.length - pending, items }));
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.statusCode = 502;
    res.end(JSON.stringify({ error: e.message }));
  }
}

async function eventsHandler(req, res, { env = process.env, fetchImpl = fetch, geo, geoBudgetMs = 3000, backgroundMs = 45000, background = waitUntil } = {}) {
  if (rejectUnlessRead(req, res)) return;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  try {
    let raw, source = 'live';
    if (env.MOCK === '1') { source = 'mock'; raw = mockEvents(); }
    else {
      raw = await fetchEvents({
        apiKey: env.WARSAW_API_KEY, fetchImpl,
        upstream: env.UPSTREAM_URL ? { url: env.UPSTREAM_URL, secret: env.UPSTREAM_SECRET || '' } : undefined,
      });
    }
    const all = normalizeEvents(raw);
    const pending = await locate(geo || (source === 'mock' ? mockGeocoder : geocoder), all, { geoBudgetMs, backgroundMs, background });
    const items = [];
    for (const { queries, lat, lon, ...it } of all) {
      if (!it.points.length && lat != null) { it.points = [{ lat, lon, label: it.venue || it.address, street: it.address, district: it.district }]; it.located = 'address'; }
      if (it.points.length) items.push(it);
    }
    // Same caching as /api/sport: short while addresses are still being looked up.
    res.setHeader('Cache-Control', pending ? 's-maxage=15' : 's-maxage=1800, stale-while-revalidate=3600');
    res.statusCode = 200;
    res.end(JSON.stringify({ updated: Date.now(), source, received: raw.length, pending, unlocated: all.length - items.length - pending, items }));
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.statusCode = 502;
    res.end(JSON.stringify({ error: e.message }));
  }
}

module.exports = { fleetHandler, vehiclesHandler, parkingHandler, incidentsHandler, sportHandler, eventsHandler };
