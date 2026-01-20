import React from 'react';
import { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'outline' | 'dot';
  size?: 'sm' | 'md' | 'lg';
  icon?: LucideIcon;
  iconPosition?: 'left' | 'right';
  pulse?: boolean;
  children?: React.ReactNode;
}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  (
    {
      className,
      variant = 'default',
      size = 'md',
      icon: Icon,
      iconPosition = 'left',
      pulse = false,
      children,
      ...props
    },
    ref
  ) => {
    const variants = {
      default: 'bg-neutral-100 text-neutral-800',
      primary: 'bg-primary-100 text-primary-800',
      success: 'bg-accent-100 text-accent-800',
      warning: 'bg-warning-light text-warning-dark',
      danger: 'bg-error-light text-error-dark',
      info: 'bg-info-light text-info-dark',
      outline: 'border-2 border-current bg-transparent',
      dot: 'bg-transparent p-0',
    };

    const sizes = {
      sm: variant === 'dot' ? 'h-2 w-2' : 'px-2 py-0.5 text-xs',
      md: variant === 'dot' ? 'h-2.5 w-2.5' : 'px-2.5 py-0.5 text-xs',
      lg: variant === 'dot' ? 'h-3 w-3' : 'px-3 py-1 text-sm',
    };

    const iconSizes = {
      sm: 'h-3 w-3',
      md: 'h-3.5 w-3.5',
      lg: 'h-4 w-4',
    };

    if (variant === 'dot') {
      const dotColors = {
        default: 'bg-neutral-500',
        primary: 'bg-primary-500',
        success: 'bg-accent-500',
        warning: 'bg-warning-dark',
        danger: 'bg-error',
        info: 'bg-info-dark',
        outline: 'bg-current',
        dot: 'bg-current',
      };

      return (
        <span
          ref={ref}
          className={cn(
            'inline-block rounded-full',
            sizes[size],
            dotColors[variant] || dotColors.default,
            pulse && 'animate-pulse',
            className
          )}
          aria-label={props['aria-label'] || 'Badge'}
          {...props}
        />
      );
    }

    return (
      <span
        ref={ref}
        className={cn(
          'inline-flex items-center gap-1 rounded-full font-medium transition-all duration-150',
          sizes[size],
          variants[variant],
          pulse && 'animate-pulse',
          className
        )}
        {...props}
      >
        {Icon && iconPosition === 'left' && (
          <Icon className={iconSizes[size]} aria-hidden="true" />
        )}
        {children && <span>{children}</span>}
        {Icon && iconPosition === 'right' && (
          <Icon className={iconSizes[size]} aria-hidden="true" />
        )}
      </span>
    );
  }
);

Badge.displayName = 'Badge';

export default Badge;
