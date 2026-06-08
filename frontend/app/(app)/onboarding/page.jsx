'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '../../../lib/supabase';
import { api } from '../../../lib/api';
import { Loader2, Upload, CheckCircle2, ArrowRight, X, User, Briefcase, MapPin, Tag } from 'lucide-react';
import Spinner from '../../../components/Spinner';

const STEPS = ['Profile', 'Resume', 'Ready'];

export default function Onboarding() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [user, setUser] = useState(null);
  const [profileId, setProfileId] = useState(null);
  const [checkingExisting, setCheckingExisting] = useState(true);

  const [fullName, setFullName] = useState('');
  const [targetTitle, setTargetTitle] = useState('');
  const [targetLocation, setTargetLocation] = useState('');
  const [keywords, setKeywords] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState('');

  const [file, setFile] = useState(null);
  const [uploadingResume, setUploadingResume] = useState(false);
  const [resumeError, setResumeError] = useState('');
  const [resumeDone, setResumeDone] = useState(false);

  useEffect(() => {
    const init = async () => {
      const { data: { user: u } } = await getSupabase().auth.getUser();
      if (!u) { router.push('/login'); return; }
      setUser(u);
      if (u.user_metadata?.full_name) setFullName(u.user_metadata.full_name);
      try {
        const profiles = await api.getProfiles(u.id);
        if (profiles?.length) { router.push('/dashboard'); return; }
      } catch { /* no profile yet */ }
      setCheckingExisting(false);
    };
    init();
  }, [router]);

  const saveProfile = async (e) => {
    e.preventDefault();
    if (!targetTitle.trim()) { setProfileError('Target role is required.'); return; }
    setSavingProfile(true);
    setProfileError('');
    try {
      const kws = keywords.split(',').map(k => k.trim()).filter(Boolean);
      const data = await api.createProfile({
        user_id: user.id,
        full_name: fullName.trim(),
        target_title: targetTitle.trim(),
        target_location: targetLocation.trim(),
        keywords: kws,
      });
      setProfileId(data.id);
      setStep(1);
    } catch (err) {
      setProfileError(err.message);
    } finally {
      setSavingProfile(false);
    }
  };

  const ALLOWED_EXTS = new Set(['pdf', 'doc', 'docx', 'txt']);

  const uploadResume = async () => {
    if (!file || !profileId) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!ALLOWED_EXTS.has(ext)) {
      setResumeError('Only PDF, Word (.doc/.docx) and plain text files are supported.');
      return;
    }
    setUploadingResume(true);
    setResumeError('');
    try {
      await api.uploadResume(profileId, file);
      setResumeDone(true);
      setStep(2);
    } catch (err) {
      setResumeError(err.message);
    } finally {
      setUploadingResume(false);
    }
  };

  const skipResume = () => setStep(2);

  if (checkingExisting) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-[#0f0f14] flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50 dark:from-[#0f0f14] dark:to-[#0f0f14] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">

        {/* Progress */}
        <div className="flex items-center justify-center gap-0 mb-10">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center">
              <div className="flex flex-col items-center gap-1.5">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all ${
                  i < step
                    ? 'bg-indigo-600 border-indigo-600 text-white'
                    : i === step
                    ? 'bg-white dark:bg-white/[0.06] border-indigo-600 text-indigo-600 dark:text-indigo-400'
                    : 'bg-white dark:bg-white/[0.03] border-slate-200 dark:border-white/10 text-slate-400'
                }`}>
                  {i < step ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
                </div>
                <span className={`text-xs font-medium ${i === step ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400 dark:text-slate-600'}`}>
                  {label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`w-16 h-0.5 mx-2 mb-5 transition-all ${i < step ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-white/10'}`} />
              )}
            </div>
          ))}
        </div>

        {step === 0 && (
          <div className="bg-white dark:bg-[#16161e] border border-slate-200/50 dark:border-white/[0.06] rounded-3xl shadow-xl shadow-slate-200/80 dark:shadow-black/30 p-8">
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">Welcome! Let's get you set up</h1>
              <p className="text-sm t-b">Tell the agent who you are and what you're looking for.</p>
            </div>

            {profileError && (
              <div className="mb-4 px-4 py-3 rounded-xl text-sm
                bg-red-50 border border-red-200 text-red-700
                dark:bg-red-500/8 dark:border-red-500/20 dark:text-red-400">
                {profileError}
              </div>
            )}

            <form onSubmit={saveProfile} className="space-y-4">
              <Field icon={<User className="w-4 h-4 text-slate-400" />} label="Your name">
                <input type="text" required value={fullName} onChange={e => setFullName(e.target.value)}
                  className="input" placeholder="Jane Smith" />
              </Field>
              <Field icon={<Briefcase className="w-4 h-4 text-slate-400" />} label="Target role">
                <input type="text" required value={targetTitle} onChange={e => setTargetTitle(e.target.value)}
                  className="input" placeholder="e.g. Senior Software Engineer" />
              </Field>
              <Field icon={<MapPin className="w-4 h-4 text-slate-400" />} label="Preferred location">
                <input type="text" value={targetLocation} onChange={e => setTargetLocation(e.target.value)}
                  className="input" placeholder="e.g. London, Remote" />
              </Field>
              <Field icon={<Tag className="w-4 h-4 text-slate-400" />} label="Keywords (comma-separated)">
                <input type="text" value={keywords} onChange={e => setKeywords(e.target.value)}
                  className="input" placeholder="e.g. React, TypeScript, AWS" />
              </Field>
              <button type="submit" disabled={savingProfile}
                className="w-full py-3.5 bg-indigo-600 text-white text-sm font-bold rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 mt-2 cursor-pointer">
                {savingProfile
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                  : <>Continue <ArrowRight className="w-4 h-4" /></>}
              </button>
            </form>
          </div>
        )}

        {step === 1 && (
          <div className="bg-white dark:bg-[#16161e] border border-slate-200/50 dark:border-white/[0.06] rounded-3xl shadow-xl shadow-slate-200/80 dark:shadow-black/30 p-8">
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">Upload your resume</h1>
              <p className="text-sm t-b">
                The AI reads your resume to score job matches and tailor your applications.
                You can upload it now or skip and add it later.
              </p>
            </div>

            {resumeError && (
              <div className="mb-4 px-4 py-3 rounded-xl text-sm
                bg-red-50 border border-red-200 text-red-700
                dark:bg-red-500/8 dark:border-red-500/20 dark:text-red-400">
                {resumeError}
              </div>
            )}

            <label className={`block border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-colors ${
              file
                ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-500/8 dark:border-indigo-500/40'
                : 'border-slate-200 dark:border-white/10 hover:border-indigo-300 dark:hover:border-indigo-500/30 hover:bg-slate-50 dark:hover:bg-white/[0.03]'
            }`}>
              <input type="file" accept=".pdf,.doc,.docx,.txt" className="sr-only"
                onChange={e => setFile(e.target.files?.[0] ?? null)} />
              {file ? (
                <div className="flex items-center justify-center gap-3">
                  <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-500/15 rounded-xl flex items-center justify-center">
                    <Upload className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white truncate max-w-[200px]">{file.name}</p>
                    <p className="text-xs t-b">{(file.size / 1024).toFixed(0)} KB</p>
                  </div>
                  <button type="button" onClick={e => { e.preventDefault(); setFile(null); }}
                    className="ml-auto p-1.5 rounded-lg hover:bg-indigo-100 dark:hover:bg-white/10 t-m hover:text-slate-600 dark:hover:text-slate-300 cursor-pointer">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div>
                  <div className="w-12 h-12 bg-slate-100 dark:bg-white/8 rounded-2xl flex items-center justify-center mx-auto mb-3">
                    <Upload className="w-6 h-6 text-slate-400 dark:text-slate-500" />
                  </div>
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">Drop your resume here</p>
                  <p className="text-xs t-m">PDF, Word (.doc/.docx) or TXT · up to 10 MB</p>
                </div>
              )}
            </label>

            <div className="flex gap-3 mt-5">
              <button onClick={uploadResume} disabled={!file || uploadingResume}
                className="flex-1 py-3.5 bg-indigo-600 text-white text-sm font-bold rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 cursor-pointer">
                {uploadingResume
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading…</>
                  : <>Upload & continue <ArrowRight className="w-4 h-4" /></>}
              </button>
              <button onClick={skipResume}
                className="px-5 py-3.5 border text-sm font-semibold rounded-xl transition-colors cursor-pointer
                  border-slate-200 text-slate-600 hover:bg-slate-50
                  dark:border-white/10 dark:text-slate-400 dark:hover:bg-white/[0.06]">
                Skip
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="bg-white dark:bg-[#16161e] border border-slate-200/50 dark:border-white/[0.06] rounded-3xl shadow-xl shadow-slate-200/80 dark:shadow-black/30 p-8 text-center">
            <div className="w-20 h-20 bg-emerald-100 dark:bg-emerald-500/15 rounded-3xl flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 className="w-10 h-10 text-emerald-600 dark:text-emerald-400" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">You're all set!</h1>
            <p className="text-sm t-b leading-relaxed mb-8 max-w-sm mx-auto">
              Your profile is ready. Head to the dashboard to run the agent, discover jobs, and start applying.
            </p>

            <div className="bg-slate-50 dark:bg-white/[0.03] border border-slate-100 dark:border-white/[0.06] rounded-2xl p-4 mb-8 text-left space-y-2.5">
              {[
                { label: 'Run discovery', desc: 'Find matching jobs from Adzuna' },
                { label: 'Review matches', desc: 'AI-scored jobs waiting for your approval' },
                { label: 'Submit applications', desc: 'Tailored resume + cover letter, auto-sent' },
              ].map(({ label, desc }) => (
                <div key={label} className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-500/15 flex items-center justify-center shrink-0">
                    <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-900 dark:text-white">{label}</p>
                    <p className="text-xs t-b">{desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <button onClick={() => router.push('/dashboard')}
              className="w-full py-4 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2 cursor-pointer">
              Go to dashboard <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ icon, label, children }) {
  return (
    <div>
      <label className="flex items-center gap-1.5 text-xs font-semibold t-b mb-1.5">
        {icon}{label}
      </label>
      {children}
    </div>
  );
}
