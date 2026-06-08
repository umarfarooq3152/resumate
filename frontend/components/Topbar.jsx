'use client';
import { useEffect, useState } from 'react';
import { Menu } from 'lucide-react';
import { getSupabase } from '../lib/supabase';
import Logo from './Logo';

export default function Topbar({ onMenuClick }) {
  const [initial, setInitial] = useState('');

  useEffect(() => {
    getSupabase().auth.getUser().then(({ data }) => {
      const email = data?.user?.email ?? '';
      const name = data?.user?.user_metadata?.full_name ?? '';
      setInitial((name[0] || email[0] || 'U').toUpperCase());
    });
  }, []);

  return (
    <header className="md:hidden sticky top-0 z-10 flex items-center justify-between h-14 px-4 shrink-0
      bg-white/90 border-b border-slate-200 backdrop-blur-md
      dark:bg-[#0d0d12]/90 dark:border-white/[0.06]">
      <button
        onClick={onMenuClick}
        className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-white/8 dark:hover:text-slate-200 transition-colors cursor-pointer"
        aria-label="Open menu">
        <Menu className="w-5 h-5" />
      </button>

      <Logo size={28} withName nameClass="font-bold text-slate-900 dark:text-white text-xs" />

      <div className="w-7 h-7 rounded-full bg-indigo-100 border border-indigo-200 dark:bg-indigo-600/25 dark:border-indigo-500/30 flex items-center justify-center text-xs font-bold text-indigo-700 dark:text-indigo-300 select-none">
        {initial}
      </div>
    </header>
  );
}
