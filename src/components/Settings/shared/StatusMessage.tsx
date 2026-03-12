import React from 'react';
import './StatusMessage.scss';

interface StatusMessageProps {
  variant: 'success' | 'warning' | 'error' | 'info';
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

const StatusMessage: React.FC<StatusMessageProps> = ({
  variant,
  icon,
  children,
  className = ''
}) => {
  return (
    <div
      className={`status-message status-message--${variant} ${className}`}
      role={variant === 'error' ? 'alert' : 'status'}
    >
      {icon && <span className="status-message__icon">{icon}</span>}
      <span className="status-message__content">{children}</span>
    </div>
  );
};

export default StatusMessage;
