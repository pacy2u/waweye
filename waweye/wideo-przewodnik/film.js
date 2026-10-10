// wawEye – pierwsze kroki: czysta funkcja czasu. window.seek(t) rysuje klatkę t (lib/motion.js).
// Czas w uderzeniach (u) na zmierzonej siatce beats.json; plan scen: docs/shotlist.md.
import * as M from './lib/motion.js';

const { W, H, FORMAT, E, prog, lerp, clamp, springU, springKeys, SPRING, wobble, bump, font, layout, glyph, text, fill, cover, rrect, mix } = M;

// Kolory marki (public/style.css, wideo-promocyjne): grafit, pomarańcz jako jedyny akcent.
const C = { ink: '#242428', deep: '#17171A', paper: '#F4F2EE', accent: '#FC4C02', muted: '#A7A7B1', bezel: '#0B0B0D' };
const DISPLAY = 'Display', UI = 'UI';
const P = FORMAT.portrait;

// ---------------------------------------------------------------- funkcje (sceny 3–13)
// b: uderzenie startu; img: zrzut; zoom/fx/fy: najazd kamery w ekran telefonu; dot: punkt do zaznaczenia (ułamek zrzutu).
const FEAT = [
  { b: 8, img: 'trasa', crop: [50, 1440, 1080, 460], t: 'Kliknij pojazd', s: 'trasa, kierunek i model', zoom: 1.75, fx: 0.5, fy: 0.78, zAt: 12 },
  { b: 16, img: 'sledz', crop: [29, 2228, 1112, 175], t: 'Śledź', s: 'mapa jedzie za autobusem', zoom: 1.7, fx: 0.62, fy: 1, dot: [0.685, 0.918] },
  { b: 20, img: 'szukaj', crop: [40, 52, 1100, 128], t: 'Szukaj', s: 'linii, miejsca albo słowa', zoom: 1.85, fx: 0.6, fy: 0 },
  { b: 24, img: 'parking', crop: [39, 1820, 1091, 320], t: 'Parkingi', s: 'wolne miejsca na żywo', zoom: 1.8, fx: 0.2, fy: 0.95 },
  { b: 28, img: 'utrudnienia', crop: [39, 1032, 1083, 408], t: 'Utrudnienia', s: 'remonty i objazdy', zoom: 1.6, fx: 0.4, fy: 0.62 },
  { b: 32, img: 'sport', crop: [39, 440, 1091, 760], t: 'Sport', s: 'zajęcia dziś, jutro, w tygodniu', zoom: 1.55, fx: 0.4, fy: 0.3 },
  { b: 36, img: 'dziejesie', crop: [39, 1001, 1091, 579], t: 'DziejeSię', s: 'wydarzenia w mieście', zoom: 1.55, fx: 0.4, fy: 0.6 },
  { b: 40, img: 'metro', crop: [39, 1831, 1091, 349], t: 'Metro', s: 'linie M1 i M2, stacje', zoom: 1.75, fx: 0.4, fy: 0.95 },
  { b: 44, img: 'strefy', crop: [273, 701, 740, 506], t: 'Strefy', s: 'płatne parkowanie i czysty transport', zoom: 1.85, fx: 0.75, fy: 0.42 },
  { b: 48, img: 'timelapse', crop: [53, 1761, 1102, 300], t: 'Timelapse', s: 'ruch według rozkładu ZTM', zoom: 1.75, fx: 0.2, fy: 0.96 },
  { b: 54, img: 'lokalizacja', crop: [300, 980, 600, 600], t: 'Gdzie jestem?', s: 'twoja pozycja na mapie', zoom: 1.9, fx: 0.512, fy: 0.506, dot: [0.512, 0.506] },
];
const END = 58;                        // plansza końcowa
const nextB = (i) => (i + 1 < FEAT.length ? FEAT[i + 1].b : END);
const TAP = [0.5, 0.37];               // wybrany autobus 175 na m-trasa.png (stuknięcie @9)

// Każdy akcent: [uderzenie, opis, sfx, opcje]. sfx.mjs nakłada dźwięk na każdy, więc obraz i dźwięk się nie rozjadą.
const HITS = [
  [0, 'Gdzie', 'impact'],
  [0.5, 'jest', 'pop', { pitch: 'A5' }],
  [1, 'mój', 'pop', { pitch: 'D6' }],
  [1.5, 'autobus', 'pop', { pitch: 'F#6' }],
  [2, 'znak zapytania', 'thud'],
  [3.5, 'pchnięcie w pomarańcz', 'whoosh', { len: 0.5, from: 500, to: 3000 }],
  [4, 'mapa na żywo', 'impact'],
  [5, 'logo', 'bell', { pitch: 'D6' }],
  [7.6, 'mapa do telefonu', 'whoosh', { len: 0.45, from: 2400, to: 500 }],
  [8.3, 'telefon ląduje', 'thud'],
  [9, 'stuknięcie w autobus', 'pop', { pitch: 'A5' }],
  [12, 'najazd na panel', 'whoosh', { len: 0.35, from: 800, to: 2200, gain: 0.2 }],
  [12.35, 'wycinek: Kliknij pojazd', 'tick'],
  ...FEAT.slice(1).flatMap((f, i) => [
    [f.b - 0.3, `taśma → ${f.t}`, 'whoosh', { len: 0.4, from: i % 2 ? 2400 : 700, to: i % 2 ? 700 : 2400, pan: P ? 0.3 : 0 }],
    [f.b + 0.95, `wycinek: ${f.t}`, 'tick'],
  ]),
  [17, 'Śledź', 'pop', { pitch: 'D6' }],
  [50, 'tempo ×10', 'blip', { pitch: 'A5' }],
  [51, 'tempo ×100', 'blip', { pitch: 'D6' }],
  [52, 'tempo ×1000', 'blip', { pitch: 'A6' }],
  [55, 'kropka lokalizacji', 'pop', { pitch: 'E6' }],
  [57.4, 'wejście w kropkę', 'whoosh', { len: 0.5, from: 600, to: 2800 }],
  [58, 'plansza', 'impact'],
  [59, 'logo', 'bell', { pitch: 'D6' }],
];

// ---------------------------------------------------------------- telefon
// Prostokąt ekranu telefonu w spoczynku, dla danego formatu.
function phoneBox() {
  const s = FORMAT.safe;
  const h = P ? 980 : 900;
  const w = h * (1170 / 2532);
  const cx = P ? W / 2 : s.x + s.w * 0.26;
  const cy = P ? s.y + s.h - h / 2 : H / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h, cx, cy };
}
// Punkt zrzutu (ułamki) → piksele ekranu, dla tych samych parametrów co cover().
function coverPoint(img, box, { fx, fy, zoom }, [px, py]) {
  const s = Math.max(box.w / img.width, box.h / img.height) * zoom;
  const dw = img.width * s, dh = img.height * s;
  return [box.x + (box.w - dw) * fx + px * dw, box.y + (box.h - dh) * fy + py * dh];
}
function drawPhone(ctx, box, paint, { bezel = 1, scale = 1 } = {}) {
  const r = box.w * 0.13, b = box.w * 0.035;
  ctx.save();
  ctx.translate(box.cx, box.cy); ctx.scale(scale, scale); ctx.translate(-box.cx, -box.cy);
  if (bezel > 0) {
    ctx.globalAlpha = bezel;
    ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 60; ctx.shadowOffsetY = 24;
    rrect(ctx, box.x - b, box.y - b, box.w + 2 * b, box.h + 2 * b, r + b); ctx.fillStyle = C.bezel; ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.globalAlpha = 1;
  }
  ctx.save(); rrect(ctx, box.x, box.y, box.w, box.h, r * clamp(bezel)); ctx.clip();
  paint(box);
  ctx.restore();
  ctx.restore();
}
// Zoom kamery w ekranie telefonu dla funkcji i (sprężyna, z lekkim przestrzeleniem).
function featCam(f, u) {
  const k = springU(u, f.zAt ?? f.b + 0.6, SPRING.gentle);
  return { fx: lerp(0.5, f.fx, k), fy: lerp(0.5, f.fy, k), zoom: lerp(1, Math.min(f.zoom, 1.3), k) };
}
// Pierścień zaznaczenia (kolor akcentu) wokół punktu.
function ring(ctx, x, y, r, a, w = 6) {
  if (a <= 0.01) return;
  ctx.save(); ctx.globalAlpha = a; ctx.strokeStyle = C.accent; ctx.lineWidth = w;
  ctx.beginPath(); ctx.arc(x, y, r, 0, M.TAU); ctx.stroke(); ctx.restore();
}

// ---------------------------------------------------------------- S1 hak   (u 0..4)
const HOOK = P ? ['Gdzie', 'jest mój', 'autobus?'] : ['Gdzie jest', 'mój autobus?'];
const HOOK_AT = P ? [[0], [0.5, 1], [1.5]] : [[0, 0.5], [1, 1.5]]; // uderzenie każdego słowa w linii
function sceneHook(ctx, u) {
  fill(ctx, C.ink);
  const s = FORMAT.safe;
  const size = P ? 175 : 205;
  const f = font(size, 800, DISPLAY), track = -0.03 * size, lineH = size * 0.98;
  const top = P ? s.y + s.h * 0.24 : H * 0.36;
  // pchnięcie w pomarańczowy „?” od 3.4: zoom wokół kropki znaku
  const push = E.inExpo(prog(u, 3.35, 4));
  let qx = 0, qy = 0;
  const lines = HOOK.map((str, i) => ({ str, L: layout(ctx, str, f, track), base: top + size + i * lineH }));
  const last = lines[lines.length - 1];
  const qg = last.L.glyphs[last.L.glyphs.length - 1];
  qx = s.x + qg.cx; qy = last.base - size * 0.06;
  ctx.save();
  if (push > 0) M.zoomAbout(ctx, 1 + push * 90, qx, qy);
  lines.forEach(({ str, L, base }, li) => {
    const words = str.split(' ');
    let wi = 0;
    L.glyphs.forEach((g, j) => {
      if (g.ch === ' ') { wi++; return; }
      const isQ = g.ch === '?';
      const u0 = isQ ? 2 : HOOK_AT[li][wi] - (li === 0 && wi === 0 ? 0.3 : 0);
      const k = springU(u, u0 + (isQ ? 0 : j * 0.025), isQ ? SPRING.wobbly : SPRING.bouncy);
      if (k <= 0) return;
      const pulse = isQ ? 1 + 0.12 * bump(u, 3, 0.35) : 1;
      glyph(ctx, g.ch, s.x + g.cx, base + (1 - k) * 140, f, isQ ? C.accent : C.paper, k * pulse, k * pulse);
    });
    void words;
  });
  ctx.restore();
}

// ---------------------------------------------------------------- S2 mapa na żywo   (u 4..8)
function mapImg(IMG) { return P ? IMG.mapM : IMG.mapD; }
function sceneMap(ctx, u, IMG) {
  const img = mapImg(IMG);
  const r = { x: 0, y: 0, w: W, h: H, cx: W / 2, cy: H / 2 };
  fill(ctx, C.ink);
  // odsłonięcie kołem z pomarańczu (4..4.6)
  const rev = E.outCubic(prog(u, 4, 4.7));
  if (rev < 1) fill(ctx, C.accent);
  ctx.save();
  ctx.beginPath(); ctx.arc(W / 2, H / 2, rev * Math.hypot(W, H) * 0.6, 0, M.TAU); ctx.clip();
  fill(ctx, C.ink);
  const z = lerp(1, 1.06, prog(u, 4, 7.4));
  drawPhone(ctx, r, (b) => { if (img) cover(ctx, img, b.x, b.y, b.w, b.h, { fx: 0.5, fy: 0.5, zoom: z }); }, { bezel: 0 });
  ctx.restore();
  // karta z logo i licznikiem (5..7.4), na dole po lewej
  const ck = springU(u, 4.8, SPRING.snappy) - springU(u, 6.7, SPRING.snappy);
  if (ck > 0.002) {
    const s = FORMAT.safe;
    const cw = P ? s.w : 820, ch = P ? 330 : 300;
    const cx = s.x, cy = (P ? s.y + s.h - ch - 40 : H - s.y - ch - 20) + (1 - ck) * 120;
    ctx.save(); ctx.globalAlpha = clamp(ck);
    rrect(ctx, cx, cy, cw, ch, 28); ctx.fillStyle = 'rgba(36,36,40,0.94)'; ctx.fill();
    text(ctx, 'wawEye', cx + 48, cy + 128, font(P ? 120 : 112, 800, DISPLAY), C.accent, 'left', -3);
    text(ctx, 'Warszawa na żywo', cx + 52, cy + 200, font(P ? 52 : 48, 600, DISPLAY), C.paper);
    const n = Math.round(1090 * E.outCubic(prog(u, 5, 6.6)));
    text(ctx, `${n.toLocaleString('pl-PL')} pojazdów teraz`, cx + 54, cy + 262, font(P ? 36 : 32, 500, UI), C.muted);
    ctx.restore();
  }
}

// ---------------------------------------------------------------- S3–13 taśma funkcji   (u 8..58)
function featIndex(u) { let i = 0; while (i + 1 < FEAT.length && u >= FEAT[i + 1].b - 0.3) i++; return i; }
function paintFeature(ctx, i, b, u, IMG) {
  const f = FEAT[i];
  const cam = featCam(f, u);
  const img = IMG[f.img];
  if (i === 0 && u < 10) {
    // przed stuknięciem: ta sama mapa co w S2, potem koło z punktu stuknięcia odsłania wybrany autobus
    const m = mapImg(IMG);
    if (m) cover(ctx, m, b.x, b.y, b.w, b.h, { fx: 0.5, fy: 0.5, zoom: 1.06 });
    if (img) {
      const [tx, ty] = coverPoint(img, b, { fx: 0.5, fy: 0.5, zoom: 1 }, TAP);
      const rr = E.inOutCubic(prog(u, 9.05, 9.7)) * Math.hypot(b.w, b.h);
      if (rr > 0) { ctx.save(); ctx.beginPath(); ctx.arc(tx, ty, rr, 0, M.TAU); ctx.clip(); cover(ctx, img, b.x, b.y, b.w, b.h, cam); ctx.restore(); }
      const tk = prog(u, 8.75, 9.6);
      if (tk > 0 && tk < 1) ring(ctx, tx, ty, lerp(14, 70, E.outCubic(tk)), 1 - tk, 7);
    }
    return;
  }
  if (img) cover(ctx, img, b.x, b.y, b.w, b.h, cam);
  if (f.dot && img) {
    const [x, y] = coverPoint(img, b, cam, f.dot);
    const p = (u - f.b - 1) % 1.5;
    if (u > f.b + 1) ring(ctx, x, y, lerp(30, 90, E.outCubic(p / 1.5)), 1 - p / 1.5, 6);
  }
}
function sceneFeatures(ctx, u, IMG) {
  fill(ctx, C.ink);
  const box = phoneBox();
  // pozycja taśmy: sprężyna przesuwa się o jeden telefon przy każdej funkcji
  const keys = [[0, 0], ...FEAT.slice(1).map((f, i) => [f.b - 0.35, i + 1])];
  const c = springKeys(u, keys, SPRING.gentle);
  const D = P ? box.w + 150 : box.h + 120;
  const lo = Math.floor(c) - 1, hi = Math.ceil(c) + 1;
  // wyjście (57.3..58): ekran wchodzi w kropkę lokalizacji, grafitowe koło zalewa kadr
  for (let i = Math.max(0, lo); i <= Math.min(FEAT.length - 1, hi); i++) {
    const off = (i - c) * D;
    let b = { ...box };
    if (P) { b.x += off; b.cx += off; } else { b.y += off; b.cy += off; }
    let bezel = 1;
    if (i === 0 && u < 10) {
      // od 7.4 mapa zjeżdża z pełnego kadru w ekran telefonu
      const k = springU(u, 7.4, SPRING.gentle);
      b = { x: lerp(0, b.x, k), y: lerp(0, b.y, k), w: lerp(W, b.w, k), h: lerp(H, b.h, k) };
      b.cx = b.x + b.w / 2; b.cy = b.y + b.h / 2; bezel = clamp(k * 1.4);
    }
    const near = clamp(1 - Math.abs(i - c));
    ctx.save();
    ctx.globalAlpha = lerp(0.35, 1, near);
    drawPhone(ctx, b, (bb) => paintFeature(ctx, i, bb, u, IMG), { scale: lerp(0.88, 1, near), bezel });
    ctx.restore();
  }
  labels(ctx, u);
  callouts(ctx, u, IMG, box);
  // licznik tempa w Timelapse
  const tl = FEAT[9];
  if (u > tl.b + 1.6 && u < nextB(9)) {
    const steps = ['×1', '×10', '×100', '×1000'];
    const si = clamp(Math.floor(u - 49), 0, 3);
    const s = FORMAT.safe;
    const k = springU(u, 49 + si, SPRING.bouncy);
    const x = s.x + s.w - 6;
    // w wierszu numeru sceny, po prawej
    const tSize = Math.min(P ? 120 : 150, M.fitSize(ctx, tl.t, 800, DISPLAY, P ? s.w : s.x + s.w - labelX(), 400, -0.03));
    const y = labelBase() - tSize - 50;
    ctx.save(); ctx.globalAlpha = clamp((u - tl.b - 1.6) * 3) * (1 - prog(u, 53.4, 53.7));
    text(ctx, steps[si], x, y + (1 - k) * 30, font(P ? 64 : 72, 700, UI), C.accent, 'right', -2);
    ctx.restore();
  }
}
const labelX = () => (P ? FORMAT.safe.x : FORMAT.safe.x + FORMAT.safe.w * 0.43);
const labelBase = () => (P ? FORMAT.safe.y + 130 : H * 0.31);
function labels(ctx, u) {
  const s = FORMAT.safe;
  const x0 = labelX();
  const maxW = P ? s.w : s.x + s.w - x0;
  FEAT.forEach((f, i) => {
    const a = f.b + (i === 0 ? 0.6 : 0.05), z = nextB(i) - 0.35;
    if (u < a - 0.1 || u > z + 0.6) return;
    const base = labelBase();
    const tSize = Math.min(P ? 120 : 150, M.fitSize(ctx, f.t, 800, DISPLAY, maxW, 400, -0.03));
    const tf = font(tSize, 800, DISPLAY);
    const L = layout(ctx, f.t, tf, -0.03 * tSize);
    const out = E.inBack(prog(u, z, z + 0.4), 1.6);
    // numer
    const nk = springU(u, a, SPRING.snappy);
    ctx.save(); ctx.beginPath(); ctx.rect(0, base - tSize - 140, W, 110); ctx.clip();
    text(ctx, String(i + 1).padStart(2, '0'), x0 + 4, base - tSize - 50 + (1 - nk) * 90 - out * 110, font(P ? 52 : 56, 700, UI), C.accent);
    ctx.restore();
    // tytuł, znak po znaku spod maski
    ctx.save(); ctx.beginPath(); ctx.rect(0, base - tSize * 1.05, W, tSize * 1.35); ctx.clip();
    L.glyphs.forEach((g, j) => {
      const k = springU(u, a + 0.08 + j * 0.03, SPRING.snappy);
      if (k <= 0) return;
      glyph(ctx, g.ch, x0 + g.cx, base + (1 - k) * tSize * 1.2 - out * tSize * 1.3, tf, C.paper);
    });
    ctx.restore();
    // podpis
    const sk = E.outQuint(prog(u, a + 0.45, a + 0.95));
    if (sk > 0) {
      const sSize = P ? 46 : 52;
      ctx.save(); ctx.globalAlpha = sk * (1 - out);
      text(ctx, f.s, x0 + 6, base + sSize * 1.6 + (1 - sk) * 24, font(sSize, 500, DISPLAY), C.muted);
      ctx.restore();
    }
  });
}


// Powiększony wycinek prawdziwego zrzutu: wyjeżdża ze swojego miejsca na ekranie telefonu.
function calloutTarget(f, img) {
  const s = FORMAT.safe;
  const [, , cw, ch] = f.crop;
  const x = labelX();
  const top = labelBase() + (P ? 190 : 150);
  const maxW = P ? s.w : s.x + s.w - x, maxH = P ? 560 : H - s.y - top;
  const sc = Math.min(maxW / cw, maxH / ch);
  void img;
  return { x: P ? s.x + (s.w - cw * sc) / 2 : x, y: top, w: cw * sc, h: ch * sc };
}
function callouts(ctx, u, IMG, box) {
  FEAT.forEach((f, i) => {
    const img = IMG[f.img];
    if (!img || !f.crop) return;
    const a = (f.zAt ?? f.b + 0.6) + 0.35, z = nextB(i) - 0.35;
    if (u < a || u > z + 0.6) return;
    const k = springU(u, a, SPRING.gentle);
    const out = E.inBack(prog(u, z - 0.1, z + 0.35), 1.4);
    // skąd: prostokąt wycinka na ekranie telefonu (w spoczynku, z aktualnym najazdem kamery)
    const cam = featCam(f, u);
    const [cx, cy, cw, ch] = f.crop;
    const [x0, y0] = coverPoint(img, box, cam, [cx / img.width, cy / img.height]);
    const [x1, y1] = coverPoint(img, box, cam, [(cx + cw) / img.width, (cy + ch) / img.height]);
    const T = calloutTarget(f, img);
    const r = { x: lerp(x0, T.x, k), y: lerp(y0, T.y, k), w: lerp(x1 - x0, T.w, k), h: lerp(y1 - y0, T.h, k) };
    if (out > 0) r.y -= out * (P ? 260 : 220);
    ctx.save();
    ctx.globalAlpha = clamp(k * 3) * (1 - clamp(out));
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 50; ctx.shadowOffsetY = 18;
    rrect(ctx, r.x, r.y, r.w, r.h, 22); ctx.fillStyle = C.deep; ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.save(); rrect(ctx, r.x, r.y, r.w, r.h, 22); ctx.clip();
    ctx.drawImage(img, cx, cy, cw, ch, r.x, r.y, r.w, r.h);
    ctx.restore();
    // cienka ramka w kolorze akcentu podkreśla, skąd wycinek pochodzi
    ctx.lineWidth = 3; ctx.strokeStyle = C.accent; rrect(ctx, r.x, r.y, r.w, r.h, 22); ctx.stroke();
    ctx.restore();
  });
}

// ---------------------------------------------------------------- przejście w kropkę i plansza końcowa   (u 57.3..64)
function dotWipe(ctx, u, IMG) {
  // koło z grafitu rośnie od kropki lokalizacji (pozycja na ekranie telefonu w spoczynku)
  const f = FEAT[10], img = IMG[f.img];
  if (!img) return;
  const [x, y] = coverPoint(img, phoneBox(), featCam(f, u), f.dot);
  const r = E.inCubic(prog(u, 57.35, 58)) * Math.hypot(W, H);
  if (r <= 0) return;
  ctx.beginPath(); ctx.arc(x, y, r, 0, M.TAU); ctx.fillStyle = C.deep; ctx.fill();
}
function sceneEnd(ctx, u) {
  fill(ctx, C.deep);
  const s = FORMAT.safe;
  const size = P ? 210 : 230;
  const f = font(size, 800, DISPLAY);
  const L = layout(ctx, 'wawEye', f, -0.03 * size);
  const base = P ? s.y + s.h * 0.42 : H * 0.47;
  const x0 = s.x;
  ctx.save(); ctx.beginPath(); ctx.rect(0, base - size * 1.05, W, size * 1.32); ctx.clip();
  L.glyphs.forEach((g, j) => {
    const k = springU(u, 57.85 + j * 0.05, SPRING.bouncy);
    if (k <= 0) return;
    const q = 0.06 * wobble(u - 58.4 - j * 0.05, 2.4, 6);
    glyph(ctx, g.ch, x0 + g.cx, base + (1 - k) * size * 1.2, f, C.accent, 1 + q, 1 - q);
  });
  ctx.restore();
  // adres, znak po znaku
  const url = 'waweye.vercel.app';
  const uf = font(P ? 64 : 72, 600, UI);
  const UL = layout(ctx, url, uf, 0);
  UL.glyphs.forEach((g, j) => {
    const k = springU(u, 58.75 + j * 0.018, SPRING.snappy);
    if (k <= 0) return;
    glyph(ctx, g.ch, x0 + 8 + g.cx, base + (P ? 120 : 130) + (1 - k) * 40, uf, C.paper, 1, k);
  });
  const lk = E.outQuint(prog(u, 59.5, 60.1));
  if (lk > 0) {
    ctx.save(); ctx.globalAlpha = lk;
    const lf = font(P ? 46 : 50, 500, DISPLAY);
    const lines = P ? ['Komunikacja miejska w Warszawie', 'na żywo. Bez logowania', 'i instalacji.'] : ['Komunikacja miejska w Warszawie na żywo.', 'Bez logowania i instalacji.'];
    lines.forEach((l, i) => text(ctx, l, x0 + 8, base + (P ? 230 : 240) + i * (P ? 64 : 70) + (1 - lk) * 20, lf, C.muted));
    ctx.restore();
  }
  const ak = prog(u, 60.2, 60.8);
  if (ak > 0) {
    ctx.save(); ctx.globalAlpha = ak * 0.8;
    text(ctx, 'dane: m.st. Warszawa · mapa: © współtwórcy OpenStreetMap', x0 + 8, P ? s.y + s.h - 10 : H - s.y, font(P ? 30 : 30, 400, UI), C.muted);
    ctx.restore();
  }
}

M.film({
  fonts: [font(100, 800, DISPLAY), font(100, 600, DISPLAY), font(100, 500, DISPLAY), font(40, 500, UI), font(40, 700, UI), font(40, 400, UI)],
  async init() {
    // napisy po polsku: dociągnij też podzbiór latin-ext obu krojów
    await Promise.all(['800', '600', '500'].map((w) => document.fonts.load(`${w} 100px ${DISPLAY}`, 'ąćęłńóśźżŚĆŻŁ'))
      .concat(['400', '500', '600', '700'].map((w) => document.fonts.load(`${w} 40px ${UI}`, 'ąćęłńóśźż×'))));
  },
  images: {
    mapD: 'assets/shots/desktop_viewport.png', mapM: 'assets/shots/mobile_viewport.png',
    ...Object.fromEntries(FEAT.map((f) => [f.img, `assets/shots/m-${f.img}.png`])),
  },
  hits: HITS,
  draw(ctx, u, t, IMG) {
    if (u < 4) sceneHook(ctx, u);
    else if (u < 7.4) sceneMap(ctx, u, IMG);
    else if (u < 58) { sceneFeatures(ctx, u, IMG); dotWipe(ctx, u, IMG); }
    else sceneEnd(ctx, u);
  },
});
