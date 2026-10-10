'use strict';
// Zrzuty prawdziwej aplikacji (produkcja, dane na żywo) do filmu „Pierwsze kroki”: po jednym na funkcję.
// Uruchom z folderu waweye/: NODE_USE_ENV_PROXY=1 node wideo-przewodnik/zrzuty.js  →  wideo-przewodnik/assets/shots/m-*.png, d-*.png
// Wymaga playwright-core (npm install w waweye/) i Chromium (CHROME_PATH, domyślnie /opt/pw-browsers/chromium).
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const URL = process.env.WAWEYE_URL || 'https://waweye.vercel.app/';
const OUT = path.join(__dirname, 'assets', 'shots');
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium';
const ONLY = process.argv.slice(2);

const settle = async (page, ms = 2500) => {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(ms);
  await page.waitForFunction(() => [...document.querySelectorAll('.leaflet-tile')].every((i) => i.complete)
    && [...window.__waweye.state.markers.values()].every((m) => !m.to), null, { timeout: 20000 }).catch(() => {});
};
// Sesja Claude przechwytuje TLS własnym CA, którego Chromium nie zna: zapytania https idą przez Node.
const tileCache = new Map();
async function viaNode(route) {
  const req = route.request(), url = req.url();
  try {
    if (tileCache.has(url)) return route.fulfill(tileCache.get(url));
    const r = await fetch(url, { method: req.method(), headers: { 'User-Agent': 'waweye-przewodnik-video (github.com/pacy2u/waweye)', 'Accept': req.headers().accept || '*/*' },
      body: ['GET', 'HEAD'].includes(req.method()) ? undefined : req.postDataBuffer() });
    const res = { status: r.status, body: Buffer.from(await r.arrayBuffer()), contentType: r.headers.get('content-type') || undefined };
    if (url.includes('tile.openstreetmap.org') && r.ok) tileCache.set(url, res);
    return route.fulfill(res);
  } catch (e) { return route.abort(); }
}
const freeze = (page) => page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); });

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const PKIN = [52.2318, 21.0060];
  const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, locale: 'pl-PL', timezoneId: 'Europe/Warsaw' };
  const desk = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'pl-PL', timezoneId: 'Europe/Warsaw' };

  async function open(opts) {
    const ctx = await browser.newContext(opts);
    await ctx.route(/^https:\/\//, viaNode);
    const page = await ctx.newPage();
    await page.goto(URL);
    await page.waitForFunction(() => window.__waweye && window.__waweye.state.markers.size > 100, null, { timeout: 60000 });
    await settle(page);
    return { ctx, page };
  }
  async function take(name, opts, fn) {
    if (ONLY.length && !ONLY.includes(name)) return;
    const { ctx, page } = await open(opts);
    try {
      const info = await fn(page, ctx);
      await page.screenshot({ path: path.join(OUT, name + '.png') });
      console.log(name, info || '');
    } catch (e) { console.error(name, 'FAILED', e.message); }
    await ctx.close();
  }
  // Autobus z trasą linii: najbliższy centrum pojazd linii, która ma trasę.
  async function pickBus(page, near, line) {
    return page.evaluate(({ near, line }) => [...window.__waweye.state.markers.values()].map((m) => m.v)
      .filter((v) => v.type === 'bus' && (!line || v.line === line))
      .map((v) => ({ id: v.id, lat: v.lat, lon: v.lon, line: v.line, d: Math.hypot(v.lat - near[0], (v.lon - near[1]) * 0.61) }))
      .sort((a, b) => a.d - b.d)[0], { near, line });
  }
  async function selectWithRoute(page, v, zoom, dLat) {
    await page.evaluate(({ v, zoom, dLat }) => { const { map, select } = window.__waweye; map.setView([v.lat - dLat, v.lon], zoom, { animate: false }); select(v.id); }, { v, zoom, dLat });
    await page.waitForFunction(() => !document.getElementById('p-route').hidden, null, { timeout: 30000 }).catch(() => {});
  }

  await take('m-trasa', phone, async (page) => {
    await freeze(page);
    const v = (await pickBus(page, PKIN, '175')) || (await pickBus(page, PKIN));
    await selectWithRoute(page, v, 13, 0.012);
    await settle(page, 3000);
    return v;
  });
  await take('d-trasa', desk, async (page) => {
    await freeze(page);
    const v = (await pickBus(page, PKIN, '175')) || (await pickBus(page, PKIN));
    await selectWithRoute(page, v, 13, 0);
    await settle(page, 3000);
    return v;
  });
  await take('m-szukaj', phone, async (page) => {
    await freeze(page);
    await page.evaluate(() => { window.__waweye.map.setView([52.225, 21.0], 12, { animate: false }); });
    await page.fill('#search', '175');
    await settle(page, 2000);
  });
  await take('m-parking', phone, async (page) => {
    await page.click('#t-park');
    await page.waitForFunction(() => window.__waweye.state.parkings.length > 0, null, { timeout: 30000 });
    await freeze(page);
    const p = await page.evaluate(() => {
      const { state, map, selectPark } = window.__waweye;
      const free = (p) => p.free.standard + p.free.disabled + p.free.electric;
      const best = state.parkings.filter((p) => Math.hypot(p.lat - 52.232, (p.lon - 21.01) * 0.61) < 0.03).sort((a, b) => free(b) - free(a))[0] || state.parkings[0];
      map.setView([best.lat - 0.012, best.lon + 0.004], 14, { animate: false });
      selectPark(best.id);
      return best.name;
    });
    await settle(page);
    return p;
  });
  await take('m-utrudnienia', phone, async (page) => {
    await page.click('#t-inc');
    await page.waitForFunction(() => window.__waweye.state.incidents.length > 0, null, { timeout: 30000 });
    await freeze(page);
    const i = await page.evaluate(() => {
      const { state, map, selectInc } = window.__waweye;
      const lines = state.incidents.filter((i) => i.status === 'active' && i.shapes.some((s) => s.type === 'line'));
      const pick = lines[0] || state.incidents[0];
      const pt = pick.shapes[0].points[Math.floor(pick.shapes[0].points.length / 2)];
      map.setView([pt[0] - 0.012, pt[1] - 0.01], 14, { animate: false });
      selectInc(pick.id);
      return pick.name;
    });
    await settle(page, 3500);
    return i;
  });
  for (const [name, btn, markers, selectFn] of [['m-sport', '#t-sport', 'sportMarkers', 'selectSport'], ['m-dziejesie', '#t-events', 'eventMarkers', 'selectEvent']]) {
    await take(name, phone, async (page) => {
      await page.click(btn);
      await page.click('#sfilter [data-range="week"]').catch(() => {});
      await page.waitForFunction((k) => window.__waweye.state[k].size > 0, markers, { timeout: 60000 });
      await page.waitForTimeout(4000);
      await freeze(page);
      const r = await page.evaluate(({ markers, selectFn }) => {
        const w = window.__waweye;
        const ms = [...w.state[markers].entries()].map(([id, m]) => ({ id, p: m.place }))
          .map((x) => ({ ...x, d: Math.hypot(x.p.lat - 52.232, (x.p.lon - 21.01) * 0.61) })).filter((x) => x.d < 0.04)
          .sort((a, b) => b.p.entries.length - a.p.entries.length);
        const c = ms[0];
        w.map.setView([c.p.lat - 0.012, c.p.lon], 14, { animate: false });
        w[selectFn](c.id);
        return c.p.entries.length + ' wpisów';
      }, { markers, selectFn });
      await settle(page, 3000);
      return r;
    });
  }
  await take('m-timelapse', phone, async (page) => {
    await page.evaluate(() => { window.__waweye.map.setView([52.232, 21.01], 13, { animate: false }); });
    await page.click('#t-lapse');
    await page.waitForFunction(() => !/Wczytywanie/.test(document.getElementById('lapse-note').textContent), null, { timeout: 90000 }).catch(() => {});
    await page.evaluate(() => { const i = document.getElementById('lapse-pos'); i.value = 300; i.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(4000);
  });
  await take('m-strefy', phone, async (page) => {
    await freeze(page);
    await page.evaluate(() => { window.__waweye.map.setView([52.232, 21.01], 13, { animate: false }); });
    await page.click('#zones-btn');
    await page.check('#z-sppn');
    await page.check('#z-sct');
    await page.waitForTimeout(1500);
    await settle(page, 5000);
  });
  await take('m-metro', phone, async (page) => {
    await freeze(page);
    await page.waitForFunction(() => window.__waweye.metro.stations && window.__waweye.metro.stations.length > 30, null, { timeout: 30000 });
    await page.evaluate(() => { const w = window.__waweye; const s = w.metro.stations.find((s) => s.name === 'Świętokrzyska'); w.map.setView([s.ll[0] - 0.01, s.ll[1]], 14, { animate: false }); w.openStation(s.name); });
    await settle(page, 2500);
  });
  await take('m-lokalizacja', { ...phone, permissions: ['geolocation'], geolocation: { latitude: 52.2297, longitude: 21.0122, accuracy: 25 } }, async (page) => {
    await freeze(page);
    await page.click('#locate');
    await settle(page, 4000);
  });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
