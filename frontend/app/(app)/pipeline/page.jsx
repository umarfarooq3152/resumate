'use client';
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { api } from '../../../lib/api';
import { getSupabase } from '../../../lib/supabase';
import Spinner from '../../../components/Spinner';
import { useToast } from '../../../components/Toast';
import { Play, Zap, Loader2, RefreshCw, AlertTriangle, Search, Target, PenLine, Send } from 'lucide-react';

const STEPS = [
  { key: 'discovery',   label: 'Discovery',   desc: 'Fetch new jobs from Adzuna matching your keywords',                 Icon: Search },
  { key: 'matching',    label: 'Matching',    desc: 'Score all unscored jobs against your resume with Gemini AI',        Icon: Target },
  { key: 'tailoring',   label: 'Tailoring',   desc: 'Generate a tailored resume + cover letter for each approved match', Icon: PenLine },
  { key: 'application', label: 'Application', desc: 'Submit approved applications via Greenhouse / Lever / Ashby / Forms (DRY_RUN gated)', Icon: Send },
];

export default function Pipeline() {
  const toast = useToast();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [settings, setSettings] = useState(null);
  const [keywords, setKeywords] = useState('');
  const [location, setLocation] = useState('');
  const [running, setRunning] = useState(null);   // step key
  const [runningAll, setRunningAll] = useState(false);
  const pollRef = useRef(null);

  const loadEvents = async () => {
    const ev = await api.getEvents(50).catch(() => []);
    setEvents(ev ?? []);
  };

  const startPolling = () => {
    if (pollRef.current) return;
    pollRef.current = setInterval(loadEvents, 3000);
  };

  const stopPolling = () => {
    clearInterval(pollRef.current);
    pollRef.current = null;
  };

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await getSupabase().auth.getUser();
      if (!user) { setLoading(false); return; }
      const [profiles, cfg] = await Promise.allSettled([
        api.getProfiles(user.id),
        api.getSettings(),
      ]);
      const p = profiles.status === 'fulfilled' ? profiles.value?.[0] : null;
      if (p) {
        setProfile(p);
        setKeywords((p.keywords ?? []).join(', '));
        setLocation(p.target_location ?? '');
      }
      if (cfg.status === 'fulfilled') setSettings(cfg.value);
      await loadEvents();
      setLoading(false);
    };
    init();
    return () => stopPolling();
  }, []);

  const run = async (key) => {
    setRunning(key);
    startPolling();
    try {
      const kw = keywords.split(',').map(s => s.trim()).filter(Boolean);
      if (key === 'discovery')   await api.runDiscovery({ keywords: kw, location, profile_id: profile?.id });
      else if (key === 'matching')    await api.runMatching({ profile_id: profile?.id });
      else if (key === 'tailoring')   await api.runTailoring();
      else if (key === 'application') await api.runApplication();
      toast(`${key} started — check events below`, 'info');
    } catch (e) {
      toast(e.message, 'error');
    }
    // Let it run in background; stop polling after 30s
    setTimeout(() => { loadEvents(); stopPolling(); }, 30_000);
    setRunning(null);
  };

  const runAll = async () => {
    setRunningAll(true);
    startPolling();
    try {
      const kw = keywords.split(',').map(s => s.trim()).filter(Boolean);
      await api.runAll({ keywords: kw, location, profile_id: profile?.id });
      toast('Full pipeline started — watch events below', 'info');
    } catch (e) {
      toast(e.message, 'error');
    }
    setTimeout(() => { loadEvents(); stopPolling(); }, 60_000);
    setRunningAll(false);
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64"><Spinner /></div>
  );

  const dryRun = settings?.dry_run ?? true;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">Pipeline</h1>
          <p className="text-sm t-b mt-0.5">Run individual steps or the full agent pipeline</p>
        </div>
        <button onClick={loadEvents} className="btn-icon"><RefreshCw className="w-4 h-4" /></button>
      </div>

      {dryRun && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm
          bg-amber-50 border border-amber-200 text-amber-800
          dark:bg-amber-500/8 dark:border-amber-500/20 dark:text-amber-300">
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500 dark:text-amber-400" />
          <span>Dry run mode — submissions are logged but not sent. Change in <a href="/settings" className="underline font-semibold">Settings</a>.</span>
        </div>
      )}

      {!profile?.resume_text && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm
          bg-red-50 border border-red-200 text-red-800
          dark:bg-red-500/8 dark:border-red-500/20 dark:text-red-300">
          <AlertTriangle className="w-4 h-4 shrink-0 text-red-500 dark:text-red-400" />
          <span>No resume found. <a href="/profile" className="underline font-semibold">Upload your CV</a> before running matching.</span>
        </div>
      )}

      {/* Discovery params */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white mb-4">Discovery Parameters</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium t-b mb-1.5">Keywords (comma-separated)</label>
            <input className="input" value={keywords} onChange={e => setKeywords(e.target.value)} placeholder="Python, FastAPI, ML engineer" />
          </div>
          <div>
            <label className="block text-xs font-medium t-b mb-1.5">Location</label>
            <input className="input" value={location} onChange={e => setLocation(e.target.value)} placeholder="London" />
          </div>
        </div>
        <p className="text-xs t-m mt-2.5">Overrides your profile defaults for this run only.</p>
      </div>

      {/* Run all */}
      <div className="bg-gradient-to-r from-indigo-600 to-violet-600 rounded-2xl p-5 flex items-center justify-between gap-4">
        <div>
          <p className="text-white font-semibold">Run Full Pipeline</p>
          <p className="text-indigo-200 text-xs mt-0.5">Discovery → Matching → Tailoring → Application</p>
        </div>
        <button onClick={runAll} disabled={runningAll || !!running}
          className="flex items-center gap-2 px-5 py-2.5 bg-white text-indigo-700 text-sm font-bold rounded-xl hover:bg-indigo-50 disabled:opacity-60 transition-colors shrink-0 cursor-pointer">
          {runningAll ? <><Loader2 className="w-4 h-4 animate-spin" /> Running…</> : <><Zap className="w-4 h-4" /> Run All</>}
        </button>
      </div>

      {/* Steps */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {STEPS.map((step, idx) => {
          const isRunning = running === step.key;
          const disabled = isRunning || !!running || runningAll;
          return (
            <div key={step.key} className={clsx(
              'rounded-2xl p-5 flex flex-col gap-4 border transition-all duration-150',
              'bg-white dark:bg-white/[0.04]',
              isRunning
                ? 'border-indigo-300 shadow-sm shadow-indigo-100 dark:border-indigo-500/40 dark:shadow-indigo-500/10'
                : 'border-slate-200 hover:border-slate-300 hover:shadow-sm dark:border-white/10 dark:hover:border-white/20',
            )}>
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-slate-100 dark:bg-white/8">
                  <step.Icon className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-slate-900 dark:text-white text-sm">{step.label}</p>
                    <span className="text-[10px] font-bold t-m bg-slate-100 dark:bg-white/8 px-1.5 py-0.5 rounded-full">
                      {idx + 1} of {STEPS.length}
                    </span>
                  </div>
                  <p className="text-xs t-b mt-0.5 leading-relaxed">{step.desc}</p>
                </div>
              </div>
              <button onClick={() => run(step.key)} disabled={disabled}
                className={clsx(
                  'self-start flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer',
                  isRunning
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-700 dark:hover:bg-slate-100 disabled:opacity-40',
                )}>
                {isRunning
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Running…</>
                  : <><Play className="w-3.5 h-3.5" /> Run {step.label}</>}
              </button>
            </div>
          );
        })}
      </div>

      {/* Event log */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">Agent Event Log</h2>
          {(running || runningAll) && (
            <span className="flex items-center gap-1.5 text-xs text-indigo-600 dark:text-indigo-400 font-medium">
              <span className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse" /> Live
            </span>
          )}
        </div>
        {events.length === 0
          ? <div className="empty-state"><p className="text-sm t-m">No events yet — run a step above</p></div>
          : (
            <div className="card div-y overflow-hidden">
              {events.map((ev, i) => {
                const isError = ev.payload?.error || ev.event_type?.includes('error');
                return (
                  <div key={ev.id ?? i} className="flex items-center gap-3 px-4 py-2.5 row-hover">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isError ? 'bg-red-400' : 'bg-emerald-400'}`} />
                    <span className="text-[11px] font-semibold t-m font-mono w-16 shrink-0 truncate">{ev.agent}</span>
                    <p className="flex-1 text-xs text-slate-700 dark:text-slate-300 truncate">{ev.event_type?.replace(/\./g, ' › ')}</p>
                    {ev.payload && Object.keys(ev.payload).length > 0 && (
                      <p className="text-xs t-m truncate max-w-[140px] hidden sm:block font-mono">{JSON.stringify(ev.payload)}</p>
                    )}
                    <p className="text-xs t-m shrink-0">{fmtDate(ev.created_at)}</p>
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
