'use client';
import { Component, useState } from 'react';
import Spline from '@splinetool/react-spline';

const C = '#22d3ee';
const P = '#a855f7';

const Fallback = () => (
  <div style={{ width: '100%', height: '100%', background: '#08090f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <div style={{ textAlign: 'center' }}>
      <p style={{ fontSize: 64, fontWeight: 900, background: `linear-gradient(135deg,${C},${P})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', letterSpacing: '-0.04em', margin: 0 }}>RESUMATE</p>
      <p style={{ color: 'rgba(255,255,255,0.25)', marginTop: 12, fontSize: 14, letterSpacing: '0.08em' }}>AI-powered job applications</p>
    </div>
  </div>
);

class ErrorBoundary extends Component {
  state = { crashed: false };
  static getDerivedStateFromError() { return { crashed: true }; }
  render() { return this.state.crashed ? <Fallback /> : this.props.children; }
}

export default function SplineHero() {
  const [loaded, setLoaded] = useState(false);

  return (
    <ErrorBoundary>
      {/* show fallback text while loading */}
      {!loaded && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
          <Fallback />
        </div>
      )}
      <Spline
        scene="https://prod.spline.design/0sWxrv4yIUaXMQb6/scene.splinecode"
        onLoad={() => setLoaded(true)}
        style={{ width: '100%', height: '100%' }}
      />
    </ErrorBoundary>
  );
}
