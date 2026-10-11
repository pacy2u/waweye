'use strict';
const { fetchVehicles, fetchParkings, fetchIncidents, fetchFleet, fetchSport, fetchEvents, normalizeFleet, normalizeParkings, normalizeIncidents, normalizeSport, normalizeEvents } = require('./warsaw');
const { mockVehicles, mockParkings, mockIncidents, mockFleet, mockSport, mockEvents, MOCK_GEOCODES } = require('./mock');
const { createGeocoder, workerStore } = require('./geocoding');
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
// Answers shared by all instances and kept across deploys: the Worker's KV (only when the Worker is in use).
const geoStore = (env, fetchImpl) => (env.UPSTREAM_URL ? workerStore({ url: env.UPSTREAM_URL, secret: env.UPSTREAM_SECRET || '', fetchImpl }) : undefined);
const mockGeocoder = createGeocoder({ minGapMs: 0, fetchImpl: async (url) => {
  const hit = MOCK_GEOCODES[new URL(url).searchParams.get('q')];
  return new Response(JSON.stringify(hit ? [{ lat: String(hit.lat), lon: String(hit.lon) }] : []), { status: 200 });
} });

// A reply waits at most geoBudgetMs for address lookups; whatever is left goes on in the background for up to
// backgroundMs (within the functions' 60 s limit), so places fill in within minutes, not one batch per request.
async function locate(geo, items, { geoBudgetMs, backgroundMs, background, store }) {
  const pending = await geo.locate(items, { budgetMs: geoBudgetMs, store });
  if (pending && geo.locateLater) {
    const later = geo.locateLater(items, { budgetMs: backgroundMs, store });
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
    const pending = await locate(geo || (source === 'mock' ? mockGeocoder : geocoder), all, { geoBudgetMs, backgroundMs, background, store: source === 'mock' ? undefined : geoStore(env, fetchImpl) });
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
    const pending = await locate(geo || (source === 'mock' ? mockGeocoder : geocoder), all, { geoBudgetMs, backgroundMs, background, store: source === 'mock' ? undefined : geoStore(env, fetchImpl) });
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

// Diagnostics: can this Vercel region (fra1) get the official ZTM GTFS, through the Worker and directly?
// Answers only with statuses and sizes (the Worker's probe mode; the direct request is cut after the headers).
async function gtfsProbeHandler(req, res, { env = process.env, fetchImpl = fetch } = {}) {
  if (rejectUnlessRead(req, res)) return;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  const timed = async (fn) => { const t0 = Date.now(); try { return { ...(await fn()), ms: Date.now() - t0 }; } catch (e) { return { error: e.cause ? `${e.message} (${e.cause.code || e.cause.message})` : e.message, ms: Date.now() - t0 }; } };
  const viaWorker = env.UPSTREAM_URL ? await timed(async () => {
    const u = env.UPSTREAM_URL + (env.UPSTREAM_URL.includes('?') ? '&' : '?') + 'resource=gtfs&probe=1';
    const r = await fetchImpl(u, { headers: { 'x-proxy-secret': env.UPSTREAM_SECRET || '' }, signal: AbortSignal.timeout(25000) });
    return { httpStatus: r.status, worker: await r.json().catch(() => null) };
  }) : { error: 'brak UPSTREAM_URL (produkcja bez Workera)' };
  const direct = await timed(async () => {
    const r = await fetchImpl('https://gtfs.ztm.waw.pl/last', { redirect: 'follow', headers: { 'User-Agent': 'wawEye/1.0 (+https://github.com/pacy2u/waweye)' }, signal: AbortSignal.timeout(25000) });
    try { if (r.body) await r.body.cancel(); } catch {}
    return { status: r.status, url: r.url, length: r.headers.get('content-length'), modified: r.headers.get('last-modified') };
  });
  res.statusCode = 200;
  res.end(JSON.stringify({ region: env.VERCEL_REGION || 'lokalnie', checked: new Date().toISOString(), viaWorker, direct }));
}

// ---- Routes of the lines: a daily refresh from the ZTM GTFS into the Worker's KV, and reads for the app ----
// Vercel runs in Frankfurt (fra1), where gtfs.ztm.waw.pl answers; GitHub's runners and Workers called from the USA get
// no connection (2026-10-05). The cron in vercel.json calls /api/odswiez-trasy once a day.
const GTFS_URL = 'https://gtfs.ztm.waw.pl/last';
const ROUTE_LINE_RE = /^[A-Za-z0-9-]{1,10}$/;
const REFRESH_EVERY_MS = 12 * 3600e3; // without CRON_SECRET anyone may call the refresh; it does nothing more often
const ATTEMPT_EVERY_MS = 15 * 60e3; // and one instance does not start another download sooner than this
let lastAttempt = 0;
const resetRouteState = () => { lastAttempt = 0; routeMetaCache = { at: 0, value: undefined }; }; // tests
let routeMetaCache = { at: 0, value: undefined };

const workerUrl = (env, query) => env.UPSTREAM_URL + (env.UPSTREAM_URL.includes('?') ? '&' : '?') + query;
const workerFetch = (env, fetchImpl, query, init = {}) => fetchImpl(workerUrl(env, query),
  { ...init, headers: { 'x-proxy-secret': env.UPSTREAM_SECRET || '', ...(init.headers || {}) }, signal: AbortSignal.timeout(init.timeout || 25000) });

async function routeMeta(env, fetchImpl, fresh = false) {
  if (!fresh && routeMetaCache.value !== undefined && Date.now() - routeMetaCache.at < 600e3) return routeMetaCache.value;
  const r = await workerFetch(env, fetchImpl, 'resource=trasy&meta=1');
  if (r.status === 404) { routeMetaCache = { at: Date.now(), value: null }; return null; }
  if (!r.ok) throw new Error(`magazyn tras: HTTP ${r.status}`);
  const value = await r.json();
  routeMetaCache = { at: Date.now(), value };
  return value;
}

// GET /api/trasa?linia=175 -> the line's variants with the timetable's validity; ?meta=1 -> validity and refresh time;
// ?dzien=2026-10-09 -> departures per hour of every line on that day (scripts/trasy.js departures), for the timelapse.
// 404 when the store has no such line (or there is no Worker): the app then falls back to public/data/trasy/<line>.json.
async function routeHandler(req, res, { env = process.env, fetchImpl = fetch } = {}) {
  if (rejectUnlessRead(req, res)) return;
  const url = new URL(req.url, 'http://x');
  const send = (status, body, cache) => { res.statusCode = status; res.setHeader('Cache-Control', cache); res.end(JSON.stringify(body)); };
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (!env.UPSTREAM_URL) return send(404, { error: 'brak magazynu tras (produkcja bez Workera)' }, 'no-store');
  try {
    if (url.searchParams.get('meta') === '1') {
      const m = await routeMeta(env, fetchImpl, true);
      if (!m) return send(404, { error: 'magazyn tras jest pusty' }, 'no-store');
      return send(200, { source: m.source, valid: m.valid, refreshed: m.refreshed, lines: Object.keys(m.lines || {}).length, days: Object.keys(m.dayHashes || {}) }, 'public, s-maxage=60');
    }
    const day = url.searchParams.get('dzien');
    if (day !== null) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return send(400, { error: 'podaj dzień, np. ?dzien=2026-10-09' }, 'no-store');
      const r = await workerFetch(env, fetchImpl, 'resource=trasy&dzien=' + day);
      if (r.status === 404) return send(404, { error: 'brak rozkładu na ten dzień' }, 'public, s-maxage=300');
      if (!r.ok) throw new Error(`magazyn tras: HTTP ${r.status}`);
      return send(200, { date: day, lines: await r.json() }, 'public, s-maxage=3600, stale-while-revalidate=86400');
    }
    const line = url.searchParams.get('linia') || '';
    if (!ROUTE_LINE_RE.test(line)) return send(400, { error: 'podaj linię, np. ?linia=175' }, 'no-store');
    const [r, m] = await Promise.all([workerFetch(env, fetchImpl, 'resource=trasy&linia=' + encodeURIComponent(line)), routeMeta(env, fetchImpl)]);
    if (r.status === 404) return send(404, { error: 'brak trasy tej linii' }, 'public, s-maxage=300');
    if (!r.ok) throw new Error(`magazyn tras: HTTP ${r.status}`);
    const body = await r.json();
    return send(200, { ...body, valid: m && m.valid, refreshed: m && m.refreshed }, 'public, s-maxage=3600, stale-while-revalidate=86400');
  } catch (e) {
    return send(502, { error: e.message }, 'no-store');
  }
}

// GET /api/odswiez-trasy (Vercel cron): download the GTFS, build the routes (scripts/trasy.js), check them, and write the
// lines whose fingerprint changed plus the meta key. Bad or missing data writes nothing, so the old routes stay.
async function routesRefreshHandler(req, res, { env = process.env, fetchImpl = fetch, now = Date.now, build } = {}) {
  if (rejectUnlessRead(req, res)) return;
  const url = new URL(req.url, 'http://x');
  const send = (status, body) => { res.statusCode = status; res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)); };
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (!env.UPSTREAM_URL) return send(500, { error: 'brak UPSTREAM_URL: trasy są przechowywane przez Workera' });
  const h = req.headers || {};
  const secretOk = !!env.UPSTREAM_SECRET && h['x-proxy-secret'] === env.UPSTREAM_SECRET;
  const cronOk = !!env.CRON_SECRET && h.authorization === `Bearer ${env.CRON_SECRET}`;
  if (env.CRON_SECRET && !cronOk && !secretOk) return send(401, { error: 'unauthorized' });
  const force = secretOk && url.searchParams.get('wymus') === '1';
  const t0 = now();
  try {
    const old = await routeMeta(env, fetchImpl, true);
    if (!force && old && old.refreshed && t0 - Date.parse(old.refreshed) < REFRESH_EVERY_MS) return send(200, { skipped: 'odświeżone niedawno', refreshed: old.refreshed });
    if (!force && t0 - lastAttempt < ATTEMPT_EVERY_MS) return send(429, { error: 'poprzednia próba była przed chwilą' });
    lastAttempt = t0;
    const trasy = require('../scripts/trasy');
    let buf, via = 'bezpośrednio';
    try {
      const r = await fetchImpl(GTFS_URL, { redirect: 'follow', headers: { 'User-Agent': 'wawEye/1.0 (+https://github.com/pacy2u/waweye)' }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      buf = Buffer.from(await r.arrayBuffer());
    } catch (e) {
      via = `przez Workera (bezpośrednio: ${e.message})`;
      const r = await workerFetch(env, fetchImpl, 'resource=gtfs', { timeout: 30000 });
      if (!r.ok) throw new Error(`GTFS niedostępny bezpośrednio (${e.message}) ani przez Workera (HTTP ${r.status})`, { cause: e });
      buf = Buffer.from(await r.arrayBuffer());
    }
    const { lines, valid, problems, days = {} } = await (build || trasy.fromZip)(buf);
    if (problems.length) return send(502, { error: 'dane nie przeszły kontroli, magazyn bez zmian', problems: problems.slice(0, 20), via });
    const hashes = {}, changed = [];
    for (const L of lines) { hashes[L.line] = trasy.lineHash(L); if (!old || !old.hashes || old.hashes[L.line] !== hashes[L.line]) changed.push(L); }
    const removed = old && old.hashes ? Object.keys(old.hashes).filter((l) => !hashes[l]) : [];
    const post = async (payload) => {
      const r = await workerFetch(env, fetchImpl, 'resource=trasy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!r.ok) throw new Error(`zapis w magazynie tras: HTTP ${r.status} ${(await r.text()).slice(0, 120)}`);
      return r.json().catch(() => ({}));
    };
    const batches = [];
    for (let i = 0; i < changed.length; i += 10) batches.push(changed.slice(i, i + 10)); // ~110 KB per request: little CPU for the Worker
    for (let i = 0; i < batches.length; i += 4) {
      await Promise.all(batches.slice(i, i + 4).map((b) => post({ put: Object.fromEntries(b.map((L) => [L.line, JSON.stringify(trasy.lineBody(L))])) })));
    }
    for (let i = 0; i < removed.length; i += 100) await post({ del: removed.slice(i, i + 100) });
    // Departures per hour: one key per day, written when it changed; days gone from the timetable are deleted.
    // A Worker deployed before this feature answers without "days" and stores nothing: then no day counts as written,
    // so the next refresh tries again.
    let dayHashes = {}, daysNote = null;
    const changedDays = [];
    for (const [d, day] of Object.entries(days)) { dayHashes[d] = trasy.dayHash(day); if (!old || !old.dayHashes || old.dayHashes[d] !== dayHashes[d]) changedDays.push(d); }
    for (let i = 0; i < changedDays.length; i += 3) {
      const r = await post({ days: Object.fromEntries(changedDays.slice(i, i + 3).map((d) => [d, JSON.stringify(days[d])])) });
      if (r.days === undefined) { dayHashes = {}; daysNote = 'Worker nie obsługuje dni (wdróż nowszy kod Workera)'; break; }
    }
    const removedDays = !daysNote && old && old.dayHashes ? Object.keys(old.dayHashes).filter((d) => !dayHashes[d]) : [];
    if (removedDays.length) await post({ delDays: removedDays.slice(0, 100) });
    const refreshed = new Date(now()).toISOString();
    // The meta key goes last: until it is written, readers keep seeing the previous refresh as complete.
    await post({ meta: JSON.stringify({ source: 'GTFS ZTM Warszawa (gtfs.ztm.waw.pl)', valid, refreshed, lines: Object.fromEntries(lines.map((L) => [L.line, L.type])), hashes, dayHashes }) });
    routeMetaCache = { at: 0, value: undefined };
    return send(200, { refreshed, valid, lines: lines.length, changed: changed.length, deleted: removed.length, days: Object.keys(days).length, changedDays: daysNote ? 0 : changedDays.length, ...(daysNote && { daysNote }), via, ms: now() - t0 });
  } catch (e) {
    return send(502, { error: e.message });
  }
}

module.exports = { routeHandler, routesRefreshHandler, resetRouteState, gtfsProbeHandler, fleetHandler, vehiclesHandler, parkingHandler, incidentsHandler, sportHandler, eventsHandler };
