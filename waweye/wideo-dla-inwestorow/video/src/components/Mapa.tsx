import React from 'react';
import { Easing, interpolate } from 'remotion';
import dane from '../dane.json';
import { ACCENT, BEATS, CAMERA, DATA_TIME, REVEAL } from '../timing';
import { C, FONT, TYPE } from '../look';

type Pt = [number, number];
const veh = dane.veh as { tram: boolean; line: string; pts: Pt[] }[];
const hero = dane.hero as { index: number; line: string; parking: { x: number; y: number; free: number }; incident: Pt[] };
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const inOut = Easing.bezier(0.65, 0, 0.35, 1);

// Built once: SVG paths for traces and water, and each trace's distance from the centre (for the reveal order).
const pathOf = (p: Pt[]) => 'M' + p.map((q) => q.join(' ')).join('L');
const incMid = hero.incident[Math.floor(hero.incident.length / 2)];
const traces = veh.map((v, i) => ({ i, d: pathOf(v.pts), r: Math.hypot(v.pts[0][0] - 960, v.pts[0][1] - 560) }));
const maxR = Math.max(...traces.map((t) => t.r));
const waterPath = (dane.water as Pt[]).map(([x, y]) => `M${x} ${y}h1.6v1.6h-1.6z`).join('');

export const dataSample = (f: number) => interpolate(f, [DATA_TIME.from, DATA_TIME.to], [DATA_TIME.s0, DATA_TIME.s1], clamp);
export const posAt = (pts: Pt[], s: number): Pt => {
  const k = Math.min(pts.length - 2, Math.floor(s));
  const t = s - k;
  return [pts[k][0] + (pts[k + 1][0] - pts[k][0]) * t, pts[k][1] + (pts[k + 1][1] - pts[k][1]) * t];
};

export const camera = (f: number) => {
  const fs = CAMERA.map((k) => k.f);
  const pick = (key: 'z' | 'wx' | 'wy' | 'sx' | 'sy') => interpolate(f, fs, CAMERA.map((k) => k[key]), { ...clamp, easing: inOut });
  return { z: pick('z'), wx: pick('wx'), wy: pick('wy'), sx: pick('sx'), sy: pick('sy') };
};

const accentOwner = (f: number) =>
  f >= BEATS.b2.from && f < ACCENT.busAgain
    ? f >= ACCENT.incident ? 'incident' : f >= ACCENT.parking ? 'parking' : 'bus'
    : 'bus';

export const Mapa: React.FC<{ frame: number; dim?: number; heroOpacity?: number }> = ({ frame, dim = 1, heroOpacity = 1 }) => {
  const cam = camera(frame);
  const s = dataSample(frame);
  const owner = accentOwner(frame);
  const px = 1 / cam.z; // one screen pixel in world units
  const b2 = interpolate(frame, [BEATS.b2.from, BEATS.b2.from + 12, ACCENT.busAgain - 6, ACCENT.busAgain + 6], [0, 1, 1, 0], clamp);
  const [hx, hy] = posAt(veh[hero.index].pts, s);
  const P = hero.parking;
  const ease = Easing.bezier(0.16, 1, 0.3, 1);
  const parkIn = interpolate(frame, [ACCENT.parking - 4, ACCENT.parking + 10], [0, 1], { ...clamp, easing: ease });
  const incIn = interpolate(frame, [ACCENT.incident - 4, ACCENT.incident + 12], [0, 1], { ...clamp, easing: ease });
  return (
    <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}>
      <g transform={`translate(${cam.sx} ${cam.sy}) scale(${cam.z}) translate(${-cam.wx} ${-cam.wy})`}>
       <g opacity={dim}>
        {/* The river is a dot grid from map tiles: it reads at city scale and turns to pixels when zoomed, so it fades out. */}
        <path d={waterPath} fill={C.muted} opacity={interpolate(cam.z, [1.15, 1.8], [0.1, 0], clamp)} />
        <g fill="none" stroke={C.muted} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" style={{ vectorEffect: 'non-scaling-stroke' } as React.CSSProperties}>
          {traces.map((t) => {
            const start = REVEAL.from + (t.r / maxR) * (REVEAL.to - REVEAL.perTrace - REVEAL.from);
            const o = interpolate(frame, [start, start + REVEAL.perTrace], [0, 0.3], clamp);
            return o > 0 ? <path key={t.i} d={t.d} opacity={o} vectorEffect="non-scaling-stroke" /> : null;
          })}
        </g>
        {veh.map((v, i) => {
          if (i === hero.index) return null;
          const t = traces[i];
          const start = REVEAL.from + (t.r / maxR) * (REVEAL.to - REVEAL.perTrace - REVEAL.from);
          const o = interpolate(frame, [start + 4, start + 4 + REVEAL.perTrace], [0, 0.9], clamp);
          if (o <= 0) return null;
          const [x, y] = posAt(v.pts, s);
          return <circle key={i} cx={x} cy={y} r={2.2 * px} fill={v.tram ? C.ink : C.muted} opacity={o * (v.tram ? 0.55 : 0.8)} />;
        })}
       </g>
        {b2 > 0 && (
          <g opacity={b2}>
            <path d={pathOf(hero.incident)} fill="none" stroke={owner === 'incident' ? C.accent : C.muted} strokeWidth={10 * px} strokeLinecap="round" opacity={incIn} />
            <circle cx={incMid[0]} cy={incMid[1]} r={(26 + 10 * incIn) * px} fill="none" stroke={owner === 'incident' ? C.accent : C.muted} strokeWidth={3 * px} opacity={incIn} />
            <g transform={`translate(${P.x} ${P.y}) scale(${px * (0.6 + 0.4 * parkIn)})`} opacity={parkIn}>
              <rect x={-18} y={-18} width={36} height={36} rx={9} fill={owner === 'parking' ? C.accent : C.muted} />
              <text x={0} y={9} textAnchor="middle" fontFamily={FONT.head} fontWeight={800} fontSize={26} fill={C.bg}>P</text>
              <text className="txt" x={28} y={10} fontFamily={FONT.mono} fontWeight={500} fontSize={TYPE.label} fill={C.ink} stroke={C.bg} strokeWidth={10} strokeLinejoin="round" paintOrder="stroke">{P.free} free</text>
            </g>
          </g>
        )}
        <g transform={`translate(${hx} ${hy}) scale(${px})`} opacity={heroOpacity}>
          <circle r={14} fill={owner === 'bus' ? C.accent : C.muted} />
          <circle r={20} fill="none" stroke={owner === 'bus' ? C.accent : C.muted} strokeWidth={3} opacity={b2} />
        </g>
      </g>
    </svg>
  );
};
