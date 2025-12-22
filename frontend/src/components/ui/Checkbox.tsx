import React from 'react';
import { Check } from 'lucide-react';
import { cn } from '../../lib/utils';

interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: React.ReactNode;
  error?: string;
}

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, error, id, ...props }, ref) => {
    const inputId = id || `checkbox-${Math.random().toString(36).substr(2, 9)}`;

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
              ref={ref}
              type="checkbox"
              id={inputId}
              className="sr-only peer"
              {...props}
            />
            <div
              className={cn(
                'w-5 h-5 border-2 rounded transition-all duration-200',
                'border-gray-300 bg-white',
                'peer-focus:ring-2 peer-focus:ring-primary-500 peer-focus:ring-offset-1',
                'peer-checked:bg-primary-500 peer-checked:border-primary-500',
                'group-hover:border-gray-400 peer-checked:group-hover:border-primary-600',
                error && 'border-red-500',
                className
              )}
            />
            <Check
              className={cn(
                'absolute top-0.5 left-0.5 w-4 h-4 text-white',
                'opacity-0 scale-0 transition-all duration-200',
                'peer-checked:opacity-100 peer-checked:scale-100'
              )}
              strokeWidth={3}
            />
          </div>
          {label && (
            <span className="text-sm text-gray-700 leading-tight select-none">
              {label}
            </span>
          )}
        </label>
        {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
      </div>
    );
  }
);

Checkbox.displayName = 'Checkbox';

export { Checkbox };
export default Checkbox;
