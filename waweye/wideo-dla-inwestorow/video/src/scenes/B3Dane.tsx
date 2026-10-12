import React from 'react';
import { Easing, interpolate, useCurrentFrame } from 'remotion';
import dane from '../dane.json';
import { HALO, KNOCKOUT, Zdanie } from '../components/Zdanie';
import { BEATS, STATS, VO } from '../timing';
import { C, FONT, TYPE } from '../look';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const easeOut = Easing.bezier(0.16, 1, 0.3, 1);
const easeIn = Easing.bezier(0.7, 0, 0.84, 0);
const st = dane.stats;
const ITEMS = [
  { n: st.live, label: 'vehicles live' },
  { n: st.lines, label: 'lines running' },
  { n: st.parkings, label: 'car parks' },
  { n: st.incidentsActive, label: 'active disruptions' },
];

// Beat 3: the same city, now as numbers from the city's open data.
export const B3Dane: React.FC = () => {
  const f = useCurrentFrame();
  const leave = interpolate(f, [BEATS.b3.to - 8, BEATS.b3.to], [0, 1], { ...clamp, easing: easeIn });
  return (
    <>
      <Zdanie frame={f} at={VO.b3.at} out={BEATS.b3.to} text={VO.b3.text} size={TYPE.h2} style={{ left: 96, top: 66 }} />
      {ITEMS.map((it, i) => {
        const a = STATS.at + i * STATS.stagger;
        const p = interpolate(f, [a, a + STATS.count], [0, 1], { ...clamp, easing: easeOut });
        return (
          <div key={i} style={{ position: 'absolute', left: 96 + i * 432, top: 806, opacity: Math.min(1, p * 3) * (1 - leave), transform: `translateY(${(1 - p) * 30 - leave * 20}px)`, textShadow: HALO }}>
            <div className="txt" style={{ fontFamily: FONT.head, fontWeight: 800, fontSize: TYPE.stat, lineHeight: 1, letterSpacing: '-0.01em', color: C.ink }}>
              {Math.round(it.n * p).toLocaleString('en-US')}
            </div>
            <div className="txt" style={{ fontFamily: FONT.mono, fontWeight: 500, fontSize: TYPE.label, color: C.muted, marginTop: 12, ...KNOCKOUT }}>{it.label}</div>
          </div>
        );
      })}
      <div className="txt" style={{ position: 'absolute', left: 96, top: 990, fontFamily: FONT.mono, fontSize: TYPE.small, color: C.muted, ...KNOCKOUT, opacity: interpolate(f, [STATS.at + 10, STATS.at + 22], [0, 1], clamp) * (1 - leave) }}>
        dane.um.warszawa.pl · snapshot 2 Oct 2026, 22:12 Warsaw time
      </div>
    </>
  );
};
