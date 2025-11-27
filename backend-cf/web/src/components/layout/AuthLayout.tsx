import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '@/components/ui/Logo';
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
            <Logo size={40} />
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
