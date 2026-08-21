import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import i18n from '../../../i18n/config';
import { getApiErrorMessage } from '../../../lib/api-error';
import { superAdminApi as api } from './superAdminApi';

export interface SaPrint3dJobItem {
  id: string;
  productName: string;
  productImageUrl: string | null;
  model3dUrl: string | null;
  position: number;
  status: string;
  opsNote: string | null;
}

export interface SaPrint3dShipment {
  id: string;
  carrier: string;
  trackingNo: string | null;
  status: string;
  deliveredAt: string | null;
}

export interface SaPrint3dJob {
  id: string;
  tenantId: string;
  /** Print3dJob has no tenant relation; the server joins the name separately. */
  tenantName: string | null;
  status: string;
  partner: string;
  partnerRef: string | null;
  itemCount: number;
  totalCents: number;
  currency: string;
  note: string | null;
  createdAt: string;
  hwOrderId: string;
  items: SaPrint3dJobItem[];
  /**
   * ONLY populated on the single-job endpoint (`GET /jobs/:id`) — the queue
   * list doesn't need to carry every tenant's delivery address on one
   * screen.
   */
  hwOrder?: {
    id: string;
    status: string;
    shippingAddress: Record<string, unknown> | string | null;
    shipments: SaPrint3dShipment[];
  } | null;
}

export const saPrint3dKeys = {
  jobs: (status?: string) => ['sa', 'print3d', 'jobs', status ?? 'all'] as const,
  job: (id: string) => ['sa', 'print3d', 'job', id] as const,
};

export const useSaListPrint3dJobs = (filters: { status?: string } = {}) =>
  useQuery({
    queryKey: saPrint3dKeys.jobs(filters.status),
    queryFn: async (): Promise<SaPrint3dJob[]> => {
      const r = await api.get('/v1/superadmin/print3d/jobs', { params: filters });
      return r.data;
    },
  });

export const useSaGetPrint3dJob = (id?: string) =>
  useQuery({
    queryKey: saPrint3dKeys.job(id ?? ''),
    enabled: !!id,
    queryFn: async (): Promise<SaPrint3dJob> => {
      const r = await api.get(`/v1/superadmin/print3d/jobs/${id}`);
      return r.data;
    },
  });

export const useSaUpdatePrint3dJobStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...body
    }: {
      id: string;
      status: string;
      partnerRef?: string;
      opsNote?: string;
    }) => {
      const r = await api.patch(`/v1/superadmin/print3d/jobs/${id}/status`, body);
      return r.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sa', 'print3d'] }),
    onError: (e) => toast.error(getApiErrorMessage(e, i18n.t('common:notifications.operationFailed'))),
  });
};

export const useSaUpdatePrint3dJobItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      jobId,
      itemId,
      ...body
    }: {
      jobId: string;
      itemId: string;
      status: string;
      opsNote?: string;
    }) => {
      const r = await api.patch(
        `/v1/superadmin/print3d/jobs/${jobId}/items/${itemId}`,
        body,
      );
      return r.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sa', 'print3d'] }),
    onError: (e) => toast.error(getApiErrorMessage(e, i18n.t('common:notifications.operationFailed'))),
  });
};

/**
 * No NEW backend endpoint for shipping — this reuses the existing
 * superadmin/shipments rail. This panel is that rail's first SPA surface.
 */
export const useSaCreateShipment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      orderId,
      carrier,
      trackingNo,
    }: {
      orderId: string;
      carrier: string;
      trackingNo?: string;
    }) => {
      const r = await api.post(`/v1/superadmin/shipments/${orderId}`, {
        carrier,
        trackingNo,
      });
      return r.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sa', 'print3d'] }),
    onError: (e) => toast.error(getApiErrorMessage(e, i18n.t('common:notifications.operationFailed'))),
  });
};

export const useSaMarkShipmentDelivered = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (shipmentId: string) => {
      const r = await api.patch(`/v1/superadmin/shipments/${shipmentId}/delivered`);
      return r.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sa', 'print3d'] }),
    onError: (e) => toast.error(getApiErrorMessage(e, i18n.t('common:notifications.operationFailed'))),
  });
};
