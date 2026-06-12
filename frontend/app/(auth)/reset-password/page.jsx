'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '../../../lib/supabase';
import { Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-react';

function passwordStrength(pw) {
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

export default function ResetPassword() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const strength = passwordStrength(password);

  const submit = async (e) => {
    e.preventDefault();
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    setLoading(true);
    setError('');
    const { error: err } = await getSupabase().auth.updateUser({ password });
    if (err) { setError(err.message); setLoading(false); return; }
    setDone(true);
    setTimeout(() => router.push('/dashboard'), 2000);
  };

  if (done) {
    return (
      <div className="text-center space-y-5">
        <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-500/15 rounded-2xl flex items-center justify-center mx-auto">
          <ShieldCheck className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Password updated!</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Redirecting you to your dashboard…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">Set new password</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Choose a strong password for your account.</p>
      </div>

      {error && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 dark:bg-red-500/10 dark:border-red-500/20 rounded-xl text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-400 mb-1.5">New password</label>
          <div className="relative">
            <input
              type={showPw ? 'text' : 'password'} required value={password}
              onChange={e => setPassword(e.target.value)}
              className="input pr-10" placeholder="Min. 6 characters"
              autoComplete="new-password"
            />
            <button type="button" onClick={() => setShowPw(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors cursor-pointer">
              {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {password.length > 0 && (
            <div className="mt-2 space-y-1.5">
              <div className="flex gap-1">
                {[1, 2, 3, 4].map((n) => (
                  <div key={n}
                    className={`h-1 flex-1 rounded-full transition-all duration-300 ${strength.score >= n ? strength.color : 'bg-slate-200 dark:bg-white/10'}`}
                  />
                ))}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Strength: <span className="font-semibold text-slate-700 dark:text-slate-200">{strength.label}</span>
              </p>
            </div>
          )}
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-400 mb-1.5">Confirm password</label>
          <input
            type={showPw ? 'text' : 'password'} required value={confirm}
            onChange={e => setConfirm(e.target.value)}
            className="input" placeholder="Repeat your password"
            autoComplete="new-password" minLength={6}
          />
          {confirm.length > 0 && password !== confirm && (
            <p className="text-xs text-red-500 dark:text-red-400 mt-1.5">Passwords do not match.</p>
          )}
        </div>

        <button type="submit" disabled={loading || password !== confirm || password.length < 6}
          className="w-full py-3 bg-indigo-600 text-white text-sm font-bold rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
          {loading
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Updating…</>
            : 'Update password'}
        </button>
      </form>
    </div>
  );
}
