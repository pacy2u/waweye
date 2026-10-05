'use strict';
// TEMPORARY reconnaissance of metro data sources (run in GitHub Actions: .github/workflows/waweye-rozpoznanie-metra.yml).
// Prints a Markdown report in Polish; removed once the source for the metro layer is chosen.
// 1. dane.um.warszawa.pl (CKAN): datasets about the metro.  2. ZTM timetable files (RAyymmdd.7z): M1/M2 and stations.
// 3. City WMS services: metro layers.  4. OpenStreetMap (Overpass): route=subway relations and stations.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { wmsLayers } = require('./strefy');

const UA = 'wawEye/1.0 (+https://github.com/pacy2u/waweye)';
const TIMEOUT_MS = 90000;
const OUT = process.env.RAPORT_DIR || path.join(__dirname, '..', '..', 'rozpoznanie-metra');
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const BBOX = '52.09,20.85,52.37,21.28';
const log = (s = '') => console.log(s);
const why = (e) => `${e.message}${e.cause ? ` (${e.cause.code || e.cause.message})` : ''}`;

async function get(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { 'User-Agent': UA, ...(opts.headers || {}) }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) {
    const body = await res.text(), msg = [...body.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => m[1].replace(/<[^>]+>/g, '')).join(' | ');
    throw new Error(`HTTP ${res.status}: ${(msg || body).slice(0, 600).replace(/\s+/g, ' ')}`);
  }
  return res;
}

async function ckan() {
  log('## 1. dane.um.warszawa.pl (CKAN)\n');
  const queries = ['metro', 'stacje metra', 'linie metra', 'wejścia do metra', 'stacje', 'wejścia'];
  for (const base of ['https://dane.um.warszawa.pl/api/3/action', 'https://dane.um.warszawa.pl/api/action']) {
    let any = false;
    for (const q of queries) {
      try {
        const data = await (await get(`${base}/package_search?rows=50&q=${encodeURIComponent(q)}`)).json();
        any = true;
        const r = data.result || {};
        log(`### \`${base}/package_search?q=${q}\` – wyników: ${r.count}\n`);
        for (const p of r.results || []) {
          const formats = [...new Set((p.resources || []).map((x) => x.format).filter(Boolean))].join(', ');
          log(`- **${p.title}** (\`${p.name}\`), formaty: ${formats || '—'}, licencja: ${p.license_title || p.license_id || '—'}, zmiana metadanych: ${p.metadata_modified || '—'}, organizacja: ${(p.organization || {}).title || '—'}`);
          if (/metr/i.test(p.title + ' ' + (p.notes || ''))) {
            for (const x of p.resources || []) log(`  - zasób: ${x.name || '(bez nazwy)'} [${x.format || '?'}] ${x.url} (zmiana: ${x.last_modified || x.created || '?'})`);
          }
        }
        log();
      } catch (e) { log(`- \`${base}\` q=${q}: brak odpowiedzi: ${why(e)}`); if (!any) break; }
    }
    if (any) break;
  }
  log();
}

async function ztm() {
  log('## 2. Dane rozkładowe ZTM (RAyymmdd.7z)\n');
  const pages = ['https://www.ztm.waw.pl/pliki-do-pobrania/dane-rozkladowe/', 'https://www.ztm.waw.pl/pliki-do-pobrania/'];
  let link = null;
  for (const p of pages) {
    try {
      const html = await (await get(p)).text();
      const all = [...new Set([...html.matchAll(/(?:href|src|data-[\w-]+)=["']([^"']+)["']/gi)].map((m) => m[1]))];
      log(`- ${p}: linki zawierające 7z/zip/rozk/RA/gtfs/ftp (${all.length} wszystkich):\n\n\`\`\`\n${all.filter((u) => /7z|zip|rozk|\bRA|gtfs|ftp|dane/i.test(u)).slice(0, 60).join('\n')}\n\`\`\`\n`);
      log(`  fragmenty tekstu z „7z” lub „RA2”: ${[...html.matchAll(/.{0,120}(?:\.7z|RA2\d{5}).{0,120}/g)].slice(0, 10).map((m) => '`' + m[0].replace(/`/g, '') + '`').join('; ') || 'brak'}\n`);
      const links = [...new Set([...html.matchAll(/(?:href|data-[\w-]+)=["']([^"']*RA\d{6}\.7z)["']/gi)].map((m) => new URL(m[1], p).href))].sort();
      log(`- ${p}: HTTP 200, linków RA*.7z: ${links.length}${links.length ? ` (ostatni: ${links[links.length - 1]})` : ''}`);
      if (links.length) { link = links[links.length - 1]; break; }
    } catch (e) { log(`- ${p}: ${why(e)}`); }
  }
  if (!link) {
    try {
      const list = execFileSync('curl', ['-sS', '-m', '60', '--list-only', 'ftp://rozklady.ztm.waw.pl/'], { encoding: 'utf8' });
      const ra = list.split(/\r?\n/).filter((f) => /^RA\d{6}\.7z$/i.test(f.trim())).sort();
      log(`- ftp://rozklady.ztm.waw.pl/: plików ${list.split(/\n/).filter(Boolean).length}, RA*.7z: ${ra.length}${ra.length ? ` (ostatni: ${ra[ra.length - 1]})` : ''}`);
      if (ra.length) link = `ftp://rozklady.ztm.waw.pl/${ra[ra.length - 1].trim()}`;
    } catch (e) { log(`- ftp://rozklady.ztm.waw.pl/: ${why(e)}`); }
  }
  if (!link) { log('\nNie znaleziono pliku RA*.7z.\n'); return; }
  try {
    const buf = link.startsWith('ftp:') ? execFileSync('curl', ['-sS', '-m', '300', link], { maxBuffer: 1 << 30 })
      : Buffer.from(await (await get(link)).arrayBuffer());
    const dir = path.join(OUT, 'ztm');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, path.basename(link));
    fs.writeFileSync(file, buf);
    execFileSync('7z', ['x', '-y', `-o${dir}`, file], { stdio: 'ignore' });
    const txt = fs.readdirSync(dir).find((f) => /\.txt$/i.test(f));
    const text = new TextDecoder('windows-1250').decode(fs.readFileSync(path.join(dir, txt)));
    const lines = text.split(/\r?\n/);
    log(`\nPobrano ${path.basename(link)} (${Math.round(buf.length / 1024)} KB), rozpakowano ${txt} (${lines.length} wierszy).\n`);
    const sections = lines.filter((l) => /^\s*\*[A-Z]{2}\b/.test(l)).slice(0, 30);
    log('Sekcje pliku:\n```\n' + sections.join('\n') + '\n```\n');
    const hits = lines.map((l, i) => [l, i]).filter(([l]) => /\bM[12]\b|metro/i.test(l));
    log(`Wierszy z „M1”, „M2” lub „metro”: ${hits.length}. Pierwsze 60 z kontekstem:\n\n\`\`\``);
    let shown = 0, lastEnd = -1;
    for (const [, i] of hits) {
      if (shown >= 60) break;
      if (i <= lastEnd) continue;
      log(lines.slice(Math.max(0, i - 1), i + 3).join('\n'));
      log('---');
      lastEnd = i + 2; shown++;
    }
    log('```\n');
    for (const name of ['Kabaty', 'Młociny', 'Świętokrzyska', 'Bródno', 'Bemowo', 'Centrum']) {
      const m = lines.filter((l) => l.includes(name) && /metro|Y=|X=/i.test(l)).slice(0, 6);
      log(`Wiersze ze stacją „${name}” (z „metro” lub współrzędnymi):\n\`\`\`\n${m.join('\n') || '(brak)'}\n\`\`\`\n`);
    }
  } catch (e) { log(`\nBłąd pobierania lub rozpakowania: ${why(e)}\n`); }
}

async function wms() {
  log('## 3. Usługi WMS miasta\n');
  const re = /metr|\bM[12]\b|kolej|szyn|stacj/i;
  for (const base of ['https://wms.um.warszawa.pl/serwis', 'https://wms2.um.warszawa.pl/geoserver/wms/wms']) {
    try {
      const xml = await (await get(`${base}?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0`)).text();
      const layers = wmsLayers(xml), hits = layers.filter((l) => re.test(l.name + ' ' + l.title));
      log(`### ${base}\n\nWarstw: ${layers.length}, pasujących do metra/kolei: ${hits.length}.\n`);
      for (const l of hits) log(`- \`${l.name}\` – ${l.title} (${l.crs.slice(0, 6).join(', ')})`);
      log();
    } catch (e) { log(`### ${base}\n\nBrak odpowiedzi: ${why(e)}\n`); }
  }
}

async function overpass(query) {
  const errors = [];
  for (const url of OVERPASS) {
    try {
      const data = await (await get(url, { method: 'POST', body: new URLSearchParams({ data: query }) })).json();
      return { data, via: url };
    } catch (e) { errors.push(`${url}: ${why(e)}`); }
  }
  throw new Error(errors.join('; '));
}

async function osm() {
  log('## 4. OpenStreetMap (Overpass)\n');
  try {
    const { data, via } = await overpass(`[out:json][timeout:120];
relation["route"="subway"](${BBOX})->.r;(.r;relation["route_master"="subway"](${BBOX}););out body;
node(r.r);out tags;
(node["station"="subway"](${BBOX});nwr["railway"="station"]["subway"="yes"](${BBOX}););out center tags;`);
    log(`Źródło: ${via}, stan danych OSM: ${(data.osm3s || {}).timestamp_osm_base}.\n`);
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'osm-metro.json'), JSON.stringify(data, null, 1));
    const els = data.elements, byId = new Map(els.map((e) => [`${e.type}/${e.id}`, e]));
    const stations = els.filter((e) => e.type !== 'relation' && e.tags && (e.tags.station === 'subway' || (e.tags.railway === 'station' && e.tags.subway === 'yes')));
    const uniq = new Map();
    for (const s of stations) { const k = (s.tags || {}).name || `${s.type}/${s.id}`; if (!uniq.has(k)) uniq.set(k, s); }
    log(`### Stacje (station=subway lub railway=station+subway=yes): elementów ${stations.length}, różnych nazw ${uniq.size}\n`);
    log('| nazwa | element | line / ref | stan | współrzędne |\n|---|---|---|---|---|');
    for (const [name, s] of [...uniq].sort((a, b) => a[0].localeCompare(b[0], 'pl'))) {
      const t = s.tags || {}, c = s.center || s;
      log(`| ${name} | ${s.type}/${s.id} | ${t.line || t['subway:line'] || t.ref || ''} | ${t.railway || ''}${t.disused || t['disused:railway'] ? ' (disused)' : ''}${t.construction || t['construction:railway'] ? ' (budowa)' : ''}${t.opening_date ? ` otwarcie ${t.opening_date}` : ''} | ${c.lat?.toFixed(5)}, ${c.lon?.toFixed(5)} |`);
    }
    log('\n### Relacje\n');
    for (const r of els.filter((e) => e.type === 'relation')) {
      const t = r.tags || {};
      const stops = r.members.filter((m) => /^(stop|stop_entry_only|stop_exit_only)$/.test(m.role));
      const names = stops.map((m) => ((byId.get(`${m.type}/${m.ref}`) || {}).tags || {}).name || `${m.type}/${m.ref}`);
      log(`- **relation/${r.id}** ${t.type}=${t.route || t.route_master}, ref=${t.ref}, name=${t.name}, colour=${t.colour}, from=${t.from || ''}, to=${t.to || ''}, członków: ${r.members.length} (dróg: ${r.members.filter((m) => m.type === 'way').length}), przystanków (role stop*): ${stops.length}`);
      if (stops.length) log(`  - przystanki: ${names.join(' → ')}`);
    }
    log();
  } catch (e) { log(`Brak odpowiedzi: ${why(e)}\n`); }
}

(async () => {
  log(`# Rozpoznanie źródeł danych metra (${new Date().toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' })} czasu warszawskiego)\n`);
  for (const step of [ckan, ztm, wms, osm]) { try { await step(); } catch (e) { log(`**Błąd:** ${why(e)}\n`); } }
})();
