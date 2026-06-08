'use client';
import { useState } from 'react';
import { X, CheckCircle, XCircle, Loader2 } from 'lucide-react';

export default function ReviewModal({ type, item, onClose, onDone }) {
  const [notes, setNotes] = useState('');
  const [editedResume, setEditedResume] = useState(item?.tailored_resume ?? '');
  const [editedCover, setEditedCover] = useState(item?.cover_letter ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isApplication = type === 'application';
  const title = item?.title ?? item?.job?.title ?? 'Untitled Job';
  const company = item?.company ?? item?.job?.company ?? '';
  const score = item?.score;

  const submit = async (decision) => {
    setError('');
    if (decision === 'approved' && isApplication) {
      if (!editedResume.trim()) { setError('Tailored resume cannot be empty before approving.'); return; }
      if (!editedCover.trim()) { setError('Cover letter cannot be empty before approving.'); return; }
    }
    setLoading(true);
    try {
      await onDone(decision, {
        notes,
        ...(isApplication ? { tailored_resume: editedResume, cover_letter: editedCover } : {}),
      });
      onClose();
    } catch (e) {
      setError(e.message ?? 'Failed');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 dark:bg-black/60 backdrop-blur-sm">
      <div className="rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col
        bg-white border border-slate-200
        dark:bg-[#16161e] dark:border-white/10">

        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-slate-100 dark:border-white/[0.06]">
          <div>
            <p className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wide mb-1">
              {isApplication ? 'Application Review' : 'Match Review'}
            </p>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h2>
            {company && <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{company}</p>}
            {score !== undefined && (
              <span className="inline-block mt-2 px-2 py-0.5 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300 text-xs font-semibold rounded-full">
                Match score: {score}/100
              </span>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/8 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {item?.reasoning && (
            <Section title="AI Reasoning">
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{item.reasoning}</p>
            </Section>
          )}

          {(item?.strengths?.length > 0 || item?.gaps?.length > 0) && (
            <div className="grid grid-cols-2 gap-4">
              {item?.strengths?.length > 0 && (
                <Section title="Strengths" accent="emerald">
                  <ul className="space-y-1">
                    {item.strengths.map((s, i) => <li key={i} className="text-xs text-slate-600 dark:text-slate-400 flex gap-1.5"><span className="text-emerald-500 mt-0.5">✓</span>{s}</li>)}
                  </ul>
                </Section>
              )}
              {item?.gaps?.length > 0 && (
                <Section title="Gaps" accent="amber">
                  <ul className="space-y-1">
                    {item.gaps.map((g, i) => <li key={i} className="text-xs text-slate-600 dark:text-slate-400 flex gap-1.5"><span className="text-amber-500 mt-0.5">△</span>{g}</li>)}
                  </ul>
                </Section>
              )}
            </div>
          )}

          {item?.description && (
            <Section title="Job Description">
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed whitespace-pre-line line-clamp-6">{item.description}</p>
            </Section>
          )}

          {isApplication && (
            <>
              <Section title="Tailored Resume (edit before approving)">
                <textarea value={editedResume} onChange={e => setEditedResume(e.target.value)} rows={8}
                  className="input font-mono text-xs resize-y" />
              </Section>
              <Section title="Cover Letter (edit before approving)">
                <textarea value={editedCover} onChange={e => setEditedCover(e.target.value)} rows={8}
                  className="input font-mono text-xs resize-y" />
              </Section>
            </>
          )}

          <Section title="Notes (optional)">
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              placeholder="Add a reason or feedback…"
              className="input resize-none" />
          </Section>

          {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 p-5 border-t border-slate-100 dark:border-white/[0.06]">
          <button onClick={onClose} disabled={loading}
            className="px-4 py-2 text-sm font-medium rounded-lg border cursor-pointer transition-colors disabled:opacity-50
              text-slate-600 border-slate-200 hover:bg-slate-50
              dark:text-slate-300 dark:border-white/10 dark:hover:bg-white/[0.06]">
            Cancel
          </button>
          <button onClick={() => submit('rejected')} disabled={loading}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg border cursor-pointer transition-colors disabled:opacity-50
              text-red-600 border-red-200 hover:bg-red-50
              dark:text-red-400 dark:border-red-500/30 dark:hover:bg-red-500/10">
            <XCircle className="w-4 h-4" />
            Reject
          </button>
          <button onClick={() => submit('approved')} disabled={loading}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-500 disabled:opacity-50 transition-colors cursor-pointer">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
            {isApplication ? 'Approve & Submit' : 'Approve'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children, accent = 'slate' }) {
  const color =
    accent === 'emerald' ? 'text-emerald-600 dark:text-emerald-400' :
    accent === 'amber'   ? 'text-amber-600 dark:text-amber-400'     :
    accent === 'red'     ? 'text-red-600 dark:text-red-400'         :
    accent === 'indigo'  ? 'text-indigo-600 dark:text-indigo-400'   :
    'text-slate-500 dark:text-slate-400';
  return (
    <div>
      <p className={`text-xs font-semibold uppercase tracking-wide ${color} mb-2`}>{title}</p>
      {children}
    </div>
  );
}
