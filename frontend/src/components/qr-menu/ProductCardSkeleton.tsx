import React from 'react';
import Skeleton from './ui/Skeleton';
import { cn } from '../../lib/utils';

interface ProductCardSkeletonProps {
  count?: number;
  layoutStyle?: 'GRID' | 'LIST' | 'COMPACT';
  showImages?: boolean;
  itemsPerRow?: number;
}

const ProductCardSkeleton: React.FC<ProductCardSkeletonProps> = ({
  count = 6,
  layoutStyle = 'GRID',
  showImages = true,
  itemsPerRow = 2,
}) => {
  const gridClasses =
    layoutStyle === 'LIST'
      ? 'flex flex-col gap-3'
      : itemsPerRow === 1
        ? 'grid grid-cols-1 gap-3 sm:gap-4'
        : itemsPerRow === 3
          ? 'grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4'
          : 'grid grid-cols-2 gap-3 sm:gap-4';

  return (
    <div className={gridClasses}>
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className={cn(
            'bg-white rounded-2xl shadow-md overflow-hidden',
            layoutStyle === 'LIST' ? 'flex flex-row' : 'flex flex-col'
          )}
          style={{ animationDelay: `${index * 50}ms` }}
        >
          {/* Image Skeleton */}
          {showImages && (
            <div
              className={cn(
                'bg-slate-200 flex-shrink-0 relative overflow-hidden',
                layoutStyle === 'LIST' ? 'w-24 h-24 sm:w-32 sm:h-32' : 'h-32 sm:h-40 w-full'
              )}
            >
              <Skeleton className="w-full h-full" animation="wave" />
            </div>
          )}

          {/* Content Skeleton */}
          <div className={cn('p-3 sm:p-4 flex-1', layoutStyle === 'LIST' ? 'flex flex-col justify-center' : '')}>
            {/* Title */}
            <Skeleton className="h-4 w-3/4 mb-2" variant="rounded" />

            {/* Description */}
            <Skeleton className="h-3 w-full mb-1" variant="rounded" />
            <Skeleton className="h-3 w-2/3 mb-3" variant="rounded" />

            {/* Price and Button */}
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-16" variant="rounded" />
              <Skeleton className="h-9 w-9" variant="circular" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default ProductCardSkeleton;
