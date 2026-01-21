import React from 'react';
import { cn } from '../../lib/utils';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info';
  size?: 'sm' | 'md';
  children: React.ReactNode;
}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = 'default', size = 'md', children, ...props }, ref) => {
    const variants = {
      default: 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200/60',
      primary: 'bg-primary-50 text-primary-700 ring-1 ring-inset ring-primary-200/60',
      success: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200/60',
      warning: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200/60',
      danger: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200/60',
      info: 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200/60',
    };

    const sizes = {
      sm: 'px-2 py-0.5 text-xs',
      md: 'px-2.5 py-0.5 text-xs',
    };

    return (
      <span
        ref={ref}
        className={cn(
          'inline-flex items-center rounded-full font-medium',
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      >
        {children}
      </span>
    );
  }
);

Badge.displayName = 'Badge';

export default Badge;
