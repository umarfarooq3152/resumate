'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/api';
import StatCard from '../../../components/StatCard';
import Spinner from '../../../components/Spinner';
import { RefreshCw, AlertTriangle, CheckCircle, ChevronRight, Search, Target, FileText, Send, Zap, TrendingUp } from 'lucide-react';

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async (silent = false) => {
    if (!silent) { setLoading(true); setError(''); }
    const [s, e] = await Promise.allSettled([api.getDashboard(), api.getEvents(30)]);
    if (s.status === 'fulfilled') setStats(s.value);
    else if (!silent) setError(s.reason?.message ?? 'Failed to load dashboard');
    if (e.status === 'fulfilled') setEvents(e.value ?? []);
    if (!silent) setLoading(false);
  };

  useEffect(() => {
    load();
    const iv = setInterval(() => load(true), 30_000);
    return () => clearInterval(iv);
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><Spinner /></div>;

  if (error) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
      <AlertTriangle className="w-8 h-8 text-amber-400" />
      <p className="text-sm text-slate-600 dark:text-slate-400">{error}</p>
      <button onClick={load} className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-500 transition-colors cursor-pointer">
        Retry
      </button>
    </div>
  );

  const dryRun = stats?.dry_run ?? true;
  const matchPending = stats?.match_pending ?? 0;
  const appPending = stats?.application_pending ?? 0;
  const pendingReviews = matchPending + appPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">Dashboard</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Overview of your job agent activity</p>
        </div>
        <button onClick={load} className="btn-icon" aria-label="Refresh">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Status banner */}
      {dryRun ? (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm
          bg-amber-50 border border-amber-200 text-amber-800
          dark:bg-amber-500/8 dark:border-amber-500/20 dark:text-amber-300">
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500 dark:text-amber-400" />
          <span className="flex-1">
            <strong>Dry run mode is on.</strong> No applications submitted.{' '}
            <Link href="/settings" className="underline font-semibold">Turn off in Settings.</Link>
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm
          bg-emerald-50 border border-emerald-200 text-emerald-800
          dark:bg-emerald-500/8 dark:border-emerald-500/20 dark:text-emerald-300">
          <CheckCircle className="w-4 h-4 shrink-0 text-emerald-500 dark:text-emerald-400" />
          <span>Live mode — applications will be submitted to real platforms.</span>
        </div>
      )}

      {/* Pending alerts */}
      {pendingReviews > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {matchPending > 0 && (
            <Link href="/jobs" className="flex items-center gap-3 px-4 py-3 rounded-xl border transition-all group cursor-pointer
              bg-indigo-50 border-indigo-200 hover:bg-indigo-100
              dark:bg-indigo-500/8 dark:border-indigo-500/20 dark:hover:bg-indigo-500/12">
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
              dark:bg-emerald-500/8 dark:border-emerald-500/20 dark:hover:bg-emerald-500/12">
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
        <StatCard icon={Target}   accent="indigo"  label="AI Matches"      value={stats?.jobs_matched}      sub="above threshold" />
        <StatCard icon={FileText} accent="amber"   label="Applications"    value={stats?.total_applications} />
        <StatCard icon={Send}     accent="emerald" label="Submitted"       value={stats?.applications_submitted} sub={dryRun ? 'dry run' : 'live'} />
      </div>

      {/* Activity feed */}
      <div>
        <h2 className="text-xs font-bold text-slate-500 dark:text-slate-500 uppercase tracking-widest mb-3">Recent Activity</h2>
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
