'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import clsx from 'clsx';
import { api } from '../../../lib/api';
import { getSupabase } from '../../../lib/supabase';
import Spinner from '../../../components/Spinner';
import { useToast } from '../../../components/Toast';
import {
  RefreshCw, ExternalLink, Bot, Search, Loader2, MapPin, Globe,
  Zap, MousePointer, FileText, X, Calendar, ChevronDown,
  ChevronLeft, ChevronRight,
} from 'lucide-react';

/* ── Constants ──────────────────────────────────────────── */

const TABS = [
  { id: 'all',    label: 'All Jobs' },
  { id: 'auto',   label: 'Auto-Apply' },
  { id: 'online', label: 'Apply Online' },
  { id: 'manual', label: 'Manual Only' },
];

const DAYS_OPTIONS = [
  { value: 1,  label: '24 hours' },
  { value: 3,  label: '3 days' },
  { value: 7,  label: '1 week' },
  { value: 14, label: '2 weeks' },
  { value: 30, label: '30 days' },
];

const PAGE_SIZE = 10;

/* ── Helpers ────────────────────────────────────────────── */

function applyTypeMeta(type) {
  if (type === 'auto')          return { label: 'Auto-Apply',   Icon: Zap,          color: 'text-cyan-500 dark:text-cyan-400',   bg: 'bg-cyan-50 dark:bg-cyan-500/10',   border: 'border-cyan-200 dark:border-cyan-500/20' };
  if (type === 'online_manual') return { label: 'Apply Online', Icon: MousePointer, color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-500/10', border: 'border-purple-200 dark:border-purple-500/20' };
  return                               { label: 'Manual',       Icon: FileText,     color: 'text-amber-600 dark:text-amber-400',  bg: 'bg-amber-50 dark:bg-amber-500/10',   border: 'border-amber-200 dark:border-amber-500/20' };
}

function scoreMeta(score) {
  if (score >= 75) return { ring: 'ring-emerald-300 dark:ring-emerald-500/30', bg: 'bg-emerald-50 dark:bg-emerald-500/10', num: 'text-emerald-700 dark:text-emerald-400' };
  if (score >= 55) return { ring: 'ring-amber-300 dark:ring-amber-500/30',   bg: 'bg-amber-50 dark:bg-amber-500/10',   num: 'text-amber-700 dark:text-amber-400' };
  return                  { ring: 'ring-red-300 dark:ring-red-500/30',       bg: 'bg-red-50 dark:bg-red-500/10',       num: 'text-red-700 dark:text-red-400' };
}

function relativeTime(iso) {
  if (!iso) return null;
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const h = Math.floor(diff / 3_600_000);
    if (h < 1)  return 'just now';
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 7)  return `${d}d ago`;
    return `${Math.floor(d / 7)}w ago`;
  } catch { return null; }
}

/* ── Page ───────────────────────────────────────────────── */

export default function Jobs() {
  const toast = useToast();
  const [jobs, setJobs]           = useState([]);
  const [total, setTotal]         = useState(0);
  const [loading, setLoading]     = useState(true);
  const [selected, setSelected]   = useState(null);
  const [tab, setTab]             = useState('all');
  const [keywords, setKeywords]   = useState('');
  const [location, setLocation]   = useState('');
  const [days, setDays]           = useState(7);
  const [page, setPage]           = useState(0);
  const [discovering, setDiscover] = useState(false);
  const [matching, setMatching]   = useState(null);
  const [profileId, setProfileId] = useState(null);
  const [lastSources, setSources] = useState([]);
  const pollRef = useRef(null);

  // Stable ref holds the latest query params so load() never has stale closures
  const qRef = useRef({ tab: 'all', location: '', keywords: '', days: 7, page: 0 });

  const load = useCallback(async (overrides = {}) => {
    const q = { ...qRef.current, ...overrides };
    qRef.current = q;
    setLoading(true);
    try {
      const res = await api.getJobs({
        tab:      q.tab,
        location: q.location,
        keywords: q.keywords,
        days:     q.days,
        limit:    PAGE_SIZE,
        offset:   q.page * PAGE_SIZE,
      });
      setJobs(res.jobs ?? []);
      setTotal(res.total ?? 0);
      setSelected(null);
    } catch (e) {
      toast(e.message, 'error');
    }
    setLoading(false);
  }, [toast]);

  // Mount: fetch profile to pre-fill filters, then load once
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    (async () => {
      const { data: { user } } = await getSupabase().auth.getUser();
      if (user) {
        try {
          const profiles = await api.getProfiles(user.id);
          const p = profiles?.[0];
          if (p) {
            setProfileId(p.id);
            const kw  = (p.keywords ?? []).join(', ');
            const loc = p.target_location ?? '';
            setKeywords(kw);
            setLocation(loc);
            load({ tab: 'all', location: loc, keywords: kw, days: 7, page: 0 });
            return;
          }
        } catch { /* no profile yet */ }
      }
      load({ tab: 'all', location: '', keywords: '', days: 7, page: 0 });
    })();
    return () => clearInterval(pollRef.current);
  }, []); // run once on mount — load reads params from qRef so no stale closure

  const handleTabChange = (newTab) => {
    setTab(newTab);
    setPage(0);
    load({ tab: newTab, page: 0 });
  };

  const handleDaysChange = (d) => {
    setDays(d);
    setPage(0);
    load({ days: d, page: 0 });
  };

  const handleSearch = () => {
    setPage(0);
    load({ location, keywords, page: 0 });
  };

  const handlePageChange = (newPage) => {
    setPage(newPage);
    load({ page: newPage });
  };

  const handleDiscover = async () => {
    setDiscover(true);
    try {
      const kw = keywords.split(',').map(s => s.trim()).filter(Boolean);
      const result = await api.runDiscovery({ keywords: kw, location: location.trim(), profile_id: profileId, days });
      setSources(result.sources || []);
      toast(result.message || 'Discovery started — new jobs will appear shortly', 'info');
      let ticks = 0;
      clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        await load({ page: 0 });
        setPage(0);
        if (++ticks >= 12) { clearInterval(pollRef.current); pollRef.current = null; }
      }, 4000);
    } catch (e) { toast(e.message, 'error'); }
    setDiscover(false);
  };

  const handleRunMatch = async (job) => {
    setMatching(job.id);
    try {
      await api.runMatching({ profile_id: profileId });
      toast('Matching started — score will appear in a few seconds', 'info');
      setTimeout(() => load({}), 3500);
    } catch (e) { toast(e.message, 'error'); }
    setMatching(null);
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="flex flex-col gap-5 h-full">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black t-h tracking-tight">Jobs</h1>
          <p className="text-sm t-b mt-0.5">
            {total > 0 ? `${total} jobs found` : 'Browse discovered jobs across all sources'}
          </p>
        </div>
        <button onClick={() => load({})} className="btn-icon"><RefreshCw className="w-4 h-4" /></button>
      </div>

      {/* Filter bar */}
      <div className="card p-4">
        <div className="flex flex-wrap gap-2.5">
          {/* Keywords */}
          <div className="flex-[2_1_180px] flex items-center gap-2 px-3 py-2 border
            bg-white border-slate-200 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100
            dark:bg-transparent dark:border-white/10 dark:focus-within:border-indigo-500/50 dark:focus-within:ring-indigo-500/10 transition-all">
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <input
              className="flex-1 text-sm bg-transparent outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500 text-slate-900 dark:text-white"
              value={keywords}
              onChange={e => setKeywords(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="Keywords (e.g. Python, backend)"
            />
          </div>

          {/* Location */}
          <div className="flex-[1_1_140px] flex items-center gap-2 px-3 py-2 border
            bg-white border-slate-200 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100
            dark:bg-transparent dark:border-white/10 dark:focus-within:border-indigo-500/50 dark:focus-within:ring-indigo-500/10 transition-all">
            <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <input
              className="flex-1 text-sm bg-transparent outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500 text-slate-900 dark:text-white"
              value={location}
              onChange={e => setLocation(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="Location (e.g. Lahore)"
            />
          </div>

          {/* Days */}
          <div className="relative flex items-center">
            <Calendar className="absolute left-3 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            <select
              value={days}
              onChange={e => handleDaysChange(Number(e.target.value))}
              className="pl-8 pr-8 py-2 text-sm border bg-white border-slate-200 text-slate-700 cursor-pointer outline-none appearance-none
                dark:bg-transparent dark:border-white/10 dark:text-slate-300"
            >
              {DAYS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <ChevronDown className="absolute right-2.5 w-3 h-3 text-slate-400 pointer-events-none" />
          </div>

          {/* Search */}
          <button
            onClick={handleSearch}
            className="flex-none flex items-center gap-2 px-5 py-2 bg-indigo-600 text-white text-sm font-bold
              hover:bg-indigo-500 transition-colors cursor-pointer"
          >
            <Search className="w-3.5 h-3.5" />Search
          </button>

          {/* Find Jobs (discovery) */}
          <button
            onClick={handleDiscover}
            disabled={discovering}
            className="flex-none flex items-center gap-2 px-5 py-2 bg-cyan-400 text-slate-900 text-sm font-bold
              hover:bg-cyan-300 disabled:opacity-60 transition-colors cursor-pointer"
          >
            {discovering
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Scanning…</>
              : <><Globe className="w-3.5 h-3.5" />Find Jobs</>}
          </button>
        </div>

        {lastSources.length > 0 && (
          <div className="flex items-center gap-2 mt-2.5 pt-2.5 border-t border-slate-100 dark:border-white/[0.06]">
            <Globe className="w-3 h-3 text-slate-400 shrink-0" />
            <span className="text-xs t-b">Sources:</span>
            <span className="text-xs text-slate-600 dark:text-slate-400">{lastSources.join(' · ')}</span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="tabs-bar">
        {TABS.map(t => (
          <button key={t.id} onClick={() => handleTabChange(t.id)}
            className={clsx('px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer',
              tab === t.id ? 'tab-on' : 'tab-off')}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Body */}
      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : jobs.length === 0 ? (
        <EmptyState tab={tab} />
      ) : (
        <div className="flex flex-col gap-3 flex-1 min-h-0">
          <div className="flex gap-4 items-start min-h-0 flex-1">
            {/* List */}
            <div className={clsx('flex flex-col gap-2 overflow-y-auto', selected ? 'hidden lg:flex lg:w-96 lg:shrink-0' : 'w-full')}>
              {jobs.map(job => (
                <JobCard
                  key={job.id}
                  job={job}
                  selected={selected?.id === job.id}
                  onClick={() => setSelected(prev => prev?.id === job.id ? null : job)}
                  onMatch={() => handleRunMatch(job)}
                  matching={matching === job.id}
                />
              ))}
            </div>

            {/* Detail panel */}
            {selected && (
              <div className="flex-1 min-w-0">
                <JobDetail
                  job={selected}
                  onClose={() => setSelected(null)}
                  onMatch={() => handleRunMatch(selected)}
                  matching={matching === selected.id}
                />
              </div>
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-white/[0.06]">
              <span className="text-xs t-m">
                Page {page + 1} of {totalPages} · {total} jobs
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handlePageChange(page - 1)}
                  disabled={page === 0}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium border border-slate-200 dark:border-white/10
                    text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/[0.06]
                    disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                >
                  <ChevronLeft className="w-3 h-3" />Prev
                </button>
                {/* Page number pills */}
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  const start = Math.max(0, Math.min(page - 2, totalPages - 5));
                  const p = start + i;
                  return (
                    <button
                      key={p}
                      onClick={() => handlePageChange(p)}
                      className={clsx(
                        'w-7 h-7 text-xs font-medium border transition-colors cursor-pointer',
                        p === page
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/[0.06]',
                      )}
                    >{p + 1}</button>
                  );
                })}
                <button
                  onClick={() => handlePageChange(page + 1)}
                  disabled={page >= totalPages - 1}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium border border-slate-200 dark:border-white/10
                    text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/[0.06]
                    disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                >
                  Next<ChevronRight className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── JobCard ────────────────────────────────────────────── */

function JobCard({ job, selected, onClick, onMatch, matching }) {
  const hasScore = job.score != null;
  const sm = hasScore ? scoreMeta(job.score) : null;
  const atm = applyTypeMeta(job.apply_type);
  const TypeIcon = atm.Icon;
  const when = relativeTime(job.posted_at ?? job.discovered_at);

  return (
    <div
      onClick={onClick}
      className={clsx(
        'border p-4 cursor-pointer transition-all duration-150 hover:border-slate-300 dark:hover:border-white/20',
        selected
          ? 'bg-cyan-50/60 border-cyan-300 dark:bg-cyan-500/5 dark:border-cyan-500/30'
          : 'bg-white border-slate-200 dark:bg-white/[0.03] dark:border-white/10',
      )}
    >
      <div className="flex gap-3">
        {/* Score badge */}
        {hasScore ? (
          <div className={clsx('w-12 h-12 shrink-0 flex flex-col items-center justify-center ring-2', sm.ring, sm.bg)}>
            <span className={clsx('text-base font-black leading-none tabular-nums', sm.num)}>{Math.round(job.score)}</span>
            <span className="text-[9px] font-bold opacity-40 mt-0.5">/100</span>
          </div>
        ) : (
          <div className="w-12 h-12 shrink-0 flex items-center justify-center border border-dashed border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.02]">
            <Bot className="w-4 h-4 text-slate-300 dark:text-slate-600" />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-[14px] font-semibold t-h leading-snug truncate">{job.title ?? '—'}</h3>
            {when && <span className="text-[11px] t-m shrink-0 mt-0.5">{when}</span>}
          </div>

          {(job.company || job.location) && (
            <p className="text-[12px] t-b mt-0.5 truncate">{[job.company, job.location].filter(Boolean).join(' · ')}</p>
          )}

          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            <span className={clsx('inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 border', atm.color, atm.bg, atm.border)}>
              <TypeIcon className="w-2.5 h-2.5" />
              {atm.label}
            </span>

            {job.source && (
              <span className="text-[10px] font-semibold t-m bg-slate-100 dark:bg-white/[0.06] border border-slate-200 dark:border-white/10 px-2 py-0.5">
                {job.source}
              </span>
            )}

            {!hasScore && (
              <button
                onClick={e => { e.stopPropagation(); onMatch(); }}
                disabled={matching}
                className="ml-auto inline-flex items-center gap-1 text-[10px] font-bold text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/20 px-2 py-0.5 cursor-pointer hover:bg-purple-100 dark:hover:bg-purple-500/20 transition-colors disabled:opacity-50"
              >
                {matching ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Bot className="w-2.5 h-2.5" />}
                {matching ? 'Scoring…' : 'Run Match'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── JobDetail ──────────────────────────────────────────── */

function JobDetail({ job, onClose, onMatch, matching }) {
  const hasScore = job.score != null;
  const sm = hasScore ? scoreMeta(job.score) : null;
  const atm = applyTypeMeta(job.apply_type);
  const TypeIcon = atm.Icon;
  const when = relativeTime(job.posted_at ?? job.discovered_at);
  const [descExpanded, setDescExpanded] = useState(false);
  const desc = job.description ?? '';
  const longDesc = desc.length > 600;

  return (
    <div className="card overflow-hidden flex flex-col">
      {/* Top header */}
      <div className="p-5 border-b border-slate-100 dark:border-white/[0.06]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-black t-h leading-snug">{job.title ?? '—'}</h2>
            <p className="text-sm t-b mt-1">{[job.company, job.location].filter(Boolean).join(' · ')}</p>
          </div>
          <button onClick={onClose} className="btn-icon shrink-0"><X className="w-4 h-4" /></button>
        </div>

        {/* Meta badges */}
        <div className="flex flex-wrap gap-2 mt-3">
          <span className={clsx('inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 border', atm.color, atm.bg, atm.border)}>
            <TypeIcon className="w-3 h-3" />
            {atm.label}
          </span>
          {job.source && (
            <span className="text-[11px] font-semibold t-m bg-slate-100 dark:bg-white/[0.06] border border-slate-200 dark:border-white/10 px-2.5 py-1">
              {job.source}
            </span>
          )}
          {when && (
            <span className="inline-flex items-center gap-1.5 text-[11px] t-m">
              <Calendar className="w-3 h-3" />
              {when}
            </span>
          )}
        </div>
      </div>

      {/* Score section */}
      <div className="p-5 border-b border-slate-100 dark:border-white/[0.06]">
        {hasScore ? (
          <div className={clsx('p-4 ring-2', sm.ring, sm.bg)}>
            <div className="flex items-start gap-4">
              <div className="text-center shrink-0">
                <span className={clsx('text-4xl font-black leading-none tabular-nums', sm.num)}>{Math.round(job.score)}</span>
                <span className={clsx('text-[10px] font-bold opacity-50 block mt-0.5', sm.num)}>/100 match</span>
              </div>
              {job.reasoning && (
                <p className="text-[13px] t-b leading-relaxed">{job.reasoning}</p>
              )}
            </div>
            {(job.strengths?.length > 0 || job.gaps?.length > 0) && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {(job.strengths ?? []).map((s, i) => (
                  <span key={i} className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 px-2 py-0.5">
                    ✓ {s}
                  </span>
                ))}
                {(job.gaps ?? []).map((g, i) => (
                  <span key={i} className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 px-2 py-0.5">
                    △ {g}
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 p-4 border border-dashed border-slate-200 dark:border-white/10">
            <span className="text-sm t-b">No match score yet</span>
            <button
              onClick={onMatch}
              disabled={matching}
              className="inline-flex items-center gap-2 text-sm font-bold text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/20 px-3 py-1.5 cursor-pointer hover:bg-purple-100 dark:hover:bg-purple-500/20 transition-colors disabled:opacity-50"
            >
              {matching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bot className="w-3.5 h-3.5" />}
              {matching ? 'Scoring…' : 'Run Match'}
            </button>
          </div>
        )}
      </div>

      {/* Apply button */}
      {job.apply_url && (
        <div className="p-5 border-b border-slate-100 dark:border-white/[0.06]">
          <a
            href={job.apply_url}
            target="_blank"
            rel="noreferrer"
            className={clsx(
              'flex items-center justify-center gap-2 py-2.5 text-sm font-bold transition-colors',
              job.apply_type === 'auto'
                ? 'bg-cyan-400 text-slate-900 hover:bg-cyan-300'
                : job.apply_type === 'online_manual'
                ? 'bg-purple-600 text-white hover:bg-purple-500'
                : 'border border-slate-300 dark:border-white/20 t-h hover:bg-slate-50 dark:hover:bg-white/[0.04]',
            )}
          >
            <ExternalLink className="w-3.5 h-3.5" />
            {job.apply_type === 'auto' ? 'Auto-Apply Now' : 'Apply Now'}
          </a>
        </div>
      )}

      {/* Description */}
      {desc && (
        <div className="p-5 flex-1 overflow-y-auto">
          <p className="text-[11px] font-bold t-m uppercase tracking-wider mb-3">Description</p>
          <p className={clsx('text-[13px] t-b leading-relaxed whitespace-pre-wrap', !descExpanded && longDesc && 'line-clamp-[12]')}>
            {desc}
          </p>
          {longDesc && (
            <button
              onClick={() => setDescExpanded(v => !v)}
              className="text-xs font-semibold text-indigo-500 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 mt-2 cursor-pointer"
            >
              {descExpanded ? 'Show less ↑' : 'Show more ↓'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ── EmptyState ─────────────────────────────────────────── */

function EmptyState({ tab }) {
  const msgs = {
    all:    'No jobs found. Enter keywords and a location above, then click Search.',
    auto:   'No auto-applicable jobs found yet. Run Find Jobs with your keywords.',
    online: 'No online-apply jobs in this period. Try widening the date range.',
    manual: 'No manual-apply-only jobs found.',
  };
  return (
    <div className="empty-state">
      <p className="text-sm t-m">{msgs[tab] ?? 'No jobs found.'}</p>
    </div>
  );
}
