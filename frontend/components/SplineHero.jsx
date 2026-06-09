'use client';
import Spline from '@splinetool/react-spline/next';

export default function SplineHero() {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      overflow: 'hidden',
    }}>
      <Spline
        scene="https://prod.spline.design/0sWxrv4yIUaXMQb6/scene.splinecode"
        style={{
          width: '120%',
          height: '120%',
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%) scale(1.15)',
          transformOrigin: 'center center',
        }}
      />
    </div>
  );
}
