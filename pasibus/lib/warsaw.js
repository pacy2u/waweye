'use strict';
// Warsaw Open Data: "Lokalizacja pojazdów komunikacji miejskiej"
// New open-data portal API (dane.um.warszawa.pl): POST JSON {"type": 1|2}, token in the Authorization header.
const ENDPOINT = 'https://dane.um.warszawa.pl/api/action/get_ztm_lokalizacja_pojazdow';
const TYPES = { 1: 'bus', 2: 'tram' };
const MAX_AGE_MS = 5 * 60 * 1000;
const BBOX = { minLat: 51.9, maxLat: 52.6, minLon: 20.5, maxLon: 21.6 };

function normalize(raw, type, now = Date.now()) {
  const out = [];
  for (const r of raw) {
    const lat = Number(r.Lat), lon = Number(r.Lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < BBOX.minLat || lat > BBOX.maxLat || lon < BBOX.minLon || lon > BBOX.maxLon) continue;
    const t = Date.parse(String(r.Time).replace(' ', 'T') + '+02:00');
    const time = Number.isFinite(t) ? t : null;
    if (time !== null && now - time > MAX_AGE_MS) continue;
    out.push({
      id: `${type}-${r.VehicleNumber}`,
      type: TYPES[type],
      line: String(r.Lines).trim(),
      vehicle: String(r.VehicleNumber),
      brigade: r.Brigade == null ? '' : String(r.Brigade).trim(),
      lat, lon, time,
    });
  }
  return out;
}

const TIMEOUT_MS = 25000;

// Node's fetch only says "fetch failed"; the real reason (ECONNRESET, ENOTFOUND, cert...) is in err.cause.
function describe(err) {
  const c = err && err.cause;
  const detail = c && (c.code || c.message);
  return detail && !String(err.message).includes(detail) ? `${err.message} (${detail})` : err.message;
}

function errorText(b) {
  if (!b || typeof b !== 'object') return '';
  const e = b.error;
  return (typeof e === 'string' ? e : e && (e.message || JSON.stringify(e))) || b.message || b.detail || (typeof b.result === 'string' ? b.result : '');
}

async function fetchOnce(url, fetchImpl, init) {
  let res;
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS), ...init });
  } catch (e) {
    throw new Error(describe(e));
  }
  if (!res.ok) {
    // Relay/API errors carry a JSON {error}; include it so "HTTP 403" says who refused and why.
    let why = '';
    try { const j = await res.json(); why = errorText(j) || ''; } catch {}
    throw new Error(`HTTP ${res.status}${why ? ` (${why})` : ''}`);
  }
  const body = await res.json();
  if (!Array.isArray(body.result)) {
    // Show the shape of what we got (keys + a short preview, never headers/tokens) so odd replies can be diagnosed.
    const preview = JSON.stringify(body).slice(0, 160);
    throw new Error(errorText(body) || `Unexpected API response: ${preview}`);
  }
  return body.result;
}

async function fetchType(type, apiKey, fetchImpl, upstream) {
  // Relay mode (Cloudflare Worker): GET with a shared secret; the Warsaw token lives in the Worker.
  // Direct mode: POST to the Warsaw API. Token format in the docs is ambiguous ("token uzytkownika"),
  // so try the raw token first and "Bearer <token>" if the API answers 401/403.
  const attempts = upstream
    ? [{ url: `${upstream.url}${upstream.url.includes('?') ? '&' : '?'}type=${type}`, init: { headers: { 'x-proxy-secret': upstream.secret } } }]
    : [apiKey, `Bearer ${apiKey}`].map((auth) => ({
        url: ENDPOINT,
        init: { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ type }) },
      }));
  let raw, lastErr;
  for (const a of attempts) {
    try {
      try {
        raw = await fetchOnce(a.url, fetchImpl, a.init);
      } catch (e) {
        // One retry for quick network errors/5xx; not for timeouts (already waited long), 4xx or auth errors.
        if (/timeout|aborted/i.test(e.message) || /^HTTP 4/.test(e.message) || /token|klucz|apikey|autoryz|unauthor|forbidden/i.test(e.message)) throw e;
        raw = await fetchOnce(a.url, fetchImpl, a.init);
      }
      return normalize(raw, type);
    } catch (e) {
      lastErr = e;
      if (!/^HTTP (401|403)|token|unauthor|forbidden/i.test(e.message)) break;
    }
  }
  throw lastErr;
}

async function fetchVehicles({ apiKey, types = [1, 2], fetchImpl = fetch, upstream }) {
  if (!apiKey && !upstream) throw new Error('Missing WARSAW_API_KEY');
  const settled = await Promise.allSettled(types.map((t) => fetchType(t, apiKey, fetchImpl, upstream)));
  const vehicles = [], errors = [];
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') vehicles.push(...s.value);
    else errors.push(`${TYPES[types[i]]}: ${s.reason.message}`);
  });
  if (errors.length === types.length) throw new Error(errors.join('; '));
  return { vehicles, errors };
}

module.exports = { fetchVehicles, normalize, TYPES };
