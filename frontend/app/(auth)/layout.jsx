import Link from 'next/link';
import Logo from '../../components/Logo';

export default function AuthLayout({ children }) {
  return (
    <div className="min-h-screen flex bg-white dark:bg-[#0d0d12]">

      {/* ── Left: form panel ── */}
      <div className="flex-1 flex flex-col bg-white dark:bg-[#0d0d12]">
        {/* top bar */}
        <div className="flex items-center justify-between px-8 py-[18px] border-b border-slate-100 dark:border-white/[0.06]">
          <Link href="/" className="no-underline">
            <Logo height={36} />
          </Link>
          <Link href="/" className="text-xs text-slate-400 dark:text-slate-500 no-underline hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
            ← Back to home
          </Link>
        </div>

        {/* form content */}
        <div className="flex-1 flex items-center justify-center px-6 py-12">
          <div className="w-full max-w-[360px]">
            {children}
          </div>
        </div>

        <p className="text-center text-[11px] text-slate-300 dark:text-slate-600 pb-6 px-4">
          By continuing you agree to our{' '}
          <span className="underline cursor-pointer">Terms</span>
          {' '}and{' '}
          <span className="underline cursor-pointer">Privacy Policy</span>.
        </p>
      </div>

      {/* ── Right: branding panel ── */}
      <div className="auth-right-panel hidden w-[480px] shrink-0 flex-col justify-center items-start bg-[#08090f] px-14 py-16 relative overflow-hidden">
        {/* top accent line */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-cyan-400 to-violet-500" />

        {/* faint grid */}
        <div className="absolute inset-0 opacity-[0.04] pointer-events-none"
          style={{ backgroundImage: 'linear-gradient(#22d3ee 1px,transparent 1px),linear-gradient(90deg,#22d3ee 1px,transparent 1px)', backgroundSize: '48px 48px' }} />

        {/* glow */}
        <div className="absolute -bottom-20 -right-20 w-80 h-80 rounded-full pointer-events-none"
          style={{ background: '#a855f718', filter: 'blur(80px)' }} />

        <div className="relative">
          <div className="mb-10">
            <Logo height={56} />
          </div>

          <h2 className="text-[36px] font-black text-white leading-[1.1] tracking-[-0.03em] mb-4">
            Your resume,<br />
            <span className="bg-gradient-to-br from-cyan-400 to-violet-500 bg-clip-text text-transparent">
              perfectly applied.
            </span>
          </h2>

          <p className="text-sm text-white/35 leading-relaxed max-w-[320px]">
            AI finds jobs, scores them against your profile,<br />
            tailors every application — you approve each send.
          </p>

          <div className="w-12 h-[2px] bg-gradient-to-r from-cyan-400 to-violet-500 my-9" />

          <div className="flex gap-10">
            {[
              { v: '10+', l: 'Job boards' },
              { v: '0–100', l: 'AI fit score' },
              { v: '100%', l: 'You approve' },
            ].map(({ v, l }) => (
              <div key={l}>
                <p className="text-[22px] font-black text-white m-0">{v}</p>
                <p className="text-[10px] text-white/30 mt-0.5 uppercase tracking-[0.1em]">{l}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
