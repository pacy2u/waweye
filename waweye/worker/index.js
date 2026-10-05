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

export async function handle(request, env, fetchImpl) {
  if (!env.PROXY_SECRET || request.headers.get('x-proxy-secret') !== env.PROXY_SECRET) return json({ error: 'forbidden' }, 403);
  const params = new URL(request.url).searchParams;
  const resource = params.get('resource');
  if (resource === 'geokody') {
    try { return await geocodes(request, env); } catch (e) { return json({ error: 'kv: ' + e.message }, 502); }
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
