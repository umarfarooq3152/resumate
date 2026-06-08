import clsx from 'clsx';

const ACCENT = {
  indigo:  { light: 'bg-indigo-50 border-indigo-100',  icon: 'text-indigo-500',  dark: 'dark:bg-indigo-500/10 dark:border-indigo-500/20',  darkIcon: 'dark:text-indigo-400',  glow: 'dark:shadow-indigo-500/10' },
  emerald: { light: 'bg-emerald-50 border-emerald-100', icon: 'text-emerald-500', dark: 'dark:bg-emerald-500/10 dark:border-emerald-500/20', darkIcon: 'dark:text-emerald-400', glow: 'dark:shadow-emerald-500/10' },
  amber:   { light: 'bg-amber-50 border-amber-100',    icon: 'text-amber-500',   dark: 'dark:bg-amber-500/10 dark:border-amber-500/20',    darkIcon: 'dark:text-amber-400',   glow: 'dark:shadow-amber-500/10' },
  violet:  { light: 'bg-violet-50 border-violet-100',  icon: 'text-violet-500',  dark: 'dark:bg-violet-500/10 dark:border-violet-500/20',  darkIcon: 'dark:text-violet-400',  glow: 'dark:shadow-violet-500/10' },
  rose:    { light: 'bg-rose-50 border-rose-100',      icon: 'text-rose-500',    dark: 'dark:bg-rose-500/10 dark:border-rose-500/20',      darkIcon: 'dark:text-rose-400',    glow: 'dark:shadow-rose-500/10' },
};

export default function StatCard({ label, value, sub, icon: Icon, accent = 'indigo' }) {
  const ac = ACCENT[accent] ?? ACCENT.indigo;
  return (
    <div className={clsx(
      'rounded-2xl p-5 flex flex-col gap-4 transition-all duration-200',
      'bg-white border border-slate-200',
      'dark:bg-white/[0.04] dark:border-white/10',
      `dark:shadow-lg ${ac.glow}`,
    )}>
      {Icon && (
        <div className={clsx('w-9 h-9 rounded-xl flex items-center justify-center border', ac.light, ac.dark, ac.icon, ac.darkIcon)}>
          <Icon className="w-4 h-4" />
        </div>
      )}
      <div>
        <p className="text-3xl font-black text-slate-900 dark:text-white tabular-nums leading-none tracking-tight">
          {value ?? '—'}
        </p>
        <p className="text-xs font-semibold text-slate-600 dark:text-slate-400 mt-1.5">{label}</p>
        {sub && <p className="text-xs text-slate-400 dark:text-slate-600 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}
