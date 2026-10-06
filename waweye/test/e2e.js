'use strict';
// Browser test against the mock API. Run: npm run test:e2e
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('fs');
const { createServer } = require('../dev-server');

const SHOTS = process.env.SHOTS || '/tmp';
// The SPPN layer comes from the city's WMS; tests answer its tile requests with a transparent pixel (no outside traffic).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const wmsTiles = (ctx) => ctx.route('**/wms.um.warszawa.pl/**', (r) => { r.fulfill({ status: 200, contentType: 'image/png', body: PNG }); });
function findChromium() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH; // e.g. Google Chrome preinstalled on GitHub runners
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
  const step = async (name, fn) => {
    try { await fn(); } catch (e) { console.error('FAIL -', name); throw e; }
    results.push(name); console.log('ok -', name);
  };

  for (const [label, ctxOpts] of [['desktop', { viewport: { width: 1280, height: 800 } }],
    ['mobile', { viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
    const ctx = await browser.newContext(ctxOpts);
    await wmsTiles(ctx);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url);
    const S = () => page.evaluate(() => ({ n: window.__waweye.state.markers.size, sel: window.__waweye.state.selected, z: window.__waweye.map.getZoom(),
      shown: [...window.__waweye.state.markers.values()].filter((m) => window.__waweye.map.hasLayer(m.mk)).length,
      labels: document.querySelectorAll('.lbl').length, panel: !document.getElementById('panel').hidden }));

    await step(`${label}: vehicles load and render`, async () => {
      await page.waitForFunction(() => window.__waweye.state.markers.size > 50);
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
      // Freeze the data while clicking (see "vehicles stay clickable…" below): at zoom 16 a poll moves mock vehicles by hundreds of pixels.
      await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }));
      let pt;
      try {
        await page.waitForTimeout(200);
        await page.waitForFunction(() => [...window.__waweye.state.markers.values()].every((m) => !m.to));
        await page.evaluate(() => { const { map, state } = window.__waweye; const m = [...state.markers.values()][5]; map.setView(m.mk.getLatLng(), 16, { animate: false }); });
        await page.waitForTimeout(300);
        // A vehicle on its own and not under the top bar, the status or the buttons.
        pt = await page.evaluate(() => { const { map, state } = window.__waweye; const r = map.getContainer().getBoundingClientRect(), cv = document.querySelector('.leaflet-overlay-pane canvas');
          const all = [...state.markers.values()].filter((x) => map.hasLayer(x.mk)).map((x) => { const p = map.latLngToContainerPoint(x.mk.getLatLng()); return { x: r.left + p.x, y: r.top + p.y, id: x.v.id }; });
          return all.find((p) => document.elementFromPoint(p.x, p.y) === cv && all.every((q) => q === p || Math.hypot(q.x - p.x, q.y - p.y) > 20)); });
        assert.ok(pt, 'no clickable vehicle in view');
        await page.mouse.click(pt.x, pt.y); await page.waitForTimeout(300);
      } finally {
        await page.evaluate(() => { delete document.hidden; });
      }
      const s = await S();
      assert.equal(s.sel, pt.id); assert.ok(s.panel);
      assert.ok(await page.locator('.hl').count() === 1);
      const fills = await page.evaluate(() => { const { state } = window.__waweye; const o = [...state.markers.values()].find((m) => m.v.id !== state.selected); return { sel: state.markers.get(state.selected).mk.options.fillColor, other: o.mk.options.fillOpacity }; });
      assert.equal(fills.sel, '#FC4C02'); assert.ok(fills.other < 1);
      await page.screenshot({ path: `${SHOTS}/waweye-${label}-selected.png` });
    });
    await step(`${label}: vehicle panel shows fleet details from the public-transport-vehicles dataset`, async () => {
      await page.waitForFunction(() => document.querySelectorAll('#p-fleet dt').length > 3);
      const txt = await page.textContent('#p-fleet');
      for (const t of ['Model', 'Rok produkcji', 'Operator', 'Zajezdnia', 'Miejsca', 'Klimatyzacja']) assert.ok(txt.includes(t), 'missing ' + t + ': ' + txt);
      const m = await page.evaluate(() => { const { state } = window.__waweye; return state.markers.get(state.selected).v.type; });
      assert.match(txt, m === 'bus' ? /Solaris Urbino 12 IV/ : /Konstal 105N i/);
      assert.ok(await page.isVisible('#p-fleet'));
      await page.screenshot({ path: `${SHOTS}/waweye-${label}-fleet.png` });
    });
    await step(`${label}: selection survives refresh`, async () => {
      const id = (await S()).sel; const t0 = await page.evaluate(() => window.__waweye.state.lastOk); await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }); await page.waitForFunction((t) => window.__waweye.state.lastOk > t, t0);
      await page.waitForTimeout(100); assert.equal((await S()).sel, id);
    });
    await step(`${label}: follow mode centres selected`, async () => {
      await page.click('#follow'); await page.waitForTimeout(500);
      const d = await page.evaluate(() => { const { map, state } = window.__waweye; const p = map.latLngToContainerPoint(state.markers.get(state.selected).mk.getLatLng()); const s = map.getSize(); return Math.hypot(p.x - s.x / 2, p.y - s.y / 2); });
      assert.ok(d < 5, 'distance ' + d);
    });
    await step(`${label}: the selected vehicle's line route is drawn with its stops, and cleared on deselect`, async () => {
      const R = () => page.evaluate(() => { const { map, route } = window.__waweye; let lines = 0, stops = 0;
        map.eachLayer((l) => { if (l instanceof L.Polyline && l.options.color === '#FC4C02' && !l.options.interactive) lines++; if (l instanceof L.CircleMarker && l.getTooltip && l.getTooltip()) stops++; });
        return { lines, stops, shown: route.shown.length, want: route.shown.reduce((n, v) => n + v.stops.length, 0), text: document.getElementById('p-route').textContent,
          hidden: document.getElementById('p-route').hidden }; });
      const pick = (line) => page.evaluate((line) => { const { state, select } = window.__waweye; const m = [...state.markers.values()].find((x) => x.v.line === line); select(m.v.id); return m.v.id; }, line);
      await pick('175');
      await page.waitForFunction(() => window.__waweye.route.shown.length > 0);
      let r = await R();
      assert.ok(r.lines >= 1 && r.lines === r.shown, JSON.stringify(r)); assert.equal(r.stops, r.want); assert.ok(r.stops > 20);
      assert.match(r.text, /Kierunek: /); assert.match(r.text, /Trasa wg rozkładu ZTM \(GTFS\) ważnego do \d/);
      assert.equal(await page.locator('.leaflet-overlay-pane canvas').count(), 1, 'the route shares the vehicles canvas');
      await page.screenshot({ path: `${SHOTS}/waweye-${label}-trasa.png` });
      await page.click('#close'); r = await R();
      assert.equal(r.lines + r.stops, 0, 'route cleared'); assert.ok(r.hidden);
      // A line without a file, and a timetable past its last day.
      await page.route('**/data/trasy/9.json', (rt) => rt.fulfill({ status: 404, body: 'Not found' }));
      await page.route('**/data/trasy/186.json', async (rt) => { const res = await rt.fetch(); const d = await res.json(); d.valid.to = '2020-01-01'; rt.fulfill({ response: res, body: JSON.stringify(d) }); });
      await page.evaluate(() => window.__waweye.route.cache.clear()); // earlier steps may have loaded these lines
      await pick('9');
      await page.waitForFunction(() => /brak trasy tej linii/.test(document.getElementById('p-route').textContent));
      await pick('186');
      await page.waitForFunction(() => /może być nieaktualna/.test(document.getElementById('p-route').textContent));
      assert.ok(await page.evaluate(() => document.querySelector('.p-route-src').classList.contains('old')));
      await page.unroute('**/data/trasy/9.json'); await page.unroute('**/data/trasy/186.json');
      // The route store answers first (/api/trasa); the shipped file is only the fallback.
      await page.route('**/api/trasa?linia=523', async (rt) => { const res = await page.request.get(new URL('/data/trasy/523.json', page.url()).href); const d = await res.json();
        d.variants.forEach((v) => { v.headsign = 'Z magazynu'; }); d.valid = { from: '2026-10-05', to: '2099-01-01' }; rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(d) }); });
      await page.evaluate(() => window.__waweye.route.cache.delete('523'));
      await pick('523');
      await page.waitForFunction(() => window.__waweye.route.data && window.__waweye.route.data.variants[0].headsign === 'Z magazynu');
      assert.match(await page.textContent('#p-route'), /ważnego do 1\.01\.2099/);
      await page.unroute('**/api/trasa?linia=523');
      await pick('175'); // the next step closes the panel of a selected vehicle
    });
    await step(`${label}: close panel deselects`, async () => {
      await page.click('#close'); const s = await S(); assert.equal(s.sel, null); assert.ok(!s.panel); assert.equal(await page.locator('.hl').count(), 0);
    });
    await step(`${label}: map click deselects`, async () => {
      await page.evaluate(() => { const { state, select } = window.__waweye; select([...state.markers.keys()][0]); });
      await page.mouse.click(5, ctxOpts.viewport.height - 5); await page.waitForTimeout(200);
      // bottom-left may hit status chip; use map centre-top-right instead if still selected
      if ((await S()).sel) { await page.evaluate(() => { window.__waweye.map.fire('click'); }); }
      assert.equal((await S()).sel, null);
    });
    await step(`${label}: type filter`, async () => {
      await page.click('#t-tram'); await page.waitForTimeout(600);
      const shownTrams = () => page.evaluate(() => { const { map, state } = window.__waweye; return [...state.markers.values()].filter((m) => m.v.type === 'tram' && map.hasLayer(m.mk)).length; });
      assert.equal(await shownTrams(), 0);
      await page.click('#t-tram');
      assert.ok(await shownTrams() > 0, 'trams reappear immediately, without waiting for the next poll');
    });
    await step(`${label}: line search`, async () => {
      await page.fill('#search', '175'); await page.waitForTimeout(200);
      const r = await page.evaluate(() => { const { map, state } = window.__waweye; return [...state.markers.values()].filter((m) => map.hasLayer(m.mk)).map((m) => m.v.line); });
      assert.ok(r.length > 0 && r.every((l) => l === '175'), JSON.stringify(r));
      await page.fill('#search', ''); await page.waitForTimeout(200);
    });
    await step(`${label}: labels at high zoom`, async () => {
      await page.evaluate(() => { const { map, state } = window.__waweye; map.setView([...state.markers.values()][3].mk.getLatLng(), 16, { animate: false }); });
      await page.waitForTimeout(500); assert.ok((await S()).labels > 0);
    });
    // ---- My location (Google Maps style button) ----
    const ME = { latitude: 52.2318, longitude: 21.0060, accuracy: 30 }; // Palace of Culture
    const L_ = () => page.evaluate(() => { const { me, map } = window.__waweye; return { cls: document.getElementById('locate').className, centered: me.centered,
      flying: me.flying, z: map.getZoom(), off: me.pos ? map.latLngToContainerPoint(me.pos).distanceTo(map.getSize().divideBy(2)) : null, pos: me.pos && [me.pos.lat, me.pos.lng], dots: document.querySelectorAll('.me').length,
      r: me.circle && me.circle.getRadius() }; });
    // Leaflet pans by whole pixels, so "centred" means within a pixel or so of the middle (about 3 m at zoom 15).
    const settled = () => page.waitForFunction(() => { const { me, map } = window.__waweye; return me.pos && !me.flying && map.latLngToContainerPoint(me.pos).distanceTo(map.getSize().divideBy(2)) < 1.5; });
    const moveTo = async (g) => { await ctx.setGeolocation(g); await page.waitForFunction((g) => { const p = window.__waweye.me.pos; return p && Math.abs(p.lat - g.latitude) < 1e-7 && Math.abs(p.lng - g.longitude) < 1e-7; }, g); };
    const drag = async () => {
      const c = { x: ctxOpts.viewport.width / 2, y: ctxOpts.viewport.height / 2 };
      await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.mouse.move(c.x + 120, c.y + 60, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(300);
    };
    await step(`${label}: locate button finds the user, zooms in on them and shows the blue dot`, async () => {
      await page.evaluate(() => { window.__waweye.map.setView([52.2297, 21.0122], 12, { animate: false }); });
      let s = await L_(); assert.equal(s.cls, 'locate'); assert.equal(s.dots, 0);
      assert.ok(await page.isVisible('#locate'));
      await ctx.grantPermissions(['geolocation']); await ctx.setGeolocation(ME);
      await page.click('#locate'); await settled();
      s = await L_();
      assert.ok(s.centered); assert.equal(s.cls, 'locate on'); assert.equal(s.z, 16); assert.ok(s.off < 1.5, 'centre off by px ' + s.off);
      assert.equal(s.dots, 1); assert.equal(s.r, 30, 'accuracy circle in metres');
      assert.equal(await page.locator('.leaflet-overlay-pane canvas').count(), 1, 'accuracy circle shares the vehicles canvas');
      await page.screenshot({ path: `${SHOTS}/waweye-${label}-location.png` });
    });
    await step(`${label}: map follows the user while centred; dragging stops it; the button centres again`, async () => {
      await moveTo({ ...ME, latitude: 52.2330, longitude: 21.0100 }); await settled();
      await drag();
      let s = await L_(); assert.ok(!s.centered); assert.equal(s.cls, 'locate found'); assert.equal(s.dots, 1);
      await moveTo({ ...ME, latitude: 52.2340, longitude: 21.0110 }); await page.waitForTimeout(400);
      s = await L_(); assert.ok(s.off > 50, 'map must not follow after a drag, off px ' + s.off);
      await page.click('#locate'); await settled();
      s = await L_(); assert.ok(s.centered); assert.equal(s.cls, 'locate on');
    });
    await step(`${label}: zooming while centred keeps the user in the middle`, async () => {
      const z0 = (await L_()).z;
      await page.mouse.move(ctxOpts.viewport.width / 2 + 100, ctxOpts.viewport.height / 2 + 120); await page.mouse.wheel(0, 300);
      await page.waitForFunction((z) => window.__waweye.map.getZoom() < z, z0); await page.waitForTimeout(400);
      const s = await L_(); assert.ok(s.centered); assert.ok(s.off < 1.5, 'centre off by px ' + s.off);
    });
    await step(`${label}: compass turns the heading beam, the short way round`, async () => {
      const turn = (alpha) => page.evaluate((alpha) => {
        window.dispatchEvent(new DeviceOrientationEvent('ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation', { alpha, beta: 0, gamma: 0, absolute: true }));
        return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r({ on: !!document.querySelector('.me.heading'), t: document.querySelector('.me-beam').style.transform }))));
      }, alpha);
      assert.ok(!(await page.evaluate(() => !!document.querySelector('.me.heading'))), 'no beam without a heading');
      assert.deepEqual(await turn(270), { on: true, t: 'rotate(90deg)' }); // alpha counts counter-clockwise: 270 = facing east
      assert.deepEqual(await turn(100), { on: true, t: 'rotate(260deg)' });
      assert.deepEqual(await turn(0), { on: true, t: 'rotate(360deg)' }, '260° -> 0° turns +100°, not -260°');
      assert.ok(await page.isVisible('.me-beam'));
    });
    await step(`${label}: vehicles under the location dot and accuracy circle stay clickable`, async () => {
      await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })); // freeze vehicles, as above
      try {
        await page.waitForTimeout(200);
        await page.waitForFunction(() => [...window.__waweye.state.markers.values()].every((m) => !m.to));
        const v = await page.evaluate(() => { const { map, state } = window.__waweye; const shown = [...state.markers.values()].filter((x) => map.hasLayer(x.mk));
          const px = (x) => map.latLngToContainerPoint(x.mk.getLatLng()); // pixel distances do not depend on where the map is centred
          const m = shown.find((x) => shown.every((o) => o === x || px(o).distanceTo(px(x)) > 24)); const p = m.mk.getLatLng(); return { lat: p.lat, lng: p.lng, id: m.v.id }; });
        await moveTo({ latitude: v.lat, longitude: v.lng, accuracy: 300 }); await settled(); await page.waitForTimeout(300);
        assert.equal((await L_()).r, 300);
        const pt = await page.evaluate((id) => { const { map, state } = window.__waweye; const p = map.latLngToContainerPoint(state.markers.get(id).mk.getLatLng()); const r = map.getContainer().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; }, v.id);
        await page.mouse.click(pt.x, pt.y); await page.waitForTimeout(100);
        assert.equal(await page.evaluate(() => window.__waweye.state.selected), v.id, 'vehicle under the blue dot not selectable');
        assert.ok(await page.evaluate(() => getComputedStyle(document.querySelector('.me-dot')).pointerEvents === 'none'));
        await page.evaluate(() => window.__waweye.deselect());
      } finally {
        await page.evaluate(() => { delete document.hidden; });
      }
    });
    await step(`${label}: locate button rises above an open panel instead of hiding under it`, async () => {
      const rects = () => page.evaluate(() => { const b = document.getElementById('locate').getBoundingClientRect(), p = document.getElementById('panel').getBoundingClientRect();
        return { overlap: b.left < p.right && b.right > p.left && b.top < p.bottom && b.bottom > p.top, lifted: document.getElementById('locate').style.bottom !== '' }; });
      await page.evaluate(() => { const { state, select } = window.__waweye; select([...state.markers.keys()][0]); });
      await page.waitForFunction(() => document.querySelectorAll('#p-fleet dt').length > 3); await page.waitForTimeout(400);
      let r = await rects(); assert.ok(!r.overlap, 'button covered by the panel'); assert.equal(r.lifted, label === 'mobile');
      await page.click('#close'); await page.waitForTimeout(400);
      r = await rects(); assert.ok(!r.lifted, 'button back in the corner');
    });
    await step(`${label}: the vehicle panel collapses to one bar (remembered), expands from the bar, and following collapses it on a phone`, async () => {
      const P = () => page.evaluate(() => { const p = document.getElementById('panel'), b = document.getElementById('locate').getBoundingClientRect(), r = p.getBoundingClientRect();
        return { min: p.classList.contains('min'), h: r.height, exp: document.getElementById('collapse').getAttribute('aria-expanded'),
          fleet: getComputedStyle(document.getElementById('p-fleet')).display !== 'none', pref: localStorage.getItem('waweye.panelMin'),
          overlap: b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top }; });
      const pickNth = (n) => page.evaluate((n) => { const { state, select } = window.__waweye; select([...state.markers.keys()][n]); }, n);
      await pickNth(0);
      await page.waitForFunction(() => document.querySelectorAll('#p-fleet dt').length > 3);
      let p = await P(); assert.ok(!p.min && p.fleet && p.exp === 'true', JSON.stringify(p)); const h0 = p.h;
      await page.click('#collapse'); await page.waitForTimeout(300);
      p = await P(); assert.ok(p.min && !p.fleet && p.exp === 'false' && p.pref === '1', JSON.stringify(p));
      assert.ok(p.h < 80 && p.h < h0 / 2, `collapsed height ${p.h} (expanded ${h0})`); assert.ok(!p.overlap, 'locate button covered by the bar');
      await page.screenshot({ path: `${SHOTS}/waweye-${label}-panel-zwiniety.png` });
      await pickNth(1); p = await P(); assert.ok(p.min, 'the choice carries over to the next vehicle');
      await page.click('#panel .meta'); await page.waitForTimeout(300);
      p = await P(); assert.ok(!p.min && p.fleet && p.pref === '0', JSON.stringify(p));
      await page.click('#follow'); p = await P(); assert.equal(p.min, label === 'mobile');
      assert.equal(p.pref, '0', 'collapsing for following is not remembered');
      await page.click('#follow'); await pickNth(2); p = await P(); assert.ok(!p.min);
      await page.click('#close');
    });
    await step(`${label}: following a vehicle and following the user exclude each other`, async () => {
      await page.evaluate(() => { const { state, select } = window.__waweye; select([...state.markers.keys()][0]); });
      await page.click('#follow');
      let s = await L_(); assert.ok(!s.centered); assert.equal(s.cls, 'locate found');
      await page.click('#locate'); await settled();
      s = await L_(); assert.ok(s.centered);
      assert.ok(!(await page.evaluate(() => window.__waweye.state.follow))); assert.ok(!(await page.getAttribute('#follow', 'class')).includes('on'));
      await page.click('#close');
      await drag(); assert.ok(!(await L_()).centered); // leave the map free for the next steps
    });
    await step(`${label}: parking button shows parkings, panel has free/total places`, async () => {
      await page.evaluate(() => { window.__waweye.map.setView([52.2297, 21.0122], 12, { animate: false }); });
      assert.equal(await page.locator('.pk').count(), 0);
      await page.click('#t-park'); await page.waitForSelector('.pk'); await page.waitForTimeout(300);
      assert.equal(await page.getAttribute('#t-park', 'aria-pressed'), 'true');
      assert.ok(await page.locator('#t-park svg.pico').count() === 1, 'parking icon');
      assert.ok((await page.locator('.pk').count()) >= 5);
      await page.evaluate(() => window.__waweye.selectPark(window.__waweye.state.parkings.find((p) => p.name.includes('Stadion')).id));
      const panel = await page.evaluate(() => ({ hidden: document.getElementById('ppanel').hidden, name: document.getElementById('pp-name').textContent,
        free: document.getElementById('pp-free').textContent, of: document.getElementById('pp-of').textContent, rows: document.getElementById('pp-rows').textContent }));
      assert.ok(!panel.hidden); assert.match(panel.name, /Stadion/);
      assert.equal(panel.free, '234'); assert.match(panel.of, /wolnych miejsc z 506/); // free 233+0+1, capacity 500+2+4
      assert.match(panel.rows, /Standardowe233 wolnych z 500/); assert.match(panel.rows, /Cennik/);
      await page.screenshot({ path: `${SHOTS}/waweye-${label}-parking.png` });
    });
    await step(`${label}: parking and vehicle panels are mutually exclusive`, async () => {
      await page.evaluate(() => { const { state, select } = window.__waweye; select([...state.markers.keys()][0]); });
      let s = await page.evaluate(() => ({ p: document.getElementById('ppanel').hidden, v: document.getElementById('panel').hidden }));
      assert.ok(s.p && !s.v);
      await page.evaluate(() => { const { state, selectPark } = window.__waweye; selectPark(state.parkings[0].id); });
      s = await page.evaluate(() => ({ p: document.getElementById('ppanel').hidden, v: document.getElementById('panel').hidden }));
      assert.ok(!s.p && s.v);
    });
    await step(`${label}: parking button off hides markers and panel`, async () => {
      await page.click('#t-park'); await page.waitForTimeout(200);
      assert.equal(await page.locator('.pk').count(), 0);
      assert.ok(await page.evaluate(() => document.getElementById('ppanel').hidden));
    });
    // ---- Zones: paid parking (WMS layer, on with the parkings) and the Clean Transport Zone (GeoJSON) ----
    const Z = () => page.evaluate(() => { const { zones } = window.__waweye; let prefs = null; try { prefs = JSON.parse(localStorage.getItem('waweye.strefy')); } catch {}
      return { sppn: zones.sppn, sct: zones.sct, sppnBox: document.getElementById('z-sppn').checked, sctBox: document.getElementById('z-sct').checked,
        btn: document.getElementById('zones-btn').classList.contains('on'), prefs, panel: !document.getElementById('zpanel').hidden }; });
    const menu = async (open) => { if ((await page.isHidden('#zmenu')) === open) await page.click('#zones-btn'); };
    await step(`${label}: the paid parking zone (SPPN) appears with the parkings and can be hidden`, async () => {
      assert.ok(!(await Z()).sppn, 'parking off hides the zone it showed');
      await page.click('#t-park'); await page.waitForSelector('.pk');
      let z = await Z(); assert.ok(z.sppn && z.sppnBox && z.btn);
      await page.waitForFunction(() => document.querySelectorAll('.leaflet-zones-pane img').length > 0);
      // The dashed outline is an SVG filter on the WMS tiles (edge of the city's own fill).
      assert.ok(await page.evaluate(() => getComputedStyle(document.querySelector('.leaflet-zones-pane img')).filter.includes('#sppn-edge')
        && !!document.querySelector('filter#sppn-edge feConvolveMatrix[edgeMode="duplicate"]')), 'SPPN tiles carry the outline filter');
      // Read the tile address from the page: tiles loaded in an earlier step come from the browser's memory cache
      // without a new request, so the routed requests may stay empty (failed CI twice).
      const q = new URL(await page.evaluate(() => document.querySelector('.leaflet-zones-pane img').src)).searchParams;
      assert.equal(q.get('request'), 'GetMap'); assert.equal(q.get('layers'), 'KOMUNIKACJA_STREFA_PLATNEGO_PARKOWANIA');
      assert.equal(q.get('crs'), 'EPSG:2178'); // the server has no EPSG:3857 and pads CRS:84 tiles
      const [s, w, n, e] = q.get('bbox').split(',').map(Number); // EPSG:2178 in WMS 1.3.0: northing, easting
      assert.ok(s > 5.7e6 && s < 5.9e6 && w > 7.4e6 && w < 7.6e6 && n > s && e > w, q.get('bbox'));
      assert.ok(Math.abs((n - s) / (e - w) - 1) < 0.01, 'a map tile is a square in EPSG:2178: ' + q.get('bbox'));
      await menu(true); await page.uncheck('#z-sppn');
      z = await Z(); assert.ok(!z.sppn && !z.btn); assert.equal(z.prefs.sppnHidden, true);
      assert.equal(await page.locator('.leaflet-zones-pane img').count(), 0);
      await page.click('#t-park'); await page.click('#t-park'); await page.waitForSelector('.pk');
      assert.ok(!(await Z()).sppn, 'a hidden zone stays hidden when the parkings come back');
      await menu(true); await page.check('#z-sppn');
      z = await Z(); assert.ok(z.sppn); assert.equal(z.prefs.sppnHidden, false);
      await page.click('#t-park'); await page.click('#t-park'); await page.waitForSelector('.pk');
      assert.ok((await Z()).sppn, 'shown again by default with the parkings');
      await page.screenshot({ path: `${SHOTS}/waweye-${label}-sppn.png` });
      await page.click('#t-park'); assert.ok(!(await Z()).sppn);
    });
    await step(`${label}: the Clean Transport Zone (SCT) is drawn under the vehicles, which stay clickable`, async () => {
      await page.evaluate(() => { window.__waweye.map.setView([52.2318, 21.0060], 13, { animate: false }); });
      await menu(true); await page.check('#z-sct');
      await page.waitForFunction(() => window.__waweye.zones.sctData);
      let z = await Z(); assert.ok(z.sct && z.btn); assert.equal(z.prefs.sct, true);
      const shape = await page.evaluate(() => { const { map, zones } = window.__waweye; let n = 0, inside = false;
        map.eachLayer((l) => { if (l instanceof L.Polygon && !l.options.interactive) { n++; inside = inside || l.getBounds().contains([52.2318, 21.0060]); } });
        return { n, inside, err: zones.sctError }; });
      assert.ok(shape.n >= 1 && shape.inside, JSON.stringify(shape)); assert.equal(shape.err, null);
      assert.equal(await page.locator('.leaflet-overlay-pane canvas').count(), 1, 'the zone shares the vehicles canvas');
      await page.screenshot({ path: `${SHOTS}/waweye-${label}-sct.png` });
      await page.click('#zones-btn'); // close the menu, it covers part of the map
      await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })); // freeze vehicles, as above
      try {
        await page.waitForTimeout(200);
        await page.waitForFunction(() => [...window.__waweye.state.markers.values()].every((m) => !m.to));
        const pts = await page.evaluate(() => { const { map, state } = window.__waweye; const r = map.getContainer().getBoundingClientRect(), sz = map.getSize();
          return [...state.markers.values()].filter((m) => map.hasLayer(m.mk)).map((m) => { const p = map.latLngToContainerPoint(m.mk.getLatLng()); return { x: r.left + p.x, y: r.top + p.y, cx: p.x, cy: p.y, id: m.v.id }; })
            .filter((p, _, all) => p.cy > 170 && p.cy < sz.y - 120 && p.cx > 40 && p.cx < sz.x - 80 && all.every((q) => q === p || Math.hypot(q.cx - p.cx, q.cy - p.cy) > 20)).slice(0, 3); });
        assert.ok(pts.length >= 2);
        for (const p of pts) {
          await page.mouse.click(p.x, p.y); await page.waitForTimeout(80);
          assert.equal(await page.evaluate(() => window.__waweye.state.selected), p.id, 'vehicle not selectable with the SCT on');
          await page.evaluate(() => window.__waweye.deselect());
        }
      } finally {
        await page.evaluate(() => { delete document.hidden; });
      }
    });
    await step(`${label}: zone rules panels open from the menu and exclude the other panels`, async () => {
      const hidden = () => page.evaluate(() => ['panel', 'ppanel', 'ipanel', 'zpanel'].map((id) => document.getElementById(id).hidden));
      await menu(true); await page.click('.z-info[data-zone="sct"]');
      assert.ok(await page.isHidden('#zmenu'), 'the menu closes');
      assert.deepEqual(await hidden(), [true, true, true, false]);
      const t = await page.textContent('#zpanel');
      for (const x of ['Strefa Czystego Transportu', 'Euro 5', 'OpenStreetMap']) assert.ok(t.includes(x), 'missing ' + x);
      assert.match(await page.getAttribute('#zp-link', 'href'), /^https:\/\/transport\.um\.warszawa\.pl\//);
      await page.screenshot({ path: `${SHOTS}/waweye-${label}-sct-zasady.png` });
      await menu(true); await page.click('.z-info[data-zone="sppn"]');
      assert.match(await page.textContent('#zpanel'), /Płatnego Parkowania[\s\S]*8:00–20:00[\s\S]*4,50 zł/);
      assert.match(await page.getAttribute('#zp-link', 'href'), /^https:\/\/zdm\.waw\.pl\//);
      await page.evaluate(() => { const { state, select } = window.__waweye; select([...state.markers.keys()][0]); });
      assert.deepEqual(await hidden(), [false, true, true, true]);
      await page.evaluate(() => window.__waweye.openZone('sppn'));
      assert.deepEqual(await hidden(), [true, true, true, false]);
      await page.click('#zclose'); assert.deepEqual(await hidden(), [true, true, true, true]);
      await menu(true); await page.uncheck('#z-sct');
      const z = await Z(); assert.ok(!z.sct && !z.btn); assert.equal(z.prefs.sct, false);
      await page.click('#zones-btn'); assert.ok(await page.isHidden('#zmenu'));
    });
    await step(`${label}: metro M1/M2 comes with the trams, stations open a panel, own chip hides it`, async () => {
      const M = () => page.evaluate(() => { const { map, metro } = window.__waweye; let lines = [], prefs = null;
        map.eachLayer((l) => { if (l instanceof L.Polyline && !(l instanceof L.Polygon) && !l.options.interactive && /Metro/.test(l.options.attribution || '')) lines.push(l.options.color); });
        try { prefs = JSON.parse(localStorage.getItem('waweye.metro')); } catch {}
        return { on: metro.on, err: metro.error, lines, stations: metro.stations.filter((s) => map.hasLayer(s.mk)).length, prefs,
          chip: document.getElementById('t-metro').getAttribute('aria-pressed'), panel: !document.getElementById('mpanel').hidden }; });
      await page.waitForFunction(() => window.__waweye.metro.stations.length > 0);
      let m = await M();
      assert.ok(m.on && m.chip === 'true', 'on by default with the trams'); assert.equal(m.err, null);
      assert.deepEqual(m.lines.sort(), ['#0071BC', '#C60C30']); assert.equal(m.stations, 38);
      assert.equal(await page.locator('.leaflet-overlay-pane canvas').count(), 1, 'metro shares the vehicles canvas');
      assert.match(await page.textContent('.leaflet-control-attribution'), /Metro: © współtwórcy OpenStreetMap/);
      // Hide the vehicles (line filter) so the click lands on the station, not on a tram or bus parked on top of it.
      await page.fill('#search', 'zzz');
      await page.evaluate(() => { window.__waweye.map.setView([52.2351, 21.0079], 15, { animate: false }); });
      await page.waitForTimeout(200);
      const pt = await page.evaluate(() => { const { map, metro } = window.__waweye; const st = metro.stations.find((s) => s.name === 'Świętokrzyska');
        const r = map.getContainer().getBoundingClientRect(), p = map.latLngToContainerPoint(st.mk.getLatLng()); return { x: r.left + p.x, y: r.top + p.y }; });
      await page.mouse.click(pt.x, pt.y); await page.waitForTimeout(100);
      m = await M(); assert.ok(m.panel, 'station panel opens');
      assert.equal(await page.textContent('#mp-name'), 'Świętokrzyska');
      assert.deepEqual(await page.$$eval('#mp-badges .m-badge', (b) => b.map((x) => x.textContent)), ['M1', 'M2']);
      const t = await page.textContent('#mpanel');
      for (const x of ['przesiadka', 'Kabaty', 'Bemowo', 'OpenStreetMap']) assert.ok(t.includes(x), 'missing ' + x);
      await page.screenshot({ path: `${SHOTS}/waweye-${label}-metro.png` });
      await page.evaluate(() => { const { state, select } = window.__waweye; select([...state.markers.keys()][0]); });
      assert.ok(!(await M()).panel, 'selecting a vehicle closes the station panel');
      await page.evaluate(() => { window.__waweye.deselect(); window.__waweye.openStation('Centrum'); });
      assert.equal(await page.textContent('#mp-name'), 'Centrum');
      await page.click('#mclose'); assert.ok(!(await M()).panel);
      await page.fill('#search', '');
      await page.click('#t-tram'); m = await M();
      assert.ok(!m.on && m.chip === 'false' && m.stations === 0 && m.lines.length === 0, 'hidden with the trams');
      await page.click('#t-tram'); m = await M(); assert.ok(m.on && m.stations === 38, 'back with the trams');
      await page.click('#t-metro'); m = await M();
      assert.ok(!m.on && m.stations === 0); assert.deepEqual(m.prefs, { hidden: true });
      await page.click('#t-tram'); await page.click('#t-tram'); m = await M();
      assert.ok(!m.on, 'stays hidden when the trams come back');
      await page.click('#t-metro'); m = await M();
      assert.ok(m.on && m.stations === 38); assert.deepEqual(m.prefs, { hidden: false });
      await page.evaluate(() => { window.__waweye.map.setView([52.2297, 21.0122], 13, { animate: false }); });
    });
    await step(`${label}: incidents button draws points and lines, panel shows details`, async () => {
      await page.evaluate(() => { window.__waweye.map.setView([52.2297, 21.0122], 13, { animate: false }); });
      assert.equal(await page.locator('.ic').count(), 0);
      await page.click('#t-inc'); await page.waitForSelector('.ic'); await page.waitForTimeout(300);
      assert.equal(await page.getAttribute('#t-inc', 'aria-pressed'), 'true');
      assert.ok(await page.locator('#t-inc svg.pico').count() === 1, 'warning icon');
      assert.equal(await page.locator('.ic').count(), 4);
      assert.equal(await page.locator('.ic.planned').count(), 1); assert.equal(await page.locator('.ic.ended').count(), 1);
      assert.equal(await page.evaluate(() => [...window.__waweye.state.incLayers.values()].reduce((n, g) => { g.eachLayer((l) => { if (l instanceof L.Polyline) n++; }); return n; }, 0)), 1, 'one polyline');
      await page.evaluate(() => { window.__waweye.map.panBy([0, -200], { animate: false }); }); // keep the marker clear of the (wrapped) top bar
      await page.click('.ic.planned');
      const panel = await page.evaluate(() => ({ hidden: document.getElementById('ipanel').hidden, name: document.getElementById('ip-name').textContent,
        status: document.getElementById('ip-status').textContent, link: document.getElementById('ip-link').href, linkHidden: document.getElementById('ip-link').hidden,
        body: document.getElementById('ip-body').textContent, when: document.getElementById('ip-when').textContent }));
      assert.ok(!panel.hidden); assert.match(panel.name, /Targowej/); assert.equal(panel.status, 'Zaplanowane');
      assert.equal(panel.link, 'https://infoulice.um.warszawa.pl/?page_id=8150'); assert.ok(!panel.linkHidden); assert.match(panel.body, /przyszłego tygodnia/);
      await page.screenshot({ path: `${SHOTS}/waweye-${label}-incidents.png` });
    });
    await step(`${label}: vehicles stay clickable while the incidents layer is on`, async () => {
      await page.evaluate(() => { const { map } = window.__waweye; map.setView([52.2297, 21.0122], 13, { animate: false }); });
      await page.waitForTimeout(500);
      // Freeze the data while clicking (polling pauses in a hidden tab): a poll in between would animate vehicles away
      // from the computed points and the click would miss (14 of 300 clicks in a probe, failed CI on main).
      await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }));
      try {
        await page.waitForTimeout(200); // a request already in flight may still land
        await page.waitForFunction(() => [...window.__waweye.state.markers.values()].every((m) => !m.to));
        const pts = await page.evaluate(() => { const { map, state } = window.__waweye; const r = map.getContainer().getBoundingClientRect(); const sz = map.getSize();
          return [...state.markers.values()].filter((m) => map.getBounds().contains(m.mk.getLatLng())).map((m) => { const p = map.latLngToContainerPoint(m.mk.getLatLng());
            return { x: r.left + p.x, y: r.top + p.y, cy: p.y, cx: p.x, id: m.v.id, w: sz.x, h: sz.y }; }).filter((p, _, all) => p.cy > 160 && p.cy < p.h - 120 && p.cx > 40 && p.cx < p.w - 80 && all.every((q) => q === p || Math.hypot(q.cx - p.cx, q.cy - p.cy) > 20)
              // Only points where the click reaches the map canvas: the bar (taller on phones with more layer buttons),
              // an incident icon or a panel may cover a vehicle, and a click there cannot select it.
              && document.elementFromPoint(p.x, p.y) instanceof HTMLCanvasElement).slice(0, 6); });
        assert.ok(pts.length >= 3);
        for (const p of pts) {
          await page.mouse.click(p.x, p.y); await page.waitForTimeout(80);
          assert.equal(await page.evaluate(() => window.__waweye.state.selected), p.id, 'vehicle not selectable with incidents on');
          await page.evaluate(() => window.__waweye.deselect());
        }
      } finally {
        await page.evaluate(() => { delete document.hidden; });
      }
      assert.equal(await page.locator('.leaflet-overlay-pane canvas').count(), 1, 'single canvas');
    });
    await step(`${label}: incident panel is mutually exclusive with vehicle and parking panels`, async () => {
      const hidden = () => page.evaluate(() => ['panel', 'ppanel', 'ipanel'].map((id) => document.getElementById(id).hidden));
      await page.evaluate(() => { const { state, select } = window.__waweye; select([...state.markers.keys()][0]); });
      assert.deepEqual(await hidden(), [false, true, true]);
      await page.evaluate(() => { const { state, selectInc } = window.__waweye; selectInc(state.incidents[0].id); });
      assert.deepEqual(await hidden(), [true, true, false]);
      await page.click('#t-park'); await page.waitForSelector('.pk');
      await page.evaluate(() => { const { state, selectPark } = window.__waweye; selectPark(state.parkings[0].id); });
      assert.deepEqual(await hidden(), [true, false, true]);
      await page.click('#t-park');
    });
    await step(`${label}: incidents button off hides layer and panel`, async () => {
      await page.evaluate(() => { const { state, selectInc } = window.__waweye; selectInc(state.incidents[0].id); });
      await page.click('#t-inc'); await page.waitForTimeout(200);
      assert.equal(await page.locator('.ic').count(), 0);
      assert.ok(await page.evaluate(() => document.getElementById('ipanel').hidden));
    });
    await step(`${label}: Sport button shows classes for today, also ones placed from an address`, async () => {
      await page.evaluate(() => { window.__waweye.map.setView([52.2500, 21.0358], 13, { animate: false }); });
      assert.equal(await page.isVisible('#sfilter'), false);
      await page.click('#t-sport');
      await page.waitForFunction(() => window.__waweye.state.sportMarkers.size > 0);
      assert.equal(await page.getAttribute('#t-sport', 'aria-pressed'), 'true');
      assert.equal(await page.isVisible('#sfilter'), true);
      assert.ok(await page.evaluate(() => window.__waweye.state.sportItems.some((i) => i.located === 'address')));
      assert.match(await page.textContent('#status-text'), /sport: 7 dziś/);
    });
    await step(`${label}: sport marker opens a panel with the classes there; panels exclude each other`, async () => {
      const first = [...(await page.evaluate(() => [...window.__waweye.state.markers.keys()]))][0];
      await page.locator('.sp', { hasText: '2' }).click();
      assert.equal(await page.isVisible('#spanel'), true);
      assert.equal(await page.textContent('#sp-name'), 'ul. Jagiellońska 7');
      assert.match(await page.textContent('#sp-addr'), /Praga-Północ · 2 zajęcia dziś/);
      assert.deepEqual(await page.$$eval('#sp-list .s-title', (els) => els.map((e) => e.textContent)), ['Taneczne piątki dla seniorów', 'Zdrowy kręgosłup']);
      assert.match(await page.textContent('#sp-list .s-when'), /^Dziś, 10:00 · co tydzień$/);
      const href = await page.getAttribute('#sp-list a', 'href');
      assert.match(href, /^https:\/\/sport\.um\.warszawa\.pl\//);
      assert.equal(await page.locator('.sp.sel').count(), 1);
      await page.evaluate((id) => window.__waweye.select(id), first);
      assert.equal(await page.isVisible('#spanel'), false); assert.equal(await page.locator('.sp.sel').count(), 0);
      await page.evaluate(() => window.__waweye.selectSport([...window.__waweye.state.sportMarkers.keys()][0]));
      assert.equal(await page.isVisible('#panel'), false); assert.equal(await page.isVisible('#spanel'), true);
      await page.click('#sclose');
      assert.equal(await page.isVisible('#spanel'), false);
    });
    await step(`${label}: Dziś / Jutro / 7 dni filter changes which classes count`, async () => {
      const total = () => page.evaluate(() => [...window.__waweye.state.sportMarkers.values()].reduce((k, m) => k + m.place.entries.length, 0));
      assert.equal(await total(), 7);
      await page.click('#sfilter [data-range="tomorrow"]');
      assert.equal(await total(), 6); // the dated run is today and in 3 days only
      assert.equal(await page.getAttribute('#sfilter [data-range="tomorrow"]', 'aria-pressed'), 'true');
      assert.match(await page.textContent('#status-text'), /sport: 6 jutro/);
      await page.click('#sfilter [data-range="week"]');
      assert.equal(await total(), 7);
      const run = await page.evaluate(() => { const m = [...window.__waweye.state.sportMarkers.values()].find((x) => x.place.entries.some((e) => e.it.title.startsWith('Bieg'))); window.__waweye.selectSport(m.place.id); return document.querySelector('#sp-list .s-when').textContent; });
      assert.match(run, /^Dziś, 08:00 \(\+1 termin\)$/);
      await page.screenshot({ path: `${SHOTS}/waweye-${label}-sport.png` });
      await page.click('#sfilter [data-range="today"]');
    });
    await step(`${label}: DziejeSię shows today's events; one event in two places has a marker in each`, async () => {
      await page.evaluate(() => { window.__waweye.map.setView([52.235, 21.02], 13, { animate: false }); });
      await page.click('#t-events');
      await page.waitForFunction(() => window.__waweye.state.eventMarkers.size > 0);
      assert.equal(await page.getAttribute('#t-events', 'aria-pressed'), 'true');
      const titles = await page.evaluate(() => [...window.__waweye.state.eventMarkers.values()].map((m) => m.place.entries.map((e) => e.it.title)));
      assert.equal(titles.filter((t) => t.includes('Festiwal na dwóch scenach')).length, 2);
      assert.ok(titles.flat().includes('Koncert w SP 218')); // placed from its address
      assert.ok(!titles.flat().includes('Niepodległościowy Bal Kostiumowy')); // in 3 days
      assert.match(await page.textContent('#status-text'), /DziejeSię: 4 dziś/);
    });
    await step(`${label}: event panel: term, organizer, "także w"; it excludes the sport panel`, async () => {
      await page.evaluate(() => { const s = window.__waweye.state; window.__waweye.selectSport([...s.sportMarkers.keys()][0]); });
      await page.evaluate(() => { const s = window.__waweye.state; window.__waweye.selectEvent([...s.eventMarkers.values()].find((m) => m.place.entries.some((e) => e.it.title.startsWith('Festiwal'))).place.id); });
      assert.equal(await page.isVisible('#epanel'), true); assert.equal(await page.isVisible('#spanel'), false);
      assert.equal(await page.textContent('#ep-list .s-title'), 'Festiwal na dwóch scenach');
      const desc = await page.$$eval('#ep-list .s-desc', (els) => els.map((e) => e.textContent));
      assert.ok(desc.includes('Organizator: Teatr Syrena')); assert.ok(desc.some((d) => /^Także w: ul\. (Litewska 3|Targowa 56)$/.test(d)));
      assert.match(await page.getAttribute('#ep-list a', 'href'), /^https:\/\/um\.warszawa\.pl\//);
      await page.evaluate(() => { const s = window.__waweye.state; window.__waweye.selectEvent([...s.eventMarkers.values()].find((m) => m.place.entries.some((e) => e.it.title.startsWith('Oskarżony'))).place.id); });
      assert.equal(await page.textContent('#ep-list .s-when'), 'Dziś, 19:00–21:00'); // tomorrow's show is outside "Dziś"
      await page.click('#eclose'); assert.equal(await page.isVisible('#epanel'), false);
    });
    await step(`${label}: one "Kiedy" row drives both layers; it stays while either layer is on`, async () => {
      const count = () => page.evaluate(() => new Set([...window.__waweye.state.eventMarkers.values()].flatMap((m) => m.place.entries.map((e) => e.it.title))).size);
      await page.click('#sfilter [data-range="week"]');
      assert.equal(await count(), 5); // + the ball in 3 days
      const wystawa = await page.evaluate(() => { const s = window.__waweye.state; window.__waweye.selectEvent([...s.eventMarkers.values()].find((m) => m.place.entries.some((e) => e.it.title.startsWith('Wystawa'))).place.id); return document.querySelector('#ep-list .s-when').textContent; });
      assert.match(wystawa, /^do \d{1,2} [a-zżźćńółęąś]+\.?$/);
      await page.click('#sfilter [data-range="tomorrow"]');
      assert.equal(await count(), 2); // the play's second night and the running exhibition
      assert.match(await page.textContent('#status-text'), /sport: 6 jutro · DziejeSię: 2 jutro/);
      await page.click('#sfilter [data-range="today"]');
      await page.click('#t-sport'); assert.equal(await page.isVisible('#sfilter'), true); // DziejeSię still on
      await page.click('#t-events'); assert.equal(await page.isVisible('#sfilter'), false);
      assert.equal(await page.locator('.ev').count(), 0);
      await page.click('#t-sport');
    });
    await step(`${label}: the search box filters sport, events and incidents by words, ignoring case and Polish letters`, async () => {
      await page.click('#t-events'); await page.waitForFunction(() => window.__waweye.state.eventMarkers.size > 0);
      await page.click('#t-inc'); await page.waitForFunction(() => window.__waweye.state.incLayers.size > 0);
      const C = () => page.evaluate(() => { const { state, map } = window.__waweye;
        return { sport: [...state.sportMarkers.values()].flatMap((m) => m.place.entries.map((e) => e.it.title)).sort(),
          events: [...new Set([...state.eventMarkers.values()].flatMap((m) => m.place.entries.map((e) => e.it.title)))], eventMarkers: state.eventMarkers.size,
          inc: state.incidents.filter((i) => state.incLayers.has(i.id)).map((i) => i.name),
          vehicles: [...state.markers.values()].filter((m) => map.hasLayer(m.mk)).length, status: document.getElementById('status-text').textContent }; });
      const all = await C();
      await page.fill('#search', 'SENIOROW'); let c = await C();
      assert.deepEqual(c.sport, ['Taneczne piątki dla seniorów', 'Tenisowe środy dla Seniorów']);
      assert.deepEqual(c.events, []); assert.deepEqual(c.inc, []); assert.equal(c.vehicles, 0);
      assert.match(c.status, /^0 pojazdów .*sport: 2 dziś · DziejeSię: 0 dziś/);
      await page.fill('#search', 'litewska festiwal'); c = await C(); // every word, anywhere in the text (here: title and address)
      assert.deepEqual(c.events, ['Festiwal na dwóch scenach']); assert.equal(c.eventMarkers, 2, 'both places of the festival stay');
      assert.deepEqual(c.sport, []);
      await page.fill('#search', 'marszalkowskiej'); c = await C();
      assert.deepEqual(c.inc, ['Remont ulicy Marszałkowskiej']);
      await page.fill('#search', '175'); c = await C();
      assert.ok(c.vehicles > 0, 'a line number still filters the vehicles');
      await page.fill('#search', ''); c = await C();
      assert.deepEqual([c.sport, c.events, c.eventMarkers, c.inc], [all.sport, all.events, all.eventMarkers, all.inc]);
      await page.click('#t-events'); await page.click('#t-inc');
    });
    await step(`${label}: Sport button off hides markers, panel and filter`, async () => {
      await page.click('#t-sport');
      assert.equal(await page.locator('.sp').count(), 0);
      assert.equal(await page.isVisible('#spanel'), false); assert.equal(await page.isVisible('#sfilter'), false);
      assert.doesNotMatch(await page.textContent('#status-text'), /sport/);
    });
    await step(`${label}: status count always matches the visible vehicles, also after a layer error`, async () => {
      await page.route('**/api/incidents', (route) => route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"HTTP 400 (bad type)"}' }));
      await page.click('#t-inc');
      await page.waitForFunction(() => /utrudnienia: brak danych/.test(document.getElementById('status-text').textContent));
      const r = await page.evaluate(() => ({ text: document.getElementById('status-text').textContent,
        shown: [...window.__waweye.state.markers.values()].filter((m) => window.__waweye.map.hasLayer(m.mk)).length }));
      assert.ok(r.shown > 50); assert.ok(r.text.startsWith(`${r.shown} pojazdów`), r.text + ' vs ' + r.shown);
      await page.click('#t-inc'); await page.unroute('**/api/incidents');
    });
    await step(`${label}: hidden tab does not poll, showing it again polls at once`, async () => {
      const urls = [], onReq = (r) => { if (r.url().includes('/api/')) urls.push(r.url()); };
      await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }));
      await page.waitForTimeout(100); // let any request issued before hiding be reported first
      page.on('request', onReq);
      await page.evaluate(() => window.__waweye.poll());
      await page.waitForTimeout(300);
      page.off('request', onReq);
      assert.deepEqual(urls, []);
      const shown = page.waitForRequest((r) => r.url().includes('/api/vehicles'), { timeout: 3000 });
      await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
      await shown;
    });
    await step(`${label}: no horizontal overflow`, async () => {
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    });
    await step(`${label}: no JS errors`, async () => assert.deepEqual(errors, []));
    await page.screenshot({ path: `${SHOTS}/waweye-${label}.png` });

    await step(`${label}: the wawEye logo opens the "O serwisie" page`, async () => {
      await page.click('#bar .brand');
      await page.waitForURL(/\/o-serwisie$/);
      assert.match(await page.title(), /O serwisie/);
      assert.match(await page.textContent('h1'), /na żywo/);
      assert.match(await page.textContent('#prasa'), /Andrzej Pacek/);
    });
    await step(`${label}: "O serwisie": video waits for a click, media files load, no horizontal overflow`, async () => {
      const v = await page.evaluate(() => { const el = document.querySelector('video'); return { preload: el.preload, autoplay: el.autoplay, poster: el.poster, src: el.querySelector('source').src }; });
      assert.equal(v.preload, 'none'); assert.equal(v.autoplay, false);
      for (const src of [v.poster, v.src, ...await page.$$eval('img', (els) => els.map((i) => i.src))]) {
        const r = await page.request.get(src);
        assert.equal(r.status(), 200, src);
      }
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await page.waitForTimeout(300);
      assert.ok(await page.$$eval('img', (els) => els.every((i) => i.complete && i.naturalWidth > 0)), 'screenshots render');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      await page.screenshot({ path: `${SHOTS}/waweye-o-serwisie-${label}.png`, fullPage: true });
    });
    await step(`${label}: "Mapa" goes back to the map`, async () => {
      await page.click('.top .back');
      await page.waitForFunction(() => window.__waweye && window.__waweye.state.markers.size > 50);
      assert.deepEqual(errors, []);
    });
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
  const pctx = await browser.newContext(); await wmsTiles(pctx);
  const pg = await pctx.newPage();
  await pg.route('**/api/parking', (route) => route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"HTTP 403 (forbidden)"}' }));
  await pg.route('**/data/metro.geojson', (route) => route.fulfill({ status: 404, body: 'Not found' }));
  await pg.goto(`http://localhost:${half.address().port}/`);
  await step('parking API failure is reported, vehicles stay visible', async () => {
    await pg.waitForFunction(() => window.__waweye.state.markers.size > 50);
    await pg.click('#t-park');
    await pg.waitForFunction(() => /parkingi: brak danych/.test(document.getElementById('status-text').textContent));
    assert.ok(await pg.evaluate(() => window.__waweye.state.markers.size > 50));
  });
  await pg.route('**/api/incidents', (route) => route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"HTTP 403 (forbidden)"}' }));
  await step('sport API failure is reported and retried a minute later', async () => {
    let fail = true;
    await pg.route('**/api/sport', (route) => (fail ? route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"HTTP 522"}' }) : route.continue()));
    await pg.evaluate(() => { window.__sportTimers = []; const st = window.setTimeout; window.setTimeout = (f, ms, ...a) => { if (ms === 60000) window.__sportTimers.push(f); return st(f, ms, ...a); }; });
    await pg.click('#t-sport');
    await pg.waitForFunction(() => /sport: brak danych \(HTTP 522\)/.test(document.getElementById('status-text').textContent));
    fail = false;
    await pg.evaluate(() => window.__sportTimers.pop()());
    await pg.waitForFunction(() => window.__waweye.state.sportMarkers.size > 0 && !/sport: brak danych/.test(document.getElementById('status-text').textContent));
    await pg.click('#t-sport');
  });
  await step('incidents API failure is reported, vehicles stay visible', async () => {
    await pg.click('#t-inc');
    await pg.waitForFunction(() => /utrudnienia: brak danych/.test(document.getElementById('status-text').textContent));
    assert.ok(await pg.evaluate(() => window.__waweye.state.markers.size > 50));
  });

  await step('metro data failure is reported, vehicles stay visible', async () => {
    await pg.waitForFunction(() => /metro: brak danych \(HTTP 404\)/.test(document.getElementById('status-text').textContent));
    assert.ok(await pg.evaluate(() => window.__waweye.state.markers.size > 50));
  });
  await pg.route('**/data/strefa-czystego-transportu.geojson', (route) => route.fulfill({ status: 404, body: 'Not found' }));
  await step('SCT data failure is reported, vehicles stay visible', async () => {
    await pg.click('#zones-btn'); await pg.check('#z-sct');
    await pg.waitForFunction(() => /strefa czystego transportu: brak danych \(HTTP 404\)/.test(document.getElementById('status-text').textContent));
    assert.ok(await pg.evaluate(() => window.__waweye.state.markers.size > 50));
  });

  // My location: refused permission, a position outside Warsaw, permission given on an earlier visit.
  const lerrors = [];
  const lctx = await browser.newContext();
  const lp = await lctx.newPage();
  lp.on('pageerror', (e) => lerrors.push(e.message));
  await lp.goto(url);
  await step('location: refused permission shows a message and a crossed-out button', async () => {
    await lp.waitForFunction(() => window.__waweye.state.markers.size > 50);
    // As if the user had clicked "Block" (Playwright has no API for refusing a permission prompt).
    const cdp = await lctx.newCDPSession(lp), { targetInfo } = await cdp.send('Target.getTargetInfo');
    await cdp.send('Browser.setPermission', { permission: { name: 'geolocation' }, setting: 'denied', origin: new URL(url).origin, browserContextId: targetInfo.browserContextId });
    await lp.click('#locate');
    await lp.waitForSelector('#toast:not([hidden])');
    assert.match(await lp.textContent('#toast'), /Brak dostępu do lokalizacji/);
    assert.equal(await lp.getAttribute('#locate', 'class'), 'locate off');
    assert.equal(await lp.locator('.me').count(), 0);
  });
  await step('location outside Warsaw: the map goes there and says vehicles are only in Warsaw', async () => {
    await lctx.grantPermissions(['geolocation'], { origin: new URL(url).origin }); await lctx.setGeolocation({ latitude: 50.0614, longitude: 19.9366, accuracy: 20 }); // Kraków
    await lp.click('#locate');
    await lp.waitForFunction(() => { const { me, map } = window.__waweye; return me.centered && !me.flying && map.distance(map.getCenter(), me.pos) < 2; });
    assert.match(await lp.textContent('#toast'), /poza Warszawą/);
    assert.equal(await lp.getAttribute('#locate', 'class'), 'locate on');
  });
  const gctx = await browser.newContext({ permissions: ['geolocation'], geolocation: { latitude: 52.2318, longitude: 21.0060, accuracy: 30 } });
  const gp = await gctx.newPage();
  gp.on('pageerror', (e) => lerrors.push(e.message));
  await gp.goto(url);
  await step('location permission given earlier: the dot appears on load and the map stays put', async () => {
    await gp.waitForSelector('.me');
    const s = await gp.evaluate(() => { const { map, me } = window.__waweye; const c = map.getCenter(); return { z: map.getZoom(), lat: c.lat, lng: c.lng, cls: document.getElementById('locate').className, centered: me.centered }; });
    assert.equal(s.z, 12); assert.ok(!s.centered); assert.equal(s.cls, 'locate found');
    assert.ok(Math.abs(s.lat - 52.2297) < 1e-6 && Math.abs(s.lng - 21.0122) < 1e-6, 'map moved on load');
  });
  await step('location: no JS errors', async () => assert.deepEqual(lerrors, []));
  await browser.close(); server.close(); bad.close(); half.close();
  console.log(`\n${results.length} checks passed`);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
