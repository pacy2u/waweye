// Sync check: each narration clip's real speech onset (first sample above -40 dBFS) against the frame its words start
// entering on screen; plus the paired visual events. Pass = within 2 frames.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const t = fs.readFileSync('src/timing.ts', 'utf8');
const num = (re) => Number(t.match(re)[1]);
const lead = num(/lead: (\d+)/);
const rows = [];
for (const m of t.matchAll(/(b\w+): \{ at: (\d+), len: \d+, text: (['"])(.*?)\3 \}/g)) {
  const [, key, at, , text] = m;
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', `public/vo/${key}.wav`, '-f', 's16le', '-ac', '1', '-ar', '48000', '-']);
  let i = 0; while (i < raw.length / 2 && Math.abs(raw.readInt16LE(i * 2)) < 328) i++;
  const speech = Number(at) + (i / 48000) * 30;
  rows.push([`"${text.split(' ')[0]}" (${key})`, speech, Number(at) - lead]);
}
rows.push(['SFX tick / disruption ring', num(/utrudnienie: (\d+)/), num(/incident: (\d+)/) - 4]);
rows.push(['"Vav-Eye" / logo square lands', rows.find((r) => r[0].includes('b4a'))[1], num(/MORPH = \{ from: \d+, to: (\d+)/)]);
let fail = 0;
for (const [name, a, v] of rows) {
  const d = v - a, ok = Math.abs(d) <= 2; if (!ok) fail++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(34)} sound ${a.toFixed(1)}  visual ${v}  (${d >= 0 ? '+' : ''}${d.toFixed(1)} f)`);
}
process.exit(fail ? 1 : 0);
