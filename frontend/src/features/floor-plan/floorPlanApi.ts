import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import i18n from '../../i18n/config';
import api from '../../lib/api';
import { useBranchScopeStore } from '../../store/branchScopeStore';
import type {
  FloorPlan,
  CreateFloorZoneDto,
  UpdateFloorZoneDto,
  CreateFloorElementDto,
  UpdateFloorElementDto,
  SaveLayoutDto,
  FloorZone,
  FloorElement,
} from '../../types';

/** Shared cache key — branch-scoped so switching branch refetches the plan. */
export const floorPlanKey = (branchId: string | null) => ['floorPlan', branchId];

const fail = (error: any) => {
  // class-validator 400s carry a string[] message; show the first line, not a
  // garbled "[object Object]" / comma-joined blob.
  const m = error?.response?.data?.message;
  toast.error(
    (Array.isArray(m) ? m[0] : m) ||
      i18n.t('common:notifications.operationFailed'),
  );
};

export const useFloorPlan = () => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery({
    queryKey: floorPlanKey(branchId),
    // /floor-plan is branch-scoped; the api interceptor rejects branch-scoped
    // requests while branchId is null (first paint / mid branch-switch). Gate
    // the query so it only fires once a branch is resolved.
    enabled: !!branchId,
    queryFn: async (): Promise<FloorPlan> => {
      const res = await api.get<FloorPlan>('/floor-plan');
      return res.data;
    },
  });
};

const useInvalidatePlan = () => {
  const queryClient = useQueryClient();
  // Invalidate the plan AND tables (a placement/geometry change is visible in
  // both the floor plan and any table list).
  return () => {
    queryClient.invalidateQueries({ queryKey: ['floorPlan'] });
    queryClient.invalidateQueries({ queryKey: ['tables'] });
  };
};

export const useCreateZone = () => {
  const invalidate = useInvalidatePlan();
  return useMutation({
    mutationFn: async (dto: CreateFloorZoneDto): Promise<FloorZone> => {
      const res = await api.post('/floor-plan/zones', dto);
      return res.data;
    },
    onSuccess: invalidate,
    onError: fail,
  });
};

export const useUpdateZone = () => {
  const invalidate = useInvalidatePlan();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: UpdateFloorZoneDto }): Promise<FloorZone> => {
      const res = await api.patch(`/floor-plan/zones/${id}`, dto);
      return res.data;
    },
    onSuccess: invalidate,
    onError: fail,
  });
};

export const useDeleteZone = () => {
  const invalidate = useInvalidatePlan();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await api.delete(`/floor-plan/zones/${id}`);
    },
    onSuccess: invalidate,
    onError: fail,
  });
};

export const useReorderZones = () => {
  const invalidate = useInvalidatePlan();
  return useMutation({
    mutationFn: async (zones: { id: string; sortOrder: number }[]): Promise<void> => {
      await api.post('/floor-plan/zones/reorder', { zones });
    },
    onSuccess: invalidate,
    onError: fail,
  });
};

export const useCreateElement = () => {
  const invalidate = useInvalidatePlan();
  return useMutation({
    mutationFn: async (dto: CreateFloorElementDto): Promise<FloorElement> => {
      const res = await api.post('/floor-plan/elements', dto);
      return res.data;
    },
    onSuccess: invalidate,
    onError: fail,
  });
};

export const useUpdateElement = () => {
  const invalidate = useInvalidatePlan();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: UpdateFloorElementDto }): Promise<FloorElement> => {
      const res = await api.patch(`/floor-plan/elements/${id}`, dto);
      return res.data;
    },
    onSuccess: invalidate,
    onError: fail,
  });
};

export const useDeleteElement = () => {
  const invalidate = useInvalidatePlan();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await api.delete(`/floor-plan/elements/${id}`);
    },
    onSuccess: invalidate,
    onError: fail,
  });
};

/** Bulk persist a full drag/resize session (the editor's Save). */
export const useSaveLayout = () => {
  const invalidate = useInvalidatePlan();
  return useMutation({
    mutationFn: async (dto: SaveLayoutDto): Promise<{ tableCount: number; elementCount: number }> => {
      const res = await api.patch('/floor-plan/layout', dto);
      return res.data;
    },
    onSuccess: () => {
      invalidate();
      toast.success(i18n.t('floorPlan:saved', 'Floor plan saved'));
    },
    onError: (error: any) => {
      fail(error);
      // The bulk save is fail-closed: a 404 means a referenced row/zone no
      // longer exists in this branch (e.g. another session deleted it), and it
      // will 404 forever on the same stale id. Refetch the plan so the page can
      // rebuild a saveable working copy instead of looping on the stale state.
      if (error?.response?.status === 404) invalidate();
    },
  });
};
