'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/api';
import StatCard from '../../../components/StatCard';
import Spinner from '../../../components/Spinner';
import { getSupabase } from '../../../lib/supabase';
import { useRouter } from 'next/navigation';
import { RefreshCw, AlertTriangle, CheckCircle, ChevronRight, Search, Target, FileText, Send, Zap, TrendingUp, Activity, LogOut } from 'lucide-react';

export default function Dashboard() {
  const router = useRouter();
  const [stats, setStats] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [profileId, setProfileId] = useState(null);

  const EMPTY_STATS = { jobs_discovered: 0, jobs_matched: 0, total_applications: 0, applications_submitted: 0, dry_run: true, match_pending: 0, application_pending: 0 };

  const load = async (silent = false, pid = profileId, hasProfile = !!pid) => {
    if (!silent) { setLoading(true); setError(''); }
    if (!hasProfile) {
      // No profile yet — show zero state, don't pull global data
      setStats(EMPTY_STATS);
      setEvents([]);
      if (!silent) setLoading(false);
      return;
    }
    const [s, e] = await Promise.allSettled([api.getDashboard(pid), api.getEvents(30)]);
    if (s.status === 'fulfilled') setStats(s.value);
    else if (!silent) setError(s.reason?.message ?? 'Failed to load dashboard');
    if (e.status === 'fulfilled') setEvents(e.value ?? []);
    if (!silent) setLoading(false);
  };

  useEffect(() => {
    let iv;
    const init = async () => {
      const { data: { user } } = await getSupabase().auth.getUser();
      let pid = null;
      if (user) {
        try {
          const profiles = await api.getProfiles(user.id);
          pid = profiles?.[0]?.id ?? null;
        } catch { /* network error — treat as no profile */ }
        setProfileId(pid);
      }
      const hasProfile = !!pid;
      await load(false, pid, hasProfile);
      iv = setInterval(() => load(true, pid, hasProfile), 30_000);
    };
    init();
    return () => clearInterval(iv);
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><Spinner /></div>;

  const signOut = async () => {
    await getSupabase().auth.signOut();
    router.push('/login');
  };

  if (error) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
      <AlertTriangle className="w-8 h-8 text-amber-400" />
      <p className="text-sm text-slate-600 dark:text-slate-400">{error}</p>
      <div className="flex gap-2">
        <button onClick={load} className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-500 transition-colors cursor-pointer">
          Retry
        </button>
        {error.includes('Session expired') && (
          <button onClick={signOut} className="flex items-center gap-1.5 px-4 py-2 bg-slate-100 dark:bg-white/[0.06] text-slate-700 dark:text-slate-300 text-sm font-medium rounded-lg hover:bg-slate-200 dark:hover:bg-white/10 transition-colors cursor-pointer">
            <LogOut className="w-3.5 h-3.5" /> Sign out
          </button>
        )}
      </div>
    </div>
  );

  const dryRun = stats?.dry_run ?? true;
  const matchPending = stats?.match_pending ?? 0;
  const appPending = stats?.application_pending ?? 0;
  const pendingReviews = matchPending + appPending;

  return (
    <div className="space-y-6">

      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl p-6
        bg-gradient-to-br from-indigo-600/10 via-violet-600/5 to-transparent
        border border-indigo-500/20 dark:border-indigo-500/15
        dark:bg-white/[0.03] dark:backdrop-blur-sm">
        {/* Glow orbs */}
        <div className="absolute -top-20 -right-20 w-64 h-64 bg-indigo-500/15 rounded-full blur-3xl pointer-events-none dark:block hidden" />
        <div className="absolute -bottom-10 -left-10 w-48 h-48 bg-violet-500/10 rounded-full blur-3xl pointer-events-none dark:block hidden" />

        <div className="relative flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="relative flex h-2 w-2">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${dryRun ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                <span className={`relative inline-flex rounded-full h-2 w-2 ${dryRun ? 'bg-amber-400' : 'bg-emerald-400'}`} />
              </span>
              <span className={`text-xs font-bold uppercase tracking-wider ${dryRun ? 'text-amber-500 dark:text-amber-400' : 'text-emerald-500 dark:text-emerald-400'}`}>
                {dryRun ? 'Dry run' : 'Live'}
              </span>
            </div>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">Your Job Agent</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
              Scanning boards, scoring matches, drafting applications — automatically.
            </p>
          </div>
          <button onClick={load} className="btn-icon shrink-0" aria-label="Refresh">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* Inline mode notice */}
        {!dryRun && (
          <div className="relative mt-4 flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400">
            <CheckCircle className="w-3.5 h-3.5 shrink-0" />
            Live mode — applications will be submitted to real platforms.
          </div>
        )}
        {dryRun && (
          <div className="relative mt-4 flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            No applications submitted.{' '}
            <Link href="/settings" className="underline font-semibold hover:text-amber-600 dark:hover:text-amber-300">
              Turn off in Settings.
            </Link>
          </div>
        )}
      </div>

      {/* Pending alerts */}
      {pendingReviews > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {matchPending > 0 && (
            <Link href="/jobs" className="flex items-center gap-3 px-4 py-3 rounded-xl border transition-all group cursor-pointer
              bg-indigo-50 border-indigo-200 hover:bg-indigo-100
              dark:bg-indigo-500/8 dark:border-indigo-500/20 dark:hover:bg-indigo-500/12 dark:backdrop-blur-sm">
              <Zap className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
              <span className="text-sm text-indigo-800 dark:text-indigo-300 flex-1">
                <strong className="text-indigo-900 dark:text-white">{matchPending}</strong> job match{matchPending > 1 ? 'es' : ''} awaiting review
              </span>
              <ChevronRight className="w-4 h-4 text-indigo-400 group-hover:translate-x-0.5 transition-transform" />
            </Link>
          )}
          {appPending > 0 && (
            <Link href="/applications" className="flex items-center gap-3 px-4 py-3 rounded-xl border transition-all group cursor-pointer
              bg-emerald-50 border-emerald-200 hover:bg-emerald-100
              dark:bg-emerald-500/8 dark:border-emerald-500/20 dark:hover:bg-emerald-500/12 dark:backdrop-blur-sm">
              <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span className="text-sm text-emerald-800 dark:text-emerald-300 flex-1">
                <strong className="text-emerald-900 dark:text-white">{appPending}</strong> application{appPending > 1 ? 's' : ''} ready to submit
              </span>
              <ChevronRight className="w-4 h-4 text-emerald-400 group-hover:translate-x-0.5 transition-transform" />
            </Link>
          )}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Search}   accent="violet"  label="Jobs Discovered" value={stats?.jobs_discovered} />
        <StatCard icon={Target}   accent="indigo"  label="AI Matches"      value={stats?.jobs_matched}          sub="above threshold" />
        <StatCard icon={FileText} accent="amber"   label="Applications"    value={stats?.total_applications} />
        <StatCard icon={Send}     accent="emerald" label="Submitted"        value={stats?.applications_submitted} sub={dryRun ? 'dry run' : 'live'} />
      </div>

      {/* Activity feed */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Activity className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
          <h2 className="text-xs font-bold text-slate-500 dark:text-slate-500 uppercase tracking-widest">Recent Activity</h2>
        </div>
        {events.length === 0 ? (
          <div className="empty-state">
            <p className="text-sm text-slate-400 dark:text-slate-600 mb-4">No agent events yet.</p>
            <Link href="/pipeline" className="inline-flex px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-500 transition-colors">
              Run the pipeline →
            </Link>
          </div>
        ) : (
          <div className="card div-y overflow-hidden">
            {events.map((ev, i) => {
              const isError = ev.payload?.error || ev.event_type?.includes('error');
              return (
                <div key={ev.id ?? i} className="flex items-center gap-3 px-4 py-2.5 row-hover">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isError ? 'bg-red-400' : 'bg-emerald-400'}`} />
                  <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-600 font-mono w-16 shrink-0 truncate">{ev.agent}</span>
                  <p className="flex-1 text-sm text-slate-700 dark:text-slate-300 truncate">{ev.event_type?.replace(/\./g, ' › ')}</p>
                  {ev.payload && Object.keys(ev.payload).length > 0 && (
                    <p className="text-xs text-slate-400 dark:text-slate-600 truncate max-w-[140px] hidden sm:block font-mono">{JSON.stringify(ev.payload)}</p>
                  )}
                  <p className="text-xs text-slate-400 dark:text-slate-600 shrink-0">{fmtDate(ev.created_at)}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function fmtDate(str) {
  if (!str) return '';
  return new Date(str).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}
