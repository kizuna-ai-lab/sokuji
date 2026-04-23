import React, { useEffect } from 'react';
import './Toast.scss';

export type ToastVariant = 'success' | 'error';

export interface ToastProps {
  id: string;
  text: string;
  variant: ToastVariant;
  durationMs: number;
  onDismiss: (id: string) => void;
}

const Toast: React.FC<ToastProps> = ({ id, text, variant, durationMs, onDismiss }) => {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(id), durationMs);
    return () => window.clearTimeout(timer);
  }, [id, durationMs, onDismiss]);

  return (
    <div className={`toast toast-${variant}`} role="status" aria-live="polite">
      {text}
    </div>
  );
};

export default Toast;
