'use strict';
// Warsaw Open Data: "Lokalizacja pojazdów komunikacji miejskiej"
const ENDPOINT = 'https://api.um.warszawa.pl/api/action/busestrams_get/';
const RESOURCE_ID = 'f2e5503e-927d-4ad3-9500-4ab9e55deb59';
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

const TIMEOUT_MS = 12000;

async function fetchOnce(url, fetchImpl) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  if (!Array.isArray(body.result)) {
    throw new Error(typeof body.result === 'string' ? body.result : (body.error || 'Unexpected API response'));
  }
  return body.result;
}

async function fetchType(type, apiKey, fetchImpl) {
  const url = `${ENDPOINT}?resource_id=${RESOURCE_ID}&apikey=${encodeURIComponent(apiKey)}&type=${type}`;
  let raw;
  try {
    raw = await fetchOnce(url, fetchImpl);
  } catch (e) {
    // The Warsaw API is occasionally slow; one retry for network errors/timeouts/5xx (not for bad key).
    if (!/^(HTTP 4|false)/.test(e.message) && !/apikey/i.test(e.message)) raw = await fetchOnce(url, fetchImpl);
    else throw e;
  }
  return normalize(raw, type);
}

async function fetchVehicles({ apiKey, types = [1, 2], fetchImpl = fetch }) {
  if (!apiKey) throw new Error('Missing WARSAW_API_KEY');
  const settled = await Promise.allSettled(types.map((t) => fetchType(t, apiKey, fetchImpl)));
  const vehicles = [], errors = [];
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') vehicles.push(...s.value);
    else errors.push(`${TYPES[types[i]]}: ${s.reason.message}`);
  });
  if (errors.length === types.length) throw new Error(errors.join('; '));
  return { vehicles, errors };
}

module.exports = { fetchVehicles, normalize, TYPES };
