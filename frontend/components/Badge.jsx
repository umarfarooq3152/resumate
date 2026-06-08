import clsx from 'clsx';

const VARIANTS = {
  default:  'bg-slate-100 text-slate-700 dark:bg-slate-700/40 dark:text-slate-300',
  indigo:   'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
  emerald:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  amber:    'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  red:      'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  sky:      'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  violet:   'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
};

export default function Badge({ children, variant = 'default', className }) {
  return (
    <span className={clsx('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', VARIANTS[variant], className)}>
      {children}
    </span>
  );
}

export function statusVariant(status) {
  const map = {
    pending:    'amber',
    approved:   'emerald',
    rejected:   'red',
    scored:     'indigo',
    tailored:   'sky',
    submitted:  'emerald',
    discovered: 'violet',
    failed:     'red',
    prepared:   'sky',
    error:      'red',
    manual_pending: 'amber',
  };
  return map[status?.toLowerCase()] ?? 'default';
}
