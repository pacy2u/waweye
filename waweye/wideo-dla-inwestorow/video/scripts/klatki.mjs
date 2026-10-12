// Renders stills (and their "ghost" twins for the contrast check) from one bundle.
// node scripts/klatki.mjs <out-dir> <frame> [frame...]   (GHOST=1 also renders ghost twins, SCALE=0.5 for 960 px)
import path from 'node:path';
import fs from 'node:fs';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition, openBrowser } from '@remotion/renderer';

const [out, ...frames] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const serveUrl = await bundle({ entryPoint: path.resolve('src/index.ts') });
const browserExecutable = process.env.REMOTION_CHROME ?? '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const puppeteerInstance = await openBrowser('chrome', { browserExecutable });
const scale = Number(process.env.SCALE ?? 1);
for (const ghost of process.env.GHOST ? [false, true] : [false]) {
  const inputProps = { ghost };
  const composition = await selectComposition({ serveUrl, id: 'Film', inputProps, puppeteerInstance });
  for (const f of frames.map(Number)) {
    const file = path.join(out, `${ghost ? 'ghost-' : ''}${String(f).padStart(3, '0')}.png`);
    await renderStill({ serveUrl, composition, frame: f, output: file, inputProps, puppeteerInstance, scale, overwrite: true });
    console.log(file);
  }
}
await puppeteerInstance.close({ silent: true });
