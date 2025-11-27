import { ReactNode } from 'react';
import { AlertCircle, CheckCircle, Info, AlertTriangle } from 'lucide-react';
import './Alert.scss';

interface AlertProps {
  variant?: 'error' | 'success' | 'warning' | 'info';
  children: ReactNode;
  className?: string;
}

const icons = {
  error: AlertCircle,
  success: CheckCircle,
  warning: AlertTriangle,
  info: Info,
};

export function Alert({ variant = 'info', children, className = '' }: AlertProps) {
  const Icon = icons[variant];

  return (
    <div className={`alert alert--${variant} ${className}`}>
      <Icon size={18} className="alert__icon" />
      <span className="alert__message">{children}</span>
    </div>
  );
}
