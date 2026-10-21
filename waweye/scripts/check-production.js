'use strict';
// Production health check: do all live data sources answer, and do vehicles join with the fleet dataset?
// Run: node scripts/check-production.js [base URL, default https://waweye.vercel.app]
// Prints a Markdown report (Polish, it becomes the body of the alert issue); exit code 1 when something is wrong.
// Each problem is either the data supplier's (the Warsaw API timed out or answered 5xx, e.g. 522 through the Worker) or
// the application's (anything else). Supplier outages usually pass within minutes (5 of 5 alerts in Oct 2026), so a
// supplier-only failure is checked once more after SUPPLIER_RECHECK_MS before it counts.
// WAWEYE_KATEGORIE=<file> appends the final category (ok | dostawca | aplikacja) as one line, for the monitoring workflow.
// Redirect mode: node scripts/check-production.js --przekierowanie <old address> <new address> checks that the old
// address only answers 308 to the same path and query on the new one (wawEye migration, Faza 9: pasibus.vercel.app).

const fs = require('fs');

const DEFAULT_URL = 'https://waweye.vercel.app';
const TIMEOUT_MS = 60000; // the fleet dataset took ~21 s on a cold cache (2026-10-02)
const MIN_FLEET_MATCH = 0.9; // 2026-10-02: 99.5% of live buses and 99.6% of live trams were in the fleet dataset
const MIN_SAMPLE = 20;
const SUPPLIER_RECHECK_MS = 240000; // 2026-10: supplier 522s lasted from ~30 s to a few minutes
// Upstream failure as our API relays it: the Warsaw API (or the Worker's connection to it) timed out or answered 5xx.
const SUPPLIER = /\bHTTP 5\d\d\b|timeout|timed out|aborted|UND_ERR|ECONN|ENOTFOUND|EAI_AGAIN|fetch failed|upstream:/i;
// ...unless it names our own setup (a missing key or Worker address, a refused secret or token), even inside a 5xx.
const OURS = /missing|brak UPSTREAM|forbidden|unauthor|token|klucz|apikey/i;
const supplierText = (t) => SUPPLIER.test(t) && !OURS.test(t);
const ROUTES_MAX_AGE_MS = 48 * 3600e3; // the route store is refreshed daily (vercel.json cron); two missed days is a problem // too few vehicles of a type (e.g. trams at night) say nothing about the join

async function get(base, path, fetchImpl = fetch) {
  const t0 = Date.now();
  try {
    const res = await fetchImpl(base.replace(/\/$/, '') + path, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    let body = null;
    try { body = await res.json(); } catch {}
    return { status: res.status, body, ms: Date.now() - t0 };
  } catch (e) {
    return { status: 0, body: null, error: e.message, ms: Date.now() - t0 };
  }
}

// Share of live vehicles of each type that have a record in the fleet dataset (same keys as public/app.js).
function fleetMatch(vehicles, fleet) {
  const out = {};
  for (const type of ['bus', 'tram']) {
    const live = vehicles.filter((v) => v.type === type);
    const found = live.filter((v) => [v.vehicle, v.vehicle.replace(/^0+/, '')].some((n) => fleet.vehicles[`${type}:${n}`]));
    out[type] = { live: live.length, found: found.length, share: live.length ? found.length / live.length : null };
  }
  return out;
}

const pct = (x) => (x * 100).toFixed(1).replace('.', ',') + '%';
// Our API answered (5xx) and says the upstream failed; no answer at all (status 0) is ours, not the supplier's.
const supplierFail = (r) => r.status >= 500 && !!r.body && typeof r.body.error === 'string' && supplierText(r.body.error);
const httpFail = (r) => (r.status === 200 && r.body ? null : r.error ? `brak odpowiedzi (${r.error})` : `HTTP ${r.status}${r.body && r.body.error ? ` (${r.body.error})` : ''}`);

// Pure part, unit-tested: takes the responses, returns one row per check (routes: /api/trasa?meta=1, optional).
function evaluate({ vehicles, parking, incidents, fleet, routes }, now = Date.now()) {
  const rows = [];
  const add = (name, problem, detail, supplier) => rows.push({ name, ok: !problem, detail: problem || detail,
    kind: problem ? (supplier ? 'dostawca' : 'aplikacja') : null });

  let live = null;
  {
    const b = vehicles.body;
    let problem = httpFail(vehicles), supplier = !!problem && supplierFail(vehicles);
    if (!problem && !Array.isArray(b.vehicles)) problem = 'odpowiedź bez listy pojazdów';
    else if (!problem && b.source !== 'live') problem = `źródło "${b.source}" zamiast "live"`;
    else if (!problem && !b.vehicles.length) problem = `0 pojazdów (API zwróciło ${b.received ?? '?'} rekordów)`;
    else if (!problem && b.errors && b.errors.length) {
      problem = `część danych niedostępna: ${b.errors.join('; ')}`;
      supplier = b.errors.every(supplierText);
    }
    if (!problem) live = b.vehicles;
    add('Pojazdy (/api/vehicles)', problem, live && `${live.length} pojazdów, ${vehicles.ms} ms`, supplier);
  }
  {
    const b = parking.body;
    let problem = httpFail(parking);
    const supplier = !!problem && supplierFail(parking);
    if (!problem && !Array.isArray(b.parkings)) problem = 'odpowiedź bez listy parkingów';
    else if (!problem && !b.parkings.length) problem = '0 parkingów';
    add('Parkingi (/api/parking)', problem, !problem && `${b.parkings.length} parkingów, ${parking.ms} ms`, supplier);
  }
  {
    const b = incidents.body;
    let problem = httpFail(incidents);
    const supplier = !!problem && supplierFail(incidents);
    if (!problem && !Array.isArray(b.incidents)) problem = 'odpowiedź bez listy utrudnień';
    add('Utrudnienia (/api/incidents)', problem, !problem && `${b.incidents.length} utrudnień, ${incidents.ms} ms`, supplier);
  }
  {
    const b = fleet.body;
    let problem = httpFail(fleet), detail = '';
    const supplier = !!problem && supplierFail(fleet);
    if (!problem && (!b.vehicles || typeof b.vehicles !== 'object' || !Object.keys(b.vehicles).length)) problem = 'pusty zbiór pojazdów';
    if (!problem) {
      detail = `${Object.keys(b.vehicles).length} pojazdów w zbiorze, ${fleet.ms} ms`;
      if (live) {
        const m = fleetMatch(live, b);
        const parts = [], low = [];
        for (const [type, name] of [['bus', 'autobusy'], ['tram', 'tramwaje']]) {
          const x = m[type];
          if (x.live < MIN_SAMPLE) { parts.push(`${name}: za mało pojazdów na żywo (${x.live})`); continue; }
          parts.push(`${name}: ${x.found}/${x.live} (${pct(x.share)})`);
          if (x.share < MIN_FLEET_MATCH) low.push(`${name} ${pct(x.share)}`);
        }
        if (low.length) problem = `za mało pojazdów na żywo w zbiorze taboru (${low.join(', ')}; próg ${pct(MIN_FLEET_MATCH)}) – sprawdź numery taborowe`;
        detail += '; dopasowanie: ' + parts.join(', ');
      }
    }
    add('Tabor (/api/fleet)', problem, detail, supplier);
  }
  if (routes) {
    const b = routes.body;
    let problem = httpFail(routes);
    const supplier = !!problem && supplierFail(routes);
    const age = !problem && b.refreshed ? now - Date.parse(b.refreshed) : null;
    const today = new Date(now).toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' });
    if (!problem && age === null) problem = 'brak daty odświeżenia';
    else if (!problem && age > ROUTES_MAX_AGE_MS) problem = `trasy nieodświeżane od ${Math.round(age / 3600e3)} h (${b.refreshed}) – sprawdź cron /api/odswiez-trasy w Vercel`;
    else if (!problem && b.valid && b.valid.to < today) problem = `rozkład w magazynie ważny tylko do ${b.valid.to}`;
    add('Trasy linii (/api/trasa?meta=1)', problem, !problem && `${b.lines} linii, rozkład ${b.valid.from} – ${b.valid.to}, odświeżone ${Math.round(age / 3600e3)} h temu${b.days ? `, kursy na godziny: ${b.days.includes(today) ? b.days.length + ' dni' : 'brak na dziś (timelapse bez rozkładu)'}` : ''}`, supplier);
  }
  const kind = rows.some((r) => r.kind === 'aplikacja') ? 'aplikacja' : rows.some((r) => r.kind === 'dostawca') ? 'dostawca' : null;
  return { ok: rows.every((r) => r.ok), rows, kind };
}

const KIND_TEXT = {
  dostawca: 'Kategoria: **dostawca danych** – API Warszawy (lub połączenie Workera z nim) nie odpowiedziało; kod aplikacji działa.',
  aplikacja: 'Kategoria: **aplikacja** – błąd po stronie wawEye (wdrożenie, konfiguracja, format danych, odświeżanie tras).',
};
const KIND_CELL = { dostawca: 'BŁĄD (dostawca)', aplikacja: 'BŁĄD (aplikacja)' };

function report(base, result, when = new Date(), note = '') {
  const cell = (s) => String(s || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return [
    `### Kontrola produkcji: ${result.ok ? 'wszystko działa' : 'PROBLEM'}`,
    '',
    `${base} · ${when.toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' })}`,
    '',
    '| Sprawdzenie | Wynik | Szczegóły |',
    '|---|---|---|',
    ...result.rows.map((r) => `| ${r.name} | ${r.ok ? 'OK' : KIND_CELL[r.kind] || 'BŁĄD'} | ${cell(r.detail)} |`),
    '',
    ...(result.kind ? [KIND_TEXT[result.kind], ''] : []),
    ...(note ? [note, ''] : []),
  ].join('\n');
}

// The checks with their retries; fetchImpl and wait are injectable for the tests.
async function monitor(base, { fetchImpl = fetch, wait = (ms) => new Promise((r) => setTimeout(r, ms)), recheckMs = SUPPLIER_RECHECK_MS } = {}) {
  const check = async () => {
    const [vehicles, parking, incidents, fleet, routes] = await Promise.all(['/api/vehicles', '/api/parking', '/api/incidents', '/api/fleet', '/api/trasa?meta=1'].map((p) => get(base, p, fetchImpl)));
    return evaluate({ vehicles, parking, incidents, fleet, routes });
  };
  let result = await check(), note = '';
  // One retry after 30 s, so a single dropped connection does not raise an alert.
  if (!result.ok) { await wait(30000); result = await check(); }
  // A supplier-only failure gets one more, later look: these outages usually pass within minutes.
  if (!result.ok && result.kind === 'dostawca' && recheckMs > 0) {
    const first = result;
    await wait(recheckMs);
    result = await check();
    const after = recheckMs >= 60000 ? `${Math.round(recheckMs / 60000)} min` : `${Math.round(recheckMs / 1000)} s`;
    note = result.ok
      ? `Chwilowy błąd dostawcy danych (${first.rows.filter((r) => !r.ok).map((r) => r.name.replace(/ \(.*/, '')).join(', ')}) minął w ciągu ${after}.`
      : `Błąd utrzymał się po ponownej kontroli ${after} później.`;
  }
  return { result, note };
}

// A page and an API call with a query string: both must keep their path and query on the new address.
const REDIRECT_PATHS = ['/', '/api/vehicles?przekierowanie=1'];

// Same result shape as evaluate(), so report() prints it. A wrong or missing redirect is our setup: kind 'aplikacja'.
async function checkRedirect(from, to, fetchImpl = fetch) {
  const rows = await Promise.all(REDIRECT_PATHS.map(async (path) => {
    const want = new URL(path, to).href;
    const t0 = Date.now();
    let problem = null;
    try {
      const res = await fetchImpl(new URL(path, from).href, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
      const loc = res.headers.get('location');
      const got = loc ? new URL(loc, from).href : null;
      if (res.status !== 308) problem = `HTTP ${res.status} zamiast 308${got ? ` (na ${got})` : ''}`;
      else if (got !== want) problem = `przekierowuje na ${got || '(brak nagłówka Location)'} zamiast na ${want}`;
    } catch (e) {
      problem = `brak odpowiedzi (${e.message})`;
    }
    return { name: `Przekierowanie (${path})`, ok: !problem, detail: problem || `308 na ${want}, ${Date.now() - t0} ms`, kind: problem ? 'aplikacja' : null };
  }));
  const ok = rows.every((r) => r.ok);
  return { ok, rows, kind: ok ? null : 'aplikacja' };
}

// One retry after 30 s, as in monitor(), so a single dropped connection does not raise an alert.
async function monitorRedirect(from, to, { fetchImpl = fetch, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let result = await checkRedirect(from, to, fetchImpl);
  if (!result.ok) { await wait(30000); result = await checkRedirect(from, to, fetchImpl); }
  return result;
}

async function main() {
  let base, result, note = '';
  if (process.argv[2] === '--przekierowanie') {
    const [from, to] = process.argv.slice(3);
    if (!from || !to) {
      console.error('Użycie: node scripts/check-production.js --przekierowanie <stary adres> <nowy adres>');
      process.exitCode = 2;
      return;
    }
    base = from;
    result = await monitorRedirect(from, to);
  } else {
    base = process.argv[2] || process.env.WAWEYE_URL || DEFAULT_URL;
    ({ result, note } = await monitor(base, { recheckMs: Number(process.env.SUPPLIER_RECHECK_MS ?? SUPPLIER_RECHECK_MS) }));
  }
  process.stdout.write(report(base, result, new Date(), note));
  if (process.env.WAWEYE_KATEGORIE) fs.appendFileSync(process.env.WAWEYE_KATEGORIE, (result.ok ? 'ok' : result.kind) + '\n');
  process.exitCode = result.ok ? 0 : 1;
}

if (require.main === module) main();
module.exports = { evaluate, fleetMatch, report, get, monitor, checkRedirect, monitorRedirect };
