import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

export type ToastTone = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  message?: string;
}

interface ToastApi {
  show: (tone: ToastTone, title: string, message?: string) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const dismiss = useCallback((id: number) => setItems((all) => all.filter((t) => t.id !== id)), []);
  const show = useCallback(
    (tone: ToastTone, title: string, message?: string) => {
      const id = nextId.current++;
      setItems((all) => [...all.slice(-3), { id, tone, title, message }]);
      window.setTimeout(() => dismiss(id), tone === 'error' ? 8000 : 4500);
    },
    [dismiss],
  );
  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (t, m) => show('success', t, m),
      error: (t, m) => show('error', t, m),
      info: (t, m) => show('info', t, m),
    }),
    [show],
  );
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="n-toasts" aria-live="polite" aria-relevant="additions">
        {items.map((t) => (
          <div key={t.id} className={`n-toast n-toast--${t.tone}`} role={t.tone === 'error' ? 'alert' : 'status'}>
            <span className="n-toast__icon" aria-hidden="true">
              {t.tone === 'success' ? (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M3.5 8.5 6.5 11.5 12.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : t.tone === 'error' ? (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M8 3.5v5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <circle cx="8" cy="12" r="1.1" fill="currentColor" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="3" fill="currentColor" />
                </svg>
              )}
            </span>
            <div className="n-toast__text">
              <p className="n-toast__title">{t.title}</p>
              {t.message ? <p className="n-toast__msg">{t.message}</p> : null}
            </div>
            <button type="button" className="n-toast__close" aria-label="Dismiss notification" onClick={() => dismiss(t.id)}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
