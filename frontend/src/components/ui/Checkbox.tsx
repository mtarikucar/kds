import React, { useEffect, useRef } from 'react';
import { Check, Minus } from 'lucide-react';
import { cn } from '../../lib/utils';

interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label?: React.ReactNode;
  error?: string;
  size?: 'sm' | 'md' | 'lg';
  indeterminate?: boolean;
}

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, error, id, size = 'md', indeterminate, ...props }, ref) => {
    const inputId = id || `checkbox-${Math.random().toString(36).substr(2, 9)}`;
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
      if (inputRef.current) {
        inputRef.current.indeterminate = !!indeterminate;
      }
    }, [indeterminate]);

    const sizes = {
      sm: {
        box: 'w-4 h-4',
        icon: 'w-3 h-3',
        label: 'text-xs',
      },
      md: {
        box: 'w-5 h-5',
        icon: 'w-4 h-4',
        label: 'text-sm',
      },
      lg: {
        box: 'w-6 h-6',
        icon: 'w-5 h-5',
        label: 'text-base',
      },
    };

    const currentSize = sizes[size];

    return (
      <div className="w-full">
        <label
          htmlFor={inputId}
          className={cn(
            'flex items-start gap-3 cursor-pointer group',
            props.disabled && 'cursor-not-allowed opacity-60'
          )}
        >
          <div className="relative flex-shrink-0 mt-0.5">
            <input
              ref={(node) => {
                if (typeof ref === 'function') ref(node);
                else if (ref) ref.current = node;
                inputRef.current = node;
              }}
              type="checkbox"
              id={inputId}
              className="sr-only peer"
              {...props}
            />
            <div
              className={cn(
                currentSize.box,
                'border-2 rounded transition-all duration-150',
                'border-input bg-background',
                'peer-focus:ring-2 peer-focus:ring-primary-500 peer-focus:ring-offset-2',
                indeterminate
                  ? 'bg-primary-500 border-primary-500'
                  : 'peer-checked:bg-primary-500 peer-checked:border-primary-500',
                'group-hover:border-primary-400 peer-checked:group-hover:border-primary-600',
                error && 'border-error peer-focus:ring-error',
                className
              )}
            />
            {indeterminate ? (
              <Minus
                className={cn(
                  'absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-white',
                  currentSize.icon,
                  'opacity-100 scale-100 transition-all duration-150'
                )}
                strokeWidth={3}
              />
            ) : (
              <Check
                className={cn(
                  'absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-white',
                  currentSize.icon,
                  'opacity-0 scale-0 transition-all duration-150',
                  'peer-checked:opacity-100 peer-checked:scale-100'
                )}
                strokeWidth={3}
              />
            )}
          </div>
          {label && (
            <span className={cn(currentSize.label, 'text-foreground leading-tight select-none')}>
              {label}
            </span>
          )}
        </label>
        {error && (
          <p className="mt-1.5 text-sm text-error" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }
);

Checkbox.displayName = 'Checkbox';

export { Checkbox };
export default Checkbox;
