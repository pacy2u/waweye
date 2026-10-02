'use strict';
// Podgląd wybranych klatek: node wideo-promocyjne/podglad.js <katalog> 0.5 2.1 6.4 ...  → <katalog>/klatka-<t>.png
const fs = require('fs');
const path = require('path');
const { serve, openComposition, launch } = require('./wspolne');

(async () => {
  const [out, ...times] = process.argv.slice(2);
  fs.mkdirSync(out, { recursive: true });
  const { server, url } = await serve();
  const browser = await launch();
  const page = await openComposition(browser, url);
  for (const t of times) {
    const t0 = Date.now();
    await page.evaluate((t) => window.seek(t), parseFloat(t));
    await page.screenshot({ path: path.join(out, `klatka-${t}.png`) });
    console.log(t, Date.now() - t0, 'ms');
  }
  await browser.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
