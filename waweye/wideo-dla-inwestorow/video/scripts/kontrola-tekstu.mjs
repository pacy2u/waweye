// Checks text-safe-area and text-contrast on rendered stills.
// Glyphs = pixels that change between a frame and its ghost twin (text transparent, halo kept).
// Background = brightest ghost pixel within 3 px of a glyph, per 48 px cell: the worst case behind the letters.
// node scripts/kontrola-tekstu.mjs <dir>   (needs NNN.png and ghost-NNN.png)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const W = 1920, H = 1080, CELL = 48;
const raw = (f) => execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: W * H * 4 });
const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const LUT = Array.from({ length: 256 }, (_, i) => lin(i));
const lum = (b, i) => 0.2126 * LUT[b[i]] + 0.7152 * LUT[b[i + 1]] + 0.0722 * LUT[b[i + 2]];
const dir = process.argv[2];
let fail = 0;
for (const f of fs.readdirSync(dir).filter((n) => /^\d+\.png$/.test(n)).sort()) {
  const a = raw(path.join(dir, f)), g = raw(path.join(dir, 'ghost-' + f));
  const glyph = new Uint8Array(W * H);
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let p = 0; p < W * H; p++) {
    const i = p * 3;
    if (Math.abs(a[i] - g[i]) + Math.abs(a[i + 1] - g[i + 1]) + Math.abs(a[i + 2] - g[i + 2]) > 90) {
      glyph[p] = 1; const x = p % W, y = (p / W) | 0;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  }
  if (x1 < 0) { console.log(f, 'no text'); continue; }
  const safe = x0 >= 96 && x1 <= 1824 && y0 >= 54 && y1 <= 1026;
  let worst = { cr: Infinity };
  for (let cy = 0; cy < H; cy += CELL) for (let cx = 0; cx < W; cx += CELL) {
    const tl = [], bl = [];
    for (let y = cy; y < Math.min(H, cy + CELL); y++) for (let x = cx; x < Math.min(W, cx + CELL); x++) {
      const p = y * W + x;
      if (glyph[p]) { tl.push(lum(a, p * 3)); continue; }
      let near = false;
      for (let dy = -3; dy <= 3 && !near; dy++) for (let dx = -3; dx <= 3; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy >= 0 && yy < H && xx >= 0 && xx < W && glyph[yy * W + xx]) { near = true; break; }
      }
      if (near) bl.push(lum(g, p * 3));
    }
    if (tl.length < 30 || !bl.length) continue;
    const b = Math.max(...bl);
    // Rendered text colour: the 90th percentile of glyph pixels by distance from the background
    // (thin strokes never reach full colour on most pixels; the stroke cores do).
    tl.sort((m, n) => Math.abs(m - b) - Math.abs(n - b));
    const t = tl[Math.floor(tl.length * 0.9)];
    const cr = (Math.max(t, b) + 0.05) / (Math.min(t, b) + 0.05);
    if (cr < worst.cr) worst = { cr, cx, cy };
  }
  const ok = safe && worst.cr >= 4.5;
  if (!ok) fail++;
  console.log(`${f}  text box x ${x0}–${x1}, y ${y0}–${y1}  safe-area ${safe ? 'pass' : 'FAIL'}  worst contrast ${worst.cr.toFixed(2)}:1 at (${worst.cx},${worst.cy}) ${worst.cr >= 4.5 ? 'pass' : 'FAIL'}`);
}
process.exit(fail ? 1 : 0);
