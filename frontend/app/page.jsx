import Link from 'next/link';
import Image from 'next/image';
import SplineHero from '../components/SplineHero';
import {
  Search, Target, FileEdit, ShieldCheck,
  ClipboardList, BarChart3, ArrowRight, CheckCircle2,
  Lock, Database, Cpu,
} from 'lucide-react';

const C = '#22d3ee';   // cyan
const P = '#a855f7';   // purple

const FEATURES = [
  { icon: Search,        title: 'Smart Job Discovery',  desc: 'Scans Adzuna, Remotive and more. Fresh listings every run, zero duplicates.',             accent: C },
  { icon: Target,        title: 'AI Match Scoring',      desc: 'Gemini AI scores every job 0–100 against your resume with strengths and gaps.',           accent: P },
  { icon: FileEdit,      title: 'Tailored Documents',    desc: 'Custom resume and cover letter per job. Grounded in your real CV, no hallucinations.',    accent: C },
  { icon: ClipboardList, title: 'Forms Filler',          desc: 'Paste any application link. AI fills every field. You review before submit.',             accent: P },
  { icon: ShieldCheck,   title: 'Human-in-the-Loop',     desc: 'Nothing submitted without your approval. Every match waits for your sign-off.',           accent: C },
  { icon: BarChart3,     title: 'Full Audit Trail',       desc: 'Every AI decision logged. See what was sent, when, and why.',                             accent: P },
];

const STEPS = [
  { title: 'Upload your resume',              desc: 'Paste or upload your CV. Gemini AI parses skills, experience and goals automatically.' },
  { title: 'Set your preferences',            desc: 'Choose role, location and keywords. The agent scans job boards on every run.' },
  { title: 'AI scores every match',           desc: 'Each job gets a 0–100 fit score with a clear breakdown of strengths and skill gaps.' },
  { title: 'You review and approve',          desc: "See the AI's reasoning, edit the tailored resume and cover letter, then approve." },
  { title: 'Applications sent automatically', desc: 'Approved applications go out. You only make the decisions.' },
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

const divider = { borderTop: '1px solid rgba(255,255,255,0.06)' };

export default function Landing() {
  return (
    <div style={{ background: '#08090f', fontFamily: "'Inter',system-ui,sans-serif", color: '#fff', overflowX: 'hidden' }}>

      {/* Navbar */}
      <nav style={{
        position: 'fixed', top: 16, left: 16, right: 16, zIndex: 50,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 24px',
        background: 'rgba(8,9,15,0.75)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: 14,
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      }}>
        <Link href="/" style={{ textDecoration: 'none' }}>
          <Image src="/logo.png" alt="RESUMATE" width={130} height={71} priority style={{ height: 34, width: 'auto' }} />
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Link href="/login" style={{ fontSize: 14, fontWeight: 500, color: 'rgba(255,255,255,0.45)', padding: '6px 14px', textDecoration: 'none' }}>Sign in</Link>
          <Link href="/register" style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px',
            background: `linear-gradient(135deg,${C},${P})`,
            color: '#08090f', fontWeight: 700, fontSize: 14, textDecoration: 'none',
            borderRadius: 8,
            boxShadow: `0 0 20px ${C}44`,
          }}>
            Get started <ArrowRight size={14} />
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section style={{ width: '100vw', height: '100vh' }}>
        <SplineHero />
      </section>

      {/* Stats strip */}
      <div style={{ ...divider, padding: '64px 24px', background: `rgba(34,211,238,0.02)` }}>
        <div style={{ maxWidth: 960, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 32 }}>
          {[
            { v: '10+',     l: 'Job boards',     s: 'Adzuna, Remotive & more' },
            { v: '0–100',   l: 'AI fit score',   s: 'per job, per profile' },
            { v: '100%',    l: 'Human approval', s: 'nothing sent without you' },
            { v: '< 5 min', l: 'Setup time',     s: 'upload resume → first scan' },
          ].map(({ v, l, s }) => (
            <div key={l} style={{ textAlign: 'center' }}>
              <p style={{ fontSize: 32, fontWeight: 900, color: '#fff', textShadow: `0 0 24px ${C}66` }}>{v}</p>
              <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: C, marginTop: 6 }}>{l}</p>
              <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 3 }}>{s}</p>
            </div>
          ))}
        </div>
      </div>

      {/* How it works */}
      <section id="how-it-works" style={{ ...divider, padding: '96px 24px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.14em', color: C, marginBottom: 12 }}>How it works</p>
          <h2 style={{ fontSize: 'clamp(2rem,5vw,3rem)', fontWeight: 900, letterSpacing: '-0.03em', marginBottom: 16 }}>Five steps,<br />fully automated.</h2>
          <p style={{ color: 'rgba(255,255,255,0.4)', lineHeight: 1.7, maxWidth: 420, marginBottom: 56 }}>From discovery to submission the agent handles everything. You only approve.</p>
          {STEPS.map(({ title, desc }, i) => (
            <div key={title} style={{ display: 'flex', gap: 24 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{
                  width: 36, height: 36,
                  border: `1px solid ${C}44`,
                  color: C, fontSize: 13, fontWeight: 900,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  background: `${C}10`,
                  borderRadius: 10,
                }}>
                  {i + 1}
                </div>
                {i < STEPS.length - 1 && <div style={{ width: 1, flex: 1, background: `linear-gradient(${C}44,transparent)`, minHeight: 32, marginTop: 4 }} />}
              </div>
              <div style={{ paddingBottom: 40, paddingTop: 6 }}>
                <p style={{ fontWeight: 700, marginBottom: 6 }}>{title}</p>
                <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', lineHeight: 1.7 }}>{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" style={{ ...divider, padding: '96px 24px', background: `${C}06` }}>
        <div style={{ maxWidth: 1120, margin: '0 auto' }}>
          <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.14em', color: C, marginBottom: 12 }}>Features</p>
          <h2 style={{ fontSize: 'clamp(2rem,5vw,3rem)', fontWeight: 900, letterSpacing: '-0.03em', marginBottom: 56 }}>Everything you need<br />to get hired.</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 12 }}>
            {FEATURES.map(({ icon: Icon, title, desc, accent }) => (
              <div key={title} style={{
                padding: 28,
                background: 'rgba(255,255,255,0.03)',
                border: `1px solid rgba(255,255,255,0.07)`,
                borderRadius: 16,
                backdropFilter: 'blur(4px)',
                WebkitBackdropFilter: 'blur(4px)',
                transition: 'border-color 0.2s, background 0.2s',
                cursor: 'default',
              }}>
                <div style={{
                  width: 40, height: 40,
                  background: `${accent}18`, border: `1px solid ${accent}33`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginBottom: 20,
                  borderRadius: 12,
                  boxShadow: `0 0 16px ${accent}22`,
                }}>
                  <Icon size={18} color={accent} />
                </div>
                <p style={{ fontWeight: 700, marginBottom: 8, fontSize: 15 }}>{title}</p>
                <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', lineHeight: 1.7 }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" style={{ ...divider, padding: '96px 24px' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.14em', color: C, marginBottom: 12 }}>Pricing</p>
            <h2 style={{ fontSize: 'clamp(2rem,5vw,3rem)', fontWeight: 900, letterSpacing: '-0.03em' }}>Simple, honest pricing.</h2>
            <p style={{ color: 'rgba(255,255,255,0.4)', marginTop: 12 }}>Start free. No credit card required.</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 12 }}>
            {PRICING.map(({ name, price, period, desc, features, cta, href, highlight }) => (
              <div key={name} style={{
                padding: 32, display: 'flex', flexDirection: 'column', position: 'relative',
                background: highlight ? `linear-gradient(135deg,${C}14,${P}14)` : 'rgba(255,255,255,0.03)',
                border: highlight ? `1px solid ${C}55` : '1px solid rgba(255,255,255,0.08)',
                borderRadius: 18,
                backdropFilter: highlight ? 'blur(8px)' : 'blur(4px)',
                WebkitBackdropFilter: highlight ? 'blur(8px)' : 'blur(4px)',
                boxShadow: highlight ? `0 0 48px ${C}18,0 0 80px ${P}10` : 'none',
              }}>
                {highlight && (
                  <div style={{ position: 'absolute', top: -1, left: '10%', right: '10%', height: 2, background: `linear-gradient(90deg,transparent,${C},${P},transparent)`, borderRadius: 2 }} />
                )}
                {highlight && (
                  <div style={{ position: 'absolute', top: 16, right: 16, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#08090f', background: `linear-gradient(135deg,${C},${P})`, padding: '3px 8px', borderRadius: 6 }}>
                    Popular
                  </div>
                )}
                <p style={{ fontSize: 12, fontWeight: 700, color: highlight ? C : 'rgba(255,255,255,0.45)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{name}</p>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 8 }}>
                  <span style={{ fontSize: 40, fontWeight: 900 }}>{price}</span>
                  {period && <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>{period}</span>}
                </div>
                <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginBottom: 24, lineHeight: 1.6 }}>{desc}</p>
                <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 32px', flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {features.map(f => (
                    <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13 }}>
                      <CheckCircle2 size={15} color={highlight ? C : P} style={{ flexShrink: 0, marginTop: 1 }} />
                      <span style={{ color: 'rgba(255,255,255,0.75)' }}>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link href={href} style={{
                  display: 'block', textAlign: 'center', padding: '11px 0', fontWeight: 700, fontSize: 14, textDecoration: 'none',
                  background: highlight ? `linear-gradient(135deg,${C},${P})` : 'rgba(255,255,255,0.07)',
                  color: highlight ? '#08090f' : '#fff',
                  border: highlight ? 'none' : '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 10,
                  boxShadow: highlight ? `0 0 24px ${C}44` : 'none',
                  transition: 'opacity 0.15s',
                }}>{cta}</Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Trust badges */}
      <div style={{ ...divider, padding: '48px 24px', background: `${P}06` }}>
        <div style={{ maxWidth: 960, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 10 }}>
          {[
            { icon: Lock,        title: 'Data encrypted',  sub: 'AES-256 at rest + in transit',             accent: C },
            { icon: ShieldCheck, title: 'HITL approval',   sub: '100% of submissions require sign-off',     accent: P },
            { icon: Database,    title: 'Supabase hosted', sub: 'Postgres + row-level security',             accent: C },
            { icon: Cpu,         title: 'Dry-run mode',    sub: 'Safe default — no real sends until ready',  accent: P },
          ].map(({ icon: Icon, title, sub, accent }) => (
            <div key={title} style={{
              display: 'flex', alignItems: 'flex-start', gap: 12, padding: 20,
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: 14,
              backdropFilter: 'blur(4px)',
              WebkitBackdropFilter: 'blur(4px)',
            }}>
              <div style={{
                width: 32, height: 32,
                background: `${accent}18`, border: `1px solid ${accent}33`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                borderRadius: 8,
              }}>
                <Icon size={14} color={accent} />
              </div>
              <div>
                <p style={{ fontSize: 12, fontWeight: 700 }}>{title}</p>
                <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 3, lineHeight: 1.5 }}>{sub}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <section style={{ ...divider, padding: '112px 24px', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse at center,${C}08 0%,transparent 65%)`, pointerEvents: 'none' }} />
        <div style={{ position: 'relative', maxWidth: 600, margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{ fontSize: 'clamp(2rem,5vw,3rem)', fontWeight: 900, letterSpacing: '-0.03em', marginBottom: 20 }}>Stop applying manually.</h2>
          <p style={{ color: 'rgba(255,255,255,0.4)', lineHeight: 1.7, maxWidth: 400, margin: '0 auto 36px' }}>
            Set up in under 5 minutes. The agent handles the rest while you focus on interview prep.
          </p>
          <Link href="/register" style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, padding: '14px 32px',
            background: `linear-gradient(135deg,${C},${P})`, color: '#08090f', fontWeight: 700, fontSize: 14,
            textDecoration: 'none', borderRadius: 10,
            boxShadow: `0 0 40px ${C}44,0 0 80px ${P}22`,
          }}>
            Create your free account <ArrowRight size={16} />
          </Link>
          <p style={{ marginTop: 16, fontSize: 12, color: 'rgba(255,255,255,0.2)' }}>No credit card · Free forever plan · Cancel anytime</p>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ ...divider, padding: '40px 32px' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <Image src="/logo.png" alt="RESUMATE" width={110} height={60} style={{ height: 28, width: 'auto' }} />
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)' }}>Built with Next.js · Supabase · Gemini AI · Adzuna</p>
          <div style={{ display: 'flex', gap: 24 }}>
            <Link href="/login"    style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', textDecoration: 'none' }}>Sign in</Link>
            <Link href="/register" style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', textDecoration: 'none' }}>Get started</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
