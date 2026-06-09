import Link from 'next/link';
import Spline from '@splinetool/react-spline/next';
import {
  Bot, Search, Target, FileEdit, Send, ShieldCheck,
  ClipboardList, BarChart3, ArrowRight, CheckCircle2,
  Zap, ChevronRight, Sparkles, Globe, Lock, TrendingUp,
  Users, Star, Play, Database, Cpu, Layers,
} from 'lucide-react';

/* ─── Data ─────────────────────────────────────────────────────── */

const HOW_IT_WORKS = [
  { title: 'Upload your resume', desc: 'Paste or upload your CV. Gemini AI parses skills, experience and career goals automatically.' },
  { title: 'Set your preferences', desc: 'Choose your target role, location and keywords. The agent scans Adzuna for matching jobs every run.' },
  { title: 'AI scores every match', desc: 'Each job gets a 0–100 fit score with a clear breakdown of strengths and skill gaps.' },
  { title: 'You review and approve', desc: "See the AI's reasoning, edit the tailored resume and cover letter, then approve or reject." },
  { title: 'Applications sent automatically', desc: 'Approved applications go to Google Forms, Greenhouse, Lever and Ashby automatically.' },
];

const FEATURES = [
  {
    icon: Search,
    title: 'Smart Job Discovery',
    desc: 'Continuously scans Adzuna matching your profile. Fresh listings every run, zero duplicates.',
    accent: '#6366f1',
  },
  {
    icon: Target,
    title: 'AI Match Scoring',
    desc: 'Gemini AI scores every job 0–100 against your resume with strengths, gaps and plain-English reasoning.',
    accent: '#8b5cf6',
  },
  {
    icon: FileEdit,
    title: 'Tailored Documents',
    desc: 'Generates a customised resume and cover letter per job. Grounded in your real CV, no hallucinations.',
    accent: '#3b82f6',
  },
  {
    icon: ClipboardList,
    title: 'Google Forms Filler',
    desc: 'Paste any application link. AI fills every field from your profile. You review before submit.',
    accent: '#10b981',
  },
  {
    icon: ShieldCheck,
    title: 'Human-in-the-Loop',
    desc: 'Nothing submitted without your explicit approval. Every match and every application waits for your sign-off.',
    accent: '#f59e0b',
  },
  {
    icon: BarChart3,
    title: 'Full Audit Trail',
    desc: 'Every AI decision and submission is logged. See what was sent, when, and why — and undo if needed.',
    accent: '#ef4444',
  },
];

const PRICING = [
  {
    name: 'Starter',
    price: 'Free',
    period: '',
    desc: 'For individuals getting started with automated job search.',
    features: ['50 jobs scanned / month', 'AI match scoring', 'Manual document review', 'Google Forms filler', 'Email support'],
    cta: 'Get started free',
    href: '/register',
    highlight: false,
  },
  {
    name: 'Pro',
    price: '$19',
    period: '/ month',
    desc: 'For active job seekers who want full automation.',
    features: ['Unlimited job discovery', 'Priority AI scoring', 'Auto-tailored documents', 'WhatsApp integration', 'Gmail scan + drafts', 'One-click applications'],
    cta: 'Start Pro trial',
    href: '/register',
    highlight: true,
  },
  {
    name: 'Team',
    price: '$49',
    period: '/ month',
    desc: 'For recruiters and career coaches managing multiple profiles.',
    features: ['Everything in Pro', 'Up to 5 profiles', 'Shared dashboard', 'Custom keywords & filters', 'Priority support', 'API access'],
    cta: 'Contact us',
    href: '/register',
    highlight: false,
  },
];

const TRUST_LOGOS = [
  { name: 'Google Gemini', abbr: 'Gemini' },
  { name: 'Adzuna', abbr: 'Adzuna' },
  { name: 'Supabase', abbr: 'Supabase' },
  { name: 'Groq', abbr: 'Groq' },
  { name: 'Next.js', abbr: 'Next.js' },
];

/* ─── Component ─────────────────────────────────────────────────── */

export default function Landing() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] overflow-x-hidden font-['Inter',system-ui,sans-serif]">

      {/* ─── Navbar ──────────────────────────────────────────────── */}
      <nav className="fixed top-0 inset-x-0 z-50">
        <div className="mx-4 mt-3">
          <div className="flex items-center justify-between h-13 px-4 py-2.5 bg-white/[0.06] backdrop-blur-xl border border-white/10 rounded-2xl shadow-lg shadow-black/30">
            <Link href="/" className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
                <Bot className="w-4 h-4 text-white" />
              </div>
              <span className="font-bold text-white tracking-tight">JobAgent</span>
            </Link>

            <div className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-400">
              <a href="#how-it-works" className="hover:text-white transition-colors duration-150">How it works</a>
              <a href="#features" className="hover:text-white transition-colors duration-150">Features</a>
              <a href="#pricing" className="hover:text-white transition-colors duration-150">Pricing</a>
            </div>

            <div className="flex items-center gap-2">
              <Link href="/login"
                className="hidden sm:block text-sm font-medium text-slate-400 hover:text-white px-3.5 py-1.5 rounded-lg hover:bg-white/8 transition-all duration-150">
                Sign in
              </Link>
              <Link href="/register"
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-500 transition-colors shadow-md shadow-indigo-900/50">
                Get started <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* ─── Hero ─────────────────────────────────────────────────── */}
      <section className="relative h-screen min-h-[600px] overflow-hidden">
        {/* Spline 3D background */}
        <div className="absolute inset-0 z-0">
          <Spline scene="https://prod.spline.design/MWoEf6V1fJrKDXJ4/scene.splinecode" />
        </div>

        {/* scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1.5 opacity-40 pointer-events-none">
          <div className="w-px h-8 bg-gradient-to-b from-transparent to-white" />
          <span className="text-[10px] text-white uppercase tracking-widest">Scroll</span>
        </div>
      </section>

      {/* ─── Trust logos ─────────────────────────────────────────── */}
      <div className="border-y border-white/6 bg-white/[0.02] py-7 px-6">
        <div className="max-w-4xl mx-auto">
          <p className="text-center text-xs font-semibold text-slate-600 uppercase tracking-widest mb-6">Built on</p>
          <div className="flex items-center justify-center flex-wrap gap-8 md:gap-16">
            {TRUST_LOGOS.map(({ name, abbr }) => (
              <span key={name} className="text-sm font-bold text-slate-500 hover:text-slate-300 transition-colors cursor-default tracking-tight">
                {abbr}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ─── Stats bar ───────────────────────────────────────────── */}
      <div className="py-16 px-6">
        <div className="max-w-4xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8">
          {[
            { v: '768-dim', l: 'Embedding model', s: 'text-embedding-004' },
            { v: '∞', l: 'Jobs monitored', s: 'Adzuna live listings' },
            { v: '100%', l: 'Human approval', s: 'nothing sent without you' },
            { v: '< 5 min', l: 'Setup time', s: 'upload resume → first scan' },
          ].map(({ v, l, s }) => (
            <div key={l} className="text-center">
              <p className="text-3xl font-black text-white tabular-nums">{v}</p>
              <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mt-1">{l}</p>
              <p className="text-xs text-slate-600 mt-0.5">{s}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ─── How it works ────────────────────────────────────────── */}
      <section id="how-it-works" className="py-24 px-6 border-t border-white/6">
        <div className="max-w-3xl mx-auto">
          <div className="mb-16">
            <p className="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-3">How it works</p>
            <h2 className="text-4xl md:text-5xl font-black text-white tracking-tighter">Five steps,<br />fully automated.</h2>
            <p className="text-slate-500 mt-4 text-base leading-relaxed max-w-md">
              From discovery to submission the agent handles everything. You only approve.
            </p>
          </div>

          <div>
            {HOW_IT_WORKS.map(({ title, desc }, i) => (
              <div key={title} className="flex gap-6 group">
                <div className="flex flex-col items-center">
                  <div className="w-9 h-9 rounded-xl bg-indigo-600/15 border border-indigo-500/30 text-indigo-400 text-sm font-black flex items-center justify-center shrink-0 group-hover:bg-indigo-600/25 transition-colors">
                    {i + 1}
                  </div>
                  {i < HOW_IT_WORKS.length - 1 && (
                    <div className="w-px flex-1 bg-gradient-to-b from-indigo-500/30 to-transparent mt-2 mb-0 min-h-[2rem]" />
                  )}
                </div>
                <div className="pb-10 pt-1.5">
                  <p className="font-bold text-white mb-1.5">{title}</p>
                  <p className="text-sm text-slate-500 leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Features ────────────────────────────────────────────── */}
      <section id="features" className="py-24 px-6 bg-white/[0.02] border-t border-white/6">
        <div className="max-w-5xl mx-auto">
          <div className="mb-14">
            <p className="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-3">Features</p>
            <h2 className="text-4xl md:text-5xl font-black text-white tracking-tighter">Everything you need<br />to get hired.</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map(({ icon: Icon, title, desc, accent }) => (
              <div key={title}
                className="group relative p-6 rounded-2xl border border-white/8 bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/15 transition-all duration-200 cursor-default overflow-hidden">
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                  style={{ background: `radial-gradient(ellipse at 0% 0%, ${accent}0d 0%, transparent 60%)` }} />
                <div className="relative">
                  <div className="w-9 h-9 rounded-xl mb-5 flex items-center justify-center"
                    style={{ background: `${accent}18`, border: `1px solid ${accent}30` }}>
                    <Icon className="w-4.5 h-4.5" style={{ color: accent }} />
                  </div>
                  <h3 className="font-bold text-white mb-2 text-sm">{title}</h3>
                  <p className="text-sm text-slate-500 leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Pricing ─────────────────────────────────────────────── */}
      <section id="pricing" className="py-24 px-6 border-t border-white/6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-3">Pricing</p>
            <h2 className="text-4xl md:text-5xl font-black text-white tracking-tighter">Simple, honest pricing.</h2>
            <p className="text-slate-500 mt-4 text-base">Start free. No credit card required.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {PRICING.map(({ name, price, period, desc, features, cta, href, highlight }) => (
              <div key={name} className={`relative rounded-2xl p-7 flex flex-col transition-all duration-200 ${
                highlight
                  ? 'bg-indigo-600 border border-indigo-500 shadow-2xl shadow-indigo-900/50'
                  : 'bg-white/[0.04] border border-white/10 hover:border-white/20'
              }`}>
                {highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1 bg-amber-400 text-slate-900 text-[10px] font-black uppercase tracking-wider rounded-full">
                    <Star className="w-2.5 h-2.5" fill="currentColor" /> Most popular
                  </div>
                )}
                <div className="mb-6">
                  <p className={`text-sm font-bold mb-2 ${highlight ? 'text-indigo-200' : 'text-slate-400'}`}>{name}</p>
                  <div className="flex items-baseline gap-1 mb-3">
                    <span className={`text-4xl font-black ${highlight ? 'text-white' : 'text-white'}`}>{price}</span>
                    {period && <span className={`text-sm font-medium ${highlight ? 'text-indigo-200' : 'text-slate-500'}`}>{period}</span>}
                  </div>
                  <p className={`text-sm leading-relaxed ${highlight ? 'text-indigo-200' : 'text-slate-500'}`}>{desc}</p>
                </div>
                <ul className="space-y-2.5 mb-8 flex-1">
                  {features.map(f => (
                    <li key={f} className="flex items-start gap-2.5 text-sm">
                      <CheckCircle2 className={`w-4 h-4 shrink-0 mt-0.5 ${highlight ? 'text-indigo-200' : 'text-indigo-400'}`} />
                      <span className={highlight ? 'text-white' : 'text-slate-300'}>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link href={href}
                  className={`w-full py-2.5 rounded-xl text-sm font-bold text-center transition-all block ${
                    highlight
                      ? 'bg-white text-indigo-700 hover:bg-indigo-50'
                      : 'bg-white/8 text-white border border-white/15 hover:bg-white/15'
                  }`}>
                  {cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Trust / security badges ─────────────────────────────── */}
      <div className="py-12 px-6 border-t border-white/6 bg-white/[0.02]">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { icon: Lock,       title: 'Data encrypted',    sub: 'AES-256 at rest + in transit' },
              { icon: ShieldCheck,title: 'HITL approval',     sub: '100% of submissions require sign-off' },
              { icon: Database,   title: 'Supabase hosted',   sub: 'Postgres + row-level security' },
              { icon: Cpu,        title: 'Dry-run mode',      sub: 'Safe default — no real sends until ready' },
            ].map(({ icon: Icon, title, sub }) => (
              <div key={title} className="flex items-start gap-3 p-4 rounded-xl bg-white/[0.03] border border-white/8">
                <div className="w-8 h-8 rounded-lg bg-indigo-600/15 border border-indigo-500/20 flex items-center justify-center shrink-0">
                  <Icon className="w-3.5 h-3.5 text-indigo-400" />
                </div>
                <div>
                  <p className="text-xs font-bold text-white">{title}</p>
                  <p className="text-[11px] text-slate-600 mt-0.5 leading-relaxed">{sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ─── Final CTA ───────────────────────────────────────────── */}
      <section className="py-28 px-6 border-t border-white/6 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(99,102,241,.08)_0%,transparent_70%)]" />
        <div className="relative max-w-2xl mx-auto text-center">
          <h2 className="text-4xl md:text-5xl font-black text-white mb-5 tracking-tighter">
            Stop applying manually.
          </h2>
          <p className="text-slate-500 mb-8 text-base max-w-md mx-auto leading-relaxed">
            Set up in under 5 minutes. The agent handles the rest while you focus on interview prep.
          </p>
          <Link href="/register"
            className="inline-flex items-center gap-2 px-8 py-4 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-500 transition-all shadow-lg shadow-indigo-900/40 text-sm group">
            Create your free account
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </Link>
          <p className="mt-4 text-xs text-slate-700">No credit card · Free forever plan · Cancel anytime</p>
        </div>
      </section>

      {/* ─── Footer ──────────────────────────────────────────────── */}
      <footer className="border-t border-white/6 px-6 py-10">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center">
              <Bot className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-bold text-white">JobAgent</span>
          </div>
          <p className="text-xs text-slate-700">
            Built with Next.js · Supabase · Gemini AI · Adzuna
          </p>
          <div className="flex items-center gap-5 text-xs text-slate-600">
            <Link href="/login" className="hover:text-slate-300 transition-colors">Sign in</Link>
            <Link href="/register" className="hover:text-slate-300 transition-colors">Get started</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
