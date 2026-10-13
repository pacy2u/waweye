import React from 'react';
import { Easing, interpolate } from 'remotion';
import { TEXT } from '../timing';
import { C, FONT } from '../look';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const easeOut = Easing.bezier(0.16, 1, 0.3, 1);
// Knocks the map lines out from behind the letters (same colour as the background, so the look stays flat).
export const HALO = [3, 6, 10, 16, 24].map((b) => `0 0 ${b}px ${C.bg}`).join(', ');
// For small text: a solid background-coloured outline drawn under the letters (crisp knockout, still flat).
export const KNOCKOUT: React.CSSProperties = { textShadow: HALO, WebkitTextStroke: `8px ${C.bg}`, paintOrder: 'stroke fill' };
const easeIn = Easing.bezier(0.7, 0, 0.84, 0);

// One on-screen line: words enter staggered with the narration and leave together (eased in) at `out`.
export const Zdanie: React.FC<{
  frame: number; at: number; out?: number; text: string; size: number;
  accent?: string[]; color?: string; style?: React.CSSProperties;
}> = ({ frame, at, out, text, size, accent = [], color = C.ink, style }) => {
  const start = at - TEXT.lead;
  const leave = out === undefined ? 0 : interpolate(frame, [out - TEXT.exit, out], [0, 1], { ...clamp, easing: easeIn });
  return (
    <div className="txt" style={{ position: 'absolute', fontFamily: FONT.head, fontWeight: 800, fontSize: size, lineHeight: 1.05, letterSpacing: '-0.01em', color, whiteSpace: 'nowrap', textShadow: HALO, ...style }}>
      {text.split(' ').map((w, i) => {
        const p = interpolate(frame, [start + i * TEXT.stagger, start + i * TEXT.stagger + TEXT.enter], [0, 1], { ...clamp, easing: easeOut });
        const y = (1 - p) * size * 0.35 - leave * size * 0.25;
        return (
          <span key={i} style={{ display: 'inline-block', opacity: p * (1 - leave), transform: `translateY(${y}px)`, color: accent.includes(w) ? C.accent : undefined }}>
            {w}{i < text.split(' ').length - 1 ? ' ' : ''}
          </span>
        );
      })}
    </div>
  );
};
