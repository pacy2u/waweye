import React from 'react';
import { Easing, Img, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { Zdanie } from '../components/Zdanie';
import { END, VO } from '../timing';
import { C, FONT, TYPE } from '../look';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const easeOut = Easing.bezier(0.16, 1, 0.3, 1);

// Beat 4: the takeaway, held still: wawEye, open data, open for investment.
export const B4Inwestycja: React.FC = () => {
  const f = useCurrentFrame();
  const logo = interpolate(f, [END.logo, END.logo + 14], [0, 1], { ...clamp, easing: easeOut });
  const url = interpolate(f, [END.url, END.url + 14], [0, 1], { ...clamp, easing: easeOut });
  return (
    <>
      <div style={{ position: 'absolute', left: 96, top: 250, display: 'flex', alignItems: 'center', gap: 36 }}>
        <Img src={staticFile('favicon.svg')} style={{ width: 128, height: 128, opacity: logo, transform: `scale(${0.7 + 0.3 * logo})` }} />
        <Zdanie frame={f} at={VO.b4a.at + 4} text="wawEye" size={TYPE.h1} style={{ position: 'relative' }} />
      </div>
      <Zdanie frame={f} at={VO.b4b.at} text="Open data," size={TYPE.stat} style={{ left: 96, top: 470 }} />
      <Zdanie frame={f} at={VO.b4b.at + 22} text="open for investment." size={TYPE.stat} accent={['investment.']} style={{ left: 96, top: 578 }} />
      <div className="txt" style={{ position: 'absolute', left: 96, top: 770, fontFamily: FONT.mono, fontWeight: 500, fontSize: TYPE.body, color: C.ink, opacity: url, transform: `translateY(${(1 - url) * 16}px)` }}>
        waweye.vercel.app
      </div>
      <div className="txt" style={{ position: 'absolute', left: 96, top: 990, fontFamily: FONT.mono, fontSize: TYPE.small, color: C.muted, opacity: url }}>
        Data: dane.um.warszawa.pl · Vistula outline © OpenStreetMap contributors
      </div>
    </>
  );
};
