'use strict';
// Zrzuty ekranu prawdziwej aplikacji (produkcja, dane na żywo) do wideo promocyjnego.
// Uruchom: NODE_USE_ENV_PROXY=1 node wideo-promocyjne/zrzuty-aplikacji.js  →  wideo-promocyjne/zasoby/ekran-*.webp (wymaga ImageMagick)
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const URL = process.env.WAWEYE_URL || 'https://waweye.vercel.app/';
const OUT = path.join(__dirname, 'zasoby');
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium';

const settle = async (page, ms = 2500) => {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(ms);
  // Wait until every tile image has loaded and no vehicle is mid-animation.
  await page.waitForFunction(() => [...document.querySelectorAll('.leaflet-tile')].every((i) => i.complete)
    && [...window.__waweye.state.markers.values()].every((m) => !m.to), null, { timeout: 20000 }).catch(() => {});
};
// The sandbox re-terminates TLS with its own CA, which Chromium does not trust; fetch every
// https request in Node (it trusts NODE_EXTRA_CA_CERTS; run with NODE_USE_ENV_PROXY=1) and hand it to the page.
// Map tiles are cached so repeated runs do not hit tile.openstreetmap.org again.
const tileCache = new Map();
async function viaNode(route) {
  const req = route.request(), url = req.url();
  try {
    if (tileCache.has(url)) return route.fulfill(tileCache.get(url));
    const r = await fetch(url, { method: req.method(), headers: { 'User-Agent': 'waweye-promo-video (github.com/pacy2u/waweye)', 'Accept': req.headers().accept || '*/*' },
      body: ['GET', 'HEAD'].includes(req.method()) ? undefined : req.postDataBuffer() });
    const res = { status: r.status, body: Buffer.from(await r.arrayBuffer()), contentType: r.headers.get('content-type') || undefined };
    if (url.includes('tile.openstreetmap.org') && r.ok) tileCache.set(url, res);
    return route.fulfill(res);
  } catch (e) { return route.abort(); }
}
// PNG from the browser → WebP (q92 is visually lossless for UI shots and ~10× smaller).
async function shot(page, name) {
  const png = path.join(OUT, name + '.png');
  await page.screenshot({ path: png });
  execFileSync('convert', [png, '-quality', '92', '-define', 'webp:method=6', path.join(OUT, name + '.webp')]);
  fs.unlinkSync(png);
}
// Freeze polling so the shot is stable (the app skips polls in hidden tabs).
const freeze = (page) => page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); });

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, locale: 'pl-PL', timezoneId: 'Europe/Warsaw' };

  async function open(opts) {
    const ctx = await browser.newContext(opts);
    await ctx.route(/^https:\/\//, viaNode);
    const page = await ctx.newPage();
    await page.goto(URL);
    await page.waitForFunction(() => window.__waweye && window.__waweye.state.markers.size > 100, null, { timeout: 60000 });
    await settle(page);
    return { ctx, page };
  }

  // Pick a modern tram near the centre that has fleet data (nicer panel).
  async function pickTram(page, near) {
    return page.evaluate(async (near) => {
      const f = await (await fetch('/api/fleet')).json();
      const cands = [...window.__waweye.state.markers.values()].map((m) => m.v).filter((v) => v.type === 'tram')
        .map((v) => { const r = f.vehicles['tram:' + v.vehicle]; const b = r && f.brands['tram:' + r.brand]; return { v, r, b }; })
        .filter((x) => x.r && x.b && x.b.ac && x.r.year >= 2015)
        .map((x) => ({ ...x, d: Math.hypot(x.v.lat - near[0], (x.v.lon - near[1]) * 0.61) }))
        .sort((a, b) => a.d - b.d);
      const c = cands[0];
      return c && { id: c.v.id, lat: c.v.lat, lon: c.v.lon, line: c.v.line, model: c.b.make + ' ' + c.b.model, year: c.r.year };
    }, near);
  }

  // 1. Overview
  {
    const { ctx, page } = await open(phone);
    await freeze(page);
    await page.evaluate(() => { window.__waweye.map.setView([52.236, 21.012], 13, { animate: false }); });
    await settle(page);
    await shot(page, 'ekran-mapa');
    await ctx.close();
  }
  // 2. Selected tram with fleet data
  {
    const { ctx, page } = await open(phone);
    await freeze(page);
    const t = await pickTram(page, [52.2318, 21.0135]);
    console.log('tram', t);
    await page.evaluate((t) => {
      const { map, select } = window.__waweye;
      map.setView([t.lat - 0.0016, t.lon + 0.0012], 16, { animate: false }); // vehicle in the upper half, panel below
      select(t.id);
    }, t);
    await page.waitForFunction(() => document.querySelectorAll('#p-fleet dt').length > 3, null, { timeout: 30000 });
    await settle(page);
    await shot(page, 'ekran-pojazd');
    fs.writeFileSync(path.join(OUT, 'pojazd.json'), JSON.stringify(t, null, 2));
    await ctx.close();
  }
  // 3. Parking
  {
    const { ctx, page } = await open(phone);
    await page.click('#t-park');
    await page.waitForFunction(() => window.__waweye.state.parkings.length > 0, null, { timeout: 30000 });
    await freeze(page);
    const p = await page.evaluate(() => {
      const { state, map, selectPark } = window.__waweye;
      const free = (p) => p.free.standard + p.free.disabled + p.free.electric;
      const best = state.parkings.filter((p) => Math.hypot(p.lat - 52.232, (p.lon - 21.01) * 0.61) < 0.03).sort((a, b) => free(b) - free(a))[0] || state.parkings[0];
      map.setView([best.lat - 0.012, best.lon + 0.004], 14, { animate: false });
      selectPark(best.id);
      return { name: best.name, free: free(best) };
    });
    console.log('parking', p);
    await settle(page);
    await shot(page, 'ekran-parking');
    await ctx.close();
  }
  // 4. Road incidents
  {
    const { ctx, page } = await open(phone);
    await page.click('#t-inc');
    await page.waitForFunction(() => window.__waweye.state.incidents.length > 0, null, { timeout: 30000 });
    await freeze(page);
    const i = await page.evaluate(() => {
      const { state, map, selectInc } = window.__waweye;
      const lines = state.incidents.filter((i) => i.status === 'active' && i.shapes.some((s) => s.type === 'line'));
      const pick = lines.find((i) => /Stanów Zjednoczonych/.test(i.name)) || lines[0] || state.incidents[0];
      const pt = pick.shapes[0].points[Math.floor(pick.shapes[0].points.length / 2)];
      map.setView([pt[0] - 0.012, pt[1] - 0.01], 14, { animate: false });
      selectInc(pick.id);
      return { name: pick.name, n: state.incidents.length };
    });
    console.log('incident', i);
    await settle(page, 3500);
    await shot(page, 'ekran-utrudnienia');
    await ctx.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
