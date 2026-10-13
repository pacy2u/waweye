import React from 'react';
import { Composition } from 'remotion';
import { Film } from './Film';
import { DURATION, FPS, HEIGHT, WIDTH } from './timing';

export const Root: React.FC = () => (
  <Composition id="Film" component={Film} durationInFrames={DURATION} fps={FPS} width={WIDTH} height={HEIGHT} defaultProps={{ ghost: false }} />
);
