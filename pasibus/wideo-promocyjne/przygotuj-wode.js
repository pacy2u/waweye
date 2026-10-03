'use strict';
// Woda (Wisła, jeziora) dla sceny z mapą: kafelki OSM (z12) → kolor wody → siatka punktów co ~70 m.
// Wymaga ImageMagick (convert). Uruchom: NODE_USE_ENV_PROXY=1 node wideo-promocyjne/przygotuj-wode.js
// Kafelki © OpenStreetMap contributors (ODbL) – podpis jest na planszy końcowej wideo.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const Z = 12, BOX = { s: 52.06, n: 52.40, w: 20.82, e: 21.30 };
const CACHE = process.env.TILE_CACHE || path.join(require('os').tmpdir(), 'waweye-kafelki');
const OUT = path.join(__dirname, 'zasoby');
const tx = (lon) => Math.floor((lon + 180) / 360 * 2 ** Z);
const ty = (lat) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** Z); };
const lon = (x) => x / 2 ** Z * 360 - 180;
const lat = (y) => { const n = Math.PI - 2 * Math.PI * y / 2 ** Z; return 180 / Math.PI * Math.atan(Math.sinh(n)); };

(async () => {
  fs.mkdirSync(CACHE, { recursive: true });
  const x0 = tx(BOX.w), x1 = tx(BOX.e), y0 = ty(BOX.n), y1 = ty(BOX.s);
  const rows = [];
  for (let y = y0; y <= y1; y++) {
    const row = [];
    for (let x = x0; x <= x1; x++) {
      const f = path.join(CACHE, `${Z}-${x}-${y}.png`);
      if (!fs.existsSync(f)) {
        const r = await fetch(`https://tile.openstreetmap.org/${Z}/${x}/${y}.png`, { headers: { 'User-Agent': 'waweye-promo-video (github.com/pacy2u/tst)' } });
        if (!r.ok) throw new Error(`kafelek ${x},${y}: HTTP ${r.status}`);
        fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
        await new Promise((res) => setTimeout(res, 150));
      }
      row.push(f);
    }
    rows.push(row);
  }
  console.log('kafelki', rows[0].length, '×', rows.length);
  const tmpRows = rows.map((row, i) => { const f = path.join(CACHE, `row-${i}.png`); execFileSync('convert', [...row, '+append', f]); return f; });
  const full = path.join(CACHE, 'full.png');
  execFileSync('convert', [...tmpRows, '-append', full]);
  // OSM Carto water is #aad3df; keep it (white, alpha from match), drop everything else.
  execFileSync('convert', [full, '-fuzz', '3%', '-fill', 'white', '-opaque', '#aad3df', '-fill', 'black', '+opaque', 'white',
    '-morphology', 'Open', 'Disk:1', '-colorspace', 'Gray', '-alpha', 'copy', '-channel', 'RGB', '-evaluate', 'set', '100%', '+channel',
    path.join(CACHE, 'woda.png')]);
  // Sample the mask every STEP pixels (Web Mercator pixel grid → lat/lon), keep water points, delta-encode.
  const STEP = 3, size = 256 * rows[0].length;
  const raw = execFileSync('convert', [path.join(CACHE, 'woda.png'), '-alpha', 'extract', '-depth', '8', 'gray:-'], { maxBuffer: 1 << 28 });
  const pts = [];
  let pa = 0, po = 0;
  for (let py = 0; py < size; py += STEP) for (let px = 0; px < size; px += STEP) {
    if (raw[py * size + px] < 128) continue;
    const a = Math.round(lat(y0 + (py + 0.5) / 256) * 1e4), o = Math.round(lon(x0 + (px + 0.5) / 256) * 1e4);
    pts.push(a - pa, o - po); pa = a; po = o;
  }
  fs.writeFileSync(path.join(OUT, 'woda.js'), `// Woda z kafelków © OpenStreetMap contributors: punkty co ${STEP} px (z${Z}), [Δlat, Δlon] × 1e-4°.\nwindow.WODA = ${JSON.stringify(pts)};\n`);
  console.log('zapisano woda.js, punktów', pts.length / 2);
})().catch((e) => { console.error(e); process.exit(1); });
