import React, { useEffect } from 'react';
import './Toast.scss';

export type ToastVariant = 'success' | 'error';

/** One button on the toast; clicking it runs `onClick` and dismisses the toast. */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastProps {
  id: string;
  text: string;
  variant: ToastVariant;
  durationMs: number;
  action?: ToastAction;
  onDismiss: (id: string) => void;
}

const Toast: React.FC<ToastProps> = ({ id, text, variant, durationMs, action, onDismiss }) => {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(id), durationMs);
    return () => window.clearTimeout(timer);
  }, [id, durationMs, onDismiss]);

  return (
    <div className={`toast toast-${variant}`} role="status" aria-live="polite">
      <span className="toast-text">{text}</span>
      {action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            action.onClick();
            onDismiss(id);
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
};

export default Toast;
