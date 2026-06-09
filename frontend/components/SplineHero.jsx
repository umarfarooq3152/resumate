'use client';
import { Component } from 'react';
import Spline from '@splinetool/react-spline/next';

const fallback = (
  <div style={{ width: '100%', height: '100%', background: '#08090f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <div style={{ textAlign: 'center' }}>
      <p style={{ fontSize: 56, fontWeight: 900, background: 'linear-gradient(135deg,#22d3ee,#a855f7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', letterSpacing: '-0.04em' }}>RESUMATE</p>
      <p style={{ color: 'rgba(255,255,255,0.25)', marginTop: 12, fontSize: 14 }}>AI-powered job applications</p>
    </div>
  </div>
);

class SplineBoundary extends Component {
  state = { crashed: false };
  static getDerivedStateFromError() { return { crashed: true }; }
  render() {
    return this.state.crashed ? fallback : this.props.children;
  }
}

export default function SplineHero() {
  return (
    <SplineBoundary>
      <Spline scene="https://prod.spline.design/0sWxrv4yIUaXMQb6/scene.splinecode" />
    </SplineBoundary>
  );
}
