'use client';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { api } from '../../../lib/api';
import { getSupabase } from '../../../lib/supabase';
import { useToast } from '../../../components/Toast';
import Spinner from '../../../components/Spinner';
import Badge from '../../../components/Badge';
import {
  Link2, Search, Send, AlertTriangle, CheckCircle,
  Edit2, ChevronDown, ChevronUp, History, ExternalLink, RefreshCw,
  MessageCircle, Clock, HelpCircle,
} from 'lucide-react';

const CONFIDENCE_VARIANT = { high: 'emerald', medium: 'amber', low: 'red' };

export default function FormsPage() {
  const toast = useToast();
  const [profileId, setProfileId] = useState(null);
  const [url, setUrl] = useState('');
  const [step, setStep] = useState('idle');
  const [analysis, setAnalysis] = useState(null);
  const [fills, setFills] = useState([]);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [whaForms, setWhaForms] = useState([]);
  const [loadingWha, setLoadingWha] = useState(true);
  const [dryRun, setDryRun] = useState(true);
  const [expandedRows, setExpandedRows] = useState({});

  const loadWhaForms = async () => {
    try {
      const data = await api.getEmailDrafts({ source: 'whatsapp_form' });
      setWhaForms(data ?? []);
    } catch { /* ignore */ }
    setLoadingWha(false);
  };

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await getSupabase().auth.getUser();
      if (user) {
        const profiles = await api.getProfiles(user.id).catch(() => []);
        if (profiles?.[0]) setProfileId(profiles[0].id);
      }
      const [cfg, subs] = await Promise.allSettled([api.getSettings(), api.getFormSubmissions(20)]);
      if (cfg.status === 'fulfilled') setDryRun(cfg.value?.dry_run ?? true);
      if (subs.status === 'fulfilled') setHistory(subs.value ?? []);
      setLoadingHistory(false);
      loadWhaForms();
    };
    init();
  }, []);

  const analyze = async () => {
    if (!url.trim()) return;
    if (!url.includes('docs.google.com/forms') && !url.includes('forms.gle')) {
      toast('Only Google Forms URLs are supported', 'error');
      return;
    }
    setStep('analyzing');
    setResult(null);
    try {
      const data = await api.analyzeForms({ url: url.trim(), profile_id: profileId });
      setAnalysis(data);
      const proposed = data.proposed_fills ?? [];
      const questions = data.questions ?? [];
      if (proposed.length === 0 && questions.length > 0) {
        setFills(questions.map(q => ({
          entry_id: q.entry_id, question: q.title, type: q.type, value: '', confidence: 'low',
        })));
      } else {
        setFills(proposed);
      }
      setStep('review');
    } catch (e) {
      toast(e.message, 'error');
      setStep('idle');
    }
  };

  const submit = async () => {
    setStep('submitting');
    try {
      const res = await api.submitForm({
        url: analysis.url,
        fills: fills.filter(f => f.value),
        profile_id: profileId,
      });
      setResult(res);
      setStep('done');
      toast(
        res.dry_run ? 'Dry run complete — form not actually submitted' : 'Form submitted successfully!',
        res.dry_run ? 'info' : 'success',
      );
      api.getFormSubmissions(20).then(h => setHistory(h)).catch(() => {});
    } catch (e) {
      toast(e.message, 'error');
      setStep('review');
    }
  };

  const toggleRow = (i) => setExpandedRows(r => ({ ...r, [i]: !r[i] }));

  const updateFill = (entryIdOrIdx, value) => {
    setFills(prev => prev.map((f, idx) =>
      (f.entry_id != null ? f.entry_id === entryIdOrIdx : idx === entryIdOrIdx)
        ? { ...f, value } : f,
    ));
  };

  const reset = () => {
    setStep('idle'); setUrl(''); setAnalysis(null); setFills([]); setResult(null);
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">Form Auto-Fill</h1>
        <p className="text-sm t-b mt-0.5">
          Paste a Google Forms job application link — AI fills every field from your profile
        </p>
      </div>

      {(step === 'idle' || step === 'analyzing') && (
        <div className="card p-6 space-y-4">
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input
                className="input pl-9"
                value={url}
                onChange={e => setUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && analyze()}
                placeholder="https://docs.google.com/forms/d/…/viewform"
                disabled={step === 'analyzing'}
              />
            </div>
            <button
              onClick={analyze}
              disabled={!url.trim() || step === 'analyzing'}
              className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors shrink-0 cursor-pointer">
              {step === 'analyzing'
                ? <><Spinner className="w-4 h-4 text-white" /> Analyzing…</>
                : <><Search className="w-4 h-4" /> Analyze Form</>}
            </button>
          </div>

          {dryRun && (
            <div className="flex items-center gap-2 text-xs rounded-lg px-3 py-2
              text-amber-700 bg-amber-50 border border-amber-200
              dark:text-amber-300 dark:bg-amber-500/8 dark:border-amber-500/20">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>Dry run mode is on — form will not actually be submitted. Change in <a href="/settings" className="underline font-semibold">Settings</a>.</span>
            </div>
          )}
        </div>
      )}

      {step === 'review' && analysis && (
        <div className="space-y-4">
          <div className="card p-5 flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-500/15 flex items-center justify-center shrink-0">
              <Link2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wide mb-0.5">Google Form</p>
              <h2 className="text-[15px] font-semibold text-slate-900 dark:text-white truncate">{analysis.form_title}</h2>
              <a href={analysis.url} target="_blank" rel="noreferrer"
                className="text-xs t-m hover:text-slate-600 dark:hover:text-slate-300 flex items-center gap-1 mt-0.5 truncate">
                {analysis.url} <ExternalLink className="w-3 h-3 shrink-0" />
              </a>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-2xl font-black text-slate-900 dark:text-white tabular-nums leading-none">
                {fills.filter(f => f.value).length}
              </p>
              <p className="text-xs t-m mt-0.5">of {fills.length} filled</p>
            </div>
          </div>

          {fills.length === 0 ? (
            <div className="rounded-2xl p-5 text-sm space-y-2
              bg-amber-50 border border-amber-200 text-amber-800
              dark:bg-amber-500/8 dark:border-amber-500/20 dark:text-amber-300">
              <p><strong>No form fields detected.</strong> This can happen when:</p>
              <ul className="list-disc list-inside space-y-1 ml-1">
                <li>The form requires a Google account to view</li>
                <li>The URL is a preview link (<code className="text-xs bg-amber-100 dark:bg-amber-500/20 px-1 rounded">/edit</code> or <code className="text-xs bg-amber-100 dark:bg-amber-500/20 px-1 rounded">/preview</code>) — use <code className="text-xs bg-amber-100 dark:bg-amber-500/20 px-1 rounded">/viewform</code></li>
                <li>The form uses a newer Google layout not yet supported</li>
              </ul>
              <p>Make sure the form is set to <strong>"Anyone with the link"</strong> and the URL ends in <code className="text-xs bg-amber-100 dark:bg-amber-500/20 px-1 rounded">/viewform</code>.</p>
            </div>
          ) : (
            <div className="card overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-100 dark:border-white/[0.06] bg-slate-50/60 dark:bg-white/[0.02] flex items-center justify-between">
                <p className="text-xs font-semibold t-b uppercase tracking-wide">Review & Edit Answers</p>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-20 bg-slate-200 dark:bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 rounded-full transition-all"
                      style={{ width: `${fills.length > 0 ? Math.round((fills.filter(f => f.value).length / fills.length) * 100) : 0}%` }}
                    />
                  </div>
                  <p className="text-xs t-m">{fills.filter(f => f.value).length}/{fills.length}</p>
                </div>
              </div>

              {fills.map((fill, i) => {
                const expanded = expandedRows[i];
                const isLong = fill.type === 'paragraph' || (fill.value?.length ?? 0) > 80;
                const isFilled = !!fill.value;
                return (
                  <div key={fill.entry_id ?? i}
                    className={clsx(
                      'border-b border-slate-100 dark:border-white/[0.04] last:border-0 px-4 py-3 space-y-2',
                      !isFilled && 'bg-amber-50/30 dark:bg-amber-500/[0.03]',
                    )}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-200 leading-snug flex-1">{fill.question}</p>
                      <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                        <span className="text-[10px] font-mono t-m bg-slate-100 dark:bg-white/8 px-1.5 py-0.5 rounded">{fill.type}</span>
                        <Badge variant={CONFIDENCE_VARIANT[fill.confidence] ?? 'default'} className="text-[10px]">
                          {fill.confidence}
                        </Badge>
                      </div>
                    </div>

                    {isLong && !expanded ? (
                      <div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5
                        bg-slate-50 border border-slate-200
                        dark:bg-white/[0.03] dark:border-white/[0.06]">
                        <p className="text-xs text-slate-600 dark:text-slate-400 truncate flex-1">
                          {fill.value || <span className="text-slate-300 dark:text-slate-600 italic">empty — click to fill</span>}
                        </p>
                        <button onClick={() => toggleRow(i)}
                          className="flex items-center gap-1 text-[11px] font-medium text-indigo-500 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 shrink-0 cursor-pointer">
                          <Edit2 className="w-3 h-3" /> Edit <ChevronDown className="w-3 h-3" />
                        </button>
                      </div>
                    ) : isLong && expanded ? (
                      <div className="space-y-1.5">
                        <textarea
                          rows={5}
                          value={fill.value}
                          onChange={e => updateFill(fill.entry_id ?? i, e.target.value)}
                          className="w-full text-xs font-mono text-slate-700 dark:text-slate-300 rounded-lg p-2.5 resize-y focus:outline-none focus:ring-2 focus:ring-indigo-300 dark:focus:ring-indigo-500/30
                            bg-slate-50 border border-slate-200
                            dark:bg-white/[0.04] dark:border-white/[0.08]"
                        />
                        <button onClick={() => toggleRow(i)}
                          className="flex items-center gap-1 text-[11px] font-medium t-m hover:text-slate-600 dark:hover:text-slate-300 cursor-pointer">
                          <ChevronUp className="w-3 h-3" /> Collapse
                        </button>
                      </div>
                    ) : (
                      <input
                        type="text"
                        value={fill.value}
                        onChange={e => updateFill(fill.entry_id ?? i, e.target.value)}
                        placeholder="Leave blank to skip"
                        className="w-full text-xs text-slate-700 dark:text-slate-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300 dark:focus:ring-indigo-500/30 transition-colors
                          bg-slate-50 border border-slate-200 focus:bg-white
                          dark:bg-white/[0.03] dark:border-white/[0.06] dark:focus:bg-white/[0.06]"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="card px-5 py-4 flex items-center justify-between gap-4">
            <button onClick={reset} className="text-sm t-b hover:text-slate-700 dark:hover:text-slate-200 transition-colors cursor-pointer">
              ← Try another URL
            </button>
            <div className="flex items-center gap-3">
              {dryRun && (
                <span className="text-xs text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-500/15 px-2.5 py-1 rounded-full font-medium">
                  Dry Run
                </span>
              )}
              <button
                onClick={submit}
                disabled={fills.filter(f => f.value).length === 0}
                className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white text-sm font-semibold rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition-colors cursor-pointer">
                <Send className="w-4 h-4" />
                {dryRun ? 'Simulate Submit' : 'Submit Form'}
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 'submitting' && (
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <Spinner />
          <p className="text-sm t-b">{dryRun ? 'Simulating submission…' : 'Submitting form…'}</p>
        </div>
      )}

      {step === 'done' && result && (
        <div className={clsx('rounded-2xl border p-6 space-y-4', result.dry_run
          ? 'bg-amber-50 border-amber-200 dark:bg-amber-500/8 dark:border-amber-500/20'
          : 'bg-emerald-50 border-emerald-200 dark:bg-emerald-500/8 dark:border-emerald-500/20',
        )}>
          <div className="flex items-center gap-3">
            {result.dry_run
              ? <AlertTriangle className="w-6 h-6 text-amber-500 shrink-0" />
              : <CheckCircle className="w-6 h-6 text-emerald-500 shrink-0" />}
            <div>
              <p className="font-semibold text-slate-900 dark:text-white">
                {result.dry_run ? 'Dry Run Complete' : 'Form Submitted!'}
              </p>
              <p className="text-sm t-b mt-0.5">
                {result.dry_run
                  ? `${result.filled_count} fields would be filled. Turn off dry run in Settings to submit for real.`
                  : `${result.filled_count} fields filled and form submitted successfully.`}
              </p>
            </div>
          </div>

          {result.fill_results?.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-semibold t-b uppercase tracking-wide">Fields filled</p>
              <div className="flex flex-wrap gap-1.5">
                {result.fill_results.map((r, i) => (
                  <span key={i} className={clsx(
                    'text-[11px] px-2 py-0.5 rounded-full font-mono',
                    r.filled
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
                      : 'bg-slate-100 text-slate-400 dark:bg-white/8 dark:text-slate-600 line-through',
                  )}>
                    {r.entry_id?.replace('entry.', '#')}
                    {r.error ? ` ⚠` : ''}
                  </span>
                ))}
              </div>
            </div>
          )}

          {result.errors?.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-red-600 dark:text-red-400">Errors</p>
              {result.errors.map((e, i) => (
                <p key={i} className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/8 px-3 py-1.5 rounded-lg">{e.error ?? JSON.stringify(e)}</p>
              ))}
            </div>
          )}

          {result.screenshot && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold t-b uppercase tracking-wide">
                {result.dry_run ? 'Preview — form as filled (not submitted)' : 'Confirmation screenshot'}
              </p>
              <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-white/10 shadow-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`data:image/jpeg;base64,${result.screenshot}`}
                  alt="Filled form screenshot"
                  className="w-full object-top"
                />
              </div>
            </div>
          )}

          <button onClick={reset}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors cursor-pointer
              bg-white border border-slate-200 text-slate-700 hover:bg-slate-50
              dark:bg-white/[0.04] dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/[0.08]">
            <RefreshCw className="w-4 h-4" /> Fill another form
          </button>
        </div>
      )}

      {/* WhatsApp forwarded forms */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <MessageCircle className="w-4 h-4 t-m" />
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">From WhatsApp</h2>
          </div>
          <button onClick={loadWhaForms} className="btn-icon" title="Refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
        {loadingWha
          ? <div className="flex justify-center py-6"><Spinner /></div>
          : whaForms.length === 0
            ? (
              <div className="empty-state">
                <MessageCircle className="w-5 h-5 t-m mx-auto mb-2" />
                <p className="text-sm t-m">Forward a Google Form link to yourself on WhatsApp and it will appear here.</p>
              </div>
            )
            : (
              <div className="card div-y overflow-hidden">
                {whaForms.map(f => <WhaFormRow key={f.id} form={f} />)}
              </div>
            )}
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3">
          <History className="w-4 h-4 t-m" />
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">Submission History</h2>
        </div>

        {loadingHistory
          ? <div className="flex justify-center py-8"><Spinner /></div>
          : history.length === 0
            ? <div className="empty-state"><p className="text-sm t-m">No form submissions yet.</p></div>
            : (
              <div className="card div-y overflow-hidden">
                {history.map((s) => {
                  const hostname = (() => { try { return new URL(s.url).hostname; } catch { return s.url; } })();
                  return (
                    <div key={s.id} className="flex items-center gap-3 px-4 py-3 row-hover">
                      <span className={clsx(
                        'w-2 h-2 rounded-full shrink-0',
                        s.status === 'submitted' ? 'bg-emerald-400' :
                        s.status === 'dry_run'   ? 'bg-amber-400'   : 'bg-red-400',
                      )} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                          {s.form_title || hostname}
                        </p>
                        <p className="text-xs t-m mt-0.5 truncate">{hostname}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs t-m hidden sm:inline">{s.filled_count} fields</span>
                        <Badge variant={
                          s.status === 'submitted' ? 'emerald' :
                          s.status === 'dry_run'   ? 'amber'   : 'red'
                        }>
                          {s.status === 'dry_run' ? 'dry run' : s.status}
                        </Badge>
                        <span className="text-xs t-m hidden sm:inline">{fmtDate(s.created_at)}</span>
                        <a href={s.url} target="_blank" rel="noreferrer"
                          className="p-1.5 rounded-lg t-m hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/8 transition-colors">
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>
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

const WHA_STATUS = {
  pending_form_info: { label: 'Awaiting info', color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-500/10', icon: HelpCircle },
  pending_form_confirm: { label: 'Ready — reply YES', color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-500/10', icon: Clock },
  sent: { label: 'Submitted', color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-500/10', icon: CheckCircle },
  dry_run: { label: 'Dry run done', color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-500/10', icon: AlertTriangle },
  failed: { label: 'Failed', color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-500/10', icon: AlertTriangle },
  rejected: { label: 'Cancelled', color: 'text-slate-500 dark:text-slate-500', bg: 'bg-slate-50 dark:bg-white/[0.03]', icon: AlertTriangle },
};

function WhaFormRow({ form }) {
  const meta = WHA_STATUS[form.status] ?? WHA_STATUS.pending_form_confirm;
  const Icon = meta.icon;
  const url = form.source_url || '';
  const hostname = (() => { try { return new URL(url).hostname; } catch { return url; } })();
  return (
    <div className="flex items-center gap-3 px-4 py-3 row-hover">
      <div className={clsx('w-7 h-7 rounded-lg flex items-center justify-center shrink-0', meta.bg)}>
        <Icon className={clsx('w-3.5 h-3.5', meta.color)} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
          {form.job_title || hostname || 'Untitled Form'}
        </p>
        <p className={clsx('text-xs font-medium mt-0.5', meta.color)}>{meta.label}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-xs t-m hidden sm:inline">{fmtDate(form.created_at)}</span>
        {url && (
          <a href={url} target="_blank" rel="noreferrer"
            className="p-1.5 rounded-lg t-m hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/8 transition-colors">
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
      </div>
    </div>
  );
}
