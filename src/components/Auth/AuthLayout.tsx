/**
 * Authentication Layout Component
 *
 * Provides a consistent layout for authentication pages
 */

import React, { ReactNode } from 'react';
import './AuthLayout.scss';

interface AuthLayoutProps {
  children: ReactNode;
}

export function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="auth-layout">
      <div className="auth-container">
        <div className="auth-logo">
          <h1>Sokuji</h1>
          <p>Real-time AI Translation</p>
        </div>

        <div className="auth-content">
          {children}
        </div>
      </div>
    </div>
  );
}
