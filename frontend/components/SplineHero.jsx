'use client';
import Spline from '@splinetool/react-spline/next';

export default function SplineHero() {
  return (
    <Spline
      scene="https://prod.spline.design/0sWxrv4yIUaXMQb6/scene.splinecode"
      style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}
    />
  );
}
