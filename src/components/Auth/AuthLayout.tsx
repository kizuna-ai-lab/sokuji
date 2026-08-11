/**
 * Authentication Layout Component
 *
 * Provides a consistent layout for authentication pages
 */

import { ReactNode } from 'react';
import { X } from 'lucide-react';
import gmLogoMark from '../../assets/logo-gm-mark.png';
import './AuthLayout.scss';

interface AuthLayoutProps {
  children: ReactNode;
  onClose?: () => void;
}

export function AuthLayout({ children, onClose }: AuthLayoutProps) {
  return (
    <div className="auth-layout">
      <div className="auth-container">
        {onClose && (
          <button className="auth-close-button" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        )}

        <div className="auth-brand">
          <img src={gmLogoMark} alt="GM MeetMind" width={48} height={48} />
          <span>GM MeetMind</span>
        </div>

        <div className="auth-content">
          {children}
        </div>
      </div>
    </div>
  );
}
