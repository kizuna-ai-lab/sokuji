import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Toast, { type ToastVariant } from './Toast';

interface ToastEntry {
  id: string;
  text: string;
  variant: ToastVariant;
  durationMs: number;
}

interface ToastContextValue {
  showToast: (text: string, opts?: { variant?: ToastVariant; durationMs?: number }) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const showToast = useCallback<ToastContextValue['showToast']>((text, opts) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts(prev => [...prev, {
      id,
      text,
      variant: opts?.variant ?? 'success',
      durationMs: opts?.durationMs ?? 2000,
    }]);
  }, []);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div className="toast-stack">
          {toasts.map(t => (
            <Toast
              key={t.id}
              id={t.id}
              text={t.text}
              variant={t.variant}
              durationMs={t.durationMs}
              onDismiss={dismiss}
            />
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
};

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    if (typeof console !== 'undefined') {
      console.warn('[Toast] useToast() called outside ToastProvider; falling back to no-op.');
    }
    return { showToast: () => {} };
  }
  return ctx;
}
