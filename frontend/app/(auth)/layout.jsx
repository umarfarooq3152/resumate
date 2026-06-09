import Link from 'next/link';
import Logo from '../../components/Logo';
import { Bot } from 'lucide-react';

const C = '#22d3ee';
const P = '#a855f7';

export default function AuthLayout({ children }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex' }}>

      {/* ── Left: form panel ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#fff' }}>
        {/* top bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 32px', borderBottom: '1px solid #f1f5f9' }}>
          <Link href="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 28, height: 28, background: `linear-gradient(135deg,${C},${P})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Bot size={14} color="#fff" />
            </div>
            <span style={{ fontWeight: 800, color: '#0f172a', fontSize: 14, letterSpacing: '-0.02em' }}>RESUMATE</span>
          </Link>
          <Link href="/" style={{ fontSize: 12, color: '#94a3b8', textDecoration: 'none' }}>
            ← Back to home
          </Link>
        </div>

        {/* form content */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 24px' }}>
          <div style={{ width: '100%', maxWidth: 360 }}>
            {children}
          </div>
        </div>

        <p style={{ textAlign: 'center', fontSize: 11, color: '#cbd5e1', paddingBottom: 24, paddingLeft: 16, paddingRight: 16 }}>
          By continuing you agree to our{' '}
          <span style={{ textDecoration: 'underline', cursor: 'pointer' }}>Terms</span>
          {' '}and{' '}
          <span style={{ textDecoration: 'underline', cursor: 'pointer' }}>Privacy Policy</span>.
        </p>
      </div>

      {/* ── Right: branding panel ── */}
      <div style={{
        display: 'none',
        width: 480,
        flexShrink: 0,
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'flex-start',
        background: '#08090f',
        padding: '64px 56px',
        position: 'relative',
        overflow: 'hidden',
      }} className="auth-right-panel">

        {/* top cyan line accent */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg,${C},${P})` }} />

        {/* faint grid */}
        <div style={{
          position: 'absolute', inset: 0, opacity: 0.04,
          backgroundImage: `linear-gradient(${C} 1px,transparent 1px),linear-gradient(90deg,${C} 1px,transparent 1px)`,
          backgroundSize: '48px 48px',
          pointerEvents: 'none',
        }} />

        {/* corner glow */}
        <div style={{ position: 'absolute', bottom: -80, right: -80, width: 320, height: 320, background: `${P}18`, borderRadius: '50%', filter: 'blur(80px)', pointerEvents: 'none' }} />

        <div style={{ position: 'relative' }}>
          {/* logo mark */}
          <div style={{ width: 48, height: 48, background: `linear-gradient(135deg,${C},${P})`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 32, boxShadow: `0 0 32px ${C}44` }}>
            <Bot size={22} color="#fff" />
          </div>

          {/* wordmark */}
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.18em', color: C, marginBottom: 16, textTransform: 'uppercase' }}>
            Resumate
          </p>

          <h2 style={{ fontSize: 40, fontWeight: 900, color: '#fff', lineHeight: 1.1, letterSpacing: '-0.03em', marginBottom: 20 }}>
            Your resume,<br />
            <span style={{ background: `linear-gradient(135deg,${C},${P})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              perfectly applied.
            </span>
          </h2>

          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.35)', lineHeight: 1.7, maxWidth: 320 }}>
            AI finds jobs, scores them against your profile,<br />
            tailors every application — you approve each send.
          </p>

          {/* divider */}
          <div style={{ width: 48, height: 2, background: `linear-gradient(90deg,${C},${P})`, margin: '36px 0' }} />

          {/* single stat row */}
          <div style={{ display: 'flex', gap: 40 }}>
            {[
              { v: '10+', l: 'Job boards' },
              { v: '0–100', l: 'AI fit score' },
              { v: '100%', l: 'You approve' },
            ].map(({ v, l }) => (
              <div key={l}>
                <p style={{ fontSize: 22, fontWeight: 900, color: '#fff' }}>{v}</p>
                <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{l}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
