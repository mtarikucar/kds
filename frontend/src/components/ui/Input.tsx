import React, { useState, useId } from 'react';
import { LucideIcon, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '../../lib/utils';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  variant?: 'outlined' | 'filled' | 'underlined';
  floatingLabel?: boolean;
  leftIcon?: LucideIcon;
  rightIcon?: LucideIcon;
  onLeftIconClick?: () => void;
  onRightIconClick?: () => void;
  success?: boolean;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      label,
      error,
      helperText,
      variant = 'outlined',
      floatingLabel = false,
      leftIcon: LeftIcon,
      rightIcon: RightIcon,
      onLeftIconClick,
      onRightIconClick,
      success = false,
      maxLength,
      value,
      ...props
    },
    ref
  ) => {
    const [isFocused, setIsFocused] = useState(false);
    const [hasValue, setHasValue] = useState(!!value || !!(props as any).defaultValue);
    const inputId = useId();
    const labelId = `${inputId}-label`;
    const helperId = `${inputId}-helper`;
    const errorId = `${inputId}-error`;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setHasValue(!!e.target.value);
      props.onChange?.(e);
    };

    const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
      setIsFocused(true);
      props.onFocus?.(e);
    };

    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      setIsFocused(false);
      props.onBlur?.(e);
    };

    const showFloatingLabel = floatingLabel && (isFocused || hasValue || !!value);
    const showCharacterCounter = maxLength !== undefined;

    const baseInputStyles = cn(
      'w-full text-foreground transition-all duration-150',
      'focus:outline-none disabled:cursor-not-allowed',
      'placeholder:text-muted-foreground',
      variant === 'outlined' && 'border rounded-lg',
      variant === 'filled' && 'border-b-2 border-t-0 border-l-0 border-r-0 rounded-t-lg bg-muted/50',
      variant === 'underlined' && 'border-b-2 border-t-0 border-l-0 border-r-0 rounded-none bg-transparent',
      error && 'border-error focus:ring-error focus:border-error',
      success && !error && 'border-accent-500 focus:ring-accent-500 focus:border-accent-500',
      !error && !success && 'border-input focus:ring-primary-500 focus:border-primary-500',
      LeftIcon && 'pl-10',
      RightIcon && 'pr-10',
      variant === 'outlined' && 'px-4 py-2.5',
      variant === 'filled' && 'px-4 py-2.5',
      variant === 'underlined' && 'px-0 py-2.5',
      'disabled:bg-muted disabled:text-muted-foreground',
      showFloatingLabel && floatingLabel && 'pt-6 pb-2',
      !showFloatingLabel && floatingLabel && 'py-2.5'
    );

    const containerStyles = cn(
      'relative w-full',
      variant === 'filled' && 'bg-muted/50 rounded-lg',
      variant === 'underlined' && 'bg-transparent'
    );

    return (
      <div className="w-full">
        {label && !floatingLabel && (
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-foreground mb-1.5"
            id={labelId}
          >
            {label}
          </label>
        )}
        <div className={containerStyles}>
          {floatingLabel && label && (
            <label
              htmlFor={inputId}
              className={cn(
                'absolute left-0 transition-all duration-150 pointer-events-none',
                variant === 'outlined' && LeftIcon ? 'left-10' : variant === 'outlined' ? 'left-4' : 'left-0',
                variant === 'filled' && LeftIcon ? 'left-10' : variant === 'filled' ? 'left-4' : 'left-0',
                variant === 'underlined' && 'left-0',
                showFloatingLabel
                  ? 'top-1.5 text-xs text-primary-500'
                  : 'top-2.5 text-sm text-muted-foreground',
                error && showFloatingLabel && 'text-error',
                success && !error && showFloatingLabel && 'text-accent-500'
              )}
              id={labelId}
            >
              {label}
            </label>
          )}
          {LeftIcon && (
            <div
              className={cn(
                'absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground',
                onLeftIconClick && 'cursor-pointer hover:text-foreground transition-colors',
                variant === 'underlined' && 'left-0'
              )}
              onClick={onLeftIconClick}
              aria-hidden="true"
            >
              <LeftIcon className="h-5 w-5" />
            </div>
          )}
          <input
            ref={ref}
            id={inputId}
            className={cn(baseInputStyles, className)}
            value={value}
            maxLength={maxLength}
            aria-invalid={!!error}
            aria-describedby={cn(error && errorId, helperText && helperId, showCharacterCounter && `${inputId}-counter`)}
            aria-labelledby={label ? labelId : undefined}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onChange={handleChange}
            {...props}
          />
          {RightIcon && !success && !error && (
            <div
              className={cn(
                'absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground',
                onRightIconClick && 'cursor-pointer hover:text-foreground transition-colors',
                variant === 'underlined' && 'right-0'
              )}
              onClick={onRightIconClick}
              aria-hidden="true"
            >
              <RightIcon className="h-5 w-5" />
            </div>
          )}
          {success && !error && (
            <div
              className={cn(
                'absolute right-3 top-1/2 -translate-y-1/2 text-accent-500',
                variant === 'underlined' && 'right-0'
              )}
              aria-hidden="true"
            >
              <CheckCircle2 className="h-5 w-5" />
            </div>
          )}
          {error && (
            <div
              className={cn(
                'absolute right-3 top-1/2 -translate-y-1/2 text-error',
                variant === 'underlined' && 'right-0'
              )}
              aria-hidden="true"
            >
              <AlertCircle className="h-5 w-5" />
            </div>
          )}
        </div>
        <div className="mt-1.5 flex items-center justify-between">
          <div className="flex-1">
            {error && (
              <p className="text-sm text-error" id={errorId} role="alert">
                {error}
              </p>
            )}
            {helperText && !error && (
              <p className="text-sm text-muted-foreground" id={helperId}>
                {helperText}
              </p>
            )}
          </div>
          {showCharacterCounter && (
            <span
              className={cn(
                'text-xs ml-2',
                typeof value === 'string' && value.length > maxLength! * 0.9
                  ? 'text-warning-dark'
                  : 'text-muted-foreground'
              )}
              id={`${inputId}-counter`}
            >
              {typeof value === 'string' ? value.length : 0}/{maxLength}
            </span>
          )}
        </div>
      </div>
    );
  }
);

Input.displayName = 'Input';

export { Input };
export default Input;
