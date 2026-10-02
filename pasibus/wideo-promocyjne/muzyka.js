'use strict';
// Ścieżka dźwiękowa do wideo (30 s, 120 BPM, a-moll) syntezowana od zera: bez sampli i bez zewnętrznych bibliotek.
// Uruchom: node wideo-promocyjne/muzyka.js [plik.wav]   (domyślnie wideo-promocyjne/zasoby/muzyka.wav)
// Punkty synchronizacji z obrazem są w tablicy HITS i w komentarzach sekcji (takty po 2 s).
const fs = require('fs');
const path = require('path');

const SR = 48000, DUR = 30, N = SR * DUR;
const BPM = 120, BEAT = 60 / BPM, BAR = BEAT * 4, S16 = BEAT / 4;
const L = new Float32Array(N), R = new Float32Array(N);           // dry master
const RL = new Float32Array(N), RR = new Float32Array(N);         // reverb send
const PL = new Float32Array(N), PR = new Float32Array(N);         // pumped bus (sidechained to the kick)

// ---------- helpers ----------
let seed = 1234567;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const noise = () => rnd() * 2 - 1;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const pan = (p) => [Math.cos((p + 1) * Math.PI / 4), Math.sin((p + 1) * Math.PI / 4)];

function biquad(type, f, q) {
  const w = 2 * Math.PI * clamp(f, 10, SR * 0.45) / SR, c = Math.cos(w), s = Math.sin(w), a = s / (2 * q);
  let b0, b1, b2, a0 = 1 + a, a1 = -2 * c, a2 = 1 - a;
  if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; }
  else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; }
  else { b0 = a; b1 = 0; b2 = -a; } // band-pass
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}
class Filter {
  constructor(type, f, q = 0.707) { this.type = type; this.q = q; this.z1 = this.z2 = this.x1 = this.x2 = 0; this.set(f); }
  set(f) { this.c = biquad(this.type, f, this.q); }
  run(x) { const c = this.c, y = c.b0 * x + c.b1 * this.x1 + c.b2 * this.x2 - c.a1 * this.z1 - c.a2 * this.z2;
    this.x2 = this.x1; this.x1 = x; this.z2 = this.z1; this.z1 = y; return y; }
}
// Band-limited saw (polyBLEP).
function blep(t, dt) { if (t < dt) { t /= dt; return t + t - t * t - 1; } if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; } return 0; }
class Saw { constructor(f, ph = rnd()) { this.ph = ph; this.f = f; } next() { const dt = this.f / SR; this.ph += dt; if (this.ph >= 1) this.ph -= 1; return 2 * this.ph - 1 - blep(this.ph, dt); } }

function put(bufL, bufR, i, l, r) { if (i >= 0 && i < N) { bufL[i] += l; bufR[i] += r; } }
const at = (t) => Math.round(t * SR);

// ---------- instruments ----------
function kick(t, g = 1, { f0 = 150, f1 = 44, len = 0.42 } = {}) {
  let ph = 0; const n = at(len), s = at(t);
  for (let i = 0; i < n; i++) {
    const x = i / SR, f = f1 + (f0 - f1) * Math.exp(-x * 38);
    ph += 2 * Math.PI * f / SR;
    const env = Math.exp(-x * 7.5) * Math.min(1, i / 24);
    const click = i < 220 ? noise() * 0.35 * (1 - i / 220) : 0;
    const v = Math.tanh((Math.sin(ph) * env + click) * 1.6) * g;
    put(L, R, s + i, v, v);
  }
}
function sub(t, g = 1, len = 0.6) { // heartbeat thump
  let ph = 0; const n = at(len), s = at(t);
  for (let i = 0; i < n; i++) { const x = i / SR, f = 42 + 50 * Math.exp(-x * 25); ph += 2 * Math.PI * f / SR;
    const v = Math.sin(ph) * Math.exp(-x * 6) * Math.min(1, i / 60) * g; put(L, R, s + i, v, v); }
}
function clap(t, g = 1, verb = 0.35) {
  const bp = new Filter('bp', 1500, 1.2), hp = new Filter('hp', 600), s = at(t), n = at(0.32);
  for (let i = 0; i < n; i++) {
    const x = i / SR; let env = 0;
    for (const o of [0, 0.011, 0.022]) if (x >= o) env = Math.max(env, Math.exp(-(x - o) * 120));
    env = Math.max(env, x > 0.03 ? Math.exp(-(x - 0.03) * 18) * 0.55 : 0);
    const v = hp.run(bp.run(noise())) * env * g * 1.6;
    put(L, R, s + i, v * 0.95, v); put(RL, RR, s + i, v * verb, v * verb);
  }
}
function snare(t, g = 1, p = 0) {
  const hp = new Filter('hp', 900), s = at(t), n = at(0.16), [pl, pr] = pan(p); let ph = 0;
  for (let i = 0; i < n; i++) { const x = i / SR; ph += 2 * Math.PI * 190 / SR;
    const v = (hp.run(noise()) * Math.exp(-x * 30) + Math.sin(ph) * Math.exp(-x * 40) * 0.5) * g;
    put(L, R, s + i, v * pl, v * pr); put(RL, RR, s + i, v * 0.2, v * 0.2); }
}
function hat(t, g = 1, len = 0.04, p = 0) {
  const hp = new Filter('hp', 7500, 0.9), s = at(t), n = at(len * 3), [pl, pr] = pan(p);
  for (let i = 0; i < n; i++) { const x = i / SR, v = hp.run(noise()) * Math.exp(-x / len * 2.2) * g; put(L, R, s + i, v * pl, v * pr); }
}
function crash(t, g = 1, len = 2.2) {
  const hp = new Filter('hp', 4200, 0.6), hp2 = new Filter('hp', 4200, 0.6), s = at(t), n = at(len);
  for (let i = 0; i < n; i++) { const x = i / SR, env = Math.exp(-x * 2.4) * Math.min(1, i / 40) * g;
    const l = hp.run(noise()) * env, r = hp2.run(noise()) * env; put(L, R, s + i, l * 0.5, r * 0.5); put(RL, RR, s + i, l * 0.35, r * 0.35); }
}
function impact(t, g = 1) { // cinematic boom: sub drop + noise body + reverb
  let ph = 0; const lp = new Filter('lp', 1800), s = at(t), n = at(2.6);
  for (let i = 0; i < n; i++) {
    const x = i / SR, f = 30 + 70 * Math.exp(-x * 9); ph += 2 * Math.PI * f / SR;
    const body = Math.sin(ph) * Math.exp(-x * 1.7) * 1.1;
    const nz = lp.run(noise()) * Math.exp(-x * 9) * 0.9;
    const v = Math.tanh((body + nz) * 1.4) * g;
    put(L, R, s + i, v, v); put(RL, RR, s + i, nz * g * 0.6, nz * g * 0.6);
  }
}
function riser(t0, t1, g = 1, { f0 = 300, f1 = 9000, pitch = true } = {}) {
  const bpL = new Filter('bp', f0, 2.5), bpR = new Filter('bp', f0, 2.5), saw = new Saw(110), saw2 = new Saw(110.7);
  const s = at(t0), n = at(t1 - t0);
  for (let i = 0; i < n; i++) {
    const k = i / n, f = f0 * Math.pow(f1 / f0, k * k);
    if (i % 32 === 0) { bpL.set(f); bpR.set(f * 1.03); }
    saw.f = 110 * Math.pow(2, k * 3); saw2.f = saw.f * 1.006;
    const env = Math.pow(k, 1.6) * g;
    const tone = pitch ? (saw.next() + saw2.next()) * 0.08 * env : 0;
    const l = bpL.run(noise()) * env * 1.4 + tone, r = bpR.run(noise()) * env * 1.4 + tone;
    put(L, R, s + i, l, r); put(RL, RR, s + i, l * 0.3, r * 0.3);
  }
}
function whoosh(t, len = 0.5, g = 1, up = true) {
  const bp = new Filter('bp', 400, 1.6), s = at(t - len * 0.7), n = at(len);
  for (let i = 0; i < n; i++) {
    const k = i / n, f = up ? 300 * Math.pow(25, k) : 7500 * Math.pow(1 / 25, k);
    if (i % 32 === 0) bp.set(f);
    const env = Math.sin(Math.PI * Math.pow(k, up ? 1.4 : 0.6)) * g, p = (k * 2 - 1) * 0.8, [pl, pr] = pan(up ? p : -p);
    const v = bp.run(noise()) * env * 1.6;
    put(L, R, s + i, v * pl, v * pr); put(RL, RR, s + i, v * 0.25, v * 0.25);
  }
}
const XL = new Float32Array(N), XR = new Float32Array(N); // survives the silence gaps before the drops
function reverseCymbal(tEnd, len = 1, g = 1) {
  const hp = new Filter('hp', 3000, 0.7), s = at(tEnd - len), n = at(len);
  for (let i = 0; i < n; i++) { const k = i / n, v = hp.run(noise()) * Math.pow(k, 3) * g * 0.7; put(XL, XR, s + i, v, v * 0.95); }
}
const GAPS = [[5.875, 6.0], [25.8, 26.0]]; // a beat of silence before each drop
// Supersaw chord voice into a bus.
function chord(bufL, bufR, t0, len, notes, g, { cut0 = 600, cut1 = 2400, atk = 0.05, rel = 0.25, voices = 5, detune = 0.18, q = 0.9, filterEnv = null } = {}) {
  const s = at(t0), n = at(len + rel);
  const vs = [];
  notes.forEach((m) => { for (let v = 0; v < voices; v++) { const d = (v - (voices - 1) / 2) / ((voices - 1) / 2 || 1) * detune; vs.push({ o: new Saw(mtof(m + d)), p: (v / (voices - 1 || 1)) * 2 - 1 }); } });
  const fl = new Filter('lp', cut0, q), fr = new Filter('lp', cut0, q), norm = 1 / Math.sqrt(vs.length);
  for (let i = 0; i < n; i++) {
    const x = i / SR, k = x / len;
    if (i % 64 === 0) { const c = filterEnv ? filterEnv(x) : cut0 + (cut1 - cut0) * clamp(k, 0, 1); fl.set(c); fr.set(c * 1.02); }
    const env = Math.min(1, x / atk) * (x > len ? Math.exp(-(x - len) / rel * 3) : 1) * g;
    let l = 0, r = 0;
    for (const v of vs) { const y = v.o.next(); l += y * (1 - v.p) * 0.5; r += y * (1 + v.p) * 0.5; }
    put(bufL, bufR, s + i, fl.run(l * norm) * env, fr.run(r * norm) * env);
  }
}
function stab(t, notes, g = 1) { // brass-like hit for the kinetic-type section
  chord(L, R, t, 0.16, notes, g, { atk: 0.004, rel: 0.25, voices: 4, detune: 0.12, q: 1.4, filterEnv: (x) => 300 + 5200 * Math.exp(-x * 14) });
  chord(RL, RR, t, 0.16, notes, g * 0.4, { atk: 0.004, rel: 0.25, voices: 2, detune: 0.1, q: 1, filterEnv: (x) => 300 + 4000 * Math.exp(-x * 14) });
}
function pluck(t, m, g = 1, p = 0, len = 0.11) {
  const o = new Saw(mtof(m)), o2 = new Saw(mtof(m + 12.05)), f = new Filter('lp', 3000, 2.2), s = at(t), n = at(len + 0.2), [pl, pr] = pan(p);
  for (let i = 0; i < n; i++) { const x = i / SR; if (i % 32 === 0) f.set(250 + 5000 * Math.exp(-x * 26));
    const env = Math.min(1, i / 48) * Math.exp(-x * 9) * g;
    const v = f.run(o.next() * 0.7 + o2.next() * 0.3) * env; put(L, R, s + i, v * pl, v * pr); put(RL, RR, s + i, v * 0.45 * pr, v * 0.45 * pl); }
}
function bass(t, m, len, g = 1) { // sub sine + a little saw grit, into the pumped bus
  const o = new Saw(mtof(m)), f = new Filter('lp', 380, 1.1), s = at(t), n = at(len);
  let ph = 0; const fr = mtof(m);
  for (let i = 0; i < n; i++) { const x = i / SR; ph += 2 * Math.PI * fr / SR;
    const env = Math.min(1, i / 90) * Math.min(1, (n - i) / 400) * g;
    const v = (Math.sin(ph) * 0.85 + f.run(o.next()) * 0.35) * env; put(PL, PR, s + i, v, v); }
}
// Stock-exchange opening bell: a brass bell hit repeatedly by an electric clapper, plus a tuned "ding".
function bell(t, ringFor = 1.25, g = 1) {
  const parts = [[1, 1], [2.32, 0.55], [4.25, 0.35], [6.63, 0.2], [9.38, 0.1]], f0 = 1180;
  const s = at(t), n = at(ringFor + 2.4), rate = 24;
  const ph = parts.map(() => rnd() * 6.28);
  for (let i = 0; i < n; i++) {
    const x = i / SR;
    const hits = x < ringFor ? 0.55 + 0.45 * Math.pow(1 - ((x * rate) % 1), 3) : 0;
    const env = (x < ringFor ? 1 : Math.exp(-(x - ringFor) * 2.2)) * Math.min(1, i / 30);
    let v = 0; parts.forEach(([r, a], k) => { v += Math.sin(ph[k] + 2 * Math.PI * f0 * r * x * (1 + 0.0007 * Math.sin(x * 30))) * a * Math.exp(-x * (0.4 + k * 0.5)); });
    v *= env * (x < ringFor ? hits : 1) * g * 0.22;
    put(L, R, s + i, v, v * 0.9); put(RL, RR, s + i, v * 0.8, v * 0.8);
  }
  // tuned ding (A5 + E6) – musical anchor on the downbeat
  for (const [m, a] of [[81, 1], [88, 0.6], [69, 0.5]]) {
    const f = mtof(m);
    for (let i = 0; i < at(4); i++) { const x = i / SR;
      const v = (Math.sin(2 * Math.PI * f * x) + 0.35 * Math.sin(2 * Math.PI * f * 2.76 * x) * Math.exp(-x * 3) + 0.2 * Math.sin(2 * Math.PI * f * 5.4 * x) * Math.exp(-x * 6))
        * Math.exp(-x * 1.1) * Math.min(1, i / 20) * a * g * 0.12;
      put(L, R, s + i, v, v); put(RL, RR, s + i, v * 0.7, v * 0.7); }
  }
}
function tick(t, g = 1, p = 0) { // clock tick for the intro
  const bp = new Filter('bp', 3200, 6), s = at(t), [pl, pr] = pan(p);
  for (let i = 0; i < at(0.03); i++) { const v = bp.run(noise()) * Math.exp(-i / SR * 260) * g * 2; put(L, R, s + i, v * pl, v * pr); }
}

function pop(t, g = 1, f0 = 1400, p = 0) { // UI blip for cards, counters and chart flags
  const s = at(t), n = at(0.07), [pl, pr] = pan(p); let ph = 0;
  for (let i = 0; i < n; i++) { const x = i / SR, f = f0 * (0.55 + 0.45 * Math.exp(-x * 60)); ph += 2 * Math.PI * f / SR;
    const v = Math.sin(ph) * Math.exp(-x * 55) * Math.min(1, i / 24) * g * 0.5; put(L, R, s + i, v * pl, v * pr); put(RL, RR, s + i, v * 0.3, v * 0.3); }
}

// ---------- arrangement ----------
const A = [57, 60, 64], F = [53, 57, 60], C = [55, 60, 64], G = [55, 59, 62], E = [56, 59, 64];
const PROG = [A, F, C, G];
const ROOT = { A: 45, F: 41, C: 48, G: 43, E: 40 };
const ROOTS = ['A', 'F', 'C', 'G'];
const kicks = [];
const K = (t, g = 1, o) => { kick(t, g, o); kicks.push(t); };

// Bar 1 [0–2): heartbeat + clock ticks + drone + riser into the hook.
for (let b = 0; b < 4; b++) { sub(b * BEAT, 0.95); sub(b * BEAT + 0.16, 0.45); }
for (let i = 0; i < 16; i++) tick(i * S16, i % 2 ? 0.25 : 0.5, i % 2 ? 0.4 : -0.4);
chord(PL, PR, 0, 2, [45, 52, 57, 60, 64], 0.22, { cut0: 200, cut1: 900, atk: 1.2, rel: 0.1 });
riser(0.8, 2.0, 0.5, { f0: 400, f1: 6000, pitch: false });
whoosh(2.0, 0.5, 0.6);

// Bars 2–3 [2–6): kinetic type. One slam per word.
const hookStabs = [[57, 64, 69], [60, 65, 69], [55, 60, 64], [52, 59, 64]];
[2.0, 2.5, 3.0, 3.5].forEach((t, i) => { K(t, 1.05); impact(t, 0.28); stab(t, hookStabs[i], 0.95); hat(t + BEAT / 2, 0.25, 0.04, 0.3); });
for (let i = 0; i < 16; i++) hat(2 + i * S16, i % 4 === 2 ? 0.32 : 0.14, 0.03, (i % 2 ? 0.35 : -0.35));
K(4.0, 1.1); impact(4.0, 0.45); stab(4.0, [57, 64, 72], 1.1); crash(4.0, 0.35, 1.2);   // "UNTIL"
K(4.5, 1.15); impact(4.5, 0.6); stab(4.5, [60, 64, 69, 76], 1.2);                   // "NOW."
// [5–6): build – snare roll accelerating, riser, cut to silence at 5.875.
const roll = []; for (let t = 5.0; t < 5.5; t += S16) roll.push(t); for (let t = 5.5; t < 5.875; t += S16 / 2) roll.push(t);
roll.forEach((t, i) => snare(t, 0.25 + 0.55 * (i / roll.length), (i % 2 ? 0.2 : -0.2)));
riser(4.6, 5.875, 0.9);
reverseCymbal(6.0, 0.9, 0.8);

// Bars 4–10 [6–20): the drop – logo, live map, product.
const DROP0 = 6, DROP1 = 20;
for (let bar = 0; bar < (DROP1 - DROP0) / BAR; bar++) {
  const t0 = DROP0 + bar * BAR, ch = PROG[bar % 4], root = ROOT[ROOTS[bar % 4]];
  for (let b = 0; b < 4; b++) K(t0 + b * BEAT, 1);
  clap(t0 + BEAT, 0.6); clap(t0 + 3 * BEAT, 0.6);
  for (let i = 0; i < 16; i++) { const t = t0 + i * S16; if (i % 4 === 2) hat(t, 0.42, 0.05, 0.25); else if (i % 2) hat(t, 0.16, 0.025, -0.3); else if (i % 4 === 0 && bar > 1) hat(t, 0.08, 0.02, 0.5); }
  chord(PL, PR, t0, BAR, ch.map((m) => m).concat([ch[0] + 12]), 0.38, { cut0: 700, cut1: 2600, atk: 0.02, rel: 0.2 });
  [0, 0.75, 1.5, 2, 2.75, 3.5].forEach((b) => bass(t0 + b * BEAT, b % 2 === 0.75 ? root + 12 : root, BEAT * 0.7, 0.8));
  // hook melody on the even bars
  if (bar % 2 === 0) [[0, 76], [0.75, 74], [1.5, 72], [2, 69], [3, 71]].forEach(([b, m]) => pluck(t0 + b * BEAT, m + (ch === F ? -3 : 0), 0.32, 0.15, 0.2));
}
impact(6.0, 1.0); crash(6.0, 1.0, 2.8);                                                 // logo
whoosh(8.0, 0.6, 0.9); crash(8.0, 0.4); impact(8.0, 0.35);                              // particle burst → map
[12, 14, 16, 18].forEach((t) => { whoosh(t, 0.45, 0.8, t % 4 === 0); crash(t, 0.35, 1.6); }); // product screens
for (let k = 0; k < 5; k++) pluck(13.5 + k * S16, [81, 84, 88, 93, 96][k], 0.18, 0.4);       // "tap" sparkle
whoosh(20.0, 0.5, 1);
// UI pops, in sync with kompozycja.html: map counters, product cards, chart milestone flags.
[8.35, 8.47, 8.59].forEach((t, i) => pop(t, 0.5, 1500 + i * 200, -0.5));
[12.55, 12.75, 14.3, 14.45, 14.6, 14.75, 16.3, 16.5, 18.3, 18.5].forEach((t, i) => pop(t, 0.55, 1300 + (i % 4) * 180, 0.45));
{ // flags pop when the chart head passes them: draw = ioCub((t - 20.1) / 2), flag at fraction x
  const ioCub = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  [0.06, 0.3, 0.47, 0.7, 0.88].forEach((x, i) => { let lo = 0, hi = 1; for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (ioCub(m) < x) lo = m; else hi = m; } pop(20.1 + 2 * lo, 0.5, 1700 + i * 150, 0.2 * i - 0.4); });
}

// Bars 11–12 [20–24): the IPO – faster energy, arp, open hats.
for (let bar = 0; bar < 2; bar++) {
  const t0 = 20 + bar * BAR, ch = PROG[bar % 2 ? 1 : 0], root = ROOT[ROOTS[bar % 2 ? 1 : 0]];
  for (let b = 0; b < 4; b++) K(t0 + b * BEAT, 1.05);
  clap(t0 + BEAT, 0.7); clap(t0 + 3 * BEAT, 0.7);
  for (let i = 0; i < 16; i++) { const t = t0 + i * S16; hat(t, i % 4 === 2 ? 0.45 : 0.2, i % 4 === 2 ? 0.09 : 0.025, i % 2 ? 0.4 : -0.4); }
  chord(PL, PR, t0, BAR, ch.concat([ch[0] + 12, ch[1] + 12]), 0.4, { cut0: 1200, cut1: 4200, atk: 0.01, rel: 0.2 });
  for (let i = 0; i < 16; i++) { const m = ch[i % 3] + 12 + (i % 8 >= 4 ? 12 : 0); pluck(t0 + i * S16, m, 0.2, (i % 2 ? 0.5 : -0.5), 0.08); }
  [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].forEach((b) => bass(t0 + b * BEAT, root + (b % 1 ? 12 : 0), BEAT * 0.4, 0.8));
}
impact(20.0, 0.7); crash(20.0, 0.8, 2.4);
[22, 22.5, 23, 23.5].forEach((t) => stab(t, [64, 69, 72], 0.4));                      // KPI tiles
// Bar 13 [24–26): "NEXT STOP: WALL STREET." – build, no kick, roll, silence, then the bell.
stab(24.0, [57, 64, 69, 72], 1.0); impact(24.0, 0.5); K(24.0, 1);
stab(24.5, [53, 60, 65, 69], 1.0); K(24.5, 0.9);
stab(25.0, [52, 59, 64, 68], 1.1); impact(25.0, 0.6); K(25.0, 1.1);                    // "WALL STREET."
const roll2 = []; for (let t = 25.0; t < 25.5; t += S16 / 2) roll2.push(t); for (let t = 25.5; t < 25.8; t += S16 / 4) roll2.push(t);
roll2.forEach((t, i) => snare(t, 0.2 + 0.6 * (i / roll2.length), i % 2 ? 0.25 : -0.25));
chord(PL, PR, 24, 1.8, [52, 56, 59, 64, 68], 0.32, { cut0: 400, cut1: 5000, atk: 0.05, rel: 0.05 });
riser(24.0, 25.8, 1.0, { f0: 250, f1: 11000 });
reverseCymbal(26.0, 1.2, 0.9);

// Bars 14–15 [26–30): the bell, the end card, the button.
impact(26.0, 1.1); crash(26.0, 1, 3.5); bell(26.0, 1.25, 1.0); K(26.0, 1.2);
chord(PL, PR, 26, 3.4, [45, 57, 60, 64, 71, 76], 0.42, { cut0: 3000, cut1: 900, atk: 0.01, rel: 0.6, voices: 7, detune: 0.22 });
bass(26, 33, 3.2, 0.9);
for (let i = 0; i < 12; i++) pluck(26.5 + i * S16 * 1.5, [88, 84, 81, 76][i % 4] + (i > 7 ? 0 : 0), 0.13 * (1 - i / 14), i % 2 ? 0.6 : -0.6, 0.2);
K(29.0, 1.1); impact(29.0, 0.8); stab(29.0, [45, 57, 64, 69], 0.7); crash(29.0, 0.5, 1);

// ---------- mix ----------
function rms(a) { let s = 0; for (const x of a) s += x * x; return Math.sqrt(s / a.length); }
function pk(a) { let m = 0; for (const x of a) m = Math.max(m, Math.abs(x)); return m; }
if (process.env.DEBUG) console.log('dry rms', rms(L).toFixed(3), 'peak', pk(L).toFixed(2), '| pumped rms', rms(PL).toFixed(3), 'peak', pk(PL).toFixed(2), '| send rms', rms(RL).toFixed(3));
// Sidechain: duck the pumped bus after each kick.
const duck = new Float32Array(N).fill(1);
for (const t of kicks) { const s = at(t); for (let i = 0; i < at(0.4); i++) if (s + i < N) duck[s + i] = Math.min(duck[s + i], 0.25 + 0.75 * Math.pow(Math.min(1, i / at(0.32)), 1.6)); }
const PAD = 0.42; // pumped bus (pads + bass) sits under the drums
for (let i = 0; i < N; i++) { const d = duck[i] * PAD; L[i] += PL[i] * d; R[i] += PR[i] * d; RL[i] += PL[i] * d * 0.3; RR[i] += PR[i] * d * 0.3; }

// Freeverb-style reverb on the send.
function reverb(inp, combs, aps, damp = 0.25, fb = 0.82) {
  const out = new Float32Array(N);
  const cs = combs.map((d) => ({ b: new Float32Array(d), i: 0, s: 0 })), as = aps.map((d) => ({ b: new Float32Array(d), i: 0 }));
  for (let n = 0; n < N; n++) {
    const x = inp[n] * 0.015; let y = 0;
    for (const c of cs) { const o = c.b[c.i]; c.s = o * (1 - damp) + c.s * damp; c.b[c.i] = x + c.s * fb; c.i = (c.i + 1) % c.b.length; y += o; }
    for (const a of as) { const o = a.b[a.i]; const v = -y + o; a.b[a.i] = y + o * 0.5; a.i = (a.i + 1) % a.b.length; y = v; }
    out[n] = y;
  }
  return out;
}
const sc = SR / 44100;
const comb = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((d) => Math.round(d * sc * 1.15));
const ap = [556, 441, 341, 225].map((d) => Math.round(d * sc));
const wl = reverb(RL, comb, ap), wr = reverb(RR, comb.map((d) => d + 23), ap.map((d) => d + 23));
if (process.env.DEBUG) console.log('verb rms', rms(wl).toFixed(3), 'peak', pk(wl).toFixed(2));
for (let i = 0; i < N; i++) { L[i] += wl[i] * 2.2; R[i] += wr[i] * 2.2; }
for (const [a, b] of GAPS) for (let i = at(a) - 240; i < at(b); i++) { const g = Math.max(0, 1 - (i - at(a) + 240) / 240) * 0.92 + 0.08; L[i] *= g; R[i] *= g; }
for (let i = 0; i < N; i++) { L[i] += XL[i]; R[i] += XR[i]; }

// Master: DC/rumble high-pass, soft clip with ~2 dB of drive on the loudest hits, fades, normalise to -1 dBFS.
const hl = new Filter('hp', 28), hr = new Filter('hp', 28);
for (let i = 0; i < N; i++) { L[i] = hl.run(L[i]); R[i] = hr.run(R[i]); }
const pre = 1.25 / Math.max(pk(L), pk(R));
let peak = 0;
for (let i = 0; i < N; i++) {
  const x = i / SR, fade = Math.min(1, x / 0.01) * (x > 29.4 ? Math.max(0, (30 - x) / 0.6) : 1);
  L[i] = Math.tanh(L[i] * pre) * fade; R[i] = Math.tanh(R[i] * pre) * fade;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const gain = 0.89 / peak;

// ---------- write WAV (16-bit PCM stereo) ----------
const out = process.argv[2] || path.join(__dirname, 'zasoby', 'muzyka.wav');
const buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  const d = (rnd() - rnd()) / 32768; // TPDF dither
  buf.writeInt16LE(Math.round(clamp(L[i] * gain + d, -1, 1) * 32767), 44 + i * 4);
  buf.writeInt16LE(Math.round(clamp(R[i] * gain + d, -1, 1) * 32767), 46 + i * 4);
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, buf);
console.log('zapisano', out, 'peak przed normalizacją', peak.toFixed(3));
