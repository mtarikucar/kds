import React from 'react';
import { useTranslation } from 'react-i18next';
import { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'success' | 'outline' | 'ghost' | 'link' | 'icon';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  icon?: LucideIcon;
  iconPosition?: 'left' | 'right';
  'aria-label'?: string;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'md',
      isLoading = false,
      disabled,
      children,
      icon: Icon,
      iconPosition = 'left',
      'aria-label': ariaLabel,
      ...props
    },
    ref
  ) => {
    const { t } = useTranslation('common');
    
    const baseStyles =
      'inline-flex items-center justify-center rounded-lg font-medium transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]';

    const variants = {
      primary:
        'bg-primary-500 text-primary-foreground hover:bg-primary-600 focus:ring-primary-500 shadow-md hover:shadow-lg',
      secondary:
        'bg-secondary-500 text-secondary-foreground hover:bg-secondary-600 focus:ring-secondary-500 shadow-md hover:shadow-lg',
      danger:
        'bg-error text-white hover:bg-error-dark focus:ring-error shadow-md hover:shadow-lg',
      success:
        'bg-accent-500 text-accent-foreground hover:bg-accent-600 focus:ring-accent-500 shadow-md hover:shadow-lg',
      outline:
        'border-2 border-primary-500 bg-transparent text-primary-500 hover:bg-primary-50 focus:ring-primary-500',
      ghost:
        'bg-transparent text-foreground hover:bg-neutral-100 focus:ring-neutral-500',
      link:
        'bg-transparent text-primary-500 hover:text-primary-600 underline-offset-4 hover:underline focus:ring-primary-500 p-0 h-auto',
      icon:
        'bg-transparent text-foreground hover:bg-neutral-100 focus:ring-neutral-500 p-0 aspect-square',
    };

    const sizes = {
      sm: variant === 'icon' ? 'h-8 w-8' : variant === 'link' ? 'text-sm' : 'px-3 py-1.5 text-sm',
      md: variant === 'icon' ? 'h-10 w-10' : variant === 'link' ? 'text-base' : 'px-4 py-2 text-base',
      lg: variant === 'icon' ? 'h-12 w-12' : variant === 'link' ? 'text-lg' : 'px-6 py-3 text-lg',
    };

    const spinnerSizes = {
      sm: 'h-3 w-3',
      md: 'h-4 w-4',
      lg: 'h-5 w-5',
    };

    const iconSizes = {
      sm: 'h-4 w-4',
      md: 'h-5 w-5',
      lg: 'h-6 w-6',
    };

    const renderContent = () => {
      if (isLoading) {
        return (
          <>
            <svg
              className={cn('animate-spin', spinnerSizes[size], iconPosition === 'left' ? 'mr-2' : 'ml-2')}
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
            {variant !== 'icon' && <span>{t('app.loading')}</span>}
          </>
        );
      }

      if (variant === 'icon' && Icon) {
        return <Icon className={iconSizes[size]} aria-hidden="true" />;
      }

      if (Icon && children) {
        const iconElement = <Icon className={iconSizes[size]} aria-hidden="true" />;
        return (
          <>
            {iconPosition === 'left' && iconElement}
            <span>{children}</span>
            {iconPosition === 'right' && iconElement}
          </>
        );
      }

      if (Icon && !children) {
        return <Icon className={iconSizes[size]} aria-hidden="true" />;
      }

      return children;
    };

    return (
      <button
        ref={ref}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        disabled={disabled || isLoading}
        aria-label={ariaLabel || (variant === 'icon' && !children ? props['aria-label'] : undefined)}
        aria-busy={isLoading}
        {...props}
      >
        {renderContent()}
      </button>
    );
  }
);

Button.displayName = 'Button';

export { Button };
export default Button;
