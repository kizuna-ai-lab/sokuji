import React from 'react';
import './FormInput.scss';

interface FormInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  type?: 'text' | 'password';
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  disabled?: boolean;
  status?: 'valid' | 'invalid' | null;
  className?: string;
}

const FormInput: React.FC<FormInputProps> = ({
  type = 'text',
  value,
  onChange,
  placeholder,
  disabled = false,
  status = null,
  className = '',
  ...rest
}) => {
  const statusClass = status ? `settings-input--${status}` : '';

  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      className={`settings-input ${statusClass} ${className}`.trim()}
      {...rest}
    />
  );
};

export default FormInput;
