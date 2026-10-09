// Cloudflare Worker: relay to the Warsaw API from Cloudflare's network
// (the Warsaw API may refuse connections from Vercel/AWS addresses).
// Secrets (Settings -> Variables and Secrets): WARSAW_API_KEY, PROXY_SECRET.
// KV binding GEOKODY (added by the deploy workflow): address -> coordinates, see geocodes() below.
// New open-data portal API: POST {"type": 1|2}, token in the Authorization header.
const ENDPOINT = 'https://dane.um.warszawa.pl/api/action/get_ztm_lokalizacja_pojazdow';
// Resources without a request body: ?resource=parking | incidents | fleet
const RESOURCES = {
  parking: 'https://dane.um.warszawa.pl/api/action/get_m_parkingi_wolne_miejsca',
  fleet: 'https://dane.um.warszawa.pl/api/action/get_ztm_pojazdy',
  incidents: 'https://dane.um.warszawa.pl/api/action/get_bin_utrudnienia_drogowe',
  sport: 'https://dane.um.warszawa.pl/api/action/get_bmm_zajecia_sportowe',
  wydarzenia: 'https://dane.um.warszawa.pl/api/action/get_bmm_kalendarz_wydarzen',
};

// Official ZTM timetable (GTFS ZIP, ~10 days ahead). ?resource=gtfs streams it through (no parsing, so it fits the free
// plan's CPU limit); &probe=1 answers only with the upstream status, size, date and the Cloudflare location (colo) the
// request went out from - the Warsaw servers refuse some locations (the Warsaw API answers 522 to Workers run in the USA).
const GTFS_URL = 'https://gtfs.ztm.waw.pl/last';
const GTFS_UA = 'wawEye/1.0 (+https://github.com/pacy2u/waweye)';

const json = (body, status) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Geocodes shared by every Vercel instance, kept across deploys and cold starts (lib/geocoding.js uses them).
// POST ?resource=geokody with {"get": [query, ...]} -> {"found": {query: {lat, lon} | null}} (stored queries only),
// or {"put": {query: {lat, lon} | null}} -> {"saved": n}. null means "Nominatim did not find it"; that answer
// expires after 30 days so the address gets another chance, coordinates are kept for good.
const GEO_PREFIX = 'v1:';
const GEO_MAX_GET = 100; // keys per request (the client sends more in chunks)
const GEO_MAX_PUT = 20;
const GEO_MAX_KEY = 300; // characters; KV allows 512 bytes
const GEO_MISS_TTL = 30 * 86400;
const inWarsaw = (v) => v && typeof v === 'object' && Number.isFinite(v.lat) && Number.isFinite(v.lon)
  && v.lat > 51.9 && v.lat < 52.6 && v.lon > 20.5 && v.lon < 21.6;
const goodKey = (k) => typeof k === 'string' && k.length > 0 && k.length <= GEO_MAX_KEY;

async function geocodes(request, env) {
  if (!env.GEOKODY) return json({ error: 'worker has no GEOKODY binding' }, 501);
  if (request.method !== 'POST') return json({ error: 'use POST' }, 405);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  if (body && Array.isArray(body.get)) {
    const keys = [...new Set(body.get)];
    if (keys.length > GEO_MAX_GET || !keys.every(goodKey)) return json({ error: `get: up to ${GEO_MAX_GET} non-empty strings of at most ${GEO_MAX_KEY} characters` }, 400);
    const found = {};
    await Promise.all(keys.map(async (k) => {
      const v = await env.GEOKODY.get(GEO_PREFIX + k, 'json');
      if (v === null) return; // not stored
      if (v.miss) found[k] = null;
      else if (inWarsaw(v)) found[k] = { lat: v.lat, lon: v.lon };
    }));
    return json({ found }, 200);
  }
  if (body && body.put && typeof body.put === 'object' && !Array.isArray(body.put)) {
    const entries = Object.entries(body.put);
    if (entries.length > GEO_MAX_PUT || !entries.every(([k, v]) => goodKey(k) && (v === null || inWarsaw(v)))) {
      return json({ error: `put: up to ${GEO_MAX_PUT} entries, each {lat, lon} inside Warsaw or null` }, 400);
    }
    await Promise.all(entries.map(([k, v]) => (v === null
      ? env.GEOKODY.put(GEO_PREFIX + k, '{"miss":true}', { expirationTtl: GEO_MISS_TTL })
      : env.GEOKODY.put(GEO_PREFIX + k, JSON.stringify({ lat: v.lat, lon: v.lon })))));
    return json({ saved: entries.length }, 200);
  }
  return json({ error: 'expected {"get": [...]} or {"put": {...}}' }, 400);
}

// Routes of the lines (lib/handler.js routesRefreshHandler writes them once a day from the ZTM GTFS, routeHandler reads
// them for the app), in the same KV namespace as the geocodes under their own prefix. One key per line plus a meta key
// (timetable validity, refresh time, fingerprints of the lines), and one key per day with the departures per hour of
// every line (the timelapse). GET &linia=175 | GET &dzien=2026-10-09 | GET &meta=1 | POST {put, del, days, delDays, meta}.
const ROUTE_PREFIX = 'trasy:v1:';
const ROUTE_MAX_PUT = 20; // per request, so parsing stays within the free plan's CPU time
const ROUTE_MAX_VALUE = 300000; // characters; a line is ~11 KB, the biggest ~60 KB
const goodLine = (l) => typeof l === 'string' && /^[A-Za-z0-9-]{1,10}$/.test(l);
const goodDay = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
const DAY_MAX_PUT = 3; // a day is ~50 KB

async function routes(request, env, params) {
  if (!env.GEOKODY) return json({ error: 'worker has no GEOKODY binding' }, 501);
  if (request.method === 'GET') {
    const day = params.get('dzien');
    if (day !== null && !goodDay(day)) return json({ error: 'bad dzien' }, 400);
    const key = params.get('meta') === '1' ? 'meta' : day !== null ? 'day:' + day : params.get('linia');
    if (key !== 'meta' && day === null && !goodLine(key)) return json({ error: 'bad linia' }, 400);
    const v = await env.GEOKODY.get(ROUTE_PREFIX + (key === 'meta' || day !== null ? key : 'line:' + key));
    return v === null ? json({ error: 'not found' }, 404) : new Response(v, { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (request.method !== 'POST') return json({ error: 'use GET or POST' }, 405);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  const put = Object.entries((body && body.put) || {}), del = (body && body.del) || [];
  const days = Object.entries((body && body.days) || {}), delDays = (body && body.delDays) || [];
  const meta = body && body.meta;
  if (put.length > ROUTE_MAX_PUT || !put.every(([k, v]) => goodLine(k) && typeof v === 'string' && v.length <= ROUTE_MAX_VALUE)
    || !Array.isArray(del) || del.length > 100 || !del.every(goodLine) || (meta !== undefined && (typeof meta !== 'string' || meta.length > ROUTE_MAX_VALUE))
    || days.length > DAY_MAX_PUT || !days.every(([k, v]) => goodDay(k) && typeof v === 'string' && v.length <= ROUTE_MAX_VALUE)
    || !Array.isArray(delDays) || delDays.length > 100 || !delDays.every(goodDay)) {
    return json({ error: `put: up to ${ROUTE_MAX_PUT} lines as JSON strings, del: up to 100 lines, days: up to ${DAY_MAX_PUT} days as JSON strings, delDays: up to 100 days, meta: a JSON string` }, 400);
  }
  await Promise.all([...put.map(([k, v]) => env.GEOKODY.put(ROUTE_PREFIX + 'line:' + k, v)), ...del.map((k) => env.GEOKODY.delete(ROUTE_PREFIX + 'line:' + k)),
    ...days.map(([k, v]) => env.GEOKODY.put(ROUTE_PREFIX + 'day:' + k, v)), ...delDays.map((k) => env.GEOKODY.delete(ROUTE_PREFIX + 'day:' + k))]);
  if (meta !== undefined) await env.GEOKODY.put(ROUTE_PREFIX + 'meta', meta);
  return json({ saved: put.length, deleted: del.length, days: days.length, deletedDays: delDays.length, meta: meta !== undefined }, 200);
}

async function gtfs(request, fetchImpl, probe) {
  const t0 = Date.now(), colo = (request.cf && request.cf.colo) || null;
  let res;
  try {
    res = await fetchImpl(GTFS_URL, { redirect: 'follow', headers: { 'User-Agent': GTFS_UA } });
  } catch (e) {
    return json({ error: 'upstream: ' + e.message, colo, ms: Date.now() - t0 }, 502);
  }
  const info = { status: res.status, url: res.url || GTFS_URL, type: res.headers.get('content-type'), length: res.headers.get('content-length'),
    modified: res.headers.get('last-modified'), disposition: res.headers.get('content-disposition'), colo, ms: Date.now() - t0 };
  if (probe || !res.ok) {
    try { if (res.body) await res.body.cancel(); } catch {}
    return json(res.ok ? info : { error: `gtfs: HTTP ${res.status}`, ...info }, res.ok ? 200 : 502);
  }
  const headers = { 'Content-Type': info.type || 'application/zip', 'x-gtfs-url': info.url, 'x-gtfs-modified': info.modified || '', 'x-colo': colo || '' };
  if (info.length) headers['Content-Length'] = info.length;
  return new Response(res.body, { status: 200, headers });
}

export async function handle(request, env, fetchImpl) {
  if (!env.PROXY_SECRET || request.headers.get('x-proxy-secret') !== env.PROXY_SECRET) return json({ error: 'forbidden' }, 403);
  const params = new URL(request.url).searchParams;
  const resource = params.get('resource');
  if (resource === 'geokody') {
    try { return await geocodes(request, env); } catch (e) { return json({ error: 'kv: ' + e.message }, 502); }
  }
  if (resource === 'gtfs') return gtfs(request, fetchImpl, params.get('probe') === '1');
  if (resource === 'trasy') {
    try { return await routes(request, env, params); } catch (e) { return json({ error: 'kv: ' + e.message }, 502); }
  }
  const resourceUrl = Object.hasOwn(RESOURCES, resource) ? RESOURCES[resource] : undefined;
  const type = params.get('type');
  if (!resourceUrl && type !== '1' && type !== '2') return json({ error: 'bad type' }, 400);
  if (!env.WARSAW_API_KEY) return json({ error: 'worker is missing WARSAW_API_KEY' }, 500);
  try {
    // The docs say "Authorization: token uzytkownika"; try the raw token, then "Bearer <token>" on 401/403.
    let res;
    for (const auth of [env.WARSAW_API_KEY, `Bearer ${env.WARSAW_API_KEY}`]) {
      res = await fetchImpl(resourceUrl || ENDPOINT, resourceUrl
        ? { method: 'POST', headers: { Authorization: auth } }
        : { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: Number(type) }) });
      if (res.status !== 401 && res.status !== 403) break;
    }
    return new Response(await res.text(), { status: res.status, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return json({ error: 'upstream: ' + e.message }, 502);
  }
}

export default {
  // Cloudflare calls fetch(request, env, ctx) - ctx is NOT a fetch function.
  fetch(request, env) {
    return handle(request, env, fetch);
  },
};
