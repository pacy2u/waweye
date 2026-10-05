'use strict';
// Address -> coordinates for sport classes that have no "map" point, with OpenStreetMap Nominatim.
// Usage policy (https://operations.osmfoundation.org/policies/nominatim/): at most 1 request per second, an
// identifying User-Agent, results cached. Calls are queued one at a time per server instance and every answer,
// "not found" included, is kept in memory; each request spends at most budgetMs on new lookups, the rest waits
// for the next request (the handler then lets the CDN cache the reply only briefly).
// With a store (the Worker's KV, see workerStore) every instance first takes the answers already known to any
// instance, before or after a deploy, and saves the ones it found itself; only addresses nobody has looked up yet
// go to Nominatim. The store is optional: when it fails, lookups carry on without it.
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'wawEye/1.0 (+https://waweye.vercel.app/o-serwisie)';
const VIEWBOX = '20.85,52.37,21.28,52.09'; // Warsaw: left, top, right, bottom

const STORE_GET_CHUNK = 100; // the Worker's limits per request
const STORE_PUT_CHUNK = 20;
const STORE_PAUSE_MS = 10 * 60000; // after a store failure (e.g. the Worker has no KV yet), ask it again later

const isPoint = (v) => v && Number.isFinite(v.lat) && Number.isFinite(v.lon);
const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, (i + 1) * n));

// The Worker's ?resource=geokody (worker/index.js), with the same secret as the data resources.
function workerStore({ url, secret, fetchImpl = fetch, timeoutMs = 3000 }) {
  const endpoint = `${url}${url.includes('?') ? '&' : '?'}resource=geokody`;
  const call = async (body) => {
    const res = await fetchImpl(endpoint, {
      method: 'POST', headers: { 'x-proxy-secret': secret, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`geokody HTTP ${res.status}`);
    return res.json();
  };
  return {
    // -> {query: {lat, lon} | null} for the stored queries only
    async get(queries) {
      const found = {};
      for (const part of await Promise.all(chunks(queries, STORE_GET_CHUNK).map((c) => call({ get: c })))) {
        for (const [q, v] of Object.entries((part && part.found) || {})) {
          if (v === null) found[q] = null;
          else if (isPoint(v)) found[q] = { lat: v.lat, lon: v.lon };
        }
      }
      return found;
    },
    async put(entries) {
      await Promise.all(chunks(Object.entries(entries), STORE_PUT_CHUNK).map((c) => call({ put: Object.fromEntries(c) })));
    },
  };
}

function createGeocoder({ fetchImpl = fetch, minGapMs = 1100, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const cache = new Map(); // query -> {lat, lon} | null
  const askedStore = new Set(); // queries the store did not have: this instance looks them up itself
  let unsaved = {}; // found here, not yet in the store
  let queue = Promise.resolve(), last = -Infinity, blockedUntil = 0, storePausedUntil = 0;

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

  async function fromStore(store, items) {
    const ask = new Set();
    for (const it of items) {
      if (it.lat != null || !it.queries) continue;
      for (const q of it.queries) if (!cache.has(q) && !askedStore.has(q)) ask.add(q);
    }
    if (!ask.size) return;
    try {
      const found = await store.get([...ask]);
      for (const q of ask) { askedStore.add(q); if (Object.hasOwn(found, q)) cache.set(q, found[q]); }
    } catch {
      storePausedUntil = now() + STORE_PAUSE_MS;
    }
  }

  async function toStore(store) {
    const entries = unsaved;
    if (!Object.keys(entries).length) return;
    unsaved = {};
    try { await store.put(entries); } catch { unsaved = { ...entries, ...unsaved }; storePausedUntil = now() + STORE_PAUSE_MS; }
  }

  // Fills lat/lon of items that have queries. Returns how many still wait for a lookup.
  async function locate(items, { budgetMs = 20000, store } = {}) {
    const deadline = now() + budgetMs;
    const useStore = store && now() >= storePausedUntil;
    if (useStore) await fromStore(store, items);
    let pending = 0;
    for (const it of items) {
      if (it.lat != null || !it.queries) continue;
      for (const q of it.queries) {
        if (!cache.has(q)) {
          // Leave it for the next request if the call could not start (throttle included) before the deadline.
          if (Math.max(now(), last + minGapMs) >= deadline || now() < blockedUntil) { pending++; break; }
          try { const hit = await throttled(q); cache.set(q, hit); if (store) unsaved[q] = hit; } catch { pending++; break; } // errors are not cached: retried next time
        }
        const hit = cache.get(q);
        if (hit) { it.lat = hit.lat; it.lon = hit.lon; it.located = 'address'; break; }
      }
    }
    if (useStore && now() >= storePausedUntil) await toStore(store);
    return pending;
  }

  // Keeps looking up after the reply has gone (Vercel waitUntil), so the next reply has more places.
  // One background run per instance at a time; it shares the throttled queue with the requests.
  let running = null;
  function locateLater(items, { budgetMs = 45000, store } = {}) {
    if (running) return null;
    running = locate(items, { budgetMs, store }).catch(() => 0).finally(() => { running = null; });
    return running;
  }

  return { locate, locateLater, cache };
}

module.exports = { createGeocoder, workerStore, USER_AGENT };
