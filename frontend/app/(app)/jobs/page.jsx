'use client';
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { api } from '../../../lib/api';
import { getSupabase } from '../../../lib/supabase';
import Badge from '../../../components/Badge';
import Spinner from '../../../components/Spinner';
import ReviewModal from '../../../components/ReviewModal';
import { useToast } from '../../../components/Toast';
import { RefreshCw, ExternalLink, Bot, Search, Loader2, MapPin, Globe, Info } from 'lucide-react';

const TABS = ['pending', 'approved', 'rejected', 'all'];

export default function Jobs() {
  const toast = useToast();
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState('pending');
  const [keywords, setKeywords] = useState('');
  const [location, setLocation] = useState('');
  const [locationFilter, setLocationFilter] = useState(''); // set on Find Jobs click
  const [discovering, setDiscovering] = useState(false);
  const [profileId, setProfileId] = useState(null);
  const [lastSources, setLastSources] = useState([]);
  const [lastNote, setLastNote] = useState('');
  const pollRef = useRef(null);

  const load = async (t = tab) => {
    setLoading(true);
    try { setMatches((await api.getMatches(t)) ?? []); }
    catch (e) { toast(e.message, 'error'); }
    setLoading(false);
  };

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await getSupabase().auth.getUser();
      if (user) {
        try {
          const profiles = await api.getProfiles(user.id);
          const p = profiles?.[0];
          if (p) { setProfileId(p.id); setKeywords((p.keywords ?? []).join(', ')); setLocation(p.target_location ?? ''); }
        } catch {}
      }
      load(tab);
    };
    init();
    return () => clearInterval(pollRef.current);
  }, []);

  useEffect(() => { load(tab); }, [tab]);

  const handleDiscover = async () => {
    setDiscovering(true);
    const searchLoc = location.trim();
    setLocationFilter(searchLoc);
    try {
      const kw = keywords.split(',').map(s => s.trim()).filter(Boolean);
      const result = await api.runDiscovery({ keywords: kw, location: searchLoc, profile_id: profileId });
      setLastSources(result.sources || []);
      setLastNote(result.note || '');
      toast(result.message || 'Discovery started — jobs will appear shortly', 'info');
      let ticks = 0;
      clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        await load(tab);
        if (++ticks >= 10) { clearInterval(pollRef.current); pollRef.current = null; }
      }, 4000);
    } catch (e) { toast(e.message, 'error'); }
    setDiscovering(false);
  };

  const handleReview = async (decision, data) => {
    try {
      await api.reviewMatch(selected.job_id, { decision, ...data });
      toast(`Match ${decision}`, decision === 'approved' ? 'success' : 'info');
      setSelected(null); load(tab);
    } catch (e) { toast(e.message, 'error'); }
  };

  const reviewItem = selected ? {
    ...selected,
    title: selected.title ?? selected.jobs?.title,
    company: selected.company ?? selected.jobs?.company,
    description: selected.description ?? selected.jobs?.description,
    url: selected.apply_url ?? selected.jobs?.apply_url,
  } : null;

  // Filter displayed matches by the last searched location so old results from a
  // different city don't bleed through when the user switches location.
  const city = locationFilter.split(',')[0].trim().toLowerCase();
  const displayMatches = city
    ? matches.filter(m => (m.location ?? '').toLowerCase().includes(city))
    : matches;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">Jobs</h1>
          <p className="text-sm t-b mt-0.5">AI-scored matches — approve to trigger resume tailoring</p>
        </div>
        <button onClick={() => load(tab)} className="btn-icon"><RefreshCw className="w-4 h-4" /></button>
      </div>

      {/* Discovery bar */}
      <div className="card p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 flex items-center gap-2 rounded-xl px-3 py-2 border transition-all
            border-slate-200 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100
            dark:border-white/10 dark:focus-within:border-indigo-500/50 dark:focus-within:ring-indigo-500/10
            bg-white dark:bg-transparent">
            <Search className="w-4 h-4 text-slate-400 shrink-0" />
            <input className="flex-1 text-sm bg-transparent outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500 text-slate-900 dark:text-white"
              value={keywords} onChange={e => setKeywords(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleDiscover()}
              placeholder="Keywords (e.g. Python, ML engineer)" />
          </div>
          <div className="sm:w-52 flex items-center gap-2 rounded-xl px-3 py-2 border transition-all
            border-slate-200 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100
            dark:border-white/10 dark:focus-within:border-indigo-500/50 dark:focus-within:ring-indigo-500/10
            bg-white dark:bg-transparent">
            <MapPin className="w-4 h-4 text-slate-400 shrink-0" />
            <input className="flex-1 text-sm bg-transparent outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500 text-slate-900 dark:text-white"
              value={location} onChange={e => setLocation(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleDiscover()}
              placeholder="Location (e.g. London)" />
          </div>
          <button onClick={handleDiscover} disabled={discovering}
            className="flex items-center justify-center gap-2 px-5 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-500 disabled:opacity-60 transition-colors shrink-0 cursor-pointer">
            {discovering ? <><Loader2 className="w-4 h-4 animate-spin" /> Scanning…</> : <><Search className="w-4 h-4" /> Find Jobs</>}
          </button>
        </div>
        {(locationFilter || lastSources.length > 0) && (
          <div className="space-y-2 mt-2.5 pt-2.5 border-t border-slate-100 dark:border-white/[0.06]">
            {locationFilter && (
              <div className="flex items-center gap-2">
                <MapPin className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span className="text-xs t-b">Showing jobs in <strong className="text-slate-900 dark:text-white">{locationFilter}</strong></span>
                <button onClick={() => setLocationFilter('')}
                  className="ml-auto text-xs t-m hover:text-slate-700 dark:hover:text-slate-200 underline cursor-pointer">
                  Show all locations
                </button>
              </div>
            )}
            {lastSources.length > 0 && (
              <div className="flex items-start gap-2">
                <Globe className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <span className="text-xs t-b">Sources: </span>
                  <span className="text-xs text-slate-600 dark:text-slate-400">{lastSources.join(' · ')}</span>
                  {lastNote && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5 flex items-center gap-1">
                      <Info className="w-3 h-3 shrink-0" />{lastNote}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <Tabs tab={tab} setTab={setTab} options={TABS} />

      {loading
        ? <div className="flex justify-center py-16"><Spinner /></div>
        : displayMatches.length === 0 ? <Empty tab={tab} locationFilter={locationFilter} />
        : <div className="space-y-3">{displayMatches.map(m => <MatchCard key={m.id} match={m} onReview={() => setSelected(m)} />)}</div>}

      {selected && reviewItem && (
        <ReviewModal type="match" item={reviewItem} onClose={() => setSelected(null)} onDone={handleReview} />
      )}
    </div>
  );
}

function MatchCard({ match, onReview }) {
  const score = match.score ?? 0;
  const reviewStatus = match.review_status ?? 'pending';
  const [expanded, setExpanded] = useState(false);

  const sc = score >= 75
    ? { ring: 'ring-emerald-200 dark:ring-emerald-500/20', bg: 'bg-emerald-50 dark:bg-emerald-500/10', num: 'text-emerald-700 dark:text-emerald-400' }
    : score >= 55
    ? { ring: 'ring-amber-200 dark:ring-amber-500/20',   bg: 'bg-amber-50 dark:bg-amber-500/10',   num: 'text-amber-700 dark:text-amber-400' }
    : { ring: 'ring-red-200 dark:ring-red-500/20',       bg: 'bg-red-50 dark:bg-red-500/10',       num: 'text-red-700 dark:text-red-400' };

  const hasFooter = match.reasoning || match.strengths?.length || match.gaps?.length;

  return (
    <div className="card overflow-hidden hover:shadow-sm dark:hover:border-white/20 transition-all duration-150">
      <div className="p-5 flex gap-4">
        <div className={clsx('w-14 h-14 rounded-2xl flex flex-col items-center justify-center shrink-0 ring-2', sc.ring, sc.bg)}>
          <span className={clsx('text-xl font-black leading-none tabular-nums', sc.num)}>{Math.round(score)}</span>
          <span className="text-[9px] font-bold tracking-wide opacity-40 mt-0.5">/100</span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold text-slate-900 dark:text-white leading-snug truncate">{match.title ?? '—'}</h3>
              {(match.company || match.location) && (
                <p className="text-sm t-b mt-0.5 truncate">{[match.company, match.location].filter(Boolean).join(' · ')}</p>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
              {match.apply_url && (
                <a href={match.apply_url} target="_blank" rel="noreferrer"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/8 transition-colors">
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
              {reviewStatus === 'pending' && (
                <button onClick={onReview} className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-500 transition-colors cursor-pointer">
                  Review
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap mt-2.5">
            <Badge variant={reviewStatus === 'approved' ? 'emerald' : reviewStatus === 'rejected' ? 'red' : 'amber'}>{reviewStatus}</Badge>
            {match.decision === 'apply' && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 px-2 py-0.5 rounded-full border border-indigo-100 dark:border-indigo-500/20">
                <Bot className="w-2.5 h-2.5" /> AI: Apply
              </span>
            )}
          </div>
        </div>
      </div>

      {hasFooter && (
        <div className="card-muted px-5 py-3 space-y-2">
          {match.reasoning && (
            <div>
              <p className={clsx('text-xs t-b leading-relaxed', !expanded && 'line-clamp-2')}>{match.reasoning}</p>
              {match.reasoning.length > 120 && (
                <button onClick={() => setExpanded(v => !v)} className="text-[11px] font-semibold text-indigo-500 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 mt-1 cursor-pointer">
                  {expanded ? 'Show less ↑' : 'Show more ↓'}
                </button>
              )}
            </div>
          )}
          {(match.strengths?.length > 0 || match.gaps?.length > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {(match.strengths ?? []).slice(0, 3).map((s, i) => (
                <span key={i} className="text-[11px] font-medium bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-100 dark:border-emerald-500/20">✓ {s}</span>
              ))}
              {(match.gaps ?? []).slice(0, 2).map((g, i) => (
                <span key={i} className="text-[11px] font-medium bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-full border border-amber-100 dark:border-amber-500/20">△ {g}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Tabs({ tab, setTab, options }) {
  return (
    <div className="tabs-bar">
      {options.map(o => (
        <button key={o} onClick={() => setTab(o)}
          className={clsx('px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors cursor-pointer',
            tab === o ? 'tab-on' : 'tab-off')}>
          {o}
        </button>
      ))}
    </div>
  );
}

const _PK_CITIES = ['lahore','karachi','islamabad','rawalpindi','peshawar','pakistan'];

function Empty({ tab, locationFilter }) {
  const isPakistan = _PK_CITIES.some(c => locationFilter.toLowerCase().includes(c));

  if (locationFilter) {
    return (
      <div className="empty-state">
        <p className="text-sm t-m">No scored matches in <strong className="text-slate-700 dark:text-slate-300">{locationFilter}</strong> yet.</p>
        {isPakistan ? (
          <p className="text-xs t-m mt-1">
            Local Pakistan boards are bot-protected, so jobs come from <strong>Remotive, WeWorkRemotely, Jobicy & Himalayas</strong> — worldwide remote roles accessible from Pakistan.
            Run <strong>Pipeline → Matching</strong> once discovery finishes to score them.
          </p>
        ) : (
          <p className="text-xs t-m mt-1">Discovery may still be running — or click "Show all locations" above to see everything.</p>
        )}
      </div>
    );
  }
  const msgs = {
    pending: 'No jobs pending review. Enter keywords and a location above, then click Find Jobs.',
    approved: 'No approved jobs yet.',
    rejected: 'No rejected jobs.',
    all: 'No scored jobs yet. Run matching from the Pipeline page.',
  };
  return <div className="empty-state"><p className="text-sm t-m">{msgs[tab] ?? 'Nothing here.'}</p></div>;
}
