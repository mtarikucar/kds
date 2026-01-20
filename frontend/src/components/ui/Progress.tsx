import React from 'react';
import { cn } from '../../lib/utils';

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number;
  max?: number;
  variant?: 'linear' | 'circular';
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  color?: 'primary' | 'secondary' | 'accent' | 'success' | 'warning' | 'error';
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  (
    {
      className,
      value,
      max = 100,
      variant = 'linear',
      size = 'md',
      showLabel = false,
      color = 'primary',
      ...props
    },
    ref
  ) => {
    const percentage = Math.min(Math.max((value / max) * 100, 0), 100);

    const sizes = {
      sm: 'h-1',
      md: 'h-2',
      lg: 'h-3',
    };

    const colors = {
      primary: 'bg-primary-500',
      secondary: 'bg-secondary-500',
      accent: 'bg-accent-500',
      success: 'bg-accent-500',
      warning: 'bg-warning-dark',
      error: 'bg-error',
    };

    if (variant === 'circular') {
      const radius = size === 'sm' ? 20 : size === 'md' ? 30 : 40;
      const circumference = 2 * Math.PI * radius;
      const offset = circumference - (percentage / 100) * circumference;

      return (
        <div className={cn('relative inline-flex items-center justify-center', className)} ref={ref} {...props}>
          <svg className="transform -rotate-90" width={radius * 2 + 20} height={radius * 2 + 20}>
            <circle
              cx={radius + 10}
              cy={radius + 10}
              r={radius}
              stroke="currentColor"
              strokeWidth="4"
              fill="none"
              className="text-neutral-200"
            />
            <circle
              cx={radius + 10}
              cy={radius + 10}
              r={radius}
              stroke="currentColor"
              strokeWidth="4"
              fill="none"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              className={cn('transition-all duration-300', colors[color])}
              strokeLinecap="round"
            />
          </svg>
          {showLabel && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-sm font-medium text-foreground">{Math.round(percentage)}%</span>
            </div>
          )}
        </div>
      );
    }

    return (
      <div className={cn('w-full', className)} ref={ref} {...props}>
        <div className={cn('w-full bg-neutral-200 rounded-full overflow-hidden', sizes[size])}>
          <div
            className={cn(
              'h-full rounded-full transition-all duration-300',
              colors[color]
            )}
            style={{ width: `${percentage}%` }}
            role="progressbar"
            aria-valuenow={value}
            aria-valuemin={0}
            aria-valuemax={max}
            aria-label={props['aria-label'] || `Progress: ${Math.round(percentage)}%`}
          />
        </div>
        {showLabel && (
          <div className="mt-1 text-sm text-muted-foreground text-right">
            {Math.round(percentage)}%
          </div>
        )}
      </div>
    );
  }
);

Progress.displayName = 'Progress';

export { Progress };
export default Progress;
