/**
 * Visual placeholder for a loading PlanCard. Same outer dimensions as
 * the real card so the grid doesn't shift on data arrival. Used by
 * `SubscriptionPlansPage` and `ChangePlanPage` while plans load.
 */
const PlanCardSkeleton = () => (
  <div className="relative bg-white rounded-2xl p-6 shadow-sm border border-slate-200 flex flex-col h-full animate-pulse">
    <div className="mb-4">
      <div className="h-6 w-2/3 bg-slate-200 rounded mb-2" />
      <div className="h-4 w-3/4 bg-slate-100 rounded" />
    </div>
    <div className="mb-6">
      <div className="flex items-baseline gap-2">
        <div className="h-10 w-24 bg-slate-200 rounded" />
        <div className="h-4 w-12 bg-slate-100 rounded" />
      </div>
      <div className="h-4 w-32 bg-emerald-100 rounded mt-2" />
    </div>
    <div className="mb-6 flex-grow space-y-3">
      <div className="h-4 w-1/2 bg-slate-200 rounded" />
      <div className="h-3 w-3/4 bg-slate-100 rounded" />
      <div className="h-3 w-2/3 bg-slate-100 rounded" />
      <div className="h-3 w-3/4 bg-slate-100 rounded" />
      <div className="h-3 w-1/2 bg-slate-100 rounded" />
    </div>
    <div className="h-10 w-full bg-slate-200 rounded" />
  </div>
);

export default PlanCardSkeleton;
