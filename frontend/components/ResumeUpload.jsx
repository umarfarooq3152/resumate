'use client';
import { useCallback, useState } from 'react';
import { Upload, FileText, CheckCircle, XCircle } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../lib/api';
import Spinner from './Spinner';

export default function ResumeUpload({ profileId, onDone }) {
  const [drag, setDrag] = useState(false);
  const [state, setState] = useState('idle'); // idle | uploading | done | error
  const [errorMsg, setErrorMsg] = useState('');

  const ALLOWED_TYPES = new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'application/octet-stream',
  ]);
  const ALLOWED_EXTS = new Set(['pdf', 'doc', 'docx', 'txt']);

  const upload = useCallback(async (file) => {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!ALLOWED_TYPES.has(file.type) && !ALLOWED_EXTS.has(ext)) {
      setErrorMsg('Only PDF, Word (.doc/.docx) and plain text files are supported.');
      setState('error');
      return;
    }
    if (file.size > 10 * 1024 * 1024) { setErrorMsg('File must be under 10 MB.'); setState('error'); return; }
    setState('uploading');
    try {
      const result = await api.uploadResume(profileId, file);
      setState('done');
      onDone?.(result);
    } catch (e) {
      setErrorMsg(e.message ?? 'Upload failed');
      setState('error');
    }
  }, [profileId, onDone]);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDrag(false);
    upload(e.dataTransfer.files[0]);
  }, [upload]);

  const onChange = (e) => upload(e.target.files[0]);

  if (state === 'done') return (
    <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700">
      <CheckCircle className="w-5 h-5 shrink-0" />
      <div>
        <p className="text-sm font-medium">Resume uploaded and parsed</p>
        <p className="text-xs text-emerald-600">Gemini extracted the text — ready for matching</p>
      </div>
      <button onClick={() => { setState('idle'); setErrorMsg(''); }} className="ml-auto text-xs underline text-emerald-600 hover:text-emerald-800">Upload another</button>
    </div>
  );

  return (
    <div>
      <label
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={clsx(
          'flex flex-col items-center justify-center gap-3 p-8 rounded-xl border-2 border-dashed cursor-pointer transition-all',
          drag ? 'border-indigo-400 bg-indigo-50' : 'border-slate-300 bg-white hover:border-indigo-300 hover:bg-slate-50',
          state === 'uploading' && 'pointer-events-none opacity-70',
        )}>
        {state === 'uploading'
          ? <><Spinner /><span className="text-sm text-slate-500">Uploading & parsing with Gemini…</span></>
          : <>
              <div className={clsx('w-12 h-12 rounded-xl flex items-center justify-center', drag ? 'bg-indigo-100' : 'bg-slate-100')}>
                {drag ? <Upload className="w-5 h-5 text-indigo-600" /> : <FileText className="w-5 h-5 text-slate-500" />}
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-slate-700">Drop your resume here</p>
                <p className="text-xs text-slate-400 mt-0.5">PDF, Word (.doc/.docx), TXT · max 10 MB</p>
              </div>
              <span className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg">Browse file</span>
            </>}
        <input type="file" accept=".pdf,.doc,.docx,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={onChange} className="sr-only" />
      </label>

      {state === 'error' && (
        <div className="mt-2 flex items-center gap-2 text-sm text-red-600">
          <XCircle className="w-4 h-4 shrink-0" />
          {errorMsg}
          <button onClick={() => setState('idle')} className="ml-auto text-xs underline">Try again</button>
        </div>
      )}
    </div>
  );
}
