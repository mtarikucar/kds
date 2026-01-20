import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '../../lib/utils';
import PasswordStrength from './PasswordStrength';

interface PasswordInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  error?: string;
  showStrengthIndicator?: boolean;
  helperText?: string;
}

const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, label, error, showStrengthIndicator = false, helperText, value, ...props }, ref) => {
    const [showPassword, setShowPassword] = useState(false);

    const toggleVisibility = () => {
      setShowPassword((prev) => !prev);
    };

    const passwordValue = typeof value === 'string' ? value : '';

    return (
      <div className="w-full">
        {label && (
          <label className="block text-sm font-medium text-foreground mb-1.5">
            {label}
          </label>
        )}
        <div className="relative">
          <input
            ref={ref}
            type={showPassword ? 'text' : 'password'}
            value={value}
            className={cn(
              'w-full px-4 py-2.5 pr-10 border border-input rounded-lg shadow-sm',
              'bg-background text-foreground',
              'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500',
              'disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed',
              'transition-all duration-150',
              error && 'border-error focus:ring-error focus:border-error',
              className
            )}
            aria-invalid={!!error}
            aria-describedby={
              error
                ? `${props.id || 'password'}-error`
                : showStrengthIndicator
                ? `${props.id || 'password'}-strength`
                : helperText
                ? `${props.id || 'password'}-helper`
                : undefined
            }
            {...props}
          />
          <button
            type="button"
            onClick={toggleVisibility}
            className={cn(
              'absolute right-3 top-1/2 -translate-y-1/2',
              'text-muted-foreground hover:text-foreground',
              'focus:outline-none focus:text-foreground',
              'transition-all duration-150 p-1 rounded hover:bg-neutral-100'
            )}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            tabIndex={-1}
          >
            {showPassword ? (
              <EyeOff className="w-5 h-5 transition-transform duration-150" />
            ) : (
              <Eye className="w-5 h-5 transition-transform duration-150" />
            )}
          </button>
        </div>
        {error && (
          <p className="mt-1.5 text-sm text-error" id={`${props.id || 'password'}-error`} role="alert">
            {error}
          </p>
        )}
        {helperText && !error && (
          <p className="mt-1.5 text-sm text-muted-foreground" id={`${props.id || 'password'}-helper`}>
            {helperText}
          </p>
        )}
        {showStrengthIndicator && passwordValue && !error && (
          <div id={`${props.id || 'password'}-strength`} className="mt-2">
            <PasswordStrength password={passwordValue} showRequirements={true} />
          </div>
        )}
      </div>
    );
  }
);

PasswordInput.displayName = 'PasswordInput';

export { PasswordInput };
export default PasswordInput;
