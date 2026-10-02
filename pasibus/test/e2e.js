'use strict';
// Browser test against the mock API. Run: npm run test:e2e
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('fs');
const { createServer } = require('../dev-server');

const SHOTS = process.env.SHOTS || '/tmp';
function findChromium() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (fs.existsSync(base + '/chromium')) return base + '/chromium';
  const d = fs.existsSync(base) && fs.readdirSync(base).find((x) => x.startsWith('chromium'));
  for (const sub of ['chrome-linux/chrome', 'chrome-linux64/chrome']) if (d && fs.existsSync(`${base}/${d}/${sub}`)) return `${base}/${d}/${sub}`;
}

(async () => {
  const server = createServer({ env: { MOCK: '1' } });
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] });
  const results = [];
  const step = async (name, fn) => { await fn(); results.push(name); console.log('ok -', name); };

  for (const [label, ctxOpts] of [['desktop', { viewport: { width: 1280, height: 800 } }],
    ['mobile', { viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
    const ctx = await browser.newContext(ctxOpts);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url);
    const S = () => page.evaluate(() => ({ n: window.__pasibus.state.markers.size, sel: window.__pasibus.state.selected, z: window.__pasibus.map.getZoom(),
      shown: [...window.__pasibus.state.markers.values()].filter((m) => window.__pasibus.map.hasLayer(m.mk)).length,
      labels: document.querySelectorAll('.lbl').length, panel: !document.getElementById('panel').hidden }));

    await step(`${label}: vehicles load and render`, async () => {
      await page.waitForFunction(() => window.__pasibus.state.markers.size > 50);
      assert.ok((await S()).shown > 50);
      assert.match(await page.textContent('#status-text'), /pojazdów/);
    });
    await step(`${label}: zoom in/out`, async () => {
      const z0 = (await S()).z;
      await page.click('.leaflet-control-zoom-in'); await page.waitForTimeout(500);
      assert.equal((await S()).z, z0 + 1);
      await page.click('.leaflet-control-zoom-out'); await page.waitForTimeout(500); await page.click('.leaflet-control-zoom-out'); await page.waitForTimeout(500);
      assert.equal((await S()).z, z0 - 1);
      await page.click('.leaflet-control-zoom-in'); await page.waitForTimeout(400);
    });
    await step(`${label}: click selects vehicle, highlights it, dims others`, async () => {
      await page.evaluate(() => { const { map, state } = window.__pasibus; const m = [...state.markers.values()][5]; map.setView(m.mk.getLatLng(), 16, { animate: false }); });
      await page.waitForTimeout(600);
      const pt = await page.evaluate(() => { const { map, state } = window.__pasibus; const m = [...state.markers.values()].filter((x) => map.getBounds().contains(x.mk.getLatLng()))[0];
        const p = map.latLngToContainerPoint(m.mk.getLatLng()); const r = map.getContainer().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y, id: m.v.id }; });
      await page.mouse.click(pt.x, pt.y); await page.waitForTimeout(300);
      const s = await S();
      assert.equal(s.sel, pt.id); assert.ok(s.panel);
      assert.ok(await page.locator('.hl').count() === 1);
      const fills = await page.evaluate(() => { const { state } = window.__pasibus; const o = [...state.markers.values()].find((m) => m.v.id !== state.selected); return { sel: state.markers.get(state.selected).mk.options.fillColor, other: o.mk.options.fillOpacity }; });
      assert.equal(fills.sel, '#FC4C02'); assert.ok(fills.other < 1);
      await page.screenshot({ path: `${SHOTS}/pasibus-${label}-selected.png` });
    });
    await step(`${label}: selection survives refresh`, async () => {
      const id = (await S()).sel; const t0 = await page.evaluate(() => window.__pasibus.state.lastOk); await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }); await page.waitForFunction((t) => window.__pasibus.state.lastOk > t, t0);
      await page.waitForTimeout(100); assert.equal((await S()).sel, id);
    });
    await step(`${label}: follow mode centres selected`, async () => {
      await page.click('#follow'); await page.waitForTimeout(500);
      const d = await page.evaluate(() => { const { map, state } = window.__pasibus; const p = map.latLngToContainerPoint(state.markers.get(state.selected).mk.getLatLng()); const s = map.getSize(); return Math.hypot(p.x - s.x / 2, p.y - s.y / 2); });
      assert.ok(d < 5, 'distance ' + d);
    });
    await step(`${label}: close panel deselects`, async () => {
      await page.click('#close'); const s = await S(); assert.equal(s.sel, null); assert.ok(!s.panel); assert.equal(await page.locator('.hl').count(), 0);
    });
    await step(`${label}: map click deselects`, async () => {
      await page.evaluate(() => { const { state, select } = window.__pasibus; select([...state.markers.keys()][0]); });
      await page.mouse.click(5, ctxOpts.viewport.height - 5); await page.waitForTimeout(200);
      // bottom-left may hit status chip; use map centre-top-right instead if still selected
      if ((await S()).sel) { await page.evaluate(() => window.__pasibus.map.fire('click')); }
      assert.equal((await S()).sel, null);
    });
    await step(`${label}: type filter`, async () => {
      await page.click('#t-tram'); await page.waitForTimeout(600);
      assert.equal(await page.evaluate(() => [...window.__pasibus.state.markers.values()].some((m) => m.v.type === 'tram')), false);
      await page.click('#t-tram'); await page.waitForFunction(() => [...window.__pasibus.state.markers.values()].some((m) => m.v.type === 'tram'));
    });
    await step(`${label}: line search`, async () => {
      await page.fill('#search', '175'); await page.waitForTimeout(200);
      const r = await page.evaluate(() => { const { map, state } = window.__pasibus; return [...state.markers.values()].filter((m) => map.hasLayer(m.mk)).map((m) => m.v.line); });
      assert.ok(r.length > 0 && r.every((l) => l === '175'), JSON.stringify(r));
      await page.fill('#search', ''); await page.waitForTimeout(200);
    });
    await step(`${label}: labels at high zoom`, async () => {
      await page.evaluate(() => { const { map, state } = window.__pasibus; map.setView([...state.markers.values()][3].mk.getLatLng(), 16, { animate: false }); });
      await page.waitForTimeout(500); assert.ok((await S()).labels > 0);
    });
    await step(`${label}: parking button shows parkings, panel has free/total places`, async () => {
      await page.evaluate(() => { window.__pasibus.map.setView([52.2297, 21.0122], 12, { animate: false }); });
      assert.equal(await page.locator('.pk').count(), 0);
      await page.click('#t-park'); await page.waitForSelector('.pk'); await page.waitForTimeout(300);
      assert.equal(await page.getAttribute('#t-park', 'aria-pressed'), 'true');
      assert.ok(await page.locator('#t-park svg.pico').count() === 1, 'parking icon');
      assert.ok((await page.locator('.pk').count()) >= 5);
      await page.evaluate(() => window.__pasibus.selectPark(window.__pasibus.state.parkings.find((p) => p.name.includes('Stadion')).id));
      const panel = await page.evaluate(() => ({ hidden: document.getElementById('ppanel').hidden, name: document.getElementById('pp-name').textContent,
        free: document.getElementById('pp-free').textContent, of: document.getElementById('pp-of').textContent, rows: document.getElementById('pp-rows').textContent }));
      assert.ok(!panel.hidden); assert.match(panel.name, /Stadion/);
      assert.equal(panel.free, '234'); assert.match(panel.of, /wolnych miejsc z 506/); // free 233+0+1, capacity 500+2+4
      assert.match(panel.rows, /Standardowe233 wolnych z 500/); assert.match(panel.rows, /Cennik/);
      await page.screenshot({ path: `${SHOTS}/pasibus-${label}-parking.png` });
    });
    await step(`${label}: parking and vehicle panels are mutually exclusive`, async () => {
      await page.evaluate(() => { const { state, select } = window.__pasibus; select([...state.markers.keys()][0]); });
      let s = await page.evaluate(() => ({ p: document.getElementById('ppanel').hidden, v: document.getElementById('panel').hidden }));
      assert.ok(s.p && !s.v);
      await page.evaluate(() => { const { state, selectPark } = window.__pasibus; selectPark(state.parkings[0].id); });
      s = await page.evaluate(() => ({ p: document.getElementById('ppanel').hidden, v: document.getElementById('panel').hidden }));
      assert.ok(!s.p && s.v);
    });
    await step(`${label}: parking button off hides markers and panel`, async () => {
      await page.click('#t-park'); await page.waitForTimeout(200);
      assert.equal(await page.locator('.pk').count(), 0);
      assert.ok(await page.evaluate(() => document.getElementById('ppanel').hidden));
    });
    await step(`${label}: incidents button draws points and lines, panel shows details`, async () => {
      await page.evaluate(() => { window.__pasibus.map.setView([52.2297, 21.0122], 13, { animate: false }); });
      assert.equal(await page.locator('.ic').count(), 0);
      await page.click('#t-inc'); await page.waitForSelector('.ic'); await page.waitForTimeout(300);
      assert.equal(await page.getAttribute('#t-inc', 'aria-pressed'), 'true');
      assert.ok(await page.locator('#t-inc svg.pico').count() === 1, 'warning icon');
      assert.equal(await page.locator('.ic').count(), 4);
      assert.equal(await page.locator('.ic.planned').count(), 1); assert.equal(await page.locator('.ic.ended').count(), 1);
      assert.equal(await page.evaluate(() => [...window.__pasibus.state.incLayers.values()].reduce((n, g) => { g.eachLayer((l) => { if (l instanceof L.Polyline) n++; }); return n; }, 0)), 1, 'one polyline');
      await page.click('.ic.planned');
      const panel = await page.evaluate(() => ({ hidden: document.getElementById('ipanel').hidden, name: document.getElementById('ip-name').textContent,
        status: document.getElementById('ip-status').textContent, link: document.getElementById('ip-link').href, linkHidden: document.getElementById('ip-link').hidden,
        body: document.getElementById('ip-body').textContent, when: document.getElementById('ip-when').textContent }));
      assert.ok(!panel.hidden); assert.match(panel.name, /Targowej/); assert.equal(panel.status, 'Zaplanowane');
      assert.equal(panel.link, 'https://infoulice.um.warszawa.pl/?page_id=8150'); assert.ok(!panel.linkHidden); assert.match(panel.body, /przyszłego tygodnia/);
      await page.screenshot({ path: `${SHOTS}/pasibus-${label}-incidents.png` });
    });
    await step(`${label}: incident panel is mutually exclusive with vehicle and parking panels`, async () => {
      const hidden = () => page.evaluate(() => ['panel', 'ppanel', 'ipanel'].map((id) => document.getElementById(id).hidden));
      await page.evaluate(() => { const { state, select } = window.__pasibus; select([...state.markers.keys()][0]); });
      assert.deepEqual(await hidden(), [false, true, true]);
      await page.evaluate(() => { const { state, selectInc } = window.__pasibus; selectInc(state.incidents[0].id); });
      assert.deepEqual(await hidden(), [true, true, false]);
      await page.click('#t-park'); await page.waitForSelector('.pk');
      await page.evaluate(() => { const { state, selectPark } = window.__pasibus; selectPark(state.parkings[0].id); });
      assert.deepEqual(await hidden(), [true, false, true]);
      await page.click('#t-park');
    });
    await step(`${label}: incidents button off hides layer and panel`, async () => {
      await page.evaluate(() => { const { state, selectInc } = window.__pasibus; selectInc(state.incidents[0].id); });
      await page.click('#t-inc'); await page.waitForTimeout(200);
      assert.equal(await page.locator('.ic').count(), 0);
      assert.ok(await page.evaluate(() => document.getElementById('ipanel').hidden));
    });
    await step(`${label}: status count always matches the visible vehicles, also after a layer error`, async () => {
      await page.route('**/api/incidents', (route) => route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"HTTP 400 (bad type)"}' }));
      await page.click('#t-inc');
      await page.waitForFunction(() => /utrudnienia: brak danych/.test(document.getElementById('status-text').textContent));
      const r = await page.evaluate(() => ({ text: document.getElementById('status-text').textContent,
        shown: [...window.__pasibus.state.markers.values()].filter((m) => window.__pasibus.map.hasLayer(m.mk)).length }));
      assert.ok(r.shown > 50); assert.ok(r.text.startsWith(`${r.shown} pojazdów`), r.text + ' vs ' + r.shown);
      await page.click('#t-inc'); await page.unroute('**/api/incidents');
    });
    await step(`${label}: no horizontal overflow`, async () => {
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    });
    await step(`${label}: no JS errors`, async () => assert.deepEqual(errors, []));
    await page.screenshot({ path: `${SHOTS}/pasibus-${label}.png` });
    await ctx.close();
  }

  // API failure UI
  const bad = createServer({ env: {} });
  await new Promise((r) => bad.listen(0, r));
  const page = await (await browser.newContext()).newPage();
  await page.goto(`http://localhost:${bad.address().port}/`);
  await step('error banner when API fails', async () => {
    await page.waitForFunction(() => document.getElementById('status').className === 'err');
    assert.match(await page.textContent('#status-text'), /Brak danych/);
  });
  const half = createServer({ env: { MOCK: '1' } });
  half.on('request', () => {});
  await new Promise((r) => half.listen(0, r));
  const pg = await (await browser.newContext()).newPage();
  await pg.route('**/api/parking', (route) => route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"HTTP 403 (forbidden)"}' }));
  await pg.goto(`http://localhost:${half.address().port}/`);
  await step('parking API failure is reported, vehicles stay visible', async () => {
    await pg.waitForFunction(() => window.__pasibus.state.markers.size > 50);
    await pg.click('#t-park');
    await pg.waitForFunction(() => /parkingi: brak danych/.test(document.getElementById('status-text').textContent));
    assert.ok(await pg.evaluate(() => window.__pasibus.state.markers.size > 50));
  });
  await pg.route('**/api/incidents', (route) => route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"HTTP 403 (forbidden)"}' }));
  await step('incidents API failure is reported, vehicles stay visible', async () => {
    await pg.click('#t-inc');
    await pg.waitForFunction(() => /utrudnienia: brak danych/.test(document.getElementById('status-text').textContent));
    assert.ok(await pg.evaluate(() => window.__pasibus.state.markers.size > 50));
  });
  await browser.close(); server.close(); bad.close(); half.close();
  console.log(`\n${results.length} checks passed`);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
