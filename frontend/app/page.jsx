import Link from 'next/link';
import SplineHero from '@/components/SplineHero';
import {
  Bot, Search, Target, FileEdit, Send, ShieldCheck,
  ClipboardList, BarChart3, ArrowRight, CheckCircle2,
  Zap, ChevronRight, Lock, Star, Play, Database, Cpu,
} from 'lucide-react';

// v2 — dark space theme matching Spline scene
const FEATURES = [
  { icon: Search,      title: 'Smart Job Discovery',   desc: 'Scans Adzuna, Remotive and more continuously. Fresh listings every run, zero duplicates.',         accent: '#22d3ee' },
  { icon: Target,      title: 'AI Match Scoring',       desc: 'Gemini AI scores every job 0–100 against your resume with strengths, gaps and plain reasoning.',    accent: '#a855f7' },
  { icon: FileEdit,    title: 'Tailored Documents',     desc: 'Generates a custom resume and cover letter per job. Grounded in your real CV, no hallucinations.',  accent: '#22d3ee' },
  { icon: ClipboardList,title:'Google Forms Filler',    desc: 'Paste any application link. AI fills every field from your profile. You review before submit.',     accent: '#ec4899' },
  { icon: ShieldCheck, title: 'Human-in-the-Loop',      desc: 'Nothing submitted without your explicit approval. Every match and application waits for your sign-off.', accent: '#a855f7' },
  { icon: BarChart3,   title: 'Full Audit Trail',       desc: 'Every AI decision is logged. See what was sent, when, and why — and undo if needed.',               accent: '#22d3ee' },
];

const STEPS = [
  { title: 'Upload your resume',          desc: 'Paste or upload your CV. Gemini AI parses skills, experience and goals automatically.' },
  { title: 'Set your preferences',        desc: 'Choose role, location and keywords. The agent scans job boards on every run.' },
  { title: 'AI scores every match',       desc: 'Each job gets a 0–100 fit score with a clear breakdown of strengths and skill gaps.' },
  { title: 'You review and approve',      desc: "See the AI's reasoning, edit the tailored resume and cover letter, then approve or reject." },
  { title: 'Applications sent automatically', desc: 'Approved applications go out automatically — you only make the decisions.' },
];

const PRICING = [
  {
    name: 'Starter', price: 'Free', period: '',
    desc: 'For individuals getting started.',
    features: ['50 jobs scanned / month', 'AI match scoring', 'Manual document review', 'Google Forms filler'],
    cta: 'Get started free', href: '/register', highlight: false,
  },
  {
    name: 'Pro', price: '$19', period: '/ mo',
    desc: 'For active job seekers who want full automation.',
    features: ['Unlimited job discovery', 'Priority AI scoring', 'Auto-tailored documents', 'WhatsApp integration', 'Gmail scan + drafts', 'One-click applications'],
    cta: 'Start Pro trial', href: '/register', highlight: true,
  },
  {
    name: 'Team', price: '$49', period: '/ mo',
    desc: 'For recruiters managing multiple profiles.',
    features: ['Everything in Pro', 'Up to 5 profiles', 'Shared dashboard', 'Custom filters', 'Priority support'],
    cta: 'Contact us', href: '/register', highlight: false,
  },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-[#08090f] overflow-x-hidden" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>

      {/* ─── Navbar ──────────────────────────────────────────────────── */}
      <nav className="fixed top-0 inset-x-0 z-50 flex items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg,#22d3ee,#a855f7)', boxShadow: '0 0 16px rgba(34,211,238,0.35)' }}>
            <Bot className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-white tracking-tight">Resumate</span>
        </Link>

        <div className="flex items-center gap-3">
          <Link href="/login" className="text-sm font-medium text-white/50 hover:text-white transition-colors px-3 py-1.5">
            Sign in
          </Link>
          <Link href="/register"
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-bold rounded-xl text-white"
            style={{ background: 'linear-gradient(135deg,#22d3ee,#a855f7)', boxShadow: '0 0 20px rgba(34,211,238,0.3)' }}>
            Get started <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </nav>

      {/* ─── Hero (Spline) ───────────────────────────────────────────── */}
      <section style={{ width: '100vw', height: '100vh' }}>
        <SplineHero />
      </section>

      {/* ─── Stats ───────────────────────────────────────────────────── */}
      <div className="py-16 px-6" style={{ borderTop: '1px solid rgba(34,211,238,0.08)', background: 'rgba(34,211,238,0.02)' }}>
        <div className="max-w-4xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8">
          {[
            { v: '10+',    l: 'Job boards',      s: 'Adzuna, Remotive & more' },
            { v: '0–100',  l: 'AI fit score',    s: 'per job, per profile' },
            { v: '100%',   l: 'Human approval',  s: 'nothing sent without you' },
            { v: '< 5 min',l: 'Setup time',      s: 'upload resume → first scan' },
          ].map(({ v, l, s }) => (
            <div key={l} className="text-center">
              <p className="text-3xl font-black text-white tabular-nums" style={{ textShadow: '0 0 30px rgba(34,211,238,0.4)' }}>{v}</p>
              <p className="text-[10px] font-bold uppercase tracking-widest mt-1" style={{ color: '#22d3ee' }}>{l}</p>
              <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.3)' }}>{s}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ─── How it works ────────────────────────────────────────────── */}
      <section id="how-it-works" className="py-24 px-6" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="max-w-3xl mx-auto">
          <div className="mb-16">
            <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: '#22d3ee' }}>How it works</p>
            <h2 className="text-4xl md:text-5xl font-black text-white tracking-tight">Five steps,<br />fully automated.</h2>
            <p className="mt-4 text-base leading-relaxed max-w-md" style={{ color: 'rgba(255,255,255,0.4)' }}>
              From discovery to submission the agent handles everything. You only approve.
            </p>
          </div>

          <div>
            {STEPS.map(({ title, desc }, i) => (
              <div key={title} className="flex gap-6 group">
                <div className="flex flex-col items-center">
                  <div className="w-9 h-9 rounded-xl text-sm font-black flex items-center justify-center shrink-0 transition-all"
                    style={{ background: 'rgba(34,211,238,0.1)', border: '1px solid rgba(34,211,238,0.25)', color: '#22d3ee' }}>
                    {i + 1}
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className="w-px flex-1 mt-2 min-h-[2rem]"
                      style={{ background: 'linear-gradient(to bottom, rgba(34,211,238,0.25), transparent)' }} />
                  )}
                </div>
                <div className="pb-10 pt-1.5">
                  <p className="font-bold text-white mb-1.5">{title}</p>
                  <p className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.4)' }}>{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Features ────────────────────────────────────────────────── */}
      <section id="features" className="py-24 px-6" style={{ borderTop: '1px solid rgba(255,255,255,0.05)', background: 'rgba(34,211,238,0.015)' }}>
        <div className="max-w-5xl mx-auto">
          <div className="mb-14">
            <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: '#22d3ee' }}>Features</p>
            <h2 className="text-4xl md:text-5xl font-black text-white tracking-tight">Everything you need<br />to get hired.</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map(({ icon: Icon, title, desc, accent }) => (
              <div key={title} className="group relative p-6 rounded-2xl overflow-hidden cursor-default transition-all duration-200 hover:bg-white/[0.06] hover:border-white/20"
                style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid rgba(255,255,255,0.07)` }}>
                <div className="w-10 h-10 rounded-xl mb-5 flex items-center justify-center"
                  style={{ background: `${accent}18`, border: `1px solid ${accent}30`, boxShadow: `0 0 20px ${accent}20` }}>
                  <Icon className="w-5 h-5" style={{ color: accent }} />
                </div>
                <h3 className="font-bold text-white mb-2 text-sm">{title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.4)' }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Pricing ─────────────────────────────────────────────────── */}
      <section id="pricing" className="py-24 px-6" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: '#22d3ee' }}>Pricing</p>
            <h2 className="text-4xl md:text-5xl font-black text-white tracking-tight">Simple, honest pricing.</h2>
            <p className="mt-4 text-base" style={{ color: 'rgba(255,255,255,0.4)' }}>Start free. No credit card required.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {PRICING.map(({ name, price, period, desc, features, cta, href, highlight }) => (
              <div key={name} className="relative rounded-2xl p-7 flex flex-col transition-all duration-200"
                style={highlight ? {
                  background: 'linear-gradient(135deg, rgba(34,211,238,0.1), rgba(168,85,247,0.1))',
                  border: '1px solid rgba(34,211,238,0.35)',
                  boxShadow: '0 0 40px rgba(34,211,238,0.1), 0 0 80px rgba(168,85,247,0.08)',
                } : {
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.08)',
                }}>
                {highlight && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider"
                    style={{ background: 'linear-gradient(135deg,#22d3ee,#a855f7)', color: '#08090f' }}>
                    <Star className="w-2.5 h-2.5" fill="currentColor" /> Most popular
                  </div>
                )}
                <div className="mb-6">
                  <p className="text-sm font-bold mb-2" style={{ color: highlight ? '#22d3ee' : 'rgba(255,255,255,0.5)' }}>{name}</p>
                  <div className="flex items-baseline gap-1 mb-3">
                    <span className="text-4xl font-black text-white">{price}</span>
                    {period && <span className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.4)' }}>{period}</span>}
                  </div>
                  <p className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.4)' }}>{desc}</p>
                </div>
                <ul className="space-y-2.5 mb-8 flex-1">
                  {features.map(f => (
                    <li key={f} className="flex items-start gap-2.5 text-sm">
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" style={{ color: highlight ? '#22d3ee' : '#a855f7' }} />
                      <span style={{ color: 'rgba(255,255,255,0.7)' }}>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link href={href}
                  className="w-full py-2.5 rounded-xl text-sm font-bold text-center transition-all block"
                  style={highlight ? {
                    background: 'linear-gradient(135deg,#22d3ee,#a855f7)',
                    color: '#08090f',
                    boxShadow: '0 0 20px rgba(34,211,238,0.3)',
                  } : {
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    color: 'white',
                  }}>
                  {cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Trust badges ────────────────────────────────────────────── */}
      <div className="py-12 px-6" style={{ borderTop: '1px solid rgba(255,255,255,0.05)', background: 'rgba(168,85,247,0.02)' }}>
        <div className="max-w-4xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { icon: Lock,        title: 'Data encrypted',   sub: 'AES-256 at rest + in transit' },
            { icon: ShieldCheck, title: 'HITL approval',    sub: '100% of submissions require sign-off' },
            { icon: Database,    title: 'Supabase hosted',  sub: 'Postgres + row-level security' },
            { icon: Cpu,         title: 'Dry-run mode',     sub: 'Safe default — no real sends until ready' },
          ].map(({ icon: Icon, title, sub }, i) => (
            <div key={title} className="flex items-start gap-3 p-4 rounded-xl"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: i % 2 === 0 ? 'rgba(34,211,238,0.1)' : 'rgba(168,85,247,0.1)', border: i % 2 === 0 ? '1px solid rgba(34,211,238,0.2)' : '1px solid rgba(168,85,247,0.2)' }}>
                <Icon className="w-3.5 h-3.5" style={{ color: i % 2 === 0 ? '#22d3ee' : '#a855f7' }} />
              </div>
              <div>
                <p className="text-xs font-bold text-white">{title}</p>
                <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: 'rgba(255,255,255,0.3)' }}>{sub}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ─── Final CTA ───────────────────────────────────────────────── */}
      <section className="py-28 px-6 relative overflow-hidden" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at center, rgba(34,211,238,0.05) 0%, transparent 65%)' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(ellipse, rgba(168,85,247,0.06) 0%, transparent 70%)', filter: 'blur(40px)' }} />
        <div className="relative max-w-2xl mx-auto text-center">
          <h2 className="text-4xl md:text-5xl font-black text-white mb-5 tracking-tight">
            Stop applying manually.
          </h2>
          <p className="mb-8 text-base max-w-md mx-auto leading-relaxed" style={{ color: 'rgba(255,255,255,0.4)' }}>
            Set up in under 5 minutes. The agent handles the rest while you focus on interview prep.
          </p>
          <Link href="/register"
            className="inline-flex items-center gap-2 px-8 py-4 font-bold rounded-xl text-sm group transition-all"
            style={{ background: 'linear-gradient(135deg,#22d3ee,#a855f7)', color: '#08090f', boxShadow: '0 0 40px rgba(34,211,238,0.25), 0 0 80px rgba(168,85,247,0.15)' }}>
            Create your free account
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </Link>
          <p className="mt-4 text-xs" style={{ color: 'rgba(255,255,255,0.2)' }}>No credit card · Free forever plan · Cancel anytime</p>
        </div>
      </section>

      {/* ─── Footer ──────────────────────────────────────────────────── */}
      <footer className="px-6 py-10" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg,#22d3ee,#a855f7)' }}>
              <Bot className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-bold text-white">Resumate</span>
          </div>
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.2)' }}>
            Built with Next.js · Supabase · Gemini AI · Adzuna
          </p>
          <div className="flex items-center gap-5 text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
            <Link href="/login"    className="hover:text-white transition-colors">Sign in</Link>
            <Link href="/register" className="hover:text-white transition-colors">Get started</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
