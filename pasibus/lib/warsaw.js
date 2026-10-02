'use strict';
// Warsaw Open Data: "Lokalizacja pojazdów komunikacji miejskiej"
// New open-data portal API (dane.um.warszawa.pl): POST JSON {"type": 1|2}, token in the Authorization header.
const ENDPOINT = 'https://dane.um.warszawa.pl/api/action/get_ztm_lokalizacja_pojazdow';
const PARKING_ENDPOINT = 'https://dane.um.warszawa.pl/api/action/get_m_parkingi_wolne_miejsca';
const TYPES = { 1: 'bus', 2: 'tram' };
const MAX_AGE_MS = 5 * 60 * 1000;
const BBOX = { minLat: 51.9, maxLat: 52.6, minLon: 20.5, maxLon: 21.6 };

// "2026-10-02 17:33:16" is Warsaw local time (CET/CEST); convert to epoch ms without hardcoding the offset.
const WARSAW_FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Warsaw', hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
function parseWarsawTime(str) {
  const naive = Date.parse(String(str).trim().replace(' ', 'T') + 'Z'); // same wall clock, as if UTC
  if (!Number.isFinite(naive)) return null;
  const p = Object.fromEntries(WARSAW_FMT.formatToParts(new Date(naive)).map((x) => [x.type, x.value]));
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  let guess = naive - (wall - naive); // naive minus the offset Warsaw has at that instant
  const p2 = Object.fromEntries(WARSAW_FMT.formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  guess += naive - Date.UTC(+p2.year, +p2.month - 1, +p2.day, +p2.hour, +p2.minute, +p2.second); // fix near DST edges
  return guess;
}

function normalize(raw, type, now = Date.now()) {
  const out = [];
  for (const r of raw) {
    const lat = Number(r.Lat), lon = Number(r.Lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < BBOX.minLat || lat > BBOX.maxLat || lon < BBOX.minLon || lon > BBOX.maxLon) continue;
    const time = parseWarsawTime(r.Time);
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

// Pull the list out of the reply. Vehicles: bare array (new API) or {result: [...]}.
// Parkings: the docs show {"Parkings": [...]}; also accept a bare array or the list under result.
const extractVehicles = (b) => (Array.isArray(b) ? b : Array.isArray(b && b.result) ? b.result : null);
const extractParkings = (b) => {
  if (Array.isArray(b)) return b;
  if (!b || typeof b !== 'object') return null;
  for (const c of [b.Parkings, b.parkings, b.result && b.result.Parkings, b.result]) if (Array.isArray(c)) return c;
  return null;
};

async function fetchOnce(url, fetchImpl, init, extract) {
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
  const list = extract(body);
  if (!list) {
    // Show the shape of what we got (a short preview, never headers/tokens) so odd replies can be diagnosed.
    throw new Error(errorText(body) || `Unexpected API response: ${JSON.stringify(body).slice(0, 160)}`);
  }
  return list;
}

// Relay mode (Cloudflare Worker): GET with a shared secret; the Warsaw token lives in the Worker.
// Direct mode: POST to the Warsaw API. Token format in the docs is ambiguous ("token uzytkownika"),
// so try the raw token first and "Bearer <token>" if the API answers 401/403.
async function requestList({ endpoint, jsonBody, relayQuery, extract, apiKey, fetchImpl, upstream }) {
  const attempts = upstream
    ? [{ url: `${upstream.url}${upstream.url.includes('?') ? '&' : '?'}${relayQuery}`, init: { headers: { 'x-proxy-secret': upstream.secret } } }]
    : [apiKey, `Bearer ${apiKey}`].map((auth) => ({
        url: endpoint,
        init: { method: 'POST', headers: { Authorization: auth, ...(jsonBody ? { 'Content-Type': 'application/json' } : {}) }, ...(jsonBody ? { body: JSON.stringify(jsonBody) } : {}) },
      }));
  let lastErr;
  for (const a of attempts) {
    try {
      try {
        return await fetchOnce(a.url, fetchImpl, a.init, extract);
      } catch (e) {
        // One retry for quick network errors/5xx; not for timeouts (already waited long), 4xx or auth errors.
        if (/timeout|aborted/i.test(e.message) || /^HTTP 4/.test(e.message) || /token|klucz|apikey|autoryz|unauthor|forbidden/i.test(e.message)) throw e;
        return await fetchOnce(a.url, fetchImpl, a.init, extract);
      }
    } catch (e) {
      lastErr = e;
      if (!/^HTTP (401|403)|token|unauthor|forbidden/i.test(e.message)) break;
    }
  }
  throw lastErr;
}

async function fetchType(type, apiKey, fetchImpl, upstream) {
  const raw = await requestList({ endpoint: ENDPOINT, jsonBody: { type }, relayQuery: `type=${type}`, extract: extractVehicles, apiKey, fetchImpl, upstream });
  return normalize(raw, type);
}

// ---- Parkings (dataset "Wolne miejsca parkingowe") ----
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
function normalizeParkings(raw) {
  const out = [];
  for (const r of raw) {
    const lat = Number(r.latitude), lon = Number(r.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < BBOX.minLat || lat > BBOX.maxLat || lon < BBOX.minLon || lon > BBOX.maxLon) continue;
    const cap = { standard: 0, disabled: 0, electric: 0 };
    for (const l of Array.isArray(r.total_places) ? r.total_places : []) {
      cap.standard += num(l.standard); cap.disabled += num(l.disabled); cap.electric += num(l.electric);
    }
    const f = r.free_places_total || {};
    const car = (Array.isArray(r.tariffs) ? r.tariffs : []).find((t) => /osobow|car/i.test(t.VehicleType || ''));
    out.push({
      id: `p-${lat.toFixed(5)}-${lon.toFixed(5)}`,
      name: String(r.name || r.start_date || 'Parking').trim(),
      address: String(r.adress || r.address || '').trim(),
      lat, lon,
      category: r.parkingCategory || '',
      manager: r.manager || '',
      free: { standard: num(f.public), disabled: num(f.disabled), electric: num(f.electric) },
      capacity: cap,
      hours: Array.isArray(r.opening_hours) && r.opening_hours[0] ? r.opening_hours[0] : null,
      payment: r.acceptedPaymentMethod || '',
      security: r.additionalSecurity || '',
      phone: r.operatorTelephone || r.managerTelephone || '',
      carTariff: car && Array.isArray(car.Prices) ? car.Prices.map((p) => ({ hours: num(p.StayLength), price: num(p.StayPrice) })) : [],
    });
  }
  return out;
}

async function fetchParkings({ apiKey, fetchImpl = fetch, upstream }) {
  if (!apiKey && !upstream) throw new Error('Missing WARSAW_API_KEY');
  const raw = await requestList({ endpoint: PARKING_ENDPOINT, relayQuery: 'resource=parking', extract: extractParkings, apiKey, fetchImpl, upstream });
  return normalizeParkings(raw);
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

module.exports = { fetchVehicles, fetchParkings, normalize, normalizeParkings, TYPES };
