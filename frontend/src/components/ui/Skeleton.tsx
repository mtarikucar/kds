import React from 'react';
import { cn } from '../../lib/utils';

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'text' | 'circular' | 'rectangular';
  width?: string | number;
  height?: string | number;
  animation?: 'pulse' | 'wave' | 'none';
}

const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(
  (
    {
      className,
      variant = 'rectangular',
      width,
      height,
      animation = 'pulse',
      style,
      ...props
    },
    ref
  ) => {
    const baseStyles = 'bg-neutral-200 rounded';

    const variants = {
      text: 'h-4 rounded',
      circular: 'rounded-full aspect-square',
      rectangular: 'rounded',
    };

    const animations = {
      pulse: 'animate-pulse',
      wave: 'animate-shimmer',
      none: '',
    };

    const customStyle: React.CSSProperties = {
      width: width ? (typeof width === 'number' ? `${width}px` : width) : undefined,
      height: height ? (typeof height === 'number' ? `${height}px` : height) : undefined,
      ...style,
    };

    return (
      <div
        ref={ref}
        className={cn(
          baseStyles,
          variants[variant],
          animations[animation],
          className
        )}
        style={customStyle}
        aria-hidden="true"
        {...props}
      />
    );
  }
);

Skeleton.displayName = 'Skeleton';

// Pre-built skeleton components
interface SkeletonTextProps extends Omit<SkeletonProps, 'variant'> {
  lines?: number;
  lineHeight?: string;
}

const SkeletonText: React.FC<SkeletonTextProps> = ({
  lines = 3,
  lineHeight = '1rem',
  className,
  ...props
}) => {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton
          key={index}
          variant="text"
          style={{
            width: index === lines - 1 ? '75%' : '100%',
            height: lineHeight,
          }}
          {...props}
        />
      ))}
    </div>
  );
};

interface SkeletonCardProps extends Omit<SkeletonProps, 'variant'> {
  showImage?: boolean;
  showTitle?: boolean;
  showDescription?: boolean;
  showActions?: boolean;
}

const SkeletonCard: React.FC<SkeletonCardProps> = ({
  showImage = true,
  showTitle = true,
  showDescription = true,
  showActions = true,
  className,
  ...props
}) => {
  return (
    <div className={cn('p-6 space-y-4', className)}>
      {showImage && <Skeleton variant="rectangular" height="200px" className="w-full" />}
      {showTitle && <Skeleton variant="text" width="60%" height="1.5rem" />}
      {showDescription && <SkeletonText lines={2} />}
      {showActions && (
        <div className="flex gap-2">
          <Skeleton variant="rectangular" width="80px" height="2.5rem" />
          <Skeleton variant="rectangular" width="80px" height="2.5rem" />
        </div>
      )}
    </div>
  );
};

interface SkeletonTableProps extends Omit<SkeletonProps, 'variant'> {
  rows?: number;
  columns?: number;
}

const SkeletonTable: React.FC<SkeletonTableProps> = ({
  rows = 5,
  columns = 4,
  className,
  ...props
}) => {
  return (
    <div className={cn('space-y-2', className)}>
      {/* Header */}
      <div className="flex gap-4">
        {Array.from({ length: columns }).map((_, index) => (
          <Skeleton key={index} variant="text" width="100%" height="1rem" />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex gap-4">
          {Array.from({ length: columns }).map((_, colIndex) => (
            <Skeleton
              key={colIndex}
              variant="text"
              width="100%"
              height="1rem"
              {...props}
            />
          ))}
        </div>
      ))}
    </div>
  );
};

export { Skeleton, SkeletonText, SkeletonCard, SkeletonTable };
export default Skeleton;
