'use client';
import { useState } from 'react';
import Link from 'next/link';
import { getSupabase } from '../../../lib/supabase';
import { Eye, EyeOff, Loader2, Mail } from 'lucide-react';

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}

function pwStrength(pw) {
  if (!pw) return { score: 0, label: '', color: '' };
  let score = 0;
  if (pw.length >= 6) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const map = [
    { label: 'Too short', color: 'bg-red-400' },
    { label: 'Weak', color: 'bg-red-400' },
    { label: 'Fair', color: 'bg-amber-400' },
    { label: 'Good', color: 'bg-emerald-400' },
    { label: 'Strong', color: 'bg-emerald-500' },
  ];
  return { score, ...map[score] };
}

export default function Register() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const strength = pwStrength(password);

  const signInWithGoogle = async () => {
    setGoogleLoading(true);
    setError('');
    const { error: err } = await getSupabase().auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=/onboarding`,
      },
    });
    if (err) { setError(err.message); setGoogleLoading(false); }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    setLoading(true);
    setError('');
    const { error: err } = await getSupabase().auth.signUp({
      email, password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: `${typeof window !== 'undefined' ? window.location.origin : ''}/auth/callback?next=/onboarding`,
      },
    });
    if (err) { setError(err.message); setLoading(false); return; }
    setDone(true);
    setLoading(false);
  };

  if (done) {
    return (
      <div className="text-center space-y-5">
        <div className="w-14 h-14 bg-emerald-100 dark:bg-emerald-500/15 rounded-2xl flex items-center justify-center mx-auto">
          <Mail className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-1.5">Check your inbox</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
            We sent a confirmation link to{' '}
            <strong className="text-slate-700 dark:text-slate-200">{email}</strong>.
            <br />Click it to activate your account.
          </p>
        </div>
        <Link href="/login"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition-colors cursor-pointer">
          Go to sign in
        </Link>
        <p className="text-xs text-slate-400 dark:text-slate-500">
          Didn&apos;t receive it?{' '}
          <button className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium cursor-pointer" onClick={() => setDone(false)}>
            Try again
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">Create your account</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Free to start — no credit card needed</p>
      </div>

      {error && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 dark:bg-red-500/10 dark:border-red-500/20 rounded-xl text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Google OAuth */}
      <button
        type="button"
        onClick={signInWithGoogle}
        disabled={googleLoading || loading}
        className="w-full flex items-center justify-center gap-2.5 py-2.5 px-4
          bg-white border border-slate-200 text-slate-700
          dark:bg-white/[0.06] dark:border-white/10 dark:text-slate-200
          rounded-xl text-sm font-semibold
          hover:bg-slate-50 hover:border-slate-300 dark:hover:bg-white/[0.10] dark:hover:border-white/20
          transition-colors disabled:opacity-50 cursor-pointer"
      >
        {googleLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <GoogleIcon />}
        Continue with Google
      </button>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-slate-100 dark:border-white/[0.06]" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-white dark:bg-[#0d0d12] px-3 text-xs text-slate-400 dark:text-slate-500">or sign up with email</span>
        </div>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Full name</label>
          <input type="text" required value={fullName}
            onChange={e => setFullName(e.target.value)}
            className="input" placeholder="Jane Smith" autoComplete="name" />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Email address</label>
          <input type="email" required value={email}
            onChange={e => setEmail(e.target.value)}
            className="input" placeholder="you@example.com" autoComplete="email" />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Password</label>
          <div className="relative">
            <input
              type={showPw ? 'text' : 'password'} required value={password}
              onChange={e => setPassword(e.target.value)}
              className="input pr-10" placeholder="Min. 6 characters"
              autoComplete="new-password" minLength={6}
            />
            <button type="button" onClick={() => setShowPw(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors cursor-pointer">
              {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {password.length > 0 && (
            <div className="mt-2 space-y-1">
              <div className="flex gap-1">
                {[1,2,3,4].map(n => (
                  <div key={n} className={`h-1 flex-1 rounded-full transition-all duration-300 ${strength.score >= n ? strength.color : 'bg-slate-200 dark:bg-white/10'}`} />
                ))}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Strength: <span className="font-semibold text-slate-700 dark:text-slate-200">{strength.label}</span></p>
            </div>
          )}
        </div>

        <button type="submit" disabled={loading || googleLoading}
          className="w-full py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 shadow-sm shadow-indigo-200 cursor-pointer">
          {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating account…</> : 'Create account'}
        </button>
      </form>

      <p className="text-center text-sm text-slate-500 dark:text-slate-400">
        Already have an account?{' '}
        <Link href="/login" className="font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 transition-colors">
          Sign in
        </Link>
      </p>
    </div>
  );
}
