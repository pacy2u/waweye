'use strict';
// Production health check: do all live data sources answer, and do vehicles join with the fleet dataset?
// Run: node scripts/check-production.js [base URL, default https://waweye.vercel.app]
// Prints a Markdown report (Polish, it becomes the body of the alert issue); exit code 1 when something is wrong.

const DEFAULT_URL = 'https://waweye.vercel.app';
const TIMEOUT_MS = 60000; // the fleet dataset took ~21 s on a cold cache (2026-10-02)
const MIN_FLEET_MATCH = 0.9; // 2026-10-02: 99.5% of live buses and 99.6% of live trams were in the fleet dataset
const MIN_SAMPLE = 20; // too few vehicles of a type (e.g. trams at night) say nothing about the join

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
const httpFail = (r) => (r.status === 200 && r.body ? null : r.error ? `brak odpowiedzi (${r.error})` : `HTTP ${r.status}${r.body && r.body.error ? ` (${r.body.error})` : ''}`);

// Pure part, unit-tested: takes the four responses, returns one row per check.
function evaluate({ vehicles, parking, incidents, fleet }) {
  const rows = [];
  const add = (name, problem, detail) => rows.push({ name, ok: !problem, detail: problem || detail });

  let live = null;
  {
    const b = vehicles.body;
    let problem = httpFail(vehicles);
    if (!problem && !Array.isArray(b.vehicles)) problem = 'odpowiedź bez listy pojazdów';
    else if (!problem && b.source !== 'live') problem = `źródło "${b.source}" zamiast "live"`;
    else if (!problem && !b.vehicles.length) problem = `0 pojazdów (API zwróciło ${b.received ?? '?'} rekordów)`;
    else if (!problem && b.errors && b.errors.length) problem = `część danych niedostępna: ${b.errors.join('; ')}`;
    if (!problem) live = b.vehicles;
    add('Pojazdy (/api/vehicles)', problem, live && `${live.length} pojazdów, ${vehicles.ms} ms`);
  }
  {
    const b = parking.body;
    let problem = httpFail(parking);
    if (!problem && !Array.isArray(b.parkings)) problem = 'odpowiedź bez listy parkingów';
    else if (!problem && !b.parkings.length) problem = '0 parkingów';
    add('Parkingi (/api/parking)', problem, !problem && `${b.parkings.length} parkingów, ${parking.ms} ms`);
  }
  {
    const b = incidents.body;
    let problem = httpFail(incidents);
    if (!problem && !Array.isArray(b.incidents)) problem = 'odpowiedź bez listy utrudnień';
    add('Utrudnienia (/api/incidents)', problem, !problem && `${b.incidents.length} utrudnień, ${incidents.ms} ms`);
  }
  {
    const b = fleet.body;
    let problem = httpFail(fleet), detail = '';
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
    add('Tabor (/api/fleet)', problem, detail);
  }
  return { ok: rows.every((r) => r.ok), rows };
}

function report(base, result, when = new Date()) {
  const cell = (s) => String(s || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return [
    `### Kontrola produkcji: ${result.ok ? 'wszystko działa' : 'PROBLEM'}`,
    '',
    `${base} · ${when.toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' })}`,
    '',
    '| Sprawdzenie | Wynik | Szczegóły |',
    '|---|---|---|',
    ...result.rows.map((r) => `| ${r.name} | ${r.ok ? 'OK' : 'BŁĄD'} | ${cell(r.detail)} |`),
    '',
  ].join('\n');
}

async function main() {
  // PASIBUS_URL: old name, kept until the end of the wawEye migration (PLAN_MIGRACJI_WAWEYE.md, Faza 9).
  const base = process.argv[2] || process.env.WAWEYE_URL || process.env.PASIBUS_URL || DEFAULT_URL;
  const check = async () => {
    const [vehicles, parking, incidents, fleet] = await Promise.all(['/api/vehicles', '/api/parking', '/api/incidents', '/api/fleet'].map((p) => get(base, p)));
    return evaluate({ vehicles, parking, incidents, fleet });
  };
  let result = await check();
  // One retry after 30 s, so a single dropped connection does not raise an alert.
  if (!result.ok) { await new Promise((r) => setTimeout(r, 30000)); result = await check(); }
  process.stdout.write(report(base, result));
  process.exitCode = result.ok ? 0 : 1;
}

if (require.main === module) main();
module.exports = { evaluate, fleetMatch, report, get };
