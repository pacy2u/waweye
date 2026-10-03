'use strict';
// Renderuje kompozycję klatka po klatce do MP4 (H.264 + AAC).
// Uruchom: node wideo-promocyjne/renderuj.js [wyjście.mp4]
//   WORKERS=4  równoległe karty przeglądarki      FPS=60
//   SUB=4      podklatki na klatkę (rozmycie ruchu, migawka 180°; 1 = bez rozmycia)
//   FROM/TO    zakres w sekundach (do testów)    CRF=18  GRAIN=3 (siła ziarna, 0 = bez)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { serve, openComposition, launch } = require('./wspolne');

const FPS = +process.env.FPS || 60, SUB = +process.env.SUB || 4, SHUTTER = 0.5;
const CRF = process.env.CRF || '18', GRAIN = process.env.GRAIN || '3'; // grain also dithers the dark gradients against banding
const WORKERS = +process.env.WORKERS || Math.max(1, os.cpus().length - 1);
const OUT = path.resolve(process.argv[2] || path.join(__dirname, 'waweye-showreel.mp4'));
const AUDIO = path.join(__dirname, 'zasoby', 'muzyka.wav');
const TMP = fs.mkdtempSync(path.join(process.env.RENDER_TMP || os.tmpdir(), 'waweye-render-'));

function ffmpegSegment(file) {
  const vf = SUB > 1 ? `tmix=frames=${SUB},select='not(mod(n+1\\,${SUB}))',setpts=N/(${FPS}*TB)` : 'null';
  const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS * SUB), '-i', '-',
    '-vf', vf, '-r', String(FPS), '-c:v', 'libx264', '-preset', 'veryfast', '-qp', '4', '-pix_fmt', 'yuv444p', file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => p.on('close', (c) => (c ? rej(new Error('ffmpeg ' + c)) : res())));
  return { stdin: p.stdin, done };
}
const write = (s, buf) => new Promise((r) => (s.write(buf) ? r() : s.once('drain', r)));

(async () => {
  const { server, url } = await serve();
  const browser = await launch();
  const probe = await openComposition(browser, url);
  const DUR = await probe.evaluate(() => window.DUR);
  await probe.close();
  const f0 = Math.round((+process.env.FROM || 0) * FPS), f1 = Math.round((process.env.TO != null ? +process.env.TO : DUR) * FPS);
  const total = f1 - f0, per = Math.ceil(total / WORKERS), started = Date.now();
  let doneFrames = 0;
  console.log(`render ${total} klatek (${f0}–${f1}), ${FPS} fps × ${SUB} podklatek, ${WORKERS} wątków → ${OUT}`);

  const segs = await Promise.all(Array.from({ length: WORKERS }, async (_, w) => {
    const a = f0 + w * per, b = Math.min(f1, a + per); if (a >= b) return null;
    const page = await openComposition(browser, url);
    const cdp = await page.context().newCDPSession(page);
    const file = path.join(TMP, `seg-${String(w).padStart(2, '0')}.mkv`), ff = ffmpegSegment(file);
    for (let f = a; f < b; f++) {
      for (let j = 0; j < SUB; j++) {
        const off = SUB > 1 ? ((j + 0.5) / SUB - 0.5) * SHUTTER / FPS : 0;
        await page.evaluate((t) => window.seek(t), Math.max(0, f / FPS + off));
        const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
        await write(ff.stdin, Buffer.from(data, 'base64'));
      }
      if (++doneFrames % 60 === 0) { const s = (Date.now() - started) / 1000; console.log(`${doneFrames}/${total} klatek, ${s.toFixed(0)} s, ~${(s / doneFrames * (total - doneFrames)).toFixed(0)} s do końca`); }
    }
    ff.stdin.end(); await ff.done; await page.close();
    return file;
  }));
  await browser.close(); server.close();

  const list = path.join(TMP, 'lista.txt');
  fs.writeFileSync(list, segs.filter(Boolean).map((f) => `file '${f}'`).join('\n'));
  const withAudio = f0 === 0 && fs.existsSync(AUDIO);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list,
    ...(withAudio ? ['-i', AUDIO] : []),
    '-map', '0:v', ...(withAudio ? ['-map', '1:a', '-c:a', 'aac', '-b:a', '256k', '-shortest'] : []),
    '-vf', `noise=c0s=${GRAIN}:c0f=t+u`, // film grain (cheaper here than as a blended layer in the browser)
    '-c:v', 'libx264', '-preset', 'slow', '-crf', CRF, '-tune', 'film', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.2',
    '-r', String(FPS), '-movflags', '+faststart', '-metadata', 'title=wawEye – Warsaw, live.', OUT], { stdio: 'inherit' });
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`gotowe: ${OUT} (${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB) w ${((Date.now() - started) / 1000).toFixed(0)} s`);
})().catch((e) => { console.error(e); process.exit(1); });
