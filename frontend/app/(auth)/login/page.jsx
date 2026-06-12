'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getSupabase } from '../../../lib/supabase';
import { api } from '../../../lib/api';
import { Eye, EyeOff, Loader2 } from 'lucide-react';

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

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');

  const signInWithGoogle = async () => {
    setGoogleLoading(true);
    setError('');
    const { error: err } = await getSupabase().auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
      },
    });
    if (err) { setError(err.message); setGoogleLoading(false); }
  };

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const { data, error: err } = await getSupabase().auth.signInWithPassword({ email, password });
    if (err) { setError(err.message); setLoading(false); return; }
    try {
      const profiles = await api.getProfiles(data.user?.id);
      if (!profiles?.length) { router.push('/onboarding'); return; }
    } catch {}
    router.push('/dashboard');
    router.refresh();
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">Welcome back</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Sign in to continue to your account</p>
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
          <span className="bg-white dark:bg-[#0d0d12] px-3 text-xs text-slate-400 dark:text-slate-500">or continue with email</span>
        </div>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Email address</label>
          <input
            type="email" required value={email}
            onChange={e => setEmail(e.target.value)}
            className="input" placeholder="you@example.com"
            autoComplete="email"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">Password</label>
            <Link href="/forgot-password"
              className="text-xs text-indigo-600 hover:text-indigo-800 font-medium transition-colors">
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <input
              type={showPw ? 'text' : 'password'} required value={password}
              onChange={e => setPassword(e.target.value)}
              className="input pr-10" placeholder="••••••••"
              autoComplete="current-password"
            />
            <button type="button" onClick={() => setShowPw(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer">
              {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <button type="submit" disabled={loading || googleLoading}
          className="w-full py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 shadow-sm shadow-indigo-200 cursor-pointer">
          {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Signing in…</> : 'Sign in'}
        </button>
      </form>

      <p className="text-center text-sm text-slate-500 dark:text-slate-400">
        Don&apos;t have an account?{' '}
        <Link href="/register" className="font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 transition-colors">
          Sign up free
        </Link>
      </p>
    </div>
  );
}
