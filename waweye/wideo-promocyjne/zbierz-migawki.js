'use strict';
// Zbiera migawki pojazdów na żywo (do animacji ruchu na mapie) oraz parkingi, utrudnienia i tabor.
// Uruchom: node wideo-promocyjne/zbierz-migawki.js <katalog> [liczba=100] [odstęp_s=15]   (w sandboksie: NODE_USE_ENV_PROXY=1)
// Potem: node wideo-promocyjne/przygotuj-dane.js <katalog> <katalog>
const fs = require('fs');
const path = require('path');

const BASE = process.env.WAWEYE_URL || 'https://waweye.vercel.app';
const [dir, count = '100', every = '15'] = process.argv.slice(2);
if (!dir) { console.error('użycie: node zbierz-migawki.js <katalog> [liczba] [odstęp_s]'); process.exit(1); }
const get = async (p) => { const r = await fetch(BASE + p, { cache: 'no-store' }); if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`); return r.text(); };

(async () => {
  fs.mkdirSync(dir, { recursive: true });
  for (const [file, p] of [['parking.json', '/api/parking'], ['incidents.json', '/api/incidents'], ['fleet.json', '/api/fleet']]) fs.writeFileSync(path.join(dir, file), await get(p));
  for (let i = 0; i < +count; i++) {
    try { fs.writeFileSync(path.join(dir, `t${String(i).padStart(3, '0')}.json`), await get('/api/vehicles?types=1,2')); process.stdout.write('.'); }
    catch (e) { console.error('\n' + e.message); }
    if (i < +count - 1) await new Promise((r) => setTimeout(r, +every * 1000));
  }
  console.log('\ngotowe');
})().catch((e) => { console.error(e); process.exit(1); });
