'use client';
import { useState } from 'react';
import Link from 'next/link';
import { getSupabase } from '../../../lib/supabase';
import { Loader2, Mail, ArrowLeft } from 'lucide-react';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const redirectTo = `${window.location.origin}/auth/callback?next=/reset-password`;
    const { error: err } = await getSupabase().auth.resetPasswordForEmail(email, { redirectTo });
    if (err) { setError(err.message); setLoading(false); return; }
    setSent(true);
    setLoading(false);
  };

  if (sent) {
    return (
      <div className="text-center space-y-5">
        <div className="w-16 h-16 bg-indigo-100 dark:bg-indigo-500/15 rounded-2xl flex items-center justify-center mx-auto">
          <Mail className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Reset link sent</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
            Check <strong className="text-slate-700 dark:text-slate-200">{email}</strong> for a password reset link.
            It may take a minute to arrive.
          </p>
        </div>
        <Link href="/login"
          className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 hover:underline transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">Forgot your password?</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Enter your email and we'll send you a reset link.
        </p>
      </div>

      {error && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 dark:bg-red-500/10 dark:border-red-500/20 rounded-xl text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-400 mb-1.5">Email address</label>
          <input
            type="email" required value={email}
            onChange={e => setEmail(e.target.value)}
            className="input" placeholder="you@example.com"
            autoComplete="email"
          />
        </div>

        <button type="submit" disabled={loading}
          className="w-full py-3 bg-indigo-600 text-white text-sm font-bold rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
          {loading
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
            : 'Send reset link'}
        </button>
      </form>

      <Link href="/login"
        className="flex items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to sign in
      </Link>
    </div>
  );
}
