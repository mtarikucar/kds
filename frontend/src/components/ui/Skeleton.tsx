import { cn } from '../../lib/utils';

// Loading placeholder. Uses the existing .animate-shimmer utility from
// index.css; size it with h-*/w-* via className.
const Skeleton = ({ className }: { className?: string }) => (
  <div
    data-testid="skeleton"
    aria-hidden="true"
    className={cn('animate-shimmer bg-slate-100 rounded-md', className)}
  />
);

export { Skeleton };
export default Skeleton;
