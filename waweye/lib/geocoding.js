'use strict';
// Address -> coordinates for sport classes that have no "map" point, with OpenStreetMap Nominatim.
// Usage policy (https://operations.osmfoundation.org/policies/nominatim/): at most 1 request per second, an
// identifying User-Agent, results cached. Calls are queued one at a time per server instance and every answer,
// "not found" included, is kept in memory; each request spends at most budgetMs on new lookups, the rest waits
// for the next request (the handler then lets the CDN cache the reply only briefly).
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'wawEye/1.0 (+https://waweye.vercel.app/o-serwisie)';
const VIEWBOX = '20.85,52.37,21.28,52.09'; // Warsaw: left, top, right, bottom

function createGeocoder({ fetchImpl = fetch, minGapMs = 1100, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const cache = new Map(); // query -> {lat, lon} | null
  let queue = Promise.resolve(), last = -Infinity, blockedUntil = 0;

  async function lookup(q) {
    const url = `${NOMINATIM}?format=jsonv2&limit=1&countrycodes=pl&bounded=1&viewbox=${VIEWBOX}&q=${encodeURIComponent(q)}`;
    const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'pl' }, signal: AbortSignal.timeout(10000) });
    if (res.status === 429 || res.status === 403) { blockedUntil = now() + 10 * 60000; throw new Error(`Nominatim HTTP ${res.status}`); }
    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
    const [hit] = await res.json();
    const lat = Number(hit && hit.lat), lon = Number(hit && hit.lon);
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
  }

  // One Nominatim call at a time, at least minGapMs apart, also across concurrent requests.
  function throttled(q) {
    const run = queue.then(async () => {
      const wait = last + minGapMs - now();
      if (wait > 0) await sleep(wait);
      last = now();
      return lookup(q);
    });
    queue = run.catch(() => {});
    return run;
  }

  // Fills lat/lon of items that have queries. Returns how many still wait for a lookup.
  async function locate(items, { budgetMs = 20000 } = {}) {
    const deadline = now() + budgetMs;
    let pending = 0;
    for (const it of items) {
      if (it.lat != null || !it.queries) continue;
      for (const q of it.queries) {
        if (!cache.has(q)) {
          // Leave it for the next request if the call could not start (throttle included) before the deadline.
          if (Math.max(now(), last + minGapMs) >= deadline || now() < blockedUntil) { pending++; break; }
          try { cache.set(q, await throttled(q)); } catch { pending++; break; } // errors are not cached: retried next time
        }
        const hit = cache.get(q);
        if (hit) { it.lat = hit.lat; it.lon = hit.lon; it.located = 'address'; break; }
      }
    }
    return pending;
  }

  return { locate, cache };
}

module.exports = { createGeocoder, USER_AGENT };
