import { cn } from '../../lib/utils';

// Loading placeholder. Uses the existing .animate-shimmer utility from
// index.css; size it with h-*/w-* via className. The shimmer is rendered
// as an overlay to prevent the background shorthand from resetting bg-color.
const Skeleton = ({ className }: { className?: string }) => (
  <div
    data-testid="skeleton"
    aria-hidden="true"
    className={cn('bg-slate-100 rounded-md relative overflow-hidden', className)}
  >
    <div className="absolute inset-0 animate-shimmer" />
  </div>
);

export { Skeleton };
export default Skeleton;
