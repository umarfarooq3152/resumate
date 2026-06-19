'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard, User, Briefcase, FileText,
  Activity, Settings, LogOut, ClipboardList, X,
  Link2, Mail, Sun, Moon, GraduationCap,
} from 'lucide-react';
import clsx from 'clsx';
import { getSupabase } from '../lib/supabase';
import { api } from '../lib/api';
import { useTheme } from './ThemeProvider';
import Logo from './Logo';

const NAV = [
  { href: '/dashboard',    icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/profile',      icon: User,            label: 'Profile' },
  { href: '/jobs',          icon: Briefcase,       label: 'Jobs',          badge: 'match_pending' },
  { href: '/internships',   icon: GraduationCap,   label: 'Internships' },
  { href: '/applications',  icon: FileText,        label: 'Applications',  badge: 'application_pending' },
  { href: '/email-drafts', icon: Mail,            label: 'Email Drafts', badge: 'draft_pending' },
  { href: '/forms',        icon: ClipboardList,   label: 'Form Fill' },
  { href: '/pipeline',     icon: Activity,        label: 'Pipeline' },
  { href: '/integrations', icon: Link2,           label: 'Integrations' },
  { href: '/settings',     icon: Settings,        label: 'Settings' },
];

export default function Sidebar({ onClose }) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const [counts, setCounts] = useState({ match_pending: 0, application_pending: 0, draft_pending: 0 });
  const [userInitial, setUserInitial] = useState('U');
  const [userEmail, setUserEmail] = useState('');

  useEffect(() => {
    getSupabase().auth.getUser().then(({ data }) => {
      const email = data?.user?.email ?? '';
      const name = data?.user?.user_metadata?.full_name ?? '';
      setUserEmail(email);
      setUserInitial((name[0] || email[0] || 'U').toUpperCase());
    });
  }, []);

  useEffect(() => {
    let profileId = null;
    const loadCounts = async (pid = profileId) => {
      try {
        const { data: { user } } = await getSupabase().auth.getUser();
        if (!user) return;
        if (pid === null) {
          try {
            const profiles = await api.getProfiles(user.id);
            pid = profiles?.[0]?.id ?? null;
            profileId = pid;
          } catch { /* no profile */ }
        }
        const [cnts, drafts] = await Promise.all([
          api.getCounts(pid),
          api.getEmailDrafts({ user_id: user.id, status: 'pending_approval' }).catch(() => []),
        ]);
        setCounts({ ...cnts, draft_pending: drafts.length });
      } catch { /* ignore */ }
    };
    loadCounts();
    const interval = setInterval(() => loadCounts(profileId), 30_000);
    return () => clearInterval(interval);
  }, []);

  const signOut = async () => {
    await getSupabase().auth.signOut();
    router.push('/login');
    router.refresh();
  };

  return (
    <aside className="w-60 shrink-0 flex flex-col h-screen
      bg-white border-r border-slate-200
      dark:bg-[#0d0d12] dark:border-white/[0.06]">

      {/* Logo */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-slate-200 dark:border-white/[0.06]">
        <Link href="/dashboard" onClick={onClose} className="group">
          <Logo size={56} style={{ filter: 'drop-shadow(0 0 8px rgba(99,102,241,0.5))' }} />
        </Link>
        <button onClick={onClose} className="md:hidden p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/8 text-slate-400 transition-colors cursor-pointer" aria-label="Close menu">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {NAV.map(({ href, icon: Icon, label, badge }) => {
          const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href + '/'));
          const count = badge ? (counts[badge] ?? 0) : 0;
          return (
            <Link key={href} href={href} onClick={onClose}
              className={clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 cursor-pointer border',
                active
                  ? 'bg-indigo-50 text-indigo-700 border-indigo-100 dark:bg-indigo-600/20 dark:text-indigo-300 dark:border-indigo-500/20'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 border-transparent dark:text-slate-400 dark:hover:bg-white/[0.06] dark:hover:text-slate-100',
              )}>
              <Icon className="w-4 h-4 shrink-0" />
              <span className="flex-1">{label}</span>
              {count > 0 && (
                <span className="bg-indigo-600 text-white text-[10px] font-bold min-w-[18px] h-[18px] rounded-full flex items-center justify-center px-1 shrink-0">
                  {count > 99 ? '99+' : count}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-slate-200 dark:border-white/[0.06] p-3 space-y-1">
        {/* Theme toggle */}
        <button onClick={toggle}
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-medium cursor-pointer transition-all duration-150
            text-slate-600 hover:bg-slate-50 hover:text-slate-900
            dark:text-slate-400 dark:hover:bg-white/[0.06] dark:hover:text-slate-100">
          {theme === 'dark'
            ? <><Sun className="w-4 h-4 shrink-0" /> Light mode</>
            : <><Moon className="w-4 h-4 shrink-0" /> Dark mode</>}
        </button>

        {/* User */}
        <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-slate-50 dark:bg-white/[0.04]">
          <div className="w-7 h-7 rounded-full bg-indigo-100 border border-indigo-200 dark:bg-indigo-600/30 dark:border-indigo-500/30 flex items-center justify-center text-xs font-bold text-indigo-700 dark:text-indigo-300 shrink-0">
            {userInitial}
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 font-medium truncate flex-1">{userEmail || 'Loading…'}</p>
        </div>

        <button onClick={signOut}
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-medium cursor-pointer transition-all duration-150
            text-slate-500 hover:bg-red-50 hover:text-red-600
            dark:text-slate-500 dark:hover:bg-red-500/10 dark:hover:text-red-400">
          <LogOut className="w-4 h-4 shrink-0" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
