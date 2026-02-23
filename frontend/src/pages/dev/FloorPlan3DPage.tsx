import { lazy, Suspense } from 'react';
import { Box } from 'lucide-react';
import { useTables } from '../../features/tables/tablesApi';
import { useAuthStore } from '../../store/authStore';
import Spinner from '../../components/ui/Spinner';

const VoxelWorldView = lazy(() =>
  import('../../features/voxel-world').then((mod) => ({
    default: mod.VoxelWorldView,
  }))
);

const FloorPlan3DPage = () => {
  const user = useAuthStore((state) => state.user);
  const { data: tables, isLoading } = useTables();

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-4">
      <div className="flex flex-shrink-0 items-center justify-between">
        <div>
          <h1 className="text-lg font-heading font-bold text-slate-900">
            Floor Plan 3D
          </h1>
          <p className="text-xs text-amber-600 font-medium">DEV ONLY</p>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center rounded-lg border border-slate-200 bg-slate-50">
              <div className="flex flex-col items-center gap-3">
                <Box className="h-12 w-12 animate-pulse text-primary" />
                <span className="text-sm text-slate-500">Loading 3D View...</span>
              </div>
            </div>
          }
        >
          <VoxelWorldView
            tables={tables ?? []}
            tenantId={user?.tenantId ?? undefined}
            onTableClick={() => {}}
          />
        </Suspense>
      </div>
    </div>
  );
};

export default FloorPlan3DPage;
