import React from 'react';
import { cn } from '../../lib/utils';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  variant?: 'spinner' | 'dots' | 'pulse';
  color?: 'primary' | 'secondary' | 'accent' | 'neutral' | 'white';
  className?: string;
}

const Spinner: React.FC<SpinnerProps> = ({
  size = 'md',
  variant = 'spinner',
  color = 'primary',
  className,
}) => {
  const sizes = {
    sm: 'h-4 w-4',
    md: 'h-8 w-8',
    lg: 'h-12 w-12',
  };

  const colors = {
    primary: 'text-primary-500',
    secondary: 'text-secondary-500',
    accent: 'text-accent-500',
    neutral: 'text-neutral-500',
    white: 'text-white',
  };

  if (variant === 'dots') {
    const dotSizes = {
      sm: 'h-1.5 w-1.5',
      md: 'h-2 w-2',
      lg: 'h-2.5 w-2.5',
    };
    return (
      <div className={cn('flex items-center gap-1.5', className)}>
        <div
          className={cn(
            'rounded-full animate-pulse',
            dotSizes[size],
            colors[color],
            '[animation-delay:0ms]'
          )}
        />
        <div
          className={cn(
            'rounded-full animate-pulse',
            dotSizes[size],
            colors[color],
            '[animation-delay:150ms]'
          )}
        />
        <div
          className={cn(
            'rounded-full animate-pulse',
            dotSizes[size],
            colors[color],
            '[animation-delay:300ms]'
          )}
        />
      </div>
    );
  }

  if (variant === 'pulse') {
    return (
      <div className={cn('flex items-center justify-center', className)}>
        <div
          className={cn(
            'rounded-full animate-pulse',
            sizes[size],
            `bg-${color === 'primary' ? 'primary' : color === 'secondary' ? 'secondary' : color === 'accent' ? 'accent' : 'neutral'}-500`
          )}
        />
      </div>
    );
  }

  return (
    <div className={cn('flex items-center justify-center', className)} aria-label="Loading">
      <svg
        className={cn('animate-spin', sizes[size], colors[color])}
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        ></circle>
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        ></path>
      </svg>
    </div>
  );
};

export default Spinner;
