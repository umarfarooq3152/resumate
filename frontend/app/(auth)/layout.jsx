import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import Logo from '../../components/Logo';

const HIGHLIGHTS = [
  'AI scores every job against your resume',
  'Tailored resume & cover letter, per role',
  'Auto-fill Google Forms from your profile',
  'You approve everything before it sends',
];

export default function AuthLayout({ children }) {
  return (
    <div className="min-h-screen flex">

      {/* ── Left: form panel ── */}
      <div className="flex-1 flex flex-col bg-white">
        {/* top bar */}
        <div className="flex items-center justify-between px-8 py-5 border-b border-slate-100">
          <Link href="/">
            <Logo size={32} withName nameClass="font-bold text-slate-900 text-sm" />
          </Link>
          <Link href="/" className="text-xs text-slate-400 hover:text-slate-600 transition-colors">
            ← Back to home
          </Link>
        </div>

        {/* form content */}
        <div className="flex-1 flex items-center justify-center px-6 py-12">
          <div className="w-full max-w-sm">
            {children}
          </div>
        </div>

        <p className="text-center text-xs text-slate-400 pb-8 px-4">
          By continuing you agree to our{' '}
          <span className="underline cursor-pointer hover:text-slate-600">Terms</span>
          {' '}and{' '}
          <span className="underline cursor-pointer hover:text-slate-600">Privacy Policy</span>.
        </p>
      </div>

      {/* ── Right: branding panel (hidden on mobile) ── */}
      <div className="hidden lg:flex w-[480px] xl:w-[520px] shrink-0 flex-col justify-between bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 p-12 relative overflow-hidden">
        {/* grid overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(99,102,241,.07)_1px,transparent_1px),linear-gradient(90deg,rgba(99,102,241,.07)_1px,transparent_1px)] bg-[size:40px_40px]" />
        {/* glow */}
        <div className="absolute top-20 right-0 w-64 h-64 bg-indigo-600/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-20 left-0 w-48 h-48 bg-violet-600/20 rounded-full blur-3xl pointer-events-none" />

        <div className="relative">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-indigo-500/20 border border-indigo-400/30 rounded-full text-xs font-semibold text-indigo-300 mb-8">
            <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-pulse" />
            AI-powered application automation
          </div>

          <h2 className="text-3xl font-bold text-white leading-snug mb-3 tracking-tight">
            Your resume, perfectly<br />
            <span className="text-indigo-400">matched & applied.</span>
          </h2>
          <p className="text-slate-400 text-sm leading-relaxed mb-8">
            RESUMATE finds jobs, scores them against your profile,
            tailors your resume for each role, and drafts the perfect
            application — while you stay in full control.
          </p>

          <ul className="space-y-3">
            {HIGHLIGHTS.map((h) => (
              <li key={h} className="flex items-start gap-2.5 text-sm text-slate-300">
                <CheckCircle2 className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                {h}
              </li>
            ))}
          </ul>
        </div>

        {/* testimonial-style quote */}
        <div className="relative bg-white/5 border border-white/10 rounded-2xl p-5">
          <p className="text-slate-300 text-sm leading-relaxed italic mb-3">
            "Set it up on Sunday, had three interview invites by Wednesday.
            The tailored cover letters actually sounded like me."
          </p>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-indigo-500/40 flex items-center justify-center text-xs font-bold text-indigo-300">
              S
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-300">Sarah K.</p>
              <p className="text-[10px] text-slate-500">Software Engineer</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
