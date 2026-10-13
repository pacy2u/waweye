import React from 'react';
import { useCurrentFrame } from 'remotion';
import { Zdanie } from '../components/Zdanie';
import { BEATS, VO } from '../timing';
import { TYPE } from '../look';

// Beat 1: the real network of one night draws itself; "Warsaw never stops moving."
export const B1Miasto: React.FC = () => {
  const f = useCurrentFrame();
  return <Zdanie frame={f} at={VO.b1.at} out={BEATS.b1.to} text={VO.b1.text} size={TYPE.h2} style={{ left: 96, top: 940 }} />;
};
