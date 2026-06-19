'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import clsx from 'clsx';
import { api } from '../../../lib/api';
import { getSupabase } from '../../../lib/supabase';
import Spinner from '../../../components/Spinner';
import { useToast } from '../../../components/Toast';
import {
  RefreshCw, ExternalLink, GraduationCap, Search,
  Loader2, MapPin, Globe, Star, Play, ChevronLeft, ChevronRight,
} from 'lucide-react';

const TABS = [
  { id: 'all',         label: 'All' },
  { id: 'internship',  label: 'Internships' },
  { id: 'fellowship',  label: 'Fellowships' },
];

const SOURCES = {
  internshala: { label: 'Internshala', color: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-500/20' },
  unstop:      { label: 'Unstop',      color: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-200 dark:border-violet-500/20' },
  outreachy:   { label: 'Outreachy',   color: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20' },
  linkedin:    { label: 'LinkedIn',    color: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-200 dark:border-sky-500/20' },
  remotive:    { label: 'Remotive',    color: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-500/20' },
};

const PAGE_SIZE = 20;

function scoreBadge(score) {
  if (score == null) return null;
  const s = Math.round(score);
  const cls = s >= 75 ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 ring-emerald-300 dark:ring-emerald-500/30'
    : s >= 55 ? 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 ring-amber-300 dark:ring-amber-500/30'
    : 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-500/10 ring-red-300 dark:ring-red-500/30';
  return <span className={clsx('inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full ring-1', cls)}>
    <Star className="w-3 h-3" />{s}%
  </span>;
}

export default function Internships() {
  const toast = useToast();
  const [items, setItems]       = useState([]);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [tab, setTab]           = useState('all');
  const [keywords, setKeywords] = useState('');
  const [location, setLocation] = useState('');
  const [page, setPage]         = useState(0);
  const [profileId, setProfileId] = useState(null);
  const [mode, setMode]         = useState('both');
  const pollRef = useRef(null);

  const qRef = useRef({ tab: 'all', keywords: '', location: '', page: 0 });

  const load = useCallback(async (overrides = {}) => {
    const q = { ...qRef.current, ...overrides };
    qRef.current = q;
    setLoading(true);
    try {
      const res = await api.getInternships({
        opportunity_type: q.tab === 'all' ? undefined : q.tab,
        keywords:  q.keywords || undefined,
        location:  q.location || undefined,
        limit:     PAGE_SIZE,
        offset:    q.page * PAGE_SIZE,
        days:      60,
      });
      setItems(res.items ?? []);
      setTotal(res.total ?? 0);
    } catch (e) {
      toast(e.message, 'error');
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await getSupabase().auth.getUser();
      if (user) {
        try {
          const profiles = await api.getProfiles(user.id);
          const p = profiles?.[0];
          if (p) {
            setProfileId(p.id);
            setKeywords((p.keywords ?? []).join(', '));
            setLocation(p.target_location ?? '');
            load({ keywords: (p.keywords ?? []).join(', '), location: p.target_location ?? '' });
            return;
          }
        } catch { /* no profile */ }
      }
      load({});
    };
    init();
    return () => clearInterval(pollRef.current);
  }, []);

  const handleDiscover = async () => {
    setDiscovering(true);
    try {
      const kw = keywords.trim() || 'software';
      const res = await api.runInternships({ keywords: kw, location: location.trim(), mode });
      toast(res.message || 'Discovery started', 'success');
      pollRef.current = setInterval(() => {
        load(qRef.current).then(() => {});
      }, 5000);
      setTimeout(() => { clearInterval(pollRef.current); pollRef.current = null; }, 60_000);
    } catch (e) {
      toast(e.message, 'error');
    }
    setDiscovering(false);
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-5">

      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl p-6
        bg-gradient-to-br from-violet-600/10 via-indigo-600/5 to-transparent
        border border-violet-500/20 dark:border-violet-500/15
        dark:bg-white/[0.03] dark:backdrop-blur-sm">
        <div className="absolute -top-20 -right-20 w-64 h-64 bg-violet-500/15 rounded-full blur-3xl pointer-events-none dark:block hidden" />
        <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none dark:block hidden" />
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <GraduationCap className="w-5 h-5 text-violet-500 dark:text-violet-400" />
              <span className="text-xs font-bold uppercase tracking-wider text-violet-500 dark:text-violet-400">
                Internships & Fellowships
              </span>
            </div>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
              Find Opportunities
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
              Internshala, Unstop, Outreachy, LinkedIn — all in one place.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => load(qRef.current)} className="btn-icon" aria-label="Refresh">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Search + Discover */}
      <div className="card p-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              value={keywords}
              onChange={e => setKeywords(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && load({ keywords, page: 0 })}
              placeholder="Keywords (e.g. software, data, AI)"
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.04] text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            />
          </div>
          <div className="relative">
            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              value={location}
              onChange={e => setLocation(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && load({ location, page: 0 })}
              placeholder="Location (optional)"
              className="w-full sm:w-44 pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.04] text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-500">Search for:</span>
          {['both', 'internships', 'fellowships'].map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={clsx('text-xs px-3 py-1 rounded-full border transition-colors cursor-pointer font-medium',
                mode === m
                  ? 'bg-violet-600 text-white border-violet-600'
                  : 'border-slate-200 dark:border-white/[0.08] text-slate-500 dark:text-slate-400 hover:border-violet-400 hover:text-violet-600 dark:hover:text-violet-400')}>
              {m === 'both' ? 'Both' : m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
          <div className="ml-auto">
            <button
              onClick={handleDiscover}
              disabled={discovering}
              className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer">
              {discovering ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {discovering ? 'Searching…' : 'Find Now'}
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-slate-100 dark:bg-white/[0.04] rounded-xl w-fit">
        {TABS.map(t => (
          <button key={t.id}
            onClick={() => { setTab(t.id); setPage(0); load({ tab: t.id, page: 0 }); }}
            className={clsx('px-4 py-1.5 rounded-lg text-sm font-semibold transition-all cursor-pointer',
              tab === t.id
                ? 'bg-white dark:bg-white/10 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300')}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Results */}
      {loading ? (
        <div className="flex items-center justify-center h-40"><Spinner /></div>
      ) : items.length === 0 ? (
        <div className="empty-state py-16">
          <GraduationCap className="w-8 h-8 text-slate-300 dark:text-slate-700 mx-auto mb-3" />
          <p className="text-sm text-slate-400 dark:text-slate-600 mb-4">
            No opportunities found yet.
          </p>
          <button onClick={handleDiscover} disabled={discovering}
            className="flex items-center gap-2 mx-auto px-5 py-2.5 bg-violet-600 text-white text-sm font-semibold rounded-lg hover:bg-violet-500 disabled:opacity-60 transition-colors cursor-pointer">
            {discovering ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Search Now
          </button>
        </div>
      ) : (
        <>
          <p className="text-xs text-slate-400 dark:text-slate-600">{total} opportunities found</p>
          <div className="space-y-3">
            {items.map((item, i) => (
              <OpportunityCard key={item.id ?? i} item={item} />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <button onClick={() => { setPage(p => p - 1); load({ page: page - 1 }); }}
                disabled={page === 0}
                className="flex items-center gap-1 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-white/[0.08] rounded-lg hover:bg-slate-50 dark:hover:bg-white/[0.04] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer">
                <ChevronLeft className="w-4 h-4" /> Prev
              </button>
              <span className="text-xs text-slate-400">{page + 1} / {totalPages}</span>
              <button onClick={() => { setPage(p => p + 1); load({ page: page + 1 }); }}
                disabled={page >= totalPages - 1}
                className="flex items-center gap-1 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-white/[0.08] rounded-lg hover:bg-slate-50 dark:hover:bg-white/[0.04] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer">
                Next <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function OpportunityCard({ item }) {
  const typeBadge = item.opportunity_type === 'fellowship'
    ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20'
    : 'bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-200 dark:border-violet-500/20';

  const src = SOURCES[item.source] ?? { label: item.source, color: 'bg-slate-100 dark:bg-white/[0.06] text-slate-500 dark:text-slate-400 border-slate-200 dark:border-white/[0.08]' };

  return (
    <div className="card p-4 hover:shadow-md dark:hover:shadow-black/20 transition-all group">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            <span className={clsx('text-[11px] font-bold px-2 py-0.5 rounded-full border capitalize', typeBadge)}>
              {item.opportunity_type}
            </span>
            <span className={clsx('text-[11px] font-semibold px-2 py-0.5 rounded-full border', src.color)}>
              {src.label}
            </span>
            {scoreBadge(item.score)}
          </div>

          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">
            {item.title}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {item.company}
            {item.location && (
              <span className="ml-2 inline-flex items-center gap-0.5">
                {item.location.toLowerCase().includes('remote')
                  ? <Globe className="w-3 h-3" />
                  : <MapPin className="w-3 h-3" />}
                {item.location}
              </span>
            )}
          </p>

          {item.description && (
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-2 line-clamp-2">
              {item.description}
            </p>
          )}
        </div>

        {item.apply_url && (
          <a href={item.apply_url} target="_blank" rel="noopener noreferrer"
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer">
            Apply <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    </div>
  );
}
