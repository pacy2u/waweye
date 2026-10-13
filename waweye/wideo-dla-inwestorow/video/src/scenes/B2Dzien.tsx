import React from 'react';
import { useCurrentFrame } from 'remotion';
import { Zdanie } from '../components/Zdanie';
import { VO, BEATS } from '../timing';
import { TYPE } from '../look';

// Beat 2: one citizen's day on the map: their bus, a free space, a disruption ahead.
export const B2Dzien: React.FC = () => {
  const f = useCurrentFrame();
  const pos = { left: 96, top: 940 };
  return (
    <>
      <Zdanie frame={f} at={VO.b2a.at} out={VO.b2b.at - 2} text={VO.b2a.text} size={TYPE.h2} style={pos} />
      <Zdanie frame={f} at={VO.b2b.at} out={VO.b2c.at - 2} text={VO.b2b.text} size={TYPE.h2} style={pos} />
      <Zdanie frame={f} at={VO.b2c.at} out={BEATS.b2.to} text={VO.b2c.text} size={TYPE.h2} style={pos} />
    </>
  );
};
