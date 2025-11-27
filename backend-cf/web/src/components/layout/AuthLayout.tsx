import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import './AuthLayout.scss';

interface AuthLayoutProps {
  children: ReactNode;
  title: string;
  subtitle?: string;
}

export function AuthLayout({ children, title, subtitle }: AuthLayoutProps) {
  return (
    <div className="auth-layout">
      <div className="auth-layout__container">
        <div className="auth-layout__header">
          <Link to="/" className="auth-layout__logo">
            <svg width="40" height="40" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="50" cy="50" r="45" fill="#10a37f" />
              <path d="M30 50C30 38.954 38.954 30 50 30V70C38.954 70 30 61.046 30 50Z" fill="white" />
              <circle cx="60" cy="50" r="10" fill="white" />
            </svg>
            <span>Sokuji</span>
          </Link>
        </div>

        <div className="auth-layout__card">
          <div className="auth-layout__card-header">
            <h1 className="auth-layout__title">{title}</h1>
            {subtitle && <p className="auth-layout__subtitle">{subtitle}</p>}
          </div>
          <div className="auth-layout__content">{children}</div>
        </div>

        <footer className="auth-layout__footer">
          <p>&copy; {new Date().getFullYear()} Sokuji. All rights reserved.</p>
        </footer>
      </div>
    </div>
  );
}
