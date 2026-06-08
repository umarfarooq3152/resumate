'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Mail, Send, X, Pencil, ChevronDown, ChevronUp,
  CheckCircle2, XCircle, Loader2, RefreshCw, MessageCircle,
  ExternalLink, AlertTriangle, Clock, Inbox, FileText,
  Sparkles, ArrowRight,
} from 'lucide-react';
import clsx from 'clsx';
import { api } from '../../../lib/api';
import { getSupabase } from '../../../lib/supabase';
import Spinner from '../../../components/Spinner';
import { useToast } from '../../../components/Toast';

const STATUS_META = {
  lead:             { label: 'Needs Reply',  light: 'bg-sky-100 text-sky-700',      dark: 'dark:bg-sky-500/15 dark:text-sky-300',      icon: Inbox },
  generating:       { label: 'Generating…',  light: 'bg-violet-100 text-violet-700', dark: 'dark:bg-violet-500/15 dark:text-violet-300', icon: Loader2 },
  pending_approval: { label: 'Pending',       light: 'bg-amber-100 text-amber-700',   dark: 'dark:bg-amber-500/15 dark:text-amber-300',   icon: Clock },
  approved:         { label: 'Approved',      light: 'bg-indigo-100 text-indigo-700', dark: 'dark:bg-indigo-500/15 dark:text-indigo-300', icon: CheckCircle2 },
  sent:             { label: 'Sent',          light: 'bg-emerald-100 text-emerald-700', dark: 'dark:bg-emerald-500/15 dark:text-emerald-300', icon: CheckCircle2 },
  rejected:         { label: 'Rejected',      light: 'bg-slate-100 text-slate-500',   dark: 'dark:bg-slate-700/40 dark:text-slate-400',   icon: XCircle },
  failed:           { label: 'Failed',        light: 'bg-red-100 text-red-600',       dark: 'dark:bg-red-500/15 dark:text-red-400',       icon: AlertTriangle },
};

const SOURCE_META = {
  whatsapp:   { label: 'WhatsApp', icon: MessageCircle, light: 'text-emerald-600 bg-emerald-50', dark: 'dark:text-emerald-400 dark:bg-emerald-500/10' },
  gmail_scan: { label: 'Gmail',    icon: Mail,          light: 'text-red-500 bg-red-50',         dark: 'dark:text-red-400 dark:bg-red-500/10' },
  manual:     { label: 'Manual',   icon: ExternalLink,  light: 'text-indigo-600 bg-indigo-50',   dark: 'dark:text-indigo-400 dark:bg-indigo-500/10' },
};

const DRAFT_TABS = ['pending_approval', 'sent', 'rejected', 'all'];

export default function EmailDrafts() {
  const toast = useToast();
  const [user, setUser] = useState(null);
  const [leads, setLeads] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [tab, setTab] = useState('pending_approval');
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [actionLoading, setActionLoading] = useState({});
  const pollRef = useRef(null);
  const tabRef = useRef(tab);
  tabRef.current = tab;

  const loadAll = useCallback(async (userId, currentTab, silent = false) => {
    try {
      const [leadsData, generatingData, draftsData] = await Promise.all([
        api.getEmailDrafts({ user_id: userId, status: 'lead' }),
        api.getEmailDrafts({ user_id: userId, status: 'generating' }),
        api.getEmailDrafts({ user_id: userId, ...(currentTab !== 'all' ? { status: currentTab } : {}), exclude_leads: true }),
      ]);
      setLeads([...leadsData, ...generatingData].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
      setDrafts(draftsData);
      return generatingData.length; // return how many are still generating
    } catch (e) {
      if (!silent) toast(e.message, 'error');
      return 0;
    }
  }, [toast]);

  // Auto-poll every 4s while any drafts are generating
  const startPolling = useCallback((userId) => {
    if (pollRef.current) return; // already polling
    pollRef.current = setInterval(async () => {
      const stillGenerating = await loadAll(userId, tabRef.current, true);
      if (stillGenerating === 0) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }, 4000);
  }, [loadAll]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await getSupabase().auth.getUser();
      setUser(user);
      if (user) {
        const generating = await loadAll(user.id, tab);
        if (generating > 0) startPolling(user.id);
      }
      setLoading(false);
    };
    init();
    return () => stopPolling();
  }, []);

  const switchTab = async (newTab) => {
    setTab(newTab);
    setExpandedId(null);
    setEditingId(null);
    if (user) {
      setLoading(true);
      try {
        const generating = await loadAll(user.id, newTab);
        if (generating > 0) startPolling(user.id); else stopPolling();
      } finally { setLoading(false); }
    }
  };

  const setActionState = (id, val) => setActionLoading(prev => ({ ...prev, [id]: val }));

  const generateDraft = async (lead) => {
    setActionState(lead.id, 'generate');
    try {
      await api.generateEmailDraft(lead.id);
      // Optimistically flip to generating and start polling
      setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, status: 'generating' } : l));
      startPolling(user.id);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setActionState(lead.id, null);
    }
  };

  const discardLead = async (lead) => {
    if (!confirm('Remove this email from inbox leads?')) return;
    setActionState(lead.id, 'discard');
    try {
      await api.rejectEmailDraft(lead.id);
      setLeads(prev => prev.filter(l => l.id !== lead.id));
      toast('Lead removed', 'info');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setActionState(lead.id, null);
    }
  };

  const approve = async (draft) => {
    setActionState(draft.id, 'approve');
    try {
      await api.approveEmailDraft(draft.id);
      toast(`Email sent to ${draft.hr_email}`, 'success');
      await loadAll(user.id, tab);
      setExpandedId(null);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setActionState(draft.id, null);
    }
  };

  const reject = async (draft) => {
    if (!confirm('Discard this draft?')) return;
    setActionState(draft.id, 'reject');
    try {
      await api.rejectEmailDraft(draft.id);
      toast('Draft rejected', 'info');
      await loadAll(user.id, tab);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setActionState(draft.id, null);
    }
  };

  const startEdit = (draft) => {
    setEditingId(draft.id);
    setEditValues({ hr_email: draft.hr_email || '', hr_name: draft.hr_name || '', subject: draft.subject || '', email_body: draft.email_body || '' });
  };

  const saveEdit = async (draft) => {
    setActionState(draft.id, 'save');
    try {
      const updated = await api.updateEmailDraft(draft.id, editValues);
      setDrafts(prev => prev.map(d => d.id === draft.id ? { ...d, ...updated } : d));
      setEditingId(null);
      toast('Draft updated', 'success');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setActionState(draft.id, null);
    }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Spinner /></div>;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">Email Drafts</h1>
          <p className="text-sm t-b mt-0.5">Review recruiter emails, choose who to reply to, then approve drafts to send</p>
        </div>
        <button onClick={async () => { if (user) { const g = await loadAll(user.id, tab); if (g > 0) startPolling(user.id); }}} className="btn-icon">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* ── Stage 1: Inbox Leads ── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <div className="flex items-center justify-center w-6 h-6 rounded-full bg-sky-100 dark:bg-sky-500/15 text-sky-600 dark:text-sky-400 text-xs font-bold shrink-0">1</div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">Inbox Leads</h2>
          {leads.length > 0 && (
            <span className="bg-sky-600 text-white text-[10px] font-bold min-w-[18px] h-[18px] rounded-full flex items-center justify-center px-1">
              {leads.length}
            </span>
          )}
          <span className="text-xs t-m">— choose which emails deserve a follow-up</span>
        </div>

        {leads.length === 0 ? (
          <div className="empty-state">
            <Inbox className="w-7 h-7 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
            <p className="text-sm t-m">No inbox leads</p>
            <p className="text-xs t-m mt-1">Scan Gmail from the Integrations page to find recruiter emails</p>
          </div>
        ) : (
          <div className="space-y-2">
            {leads.map(lead => (
              <LeadCard
                key={lead.id}
                lead={lead}
                expanded={expandedId === lead.id}
                actionLoading={actionLoading[lead.id]}
                onToggle={() => setExpandedId(prev => prev === lead.id ? null : lead.id)}
                onGenerate={() => generateDraft(lead)}
                onDiscard={() => discardLead(lead)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Divider with arrow */}
      <div className="flex items-center gap-3">
        <div className="flex-1 border-t border-slate-200 dark:border-white/[0.06]" />
        <div className="flex items-center gap-1.5 text-xs t-m">
          <ArrowRight className="w-3.5 h-3.5" />
          <span>AI generates draft</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </div>
        <div className="flex-1 border-t border-slate-200 dark:border-white/[0.06]" />
      </div>

      {/* ── Stage 2: Email Drafts ── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <div className="flex items-center justify-center w-6 h-6 rounded-full bg-amber-100 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400 text-xs font-bold shrink-0">2</div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">Email Drafts</h2>
          <span className="text-xs t-m">— review AI-written replies then approve to send</span>
        </div>

        <div className="tabs-bar mb-4">
          {DRAFT_TABS.map(t => (
            <button key={t} onClick={() => switchTab(t)}
              className={clsx('px-3 py-1.5 rounded-lg text-sm font-medium transition-colors capitalize cursor-pointer',
                tab === t ? 'tab-on' : 'tab-off')}>
              {t.replace('_', ' ')}
            </button>
          ))}
        </div>

        {drafts.length === 0 ? (
          <div className="empty-state">
            <FileText className="w-7 h-7 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
            <p className="text-sm t-m">No {tab !== 'all' ? tab.replace('_', ' ') : ''} drafts yet</p>
            <p className="text-xs t-m mt-1">
              {tab === 'pending_approval'
                ? 'Click "Generate Draft" on a lead above, or forward a job on WhatsApp'
                : 'Approve a draft to send it'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {drafts.map(draft => (
              <DraftCard
                key={draft.id}
                draft={draft}
                expanded={expandedId === draft.id}
                editing={editingId === draft.id}
                editValues={editValues}
                actionLoading={actionLoading[draft.id]}
                onToggle={() => setExpandedId(prev => prev === draft.id ? null : draft.id)}
                onApprove={() => approve(draft)}
                onReject={() => reject(draft)}
                onStartEdit={() => startEdit(draft)}
                onCancelEdit={() => setEditingId(null)}
                onSaveEdit={() => saveEdit(draft)}
                onEditChange={vals => setEditValues(prev => ({ ...prev, ...vals }))}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ── Lead card ─────────────────────────────────────────────────────────────────

function LeadCard({ lead, expanded, actionLoading, onToggle, onGenerate, onDiscard }) {
  const isGenerating = lead.status === 'generating' || actionLoading === 'generate';
  const srcMeta = SOURCE_META[lead.source] || SOURCE_META.manual;
  const SrcIcon = srcMeta.icon;

  return (
    <div className={clsx(
      'rounded-2xl overflow-hidden border transition-all',
      'bg-white dark:bg-white/[0.04]',
      expanded
        ? 'border-sky-200 shadow-sm dark:border-sky-500/30'
        : 'border-slate-200 hover:border-slate-300 dark:border-white/10 dark:hover:border-white/20',
    )}>
      <button onClick={onToggle} className="w-full flex items-center gap-3 px-5 py-4 text-left cursor-pointer">
        <span className={clsx('w-7 h-7 rounded-lg flex items-center justify-center shrink-0', srcMeta.light, srcMeta.dark)}>
          <SrcIcon className="w-3.5 h-3.5" />
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-slate-900 dark:text-white text-sm truncate">
              {lead.job_title || lead.subject || 'Email from recruiter'}
              {lead.company ? ` @ ${lead.company}` : ''}
            </p>
            <span className={clsx(
              'text-[10px] font-bold px-2 py-0.5 rounded-full',
              isGenerating
                ? 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300'
                : 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
            )}>
              {isGenerating
                ? <><Loader2 className="inline w-2.5 h-2.5 mr-0.5 -mt-px animate-spin" />Generating…</>
                : <><Inbox className="inline w-2.5 h-2.5 mr-0.5 -mt-px" />Needs Reply</>}
            </span>
            {lead.email_type && (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 dark:bg-white/8 dark:text-slate-400 capitalize">
                {lead.email_type}
              </span>
            )}
          </div>
          <p className="text-xs t-b mt-0.5 truncate">From: {lead.hr_email || '—'}</p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-xs t-m">{fmtDate(lead.created_at)}</span>
          {expanded
            ? <ChevronUp className="w-4 h-4 text-slate-400 dark:text-slate-500" />
            : <ChevronDown className="w-4 h-4 text-slate-400 dark:text-slate-500" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 dark:border-white/[0.06] bg-slate-50/60 dark:bg-white/[0.02] px-5 py-4 space-y-4">
          {lead.source_message && (
            <div className="card p-3 text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
              {lead.source_message}
            </div>
          )}

          {!isGenerating && (
            <div className="flex gap-2 flex-wrap pt-1">
              <button onClick={onGenerate} disabled={!!actionLoading}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors cursor-pointer">
                <Sparkles className="w-4 h-4" /> Generate Draft
              </button>
              <button onClick={onDiscard} disabled={!!actionLoading}
                className="flex items-center gap-2 px-4 py-2 border text-sm font-semibold rounded-xl transition-colors cursor-pointer
                  bg-white border-red-200 text-red-600 hover:bg-red-50
                  dark:bg-transparent dark:border-red-500/20 dark:text-red-400 dark:hover:bg-red-500/8">
                <X className="w-4 h-4" /> Not Relevant
              </button>
            </div>
          )}

          {isGenerating && (
            <div className="flex items-center gap-2 text-xs text-violet-600 dark:text-violet-400 font-medium">
              <Loader2 className="w-4 h-4 animate-spin" />
              AI is writing your draft — it will appear in Email Drafts below when ready
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Draft card ────────────────────────────────────────────────────────────────

function DraftCard({
  draft, expanded, editing, editValues, actionLoading,
  onToggle, onApprove, onReject, onStartEdit, onCancelEdit, onSaveEdit, onEditChange,
}) {
  const meta = STATUS_META[draft.status] || STATUS_META.pending_approval;
  const StatusIcon = meta.icon;
  const srcMeta = SOURCE_META[draft.source] || SOURCE_META.manual;
  const SrcIcon = srcMeta.icon;
  const isPending = draft.status === 'pending_approval' || draft.status === 'failed';

  return (
    <div className={clsx(
      'rounded-2xl overflow-hidden border transition-all',
      'bg-white dark:bg-white/[0.04]',
      expanded
        ? 'border-indigo-200 shadow-sm shadow-indigo-50 dark:border-indigo-500/30 dark:shadow-indigo-500/5'
        : 'border-slate-200 hover:border-slate-300 dark:border-white/10 dark:hover:border-white/20',
    )}>
      <button onClick={onToggle} className="w-full flex items-center gap-3 px-5 py-4 text-left cursor-pointer">
        <span className={clsx('w-7 h-7 rounded-lg flex items-center justify-center shrink-0', srcMeta.light, srcMeta.dark)}>
          <SrcIcon className="w-3.5 h-3.5" />
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-slate-900 dark:text-white text-sm truncate">
              {draft.job_title || 'Untitled role'} {draft.company ? `@ ${draft.company}` : ''}
            </p>
            <span className={clsx('text-[10px] font-bold px-2 py-0.5 rounded-full', meta.light, meta.dark)}>
              <StatusIcon className={clsx('inline w-2.5 h-2.5 mr-0.5 -mt-px', draft.status === 'generating' && 'animate-spin')} />
              {meta.label}
            </span>
          </div>
          <p className="text-xs t-b mt-0.5 truncate">
            To: {draft.hr_email || <span className="text-red-500 dark:text-red-400">No HR email</span>} · {draft.subject || 'No subject'}
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-xs t-m">{fmtDate(draft.created_at)}</span>
          {expanded
            ? <ChevronUp className="w-4 h-4 text-slate-400 dark:text-slate-500" />
            : <ChevronDown className="w-4 h-4 text-slate-400 dark:text-slate-500" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 dark:border-white/[0.06] bg-slate-50/60 dark:bg-white/[0.02] px-5 py-4 space-y-4">
          {draft.error && (
            <div className="flex gap-2 p-3 rounded-xl text-xs bg-red-50 border border-red-200 text-red-700 dark:bg-red-500/8 dark:border-red-500/20 dark:text-red-400">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-500 dark:text-red-400" />
              <div><span className="font-semibold">Error:</span> {draft.error}</div>
            </div>
          )}

          {editing ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium t-b mb-1">HR Email *</label>
                  <input className="input text-sm" value={editValues.hr_email}
                    onChange={e => onEditChange({ hr_email: e.target.value })} placeholder="hr@company.com" />
                </div>
                <div>
                  <label className="block text-xs font-medium t-b mb-1">HR Name</label>
                  <input className="input text-sm" value={editValues.hr_name}
                    onChange={e => onEditChange({ hr_name: e.target.value })} placeholder="Jane Smith" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium t-b mb-1">Subject</label>
                <input className="input text-sm" value={editValues.subject}
                  onChange={e => onEditChange({ subject: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-medium t-b mb-1">Email body</label>
                <textarea className="input text-sm resize-none" rows={10} value={editValues.email_body}
                  onChange={e => onEditChange({ email_body: e.target.value })} />
              </div>
              <div className="flex gap-2">
                <button onClick={onSaveEdit} disabled={actionLoading === 'save'}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors cursor-pointer">
                  {actionLoading === 'save' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  Save changes
                </button>
                <button onClick={onCancelEdit}
                  className="px-4 py-2 text-sm font-medium t-b hover:bg-slate-100 dark:hover:bg-white/[0.06] rounded-xl transition-colors cursor-pointer">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="font-semibold t-b">To:</span>{' '}
                  <span className="text-slate-800 dark:text-slate-200 font-mono">{draft.hr_email || '—'}</span>
                </div>
                <div>
                  <span className="font-semibold t-b">HR Name:</span>{' '}
                  <span className="text-slate-800 dark:text-slate-200">{draft.hr_name || '—'}</span>
                </div>
                <div className="col-span-2">
                  <span className="font-semibold t-b">Subject:</span>{' '}
                  <span className="text-slate-800 dark:text-slate-200">{draft.subject || '—'}</span>
                </div>
              </div>

              {draft.source_url && (
                <a href={draft.source_url} target="_blank" rel="noopener"
                  className="inline-flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
                  <ExternalLink className="w-3 h-3" /> View job posting
                </a>
              )}

              <div className="card p-3 text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap font-mono leading-relaxed max-h-64 overflow-y-auto">
                {draft.email_body || 'No email body yet — still processing…'}
              </div>

              {draft.tailored_resume && <ResumePreview resume={draft.tailored_resume} />}
            </div>
          )}

          {!editing && isPending && (
            <div className="flex gap-2 flex-wrap pt-1">
              <button onClick={onApprove} disabled={actionLoading === 'approve' || !draft.hr_email}
                title={!draft.hr_email ? 'Set HR email first (click Edit)' : ''}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition-colors cursor-pointer">
                {actionLoading === 'approve'
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
                  : <><Send className="w-4 h-4" /> Approve & Send</>}
              </button>
              <button onClick={onStartEdit}
                className="flex items-center gap-2 px-4 py-2 border text-sm font-semibold rounded-xl transition-colors cursor-pointer
                  bg-white border-slate-300 text-slate-700 hover:bg-slate-50
                  dark:bg-white/[0.04] dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/[0.08]">
                <Pencil className="w-4 h-4" /> Edit draft
              </button>
              <button onClick={onReject} disabled={actionLoading === 'reject'}
                className="flex items-center gap-2 px-4 py-2 border text-sm font-semibold rounded-xl transition-colors cursor-pointer
                  bg-white border-red-200 text-red-600 hover:bg-red-50
                  dark:bg-transparent dark:border-red-500/20 dark:text-red-400 dark:hover:bg-red-500/8">
                <X className="w-4 h-4" /> Discard
              </button>
            </div>
          )}

          {draft.status === 'sent' && (
            <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400 font-medium">
              <CheckCircle2 className="w-4 h-4" />
              Sent {draft.sent_at ? fmtDate(draft.sent_at) : ''}
              {draft.gmail_message_id && (
                <span className="t-m font-mono ml-2">ID: {draft.gmail_message_id.slice(0, 12)}…</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ResumePreview({ resume }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(v => !v)}
        className="text-xs text-indigo-500 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 font-medium flex items-center gap-1 cursor-pointer">
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        {open ? 'Hide' : 'View'} tailored resume
      </button>
      {open && (
        <div className="mt-2 card p-3 text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap font-mono leading-relaxed max-h-72 overflow-y-auto">
          {resume}
        </div>
      )}
    </div>
  );
}

function fmtDate(str) {
  if (!str) return '';
  return new Date(str).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}
