'use client';
import { useEffect, useRef, useState } from 'react';
import {
  MessageCircle, Mail, Search, CheckCircle2,
  ExternalLink, RefreshCw, Loader2,
  Wifi, WifiOff, LogOut, Smartphone,
} from 'lucide-react';
import clsx from 'clsx';
import { api } from '../../../lib/api';
import { getSupabase } from '../../../lib/supabase';
import Spinner from '../../../components/Spinner';
import { useToast } from '../../../components/Toast';

export default function Integrations() {
  const toast = useToast();
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState(null);
  const [qr, setQr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scanLoading, setScanLoading] = useState(false);
  const [gmailLoading, setGmailLoading] = useState(false);
  const [jobUrl, setJobUrl] = useState('');
  const [urlLoading, setUrlLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const qrPollRef = useRef(null);

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await getSupabase().auth.getUser();
      setUser(user);
      if (user) await refreshStatus(user.id);
      setLoading(false);
    };
    init();

    const p = new URLSearchParams(window.location.search);
    if (p.get('gmail_connected')) {
      toast(`Gmail connected${p.get('email') ? ': ' + p.get('email') : ''}!`, 'success');
      window.history.replaceState({}, '', '/integrations');
    }
    if (p.get('error')) {
      toast(`Gmail error: ${p.get('error')}`, 'error');
      window.history.replaceState({}, '', '/integrations');
    }
    return () => stopQrPoll();
  }, []);

  const refreshStatus = async (userId) => {
    try {
      const s = await api.getIntegrationsStatus(userId);
      setStatus(s);
      if (s.whatsapp.has_qr && !s.whatsapp.connected) {
        startQrPoll();
      } else if (s.whatsapp.connected) {
        stopQrPoll();
        setQr(null);
      }
    } catch { /* ignore */ }
  };

  const fetchQr = async () => {
    try {
      const data = await api.getWhatsAppQr();
      if (data.connected) {
        stopQrPoll();
        setQr(null);
        if (user) await refreshStatus(user.id);
      } else if (data.qr) {
        setQr(data.qr);
      }
    } catch { /* ignore */ }
  };

  const startQrPoll = () => {
    if (qrPollRef.current) return;
    fetchQr();
    qrPollRef.current = setInterval(fetchQr, 3_000);
  };

  const stopQrPoll = () => {
    clearInterval(qrPollRef.current);
    qrPollRef.current = null;
  };

  useEffect(() => {
    if (status?.whatsapp?.has_qr && !status?.whatsapp?.connected) startQrPoll();
    return stopQrPoll;
  }, [status?.whatsapp?.has_qr, status?.whatsapp?.connected]);

  const connectGmail = async () => {
    if (!user) return;
    setGmailLoading(true);
    try {
      const { auth_url } = await api.getGmailConnectUrl(user.id);
      window.location.href = auth_url;
    } catch (e) {
      toast(e.message, 'error');
      setGmailLoading(false);
    }
  };

  const disconnectGmail = async () => {
    if (!user || !confirm('Disconnect Gmail?')) return;
    try {
      await api.disconnectGmail(user.id);
      toast('Gmail disconnected', 'info');
      await refreshStatus(user.id);
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const logoutWhatsApp = async () => {
    if (!confirm('Log out WhatsApp? You will need to scan QR again.')) return;
    try {
      await api.logoutWhatsApp();
      toast('WhatsApp logged out — restart the sidecar and scan QR again', 'info');
      if (user) await refreshStatus(user.id);
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const scanGmail = async () => {
    if (!user) return;
    setScanLoading(true);
    try {
      await api.scanGmail({ user_id: user.id, max_results: 20 });
      toast('Scan started — new drafts will appear in Email Drafts within ~60s', 'success');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setScanLoading(false);
    }
  };

  const createDraftFromUrl = async (e) => {
    e.preventDefault();
    if (!jobUrl.trim() || !user) return;
    setUrlLoading(true);
    try {
      await api.createDraftFromUrl(jobUrl.trim(), user.id);
      toast('Processing started — check Email Drafts in ~30s', 'success');
      setJobUrl('');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setUrlLoading(false);
    }
  };

  const copyText = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Spinner /></div>;

  const wa = status?.whatsapp || {};
  const gm = status?.gmail || {};
  const hi = status?.hunter_io || {};

  return (
    <div className="space-y-8 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">Integrations</h1>
          <p className="text-sm t-b mt-0.5">Connect WhatsApp and Gmail to automate job applications</p>
        </div>
        <button onClick={() => user && refreshStatus(user.id)} className="btn-icon">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {status && (
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Pending Drafts', value: status.stats.pending_drafts, color: 'amber' },
            { label: 'Emails Sent',    value: status.stats.sent_emails,    color: 'emerald' },
          ].map(({ label, value, color }) => (
            <div key={label} className="card p-4 flex items-center gap-3">
              <div className={clsx(
                'w-9 h-9 rounded-xl border flex items-center justify-center',
                color === 'amber'
                  ? 'bg-amber-50 border-amber-100 dark:bg-amber-500/10 dark:border-amber-500/20'
                  : 'bg-emerald-50 border-emerald-100 dark:bg-emerald-500/10 dark:border-emerald-500/20',
              )}>
                <Mail className={clsx('w-4 h-4', color === 'amber' ? 'text-amber-500' : 'text-emerald-500')} />
              </div>
              <div>
                <p className="text-2xl font-black text-slate-900 dark:text-white leading-none">{value}</p>
                <p className="text-xs font-semibold t-b mt-0.5">{label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <Card
        icon={<MessageCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />}
        iconBg="bg-emerald-50 border-emerald-100 dark:bg-emerald-500/10 dark:border-emerald-500/20"
        title="WhatsApp (your personal account)"
        subtitle="Forward any job message containing the HR email — the agent tailors your resume and asks you to approve before sending."
        badge={wa.connected ? 'connected' : wa.error === 'sidecar_unreachable' ? 'sidecar offline' : 'waiting for scan'}
        badgeColor={wa.connected ? 'emerald' : wa.error ? 'red' : 'amber'}
      >
        {wa.error === 'sidecar_unreachable' ? (
          <SidecarOffline />
        ) : wa.connected ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 rounded-xl
              bg-emerald-50 border border-emerald-200
              dark:bg-emerald-500/8 dark:border-emerald-500/20">
              <Wifi className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                  {wa.name || wa.phone}
                  {wa.phone && wa.name && <span className="font-normal text-emerald-700 dark:text-emerald-400 ml-1">(+{wa.phone})</span>}
                </p>
                <p className="text-xs text-emerald-600 dark:text-emerald-500 mt-0.5">Connected · messages are being monitored</p>
              </div>
              <button onClick={logoutWhatsApp}
                className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 dark:hover:text-red-300 font-medium px-2 py-1 hover:bg-red-50 dark:hover:bg-red-500/8 rounded-lg transition-colors cursor-pointer">
                <LogOut className="w-3 h-3" /> Logout
              </button>
            </div>
            <HowItWorks steps={[
              'Message YOURSELF (the "You" / Saved Messages chat) with the HR email — e.g. HIRE hr@company.com Software Engineer at Acme',
              'Any message you send to yourself containing an email is detected automatically',
              'The agent extracts the role, tailors your resume, and sends a draft preview back to you',
              'Reply APPROVE to send the email via Gmail, EDIT: <instruction> to revise, or REJECT to cancel',
            ]} />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 rounded-xl text-sm
              bg-amber-50 border border-amber-200 text-amber-800
              dark:bg-amber-500/8 dark:border-amber-500/20 dark:text-amber-300">
              <Smartphone className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="font-semibold">Scan the QR code to connect your WhatsApp</p>
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">Works exactly like WhatsApp Web — scan once, stays connected.</p>
              </div>
            </div>

            {qr ? (
              <div className="flex flex-col items-center gap-3">
                <div className="p-3 bg-white border-2 border-slate-200 dark:border-white/20 rounded-2xl shadow-sm">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qr} alt="WhatsApp QR code" className="w-48 h-48" />
                </div>
                <p className="text-xs t-b text-center">
                  Open WhatsApp on your phone → Linked Devices → Link a Device
                </p>
                <div className="flex items-center gap-1.5 text-xs text-indigo-600 dark:text-indigo-400">
                  <Loader2 className="w-3 h-3 animate-spin" /> Waiting for scan…
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 py-6">
                <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
                <p className="text-sm t-b">Loading QR code…</p>
              </div>
            )}
          </div>
        )}
      </Card>

      <Card
        icon={<Mail className="w-5 h-5 text-red-500 dark:text-red-400" />}
        iconBg="bg-red-50 border-red-100 dark:bg-red-500/10 dark:border-red-500/20"
        title="Gmail — send & scan"
        subtitle="Sends application emails on your behalf. Also scans inbox for recruiter messages and creates drafts automatically."
        badge={gm.connected ? `connected: ${gm.email}` : gm.configured ? 'ready to connect' : 'not configured'}
        badgeColor={gm.connected ? 'emerald' : gm.configured ? 'amber' : 'slate'}
      >
        {!gm.configured ? (
          <SetupBox>
            <ol className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
              <li><span className="font-semibold">1.</span> Go to <a href="https://console.cloud.google.com" target="_blank" rel="noopener" className="text-indigo-600 dark:text-indigo-400 underline">Google Cloud Console</a> → enable <strong>Gmail API</strong></li>
              <li><span className="font-semibold">2.</span> Create an OAuth 2.0 Client ID (Web application)</li>
              <li><span className="font-semibold">3.</span> Add <code className="text-xs bg-slate-100 dark:bg-white/10 px-1 rounded">http://localhost:8000/auth/gmail/callback</code> as redirect URI</li>
              <li><span className="font-semibold">4.</span> Add to <code className="text-xs bg-slate-100 dark:bg-white/10 px-1 rounded">.env</code>:
                <pre className="mt-1.5 p-2.5 bg-slate-900 text-slate-100 rounded-lg text-xs overflow-auto">{`GMAIL_CLIENT_ID=xxx.apps.googleusercontent.com\nGMAIL_CLIENT_SECRET=your_secret`}</pre>
              </li>
            </ol>
          </SetupBox>
        ) : gm.connected ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 rounded-xl
              bg-emerald-50 border border-emerald-200
              dark:bg-emerald-500/8 dark:border-emerald-500/20">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">{gm.email}</p>
                <p className="text-xs text-emerald-600 dark:text-emerald-500 mt-0.5">Emails sent from this address</p>
              </div>
              <button onClick={disconnectGmail}
                className="text-xs text-red-500 hover:text-red-700 dark:hover:text-red-300 font-medium px-2 py-1 hover:bg-red-50 dark:hover:bg-red-500/8 rounded-lg transition-colors cursor-pointer">
                Disconnect
              </button>
            </div>
            <button onClick={scanGmail} disabled={scanLoading}
              className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl transition-colors disabled:opacity-50 cursor-pointer
                bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-700 dark:hover:bg-slate-100">
              {scanLoading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Scanning…</>
                : <><Search className="w-4 h-4" /> Scan inbox for job emails</>}
            </button>
          </div>
        ) : (
          <button onClick={connectGmail} disabled={gmailLoading}
            className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors cursor-pointer">
            {gmailLoading
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Connecting…</>
              : <><Mail className="w-4 h-4" /> Connect Gmail</>}
          </button>
        )}
      </Card>

      <Card
        icon={<Search className="w-5 h-5 text-violet-600 dark:text-violet-400" />}
        iconBg="bg-violet-50 border-violet-100 dark:bg-violet-500/10 dark:border-violet-500/20"
        title="Hunter.io (optional)"
        subtitle="Finds HR emails by company domain. Not needed if the HR email is already in the message."
        badge={hi.configured ? 'configured' : 'optional'}
        badgeColor={hi.configured ? 'emerald' : 'slate'}
      >
        {hi.configured ? (
          <div className="flex items-center gap-2 p-3 rounded-xl text-sm font-semibold
            bg-emerald-50 border border-emerald-200 text-emerald-800
            dark:bg-emerald-500/8 dark:border-emerald-500/20 dark:text-emerald-300">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> Hunter.io API key active
          </div>
        ) : (
          <p className="text-sm t-b">
            Add <code className="text-xs bg-slate-100 dark:bg-white/10 px-1 rounded">HUNTER_API_KEY=…</code> to <code className="text-xs bg-slate-100 dark:bg-white/10 px-1 rounded">.env</code> (free at <a href="https://hunter.io" target="_blank" rel="noopener" className="text-indigo-600 dark:text-indigo-400 underline">hunter.io</a>).
            Without it, the agent guesses <code className="text-xs bg-slate-100 dark:bg-white/10 px-1 rounded">careers@domain.com</code>.
          </p>
        )}
      </Card>

      {gm.connected && (
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-1">Or paste a job URL</h3>
          <p className="text-xs t-b mb-4">
            No need for WhatsApp — paste any job URL and the agent scrapes + tailors + creates a draft.
          </p>
          <form onSubmit={createDraftFromUrl} className="flex gap-2">
            <input type="url" className="input flex-1"
              placeholder="https://company.com/careers/software-engineer"
              value={jobUrl} onChange={e => setJobUrl(e.target.value)} required />
            <button type="submit" disabled={urlLoading || !jobUrl.trim()}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors shrink-0 cursor-pointer">
              {urlLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
              Process
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function Card({ icon, iconBg, title, subtitle, badge, badgeColor = 'slate', children }) {
  const colors = {
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    amber:   'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
    red:     'bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400',
    slate:   'bg-slate-100 text-slate-500 dark:bg-white/8 dark:text-slate-400',
  };
  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 flex items-start gap-4 border-b border-slate-100 dark:border-white/[0.06]">
        <div className={clsx('w-10 h-10 rounded-xl border flex items-center justify-center shrink-0', iconBg)}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-slate-900 dark:text-white text-sm">{title}</h3>
            <span className={clsx('text-[10px] font-bold px-2 py-0.5 rounded-full truncate max-w-[200px]', colors[badgeColor] || colors.slate)}>
              {badge}
            </span>
          </div>
          <p className="text-xs t-b mt-0.5 leading-relaxed">{subtitle}</p>
        </div>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

function HowItWorks({ steps }) {
  return (
    <div className="mt-1">
      <p className="text-[11px] font-semibold t-m uppercase tracking-wide mb-2">How it works</p>
      <ol className="space-y-1.5">
        {steps.map((step, i) => (
          <li key={i} className="flex items-start gap-2 text-xs t-b">
            <span className="w-4 h-4 rounded-full bg-indigo-100 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-400 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
              {i + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>
    </div>
  );
}

function SidecarOffline() {
  return (
    <div className="flex items-start gap-2 p-3 rounded-xl text-sm
      bg-red-50 border border-red-200 text-red-700
      dark:bg-red-500/8 dark:border-red-500/20 dark:text-red-400">
      <WifiOff className="w-4 h-4 shrink-0 mt-0.5 text-red-500 dark:text-red-400" />
      <div>
        <p className="font-semibold">WhatsApp service unreachable</p>
        <p className="text-xs mt-0.5">The WhatsApp service is not responding. Check the Railway deployment for the whatsapp-service.</p>
      </div>
    </div>
  );
}

function SetupBox({ children }) {
  return (
    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 dark:bg-white/[0.03] dark:border-white/[0.06]">
      {children}
    </div>
  );
}
