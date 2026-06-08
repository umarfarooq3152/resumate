'use client';
import { createContext, useContext, useState, useCallback, useRef } from 'react';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';
import clsx from 'clsx';

const ToastCtx = createContext(() => {});

const META = {
  success: { icon: CheckCircle, cls: 'bg-emerald-600 text-white' },
  error:   { icon: AlertCircle, cls: 'bg-red-600 text-white' },
  info:    { icon: Info,        cls: 'bg-slate-800 text-white' },
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const id = useRef(0);

  const add = useCallback((message, type = 'info') => {
    const key = ++id.current;
    setToasts(t => [...t, { key, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.key !== key)), 4500);
  }, []);

  const remove = (key) => setToasts(t => t.filter(x => x.key !== key));

  return (
    <ToastCtx.Provider value={add}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-[min(20rem,calc(100vw-2rem))] pointer-events-none">
        {toasts.map(({ key, message, type }) => {
          const { icon: Icon, cls } = META[type] ?? META.info;
          return (
            <div key={key}
              className={clsx('flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-sm font-medium pointer-events-auto animate-in slide-in-from-right-4', cls)}>
              <Icon className="w-4 h-4 shrink-0" />
              <span className="flex-1">{message}</span>
              <button onClick={() => remove(key)} className="opacity-60 hover:opacity-100 transition-opacity">
                <X className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
