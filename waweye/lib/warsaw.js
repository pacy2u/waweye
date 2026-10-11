'use strict';
// Warsaw Open Data: "Lokalizacja pojazdów komunikacji miejskiej"
// New open-data portal API (dane.um.warszawa.pl): POST JSON {"type": 1|2}, token in the Authorization header.
const ENDPOINT = 'https://dane.um.warszawa.pl/api/action/get_ztm_lokalizacja_pojazdow';
const INCIDENTS_ENDPOINT = 'https://dane.um.warszawa.pl/api/action/get_bin_utrudnienia_drogowe';
const FLEET_ENDPOINT = 'https://dane.um.warszawa.pl/api/action/get_ztm_pojazdy';
const PARKING_ENDPOINT = 'https://dane.um.warszawa.pl/api/action/get_m_parkingi_wolne_miejsca';
const SPORT_ENDPOINT = 'https://dane.um.warszawa.pl/api/action/get_bmm_zajecia_sportowe';
const EVENTS_ENDPOINT = 'https://dane.um.warszawa.pl/api/action/get_bmm_kalendarz_wydarzen';
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
  // Docs say "Parkings", the live API answers {"Status", "Timestamp", "carParks": [...]}: take the first list we find.
  for (const c of [b.carParks, b.Parkings, b.parkings, b.result && b.result.carParks, b.result && b.result.Parkings, b.result]) if (Array.isArray(c)) return c;
  const any = Object.values(b).find((v) => Array.isArray(v));
  return any || null;
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
    // The Worker names its Cloudflare location; the Warsaw API refuses some of them with 522.
    const colo = res.headers && typeof res.headers.get === 'function' && res.headers.get('x-colo');
    throw new Error(`HTTP ${res.status}${why ? ` (${why})` : ''}${colo ? ` [Cloudflare ${colo}]` : ''}`);
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
  return { items: normalize(raw, type), received: raw.length };
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


// ---- Road incidents (dataset "Utrudnienia w ruchu drogowym") ----
// Reply is a bare list (per the docs); tolerate it being wrapped in an object too.
const extractIncidents = (b) => {
  if (Array.isArray(b)) return b;
  if (!b || typeof b !== 'object') return null;
  for (const c of [b.result, b.Incidents, b.incidents]) if (Array.isArray(c)) return c;
  return Object.values(b).find((v) => Array.isArray(v)) || null;
};

function normalizeIncidents(raw, now = Date.now()) {
  const out = [];
  for (const r of raw) {
    // geo is a list of lists of {geomType: 0 point | 1 line, latlngs: [{lat, lng}]}
    const shapes = [];
    for (const g of [].concat(r.geo || []).flat(2)) {
      const pts = (Array.isArray(g && g.latlngs) ? g.latlngs : [])
        .map((p) => [Number(p.lat), Number(p.lng)])
        .filter(([la, lo]) => Number.isFinite(la) && Number.isFinite(lo) && la >= BBOX.minLat && la <= BBOX.maxLat && lo >= BBOX.minLon && lo <= BBOX.maxLon);
      if (!pts.length) continue;
      shapes.push(Number(g.geomType) === 1 && pts.length > 1 ? { type: 'line', points: pts } : { type: 'point', points: [pts[0]] });
    }
    if (!shapes.length) continue;
    const start = parseWarsawTime(r.start_date), end = parseWarsawTime(r.end_date);
    const status = end !== null && end < now ? 'ended' : start !== null && start > now ? 'planned' : 'active';
    out.push({
      id: Number(r.id) || String(r.id),
      name: String(r.name || 'Utrudnienie').trim(),
      start, end, status,
      content: (Array.isArray(r.content) ? r.content : [r.content]).filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()),
      shapes,
    });
  }
  return out;
}

async function fetchIncidents({ apiKey, fetchImpl = fetch, upstream }) {
  if (!apiKey && !upstream) throw new Error('Missing WARSAW_API_KEY');
  const raw = await requestList({ endpoint: INCIDENTS_ENDPOINT, relayQuery: 'resource=incidents', extract: extractIncidents, apiKey, fetchImpl, upstream });
  return normalizeIncidents(raw);
}

// ---- Fleet details (dataset "Pojazdy transportu publicznego") ----
// Reply: {busy, tramwaje, metro, kolej, markiBus, markiTramwaje, ...}. Vehicles reference a brand by idMarki.
// We keep buses and trams only and key everything by "<bus|tram>:<fleet number>" / "<bus|tram>:<brand id>".
const extractFleet = (b) => {
  const o = b && !Array.isArray(b) && typeof b === 'object' && b.result && typeof b.result === 'object' && !Array.isArray(b.result) ? b.result : b;
  return o && typeof o === 'object' && (Array.isArray(o.busy) || Array.isArray(o.tramwaje)) ? o : null;
};
const str = (v) => (v == null ? '' : String(v).trim());
const optNum = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

function normalizeFleet(raw) {
  const vehicles = {}, brands = {};
  for (const [type, vKey, bKey] of [['bus', 'busy', 'markiBus'], ['tram', 'tramwaje', 'markiTramwaje']]) {
    for (const r of Array.isArray(raw[vKey]) ? raw[vKey] : []) {
      const number = str(r.numerTaborowy);
      if (!number) continue;
      vehicles[`${type}:${number}`] = {
        operator: str(r.nazwaOperatora), operatorShort: str(r.nazwaSkroconaOperatora), depot: str(r.nazwaZajezdni),
        year: optNum(r.rokProdukcji), plate: str(r.numerRejestracyjny), brand: optNum(r.idMarki),
        paint: str(r.schematMalowania), color: str(r.kolorPojazdu), upholstery: str(r.kolorTapicerki),
      };
    }
    for (const r of Array.isArray(raw[bKey]) ? raw[bKey] : []) {
      if (r.idMarki == null) continue;
      brands[`${type}:${r.idMarki}`] = {
        make: str(r.marka), model: [r.typ, r.wersja, r.wariant].map(str).filter(Boolean).join(' '), producer: str(r.producent),
        length: optNum(r.dlugosc), width: optNum(r.szerokosc), sizeClass: str(r.katWielkosci),
        seats: optNum(r.liczMiejscSiedzacychTab), standing: optNum(r.liczMiejscStojacychTab), capacity: optNum(r.liczMiejscTab),
        wheelchair: optNum(r.liczMiejscWozekInwalid), stroller: optNum(r.liczMiejscWozekDziec),
        floor: str(r.podloga), ac: typeof r.klimatyzacja === 'boolean' ? r.klimatyzacja : null,
        power: [r.rodzajZasilania, r.zasilanie].map(str).filter(Boolean).join(' / '), payment: str(r.platnosc),
      };
    }
  }
  return { vehicles, brands };
}

async function fetchFleet({ apiKey, fetchImpl = fetch, upstream }) {
  if (!apiKey && !upstream) throw new Error('Missing WARSAW_API_KEY');
  const raw = await requestList({ endpoint: FLEET_ENDPOINT, relayQuery: 'resource=fleet', extract: extractFleet, apiKey, fetchImpl, upstream });
  return normalizeFleet(raw);
}

// ---- Sport classes (dataset "Zajęcia sportowe", calendar of sport.um.warszawa.pl, updated every 2 h) ----
// Reply: a bare list. Only "map" (a GeoJSON FeatureCollection, missing from the docs) has coordinates; about a quarter
// of the records have just an address, which lib/geocoding.js turns into coordinates. Records without "date" are
// weekly classes on the weekdays in "day"; records with "date" happen on those days only.
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const WARSAW_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' });
const warsawDate = (ms = Date.now()) => WARSAW_DAY.format(new Date(ms)); // "2026-10-05"
const ENTITIES = { nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', oacute: 'ó', Oacute: 'Ó', ndash: '–', mdash: '—', bdquo: '„', rdquo: '”', hellip: '…' };

// The city's descriptions are HTML; the app shows them as plain text only.
function plainText(html) {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] !== '#') return ENTITIES[e] ?? m;
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ' '; // a broken entity must not break the whole list
    })
    .replace(/\s+/g, ' ').trim();
}
const names = (list) => (Array.isArray(list) ? list : []).map((x) => str(x && x.name)).filter((x) => x && x !== 'undefined');
const first = (v) => str([].concat(v ?? [])[0]); // phone/email come as a list or a string
const httpUrl = (u) => (/^https?:\/\/[^\s"'<>]+$/i.test(str(u)) ? str(u) : '');
const inBox = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && lat >= BBOX.minLat && lat <= BBOX.maxLat && lon >= BBOX.minLon && lon <= BBOX.maxLon;

// "ul. Michała Kajki 80/82" -> "Michała Kajki 80", "Węglarska 41 a" -> "Węglarska 41a": forms Nominatim finds.
function streetQuery(street) {
  let s = str(street).replace(/^(ul\.?|ulica)\s+/i, '').replace(/(\d+)\s*\/\s*\d+\w?/, '$1').replace(/(\d+)\s+([a-z])\b/i, '$1$2');
  return s ? `${s}, Warszawa` : '';
}

function normalizeSport(raw, today = warsawDate()) {
  const out = [];
  raw.forEach((r, i) => {
    if (!r || typeof r !== 'object') return;
    const allDates = (Array.isArray(r.date) ? r.date : []).map(str).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
    const dates = allDates.filter((d) => d >= today).sort();
    const days = (Array.isArray(r.day) ? r.day : []).map((d) => str(d && d.id).toLowerCase()).filter((d) => WEEKDAYS.includes(d));
    if (allDates.length ? !dates.length : !days.length) return; // finished, or no way to tell when it happens
    const addr = (Array.isArray(r.address) ? r.address : []).find((a) => a && typeof a === 'object') || {};
    const feature = ((r.map && Array.isArray(r.map.features)) ? r.map.features : [])
      .find((f) => f && f.geometry && f.geometry.type === 'Point' && Array.isArray(f.geometry.coordinates) && inBox(Number(f.geometry.coordinates[1]), Number(f.geometry.coordinates[0])));
    const props = (feature && feature.properties) || {};
    const mapStreet = [str(props.shortStreetName), str(props.streetNumber)].filter(Boolean).join(' ');
    const item = {
      id: `s-${i}-${str(r.url).split('/').pop() || i}`.slice(0, 120),
      title: str(r.title) || 'Zajęcia sportowe',
      url: httpUrl(r.url),
      categories: names(r.category), audience: names(r.dedicated),
      district: names(r.localization)[0] || str(props.district),
      // The point's own description ("Zbiórka przy …") says best where to go; the address may be the organiser's.
      place: str(props.details) || str(addr.name) || mapStreet,
      address: [str(addr.street) || mapStreet, str(addr.postCodeAndOffice).replace(/\s*,\s*/, ' ').replace(/^Warszawa$/, '')].filter(Boolean).join(', '),
      phone: first(addr.phone), email: first(addr.email),
      dates, days, time: /^\d{1,2}:\d{2}$/.test(str(r.time)) ? str(r.time) : '',
      text: plainText(r.text).slice(0, 400),
      lat: null, lon: null, located: '',
    };
    if (feature) { item.lat = Number(feature.geometry.coordinates[1]); item.lon = Number(feature.geometry.coordinates[0]); item.located = 'map'; }
    else item.queries = [...new Set([streetQuery(addr.street), str(addr.name) && `${str(addr.name)}, Warszawa`].filter(Boolean))];
    out.push(item);
  });
  return out;
}

async function fetchSport({ apiKey, fetchImpl = fetch, upstream }) {
  if (!apiKey && !upstream) throw new Error('Missing WARSAW_API_KEY');
  return requestList({ endpoint: SPORT_ENDPOINT, relayQuery: 'resource=sport', extract: extractIncidents, apiKey, fetchImpl, upstream });
}

// ---- City events ("Kalendarz wydarzeń", calendar of um.warszawa.pl, updated every 2 h), layer "DziejeSię" ----
// Like the sport classes, but: "occurrence" lists {from, to, daily} with times as "2027-01-29T19:00:00+01" (Warsaw
// local time with a short offset, which Date.parse rejects, so dates and times are read from the string); "map" may
// hold several points, often the same one repeated; "lead" is a short plain summary.
const OCC_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/;
function normalizeOccurrence(o) {
  const f = OCC_RE.exec(str(o && o.from)), t = OCC_RE.exec(str(o && o.to)) || f;
  if (!f) return null;
  const allDay = o.daily === true || (f[2] === '00:00' && t[2] === '23:59');
  const [from, to] = f[1] <= t[1] ? [f[1], t[1]] : [t[1], f[1]];
  return { from, to, start: allDay ? '' : f[2], end: allDay || t[2] === f[2] ? '' : t[2] };
}

// "Organizator: <a …>Teatr Syrena</a>" at the end of the description.
function organizer(html) {
  const m = /Organizator(?:zy|ów)?\s*:\s*([\s\S]*?)(?:<\/p>|<br\s*\/?>|$)/i.exec(String(html || ''));
  return m ? plainText(m[1]).replace(/[.;,\s]+$/, '').slice(0, 120) : '';
}

function normalizeEvents(raw, today = warsawDate()) {
  const out = [];
  raw.forEach((r, i) => {
    if (!r || typeof r !== 'object') return;
    const occurrences = (Array.isArray(r.occurrence) ? r.occurrence : Array.isArray(r.occurence) ? r.occurence : [])
      .map(normalizeOccurrence).filter((o) => o && o.to >= today)
      .sort((a, b) => (a.from + a.start).localeCompare(b.from + b.start)).slice(0, 40);
    if (!occurrences.length) return; // over, or no date at all
    const addr = (Array.isArray(r.address) ? r.address : [r.address]).find((a) => a && typeof a === 'object') || {};
    const seen = new Set(), points = [];
    for (const f of (r.map && Array.isArray(r.map.features)) ? r.map.features : []) {
      const c = f && f.geometry && f.geometry.type === 'Point' && Array.isArray(f.geometry.coordinates) ? f.geometry.coordinates : null;
      const lat = c && Number(c[1]), lon = c && Number(c[0]);
      if (!c || !inBox(lat, lon)) continue;
      const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
      if (seen.has(key)) continue; // the same point is often listed several times
      seen.add(key);
      const p = f.properties || {};
      points.push({ lat, lon, street: [str(p.shortStreetName), str(p.streetNumber)].filter(Boolean).join(' '), details: str(p.details), district: str(p.district) });
    }
    const one = points.length === 1;
    const item = {
      id: `e-${i}-${str(r.url).split('/').pop() || i}`.slice(0, 120),
      title: str(r.title) || 'Wydarzenie',
      url: httpUrl(r.url),
      categories: names(r.category),
      district: names(r.localization)[0] || (points[0] && points[0].district) || '',
      venue: str(addr.name),
      address: [str(addr.street), str(addr.postCodeAndOffice).replace(/\s*,\s*/, ' ').replace(/^Warszawa$/, '')].filter(Boolean).join(', '),
      organizer: organizer(r.text),
      text: (str(r.lead) ? plainText(r.lead) : plainText(String(r.text || '').replace(/<p>\s*Organizator[\s\S]*?<\/p>/gi, ' '))).slice(0, 400),
      occurrences,
      // One entry per place on the map; the venue name only fits when there is a single place.
      points: points.map((p) => ({ lat: p.lat, lon: p.lon, label: p.details || (one && str(addr.name)) || p.street || str(addr.name), street: p.street, district: p.district })),
      located: points.length ? 'map' : '',
    };
    if (!points.length) item.queries = [...new Set([streetQuery(addr.street), str(addr.name) && `${str(addr.name)}, Warszawa`].filter(Boolean))];
    out.push(item);
  });
  return out;
}

async function fetchEvents({ apiKey, fetchImpl = fetch, upstream }) {
  if (!apiKey && !upstream) throw new Error('Missing WARSAW_API_KEY');
  return requestList({ endpoint: EVENTS_ENDPOINT, relayQuery: 'resource=wydarzenia', extract: extractIncidents, apiKey, fetchImpl, upstream });
}

async function fetchVehicles({ apiKey, types = [1, 2], fetchImpl = fetch, upstream }) {
  if (!apiKey && !upstream) throw new Error('Missing WARSAW_API_KEY');
  const settled = await Promise.allSettled(types.map((t) => fetchType(t, apiKey, fetchImpl, upstream)));
  const vehicles = [], errors = [];
  let received = 0; // raw records from the API, before filtering stale/out-of-area ones
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') { vehicles.push(...s.value.items); received += s.value.received; }
    else errors.push(`${TYPES[types[i]]}: ${s.reason.message}`);
  });
  if (errors.length === types.length) throw new Error(errors.join('; '));
  return { vehicles, errors, received };
}

module.exports = { fetchVehicles, fetchParkings, fetchIncidents, fetchFleet, fetchSport, fetchEvents, normalize, normalizeFleet, normalizeParkings, normalizeIncidents, normalizeSport, normalizeEvents, organizer, plainText, streetQuery, warsawDate, TYPES };
