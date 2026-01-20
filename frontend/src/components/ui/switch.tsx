import React from 'react';
import { cn } from '../../lib/utils';

interface SwitchProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'size'> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  size?: 'sm' | 'md' | 'lg';
  label?: React.ReactNode;
  labelPosition?: 'left' | 'right';
  helperText?: string;
}

const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  (
    {
      className,
      checked = false,
      onCheckedChange,
      disabled,
      size = 'md',
      label,
      labelPosition = 'right',
      helperText,
      ...props
    },
    ref
  ) => {
    const handleClick = () => {
      if (!disabled) {
        onCheckedChange?.(!checked);
      }
    };

    const sizes = {
      sm: {
        track: 'h-4 w-7',
        thumb: 'h-3 w-3',
        translate: 'translate-x-3',
      },
      md: {
        track: 'h-6 w-11',
        thumb: 'h-5 w-5',
        translate: 'translate-x-5',
      },
      lg: {
        track: 'h-7 w-14',
        thumb: 'h-6 w-6',
        translate: 'translate-x-7',
      },
    };

    const currentSize = sizes[size];

    const switchElement = (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={props['aria-label'] || (typeof label === 'string' ? label : undefined)}
        data-state={checked ? 'checked' : 'unchecked'}
        disabled={disabled}
        className={cn(
          'inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-all duration-150',
          currentSize.track,
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          'disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'bg-primary-500' : 'bg-neutral-300',
          className
        )}
        onClick={handleClick}
        ref={ref}
        {...props}
      >
        <span
          data-state={checked ? 'checked' : 'unchecked'}
          className={cn(
            'pointer-events-none block rounded-full bg-white shadow-lg ring-0 transition-transform duration-150',
            currentSize.thumb,
            checked ? currentSize.translate : 'translate-x-0'
          )}
        />
      </button>
    );

    if (!label && !helperText) {
      return switchElement;
    }

    return (
      <div className="flex flex-col gap-1">
        <div
          className={cn(
            'flex items-center gap-3',
            labelPosition === 'left' ? 'flex-row-reverse' : 'flex-row'
          )}
        >
          {label && (
            <label
              className={cn(
                'text-sm font-medium text-foreground cursor-pointer select-none',
                disabled && 'cursor-not-allowed opacity-60'
              )}
              onClick={!disabled ? handleClick : undefined}
            >
              {label}
            </label>
          )}
          {switchElement}
        </div>
        {helperText && (
          <p
            className={cn(
              'text-xs text-muted-foreground',
              labelPosition === 'left' ? 'mr-0' : 'ml-0'
            )}
            style={{
              [labelPosition === 'left' ? 'marginRight' : 'marginLeft']:
                labelPosition === 'left'
                  ? '0'
                  : size === 'sm'
                  ? '2.5rem'
                  : size === 'md'
                  ? '3rem'
                  : '3.5rem',
            }}
          >
            {helperText}
          </p>
        )}
      </div>
    );
  }
);

Switch.displayName = 'Switch';

export { Switch };
export default Switch;
