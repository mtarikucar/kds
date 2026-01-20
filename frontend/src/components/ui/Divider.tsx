import React from 'react';
import { cn } from '../../lib/utils';

interface DividerProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: 'horizontal' | 'vertical';
  text?: string;
  textPosition?: 'left' | 'center' | 'right';
}

const Divider = React.forwardRef<HTMLDivElement, DividerProps>(
  ({ className, orientation = 'horizontal', text, textPosition = 'center', ...props }, ref) => {
    if (orientation === 'vertical') {
      return (
        <div
          ref={ref}
          className={cn('w-px h-full bg-border', className)}
          role="separator"
          aria-orientation="vertical"
          {...props}
        />
      );
    }

    if (text) {
      return (
        <div
          ref={ref}
          className={cn('flex items-center gap-3 my-4', className)}
          role="separator"
          aria-orientation="horizontal"
          {...props}
        >
          <div
            className={cn('flex-1 h-px bg-border', textPosition === 'left' && 'hidden')}
          />
          <span className="text-sm text-muted-foreground whitespace-nowrap">{text}</span>
          <div
            className={cn('flex-1 h-px bg-border', textPosition === 'right' && 'hidden')}
          />
        </div>
      );
    }

    return (
      <div
        ref={ref}
        className={cn('w-full h-px bg-border my-4', className)}
        role="separator"
        aria-orientation="horizontal"
        {...props}
      />
    );
  }
);

Divider.displayName = 'Divider';

export { Divider };
export default Divider;
