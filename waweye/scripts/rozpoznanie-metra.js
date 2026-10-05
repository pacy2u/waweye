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


const BROWSER = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'pl-PL,pl;q=0.9' };

async function csvRows(file, onRow) {
  const rl = require('readline').createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
  let head = null;
  const split = (l) => { const out = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; };
  for await (const line of rl) {
    if (!head) { head = split(line.replace(/^﻿/, '')); continue; }
    if (!line) continue;
    const v = split(line), o = {};
    head.forEach((h, i) => { o[h] = v[i]; });
    if (onRow(o) === false) break;
  }
  return head;
}

async function gtfs() {
  log('## 2a. ZTM: strona „Dane rozkładowe” i GTFS\n');
  const page = 'https://www.ztm.waw.pl/pliki-do-pobrania/dane-rozkladowe/';
  const found = new Set();
  for (const [label, headers] of [['nagłówki wawEye', {}], ['nagłówki przeglądarki', BROWSER]]) {
    try {
      const res = await fetch(page, { headers: { 'User-Agent': UA, ...headers }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
      const html = await res.text();
      const title = (html.match(/<title[^>]*>([^<]*)/i) || [])[1];
      const urls = [...new Set([...html.matchAll(/https?:\/\/[^\s"'<>()\\]+|(?:href|src)=["']([^"']+)["']/gi)].map((m) => m[1] || m[0]))];
      log(`### ${label}: HTTP ${res.status}, ${html.length} znaków, typ ${res.headers.get('content-type')}, adres końcowy ${res.url}, tytuł „${(title || '').trim()}”, adresów w treści: ${urls.length}\n`);
      log('Adresy z gtfs/zip/7z/rozk/upload:\n```\n' + (urls.filter((u) => /gtfs|\.zip|\.7z|rozk|upload/i.test(u)).slice(0, 40).join('\n') || '(brak)') + '\n```');
      log('Fragmenty z „GTFS”:\n```\n' + ([...html.matchAll(/[^<>]{0,150}GTFS[^<>]{0,150}/gi)].slice(0, 8).map((m) => m[0].trim()).join('\n') || '(brak)') + '\n```');
      log('Początek treści (bez znaczników):\n```\n' + html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 1200) + '\n```\n');
      for (const u of urls) if (/gtfs/i.test(u) && /\.zip(\?|$)/i.test(u)) found.add(new URL(u, page).href);
    } catch (e) { log(`### ${label}: ${why(e)}\n`); }
  }
  for (const u of ['https://www.ztm.waw.pl/wp-json/wp/v2/pages?slug=dane-rozkladowe', 'https://www.ztm.waw.pl/wp-json/wp/v2/media?search=gtfs&per_page=20']) {
    try {
      const res = await fetch(u, { headers: BROWSER, signal: AbortSignal.timeout(TIMEOUT_MS) });
      const t = await res.text();
      log(`- ${u}: HTTP ${res.status}, ${t.length} znaków`);
      for (const m of t.matchAll(/https?:\\?\/\\?\/[^"'\s<>]*gtfs[^"'\s<>]*/gi)) found.add(m[0].replace(/\\\//g, '/'));
    } catch (e) { log(`- ${u}: ${why(e)}`); }
  }
  try {
    const list = execFileSync('curl', ['-sS', '-m', '60', '--list-only', 'ftp://gtfs.ztm.waw.pl/'], { encoding: 'utf8' });
    log(`- ftp://gtfs.ztm.waw.pl/: ${list.split(/\r?\n/).filter(Boolean).slice(-15).join(', ')}`);
  } catch (e) { log(`- ftp://gtfs.ztm.waw.pl/: ${why(e)}`); }
  found.clear();
  found.add('https://gtfs.ztm.waw.pl/last');
  log(`\nZnalezione pliki GTFS: ${found.size ? [...found].join(', ') : 'brak'}\n`);
  const zip = [...found][0];
  if (!zip) return;
  const dir = path.join(OUT, 'gtfs');
  fs.mkdirSync(dir, { recursive: true });
  const res = await fetch(zip, { headers: BROWSER, signal: AbortSignal.timeout(300000) });
  log(`Pobranie ${zip}: HTTP ${res.status}, adres końcowy ${res.url}, typ ${res.headers.get('content-type')}, content-disposition ${res.headers.get('content-disposition')}, last-modified ${res.headers.get('last-modified')}\n`);
  if (!res.ok) return;
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(path.join(dir, 'gtfs.zip'), buf);
  execFileSync('unzip', ['-o', '-q', path.join(dir, 'gtfs.zip'), '-d', dir]);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.txt'));
  log(`Pobrano ${zip} (${Math.round(buf.length / 1024)} KB), pliki: ${files.map((f) => `${f} (${Math.round(fs.statSync(path.join(dir, f)).size / 1024)} KB)`).join(', ')}\n`);
  for (const f of ['feed_info.txt', 'agency.txt']) if (files.includes(f)) log(`\`${f}\`:\n\`\`\`\n${fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/).slice(0, 4).join('\n')}\n\`\`\`\n`);
  if (files.includes('calendar.txt')) {
    let min = '99999999', max = '0';
    await csvRows(path.join(dir, 'calendar.txt'), (r) => { if (r.start_date < min) min = r.start_date; if (r.end_date > max) max = r.end_date; });
    log(`calendar.txt: od ${min} do ${max}\n`);
  }
  const routes = [];
  const rhead = await csvRows(path.join(dir, 'routes.txt'), (r) => { if (r.route_type === '1' || /^M\d$/.test(r.route_short_name)) routes.push(r); });
  log(`routes.txt (kolumny: ${rhead.join(', ')}), linie metra:\n\`\`\`\n${routes.map((r) => JSON.stringify(r)).join('\n') || '(brak)'}\n\`\`\`\n`);
  if (!routes.length) return;
  const rid = new Set(routes.map((r) => r.route_id)), trips = new Map(), shapes = new Set();
  await csvRows(path.join(dir, 'trips.txt'), (t) => { if (rid.has(t.route_id)) { trips.set(t.trip_id, t.route_id); if (t.shape_id) shapes.add(t.shape_id); } });
  log(`Kursów metra: ${trips.size}, różnych shape_id: ${shapes.size}\n`);
  const stopRoutes = new Map();
  await csvRows(path.join(dir, 'stop_times.txt'), (st) => { const r = trips.get(st.trip_id); if (r) { if (!stopRoutes.has(st.stop_id)) stopRoutes.set(st.stop_id, new Set()); stopRoutes.get(st.stop_id).add(r); } });
  const stops = new Map(), parents = new Map();
  const shead = await csvRows(path.join(dir, 'stops.txt'), (s) => { stops.set(s.stop_id, s); });
  for (const [id, rs] of stopRoutes) { const s = stops.get(id) || {}; const key = s.parent_station || id; if (!parents.has(key)) parents.set(key, { rs: new Set(), kids: [] }); rs.forEach((r) => parents.get(key).rs.add(r)); parents.get(key).kids.push(s); }
  const name = (r) => (routes.find((x) => x.route_id === r) || {}).route_short_name || r;
  log(`stops.txt (kolumny: ${shead.join(', ')}). Przystanków metra (stop_id): ${stopRoutes.size}, stacji (parent_station lub stop_id): ${parents.size}\n`);
  for (const r of routes) log(`- ${r.route_short_name}: stacji ${[...parents.values()].filter((p) => p.rs.has(r.route_id)).length}`);
  log('\n| stacja | linie | stop_id (przykład) | współrzędne |\n|---|---|---|---|');
  for (const [key, p] of parents) { const st = stops.get(key) || p.kids[0] || {}; log(`| ${st.stop_name} | ${[...p.rs].map(name).join(', ')} | ${(p.kids[0] || {}).stop_id} | ${st.stop_lat}, ${st.stop_lon} |`); }
  log('\nPrzykładowe wiersze stops.txt:\n```\n' + p0(parents, stops) + '\n```\n');
  if (files.includes('shapes.txt') && shapes.size) {
    const pts = new Map();
    await csvRows(path.join(dir, 'shapes.txt'), (s) => { if (shapes.has(s.shape_id)) pts.set(s.shape_id, (pts.get(s.shape_id) || 0) + 1); });
    log(`shapes.txt dla metra: ${[...pts].map(([k, n]) => `${k}: ${n} pkt`).slice(0, 10).join(', ')}\n`);
  }
}
const p0 = (parents, stops) => [...parents.values()].slice(0, 3).flatMap((p) => p.kids.slice(0, 2)).map((s) => JSON.stringify(s)).join('\n');

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
  for (const step of [gtfs]) { try { await step(); } catch (e) { log(`**Błąd:** ${why(e)}\n`); } }
})();
