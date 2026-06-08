'use client';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { api } from '../../../lib/api';
import Spinner from '../../../components/Spinner';
import { useToast } from '../../../components/Toast';
import { Shield, ShieldOff, Loader2, RefreshCw } from 'lucide-react';

export default function Settings() {
  const toast = useToast();
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setConfig(await api.getSettings()); }
    catch (e) { toast(e.message, 'error'); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const toggleDryRun = async () => {
    setToggling(true);
    try {
      const updated = await api.updateSettings({ dry_run: !config.dry_run });
      setConfig(updated);
      toast(`DRY_RUN ${updated.dry_run ? 'enabled' : 'disabled — live submissions active'}`, updated.dry_run ? 'info' : 'success');
    } catch (e) { toast(e.message, 'error'); }
    setToggling(false);
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Spinner /></div>;

  const dryRun = config?.dry_run ?? true;

  return (
    <div className="max-w-2xl space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">Settings</h1>
          <p className="text-sm t-b mt-0.5">Agent configuration and submission controls</p>
        </div>
        <button onClick={load} className="btn-icon"><RefreshCw className="w-4 h-4" /></button>
      </div>

      {/* Dry run card */}
      <div className="card p-6 space-y-5">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">Submission Controls</h2>

        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className={clsx(
              'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
              dryRun
                ? 'bg-amber-100 dark:bg-amber-500/15'
                : 'bg-emerald-100 dark:bg-emerald-500/15',
            )}>
              {dryRun
                ? <Shield className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                : <ShieldOff className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />}
            </div>
            <div>
              <p className="font-medium text-slate-900 dark:text-white">Dry Run Mode</p>
              <p className="text-sm t-b mt-0.5">
                {dryRun
                  ? 'On — agents run but nothing is submitted. Safe to test.'
                  : 'Off — applications will be sent to real job platforms.'}
              </p>
            </div>
          </div>

          <button onClick={toggleDryRun} disabled={toggling}
            className={clsx('relative shrink-0 w-12 h-6 rounded-full transition-colors disabled:opacity-60 cursor-pointer',
              dryRun ? 'bg-amber-400' : 'bg-emerald-500')}
            aria-label="Toggle dry run">
            {toggling
              ? <Loader2 className="w-3.5 h-3.5 text-white absolute top-1 left-1 animate-spin" />
              : <span className={clsx('absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform', !dryRun && 'translate-x-6')} />}
          </button>
        </div>

        {dryRun && (
          <div className="rounded-xl p-4 text-sm
            bg-amber-50 border border-amber-200 text-amber-800
            dark:bg-amber-500/8 dark:border-amber-500/20 dark:text-amber-300">
            <strong>Safe to run the pipeline.</strong> Discovery, scoring, and tailoring will work. Submissions are logged but not sent.
          </div>
        )}
        {!dryRun && (
          <div className="rounded-xl p-4 text-sm
            bg-red-50 border border-red-200 text-red-800
            dark:bg-red-500/8 dark:border-red-500/20 dark:text-red-300">
            <strong>Live mode active.</strong> Approved applications will be submitted to real employers.
          </div>
        )}
      </div>

      {/* Config readout */}
      <div className="card p-6">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white mb-4">Configuration</h2>
        <div className="div-y">
          {config && Object.entries(config).map(([key, val]) => (
            <div key={key} className="flex items-center justify-between py-2.5">
              <span className="text-sm font-mono t-b">{key}</span>
              <span className={clsx(
                'text-sm font-mono font-medium',
                typeof val === 'boolean'
                  ? val ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-white'
                  : 'text-slate-900 dark:text-white',
              )}>
                {String(val)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <p className="text-xs t-m">
        Settings persist until the backend restarts. Set permanently in your <code className="font-mono">.env</code> file.
      </p>
    </div>
  );
}
