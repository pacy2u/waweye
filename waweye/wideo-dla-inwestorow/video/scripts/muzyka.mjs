// Synthesised score and SFX (no samples, seeded noise): public/audio/muzyka.wav, public/audio/sfx-utrudnienie.wav.
// 120 BPM, one beat = 15 frames. A soft low pulse and an airy pad on A minor; the pad lifts to F major for the end card
// (beat 4, 10.6 s) after a short filtered-noise swell. The SFX is a two-note tick for the disruption ring.
import fs from 'node:fs';

const SR = 48000;
const T = 15.5; // a short tail past the film end; the render cuts at 15 s
const N = Math.round(SR * T);
const BEAT = 0.5;
const LIFT = 318 / 30; // beat 4 starts here

let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

const L = new Float32Array(N), R = new Float32Array(N);
// Pulse: a sine "thump" on every beat, gliding 90 -> 50 Hz, quieter on off-beats.
for (let b = 0; b * BEAT < 15; b++) {
  const t0 = b * BEAT, amp = b % 2 ? 0.18 : 0.3;
  let ph = 0;
  for (let i = Math.round(t0 * SR); i < Math.min(N, Math.round((t0 + 0.45) * SR)); i++) {
    const t = i / SR - t0, f = 50 + 40 * Math.exp(-t * 30);
    ph += (2 * Math.PI * f) / SR;
    const v = Math.sin(ph) * Math.exp(-t * 9) * amp;
    L[i] += v; R[i] += v;
  }
}
// Pad: detuned sines, slow attack; A minor (A2 E3 C4 E4) until the lift, then F major (F2 C3 A3 C4).
const chordA = [45, 52, 60, 64], chordF = [41, 48, 57, 60];
const phases = new Array(16).fill(0);
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const x = Math.min(1, Math.max(0, (t - (LIFT - 0.25)) / 0.5)); // crossfade between chords around the lift
  const env = Math.min(1, t / 1.5) * Math.min(1, Math.max(0, (T - t) / 1.2));
  let l = 0, r = 0, k = 0;
  for (const [chord, w] of [[chordA, 1 - x], [chordF, x]]) {
    for (const m of chord) {
      for (const d of [-0.07, 0.07]) {
        phases[k] += (2 * Math.PI * hz(m + d)) / SR;
        const v = Math.sin(phases[k]) * w * 0.045;
        if (d < 0) l += v; else r += v;
        k++;
      }
    }
  }
  L[i] += l * env * (1 + 0.6 * x); R[i] += r * env * (1 + 0.6 * x); // the lift also opens the pad up a little
}
// Swell into the lift: one-pole low-passed noise rising over 1 s.
let lp = 0;
for (let i = Math.round((LIFT - 1) * SR); i < Math.round((LIFT + 0.05) * SR); i++) {
  const t = i / SR - (LIFT - 1);
  const a = 0.02 + 0.2 * t; // the filter opens as it rises
  lp += a * (rnd() - lp);
  const v = lp * 0.25 * t * t;
  L[i] += v; R[i] += v;
}

const wav = (chs) => {
  const n = chs[0].length, buf = Buffer.alloc(44 + n * chs.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * chs.length * 2, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(chs.length, 22); buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * chs.length * 2, 28); buf.writeUInt16LE(chs.length * 2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * chs.length * 2, 40);
  for (let i = 0; i < n; i++) chs.forEach((c, j) => buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, c[i])) * 32767), 44 + (i * chs.length + j) * 2));
  return buf;
};
fs.mkdirSync('public/audio', { recursive: true });
fs.writeFileSync('public/audio/muzyka.wav', wav([L, R]));

// SFX: two short sine ticks (E6 then A6), 55 ms apart.
const S = new Float32Array(Math.round(SR * 0.3));
for (const [t0, m] of [[0, 88], [0.055, 93]]) {
  for (let i = Math.round(t0 * SR); i < S.length; i++) {
    const t = i / SR - t0;
    S[i] += Math.sin(2 * Math.PI * hz(m) * t) * Math.exp(-t * 40) * 0.5;
  }
}
fs.writeFileSync('public/audio/sfx-utrudnienie.wav', wav([S, S]));
console.log('muzyka.wav', T, 's; sfx-utrudnienie.wav 0.3 s');
