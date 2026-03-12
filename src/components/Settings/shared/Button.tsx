import React from 'react';
import './Button.scss';

interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md';
  loading?: boolean;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  title?: string;
  type?: 'button' | 'submit';
}

const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  className = '',
  children,
  onClick,
  title,
  type = 'button',
}) => {
  return (
    <button
      type={type}
      className={`settings-btn settings-btn--${variant} settings-btn--${size} ${className}`}
      onClick={onClick}
      disabled={disabled || loading}
      title={title}
      aria-busy={loading || undefined}
    >
      {loading && <span className="settings-btn__spinner" aria-hidden="true" />}
      {children}
    </button>
  );
};

export default Button;
