import React from 'react';
import { AbsoluteFill, Audio, continueRender, delayRender, interpolate, Sequence, staticFile, useCurrentFrame, Easing } from 'remotion';
import { Mapa } from './components/Mapa';
import { B1Miasto } from './scenes/B1Miasto';
import { B2Dzien } from './scenes/B2Dzien';
import { B3Dane } from './scenes/B3Dane';
import { B4Inwestycja } from './scenes/B4Inwestycja';
import { BEATS, END, MAP_DIM_B3, VO } from './timing';
import { C } from './look';

const fonts = delayRender('fonts');
Promise.all([
  new FontFace('Archivo', `url(${staticFile('archivo-latin.woff2')})`, { weight: '100 900' }).load(),
  new FontFace('JetBrains Mono', `url(${staticFile('jetbrains-mono-latin.woff2')})`, { weight: '100 800' }).load(),
]).then((fs) => { fs.forEach((x) => document.fonts.add(x)); continueRender(fonts); });

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const inBeat = (f: number, b: { from: number; to: number }) => f >= b.from && f < b.to;

// ghost: text drawn transparent (halo kept), used only by the contrast check to see what sits behind the letters.
export const Film: React.FC<{ ghost?: boolean }> = ({ ghost = false }) => {
  const f = useCurrentFrame();
  const dim = interpolate(f, [BEATS.b3.from, BEATS.b3.from + 12, END.mapOut, END.mapOut + END.mapOutLen], [1, MAP_DIM_B3, MAP_DIM_B3, 0], { ...clamp, easing: Easing.bezier(0.65, 0, 0.35, 1) });
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg }}>
      {ghost && <style>{'.txt, .txt * { color: transparent !important; } text.txt { fill: transparent !important; }'}</style>}
      {f < END.heroOut && <Mapa frame={f} dim={dim} heroOpacity={interpolate(f, [END.mapOut, END.heroOut], [1, 0], clamp)} />}
      {inBeat(f, BEATS.b1) && <B1Miasto />}
      {inBeat(f, BEATS.b2) && <B2Dzien />}
      {inBeat(f, BEATS.b3) && <B3Dane />}
      {inBeat(f, BEATS.b4) && <B4Inwestycja />}
      {Object.entries(VO).map(([k, v]) => (
        <Sequence key={k} from={v.at} durationInFrames={v.len + 6}>
          <Audio src={staticFile(`vo/${k}.wav`)} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
