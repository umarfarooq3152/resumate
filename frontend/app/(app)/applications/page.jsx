'use client';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { api } from '../../../lib/api';
import { getSupabase } from '../../../lib/supabase';
import Badge, { statusVariant } from '../../../components/Badge';
import Spinner from '../../../components/Spinner';
import ReviewModal from '../../../components/ReviewModal';
import { useToast } from '../../../components/Toast';
import { RefreshCw, ExternalLink } from 'lucide-react';

const TABS = ['pending', 'approved', 'rejected', 'all'];

export default function Applications() {
  const toast = useToast();
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState('pending');
  const [profileId, setProfileId] = useState(null);

  const load = async (t = tab, pid = profileId) => {
    setLoading(true);
    try { setApps((await api.getApplications(t, pid)) ?? []); }
    catch (e) { toast(e.message, 'error'); }
    setLoading(false);
  };

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await getSupabase().auth.getUser();
      let pid = null;
      if (user) {
        try {
          const profiles = await api.getProfiles(user.id);
          pid = profiles?.[0]?.id ?? null;
        } catch { /* no profile */ }
        setProfileId(pid);
      }
      load(tab, pid);
    };
    init();
  }, []);

  useEffect(() => { if (profileId !== null) load(tab, profileId); }, [tab]);

  const handleReview = async (decision, data) => {
    try {
      await api.reviewApplication(selected.job_id, { decision, ...data });
      toast(decision === 'approved' ? 'Approved — submission queued' : 'Rejected', decision === 'approved' ? 'success' : 'info');
      setSelected(null);
      load(tab);
    } catch (e) { toast(e.message, 'error'); }
  };

  const reviewItem = selected ? {
    ...selected,
    title: selected.jobs?.title ?? selected.title,
    company: selected.jobs?.company ?? selected.company,
    description: selected.jobs?.description,
  } : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">Applications</h1>
          <p className="text-sm t-b mt-0.5">Review AI-tailored documents and approve for submission</p>
        </div>
        <button onClick={() => load(tab)} className="btn-icon"><RefreshCw className="w-4 h-4" /></button>
      </div>

      <Tabs tab={tab} setTab={setTab} options={TABS} />

      {loading
        ? <div className="flex justify-center py-16"><Spinner /></div>
        : apps.length === 0 ? <Empty tab={tab} />
        : (
          <div className="space-y-3">
            {apps.map(a => (
              <AppCard key={a.id} app={a} onReview={() => setSelected(a)}
                onRetry={async () => {
                  try { await api.submitApplication(a.job_id); toast('Retry submitted', 'success'); load(tab); }
                  catch (e) { toast(e.message, 'error'); }
                }}
              />
            ))}
          </div>
        )}

      {selected && reviewItem && (
        <ReviewModal type="application" item={reviewItem} onClose={() => setSelected(null)} onDone={handleReview} />
      )}
    </div>
  );
}

const METHOD_META = {
  google_form:    { label: 'Form', light: 'bg-sky-100 text-sky-700',       dark: 'dark:bg-sky-500/15 dark:text-sky-300' },
  greenhouse_api: { label: 'GH',  light: 'bg-emerald-100 text-emerald-700', dark: 'dark:bg-emerald-500/15 dark:text-emerald-300' },
  lever_api:      { label: 'LV',  light: 'bg-violet-100 text-violet-700',   dark: 'dark:bg-violet-500/15 dark:text-violet-300' },
  ashby_api:      { label: 'ASH', light: 'bg-indigo-100 text-indigo-700',   dark: 'dark:bg-indigo-500/15 dark:text-indigo-300' },
};

function AppCard({ app, onReview, onRetry }) {
  const job = app.jobs ?? {};
  const payload = app.submit_payload ?? {};
  const title = job.title ?? payload.title ?? '—';
  const company = job.company ?? payload.company;
  const location = job.location;
  const applyUrl = job.apply_url ?? payload.apply_url;
  const method = job.apply_method ?? payload.apply_method ?? 'manual';
  const reviewStatus = app.review_status ?? 'pending';
  const meta = METHOD_META[method] ?? { label: '···', light: 'bg-slate-100 text-slate-500', dark: 'dark:bg-slate-700/40 dark:text-slate-400' };

  return (
    <div className="card overflow-hidden hover:shadow-sm dark:hover:border-white/20 transition-all duration-150">
      <div className="p-5 flex gap-4">
        <div className={clsx('w-11 h-11 rounded-xl flex items-center justify-center shrink-0 text-xs font-bold tracking-tight', meta.light, meta.dark)}>
          {meta.label}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold text-slate-900 dark:text-white leading-snug truncate">{title}</h3>
              {(company || location) && (
                <p className="text-sm t-b mt-0.5 truncate">{[company, location].filter(Boolean).join(' · ')}</p>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
              {applyUrl && (
                <a href={applyUrl} target="_blank" rel="noreferrer"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/8 transition-colors">
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
              {app.status === 'prepared' && reviewStatus === 'pending' && (
                <button onClick={onReview} className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-semibold rounded-lg hover:bg-emerald-500 transition-colors cursor-pointer">
                  Review & Submit
                </button>
              )}
              {app.status === 'error' && (
                <button onClick={onRetry} className="px-3 py-1.5 bg-amber-500 text-white text-xs font-semibold rounded-lg hover:bg-amber-400 transition-colors cursor-pointer">
                  Retry
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap mt-2.5">
            <Badge variant={statusVariant(app.status)}>{app.status}</Badge>
            {reviewStatus !== 'pending' && (
              <Badge variant={reviewStatus === 'approved' ? 'emerald' : 'red'}>
                {reviewStatus === 'approved' ? 'Approved' : 'Rejected'}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {app.cover_letter && (
        <div className="card-muted px-5 py-3">
          <p className="text-xs t-b leading-relaxed line-clamp-2 italic">
            &ldquo;{app.cover_letter.slice(0, 240)}&hellip;&rdquo;
          </p>
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

function Empty({ tab }) {
  const msgs = {
    pending: 'No applications pending. Approve job matches first.',
    approved: 'No submitted applications yet.',
    rejected: 'No rejected applications.',
    all: 'No applications yet.',
  };
  return (
    <div className="empty-state">
      <p className="text-sm t-m">{msgs[tab] ?? 'Nothing here.'}</p>
    </div>
  );
}
