import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import { getApiErrorMessage } from '../../lib/api-error';
import { toast } from 'sonner';
import i18n from '../../i18n/config';
import type { Order } from '../../types';

/**
 * Operator-driven moderation of incoming delivery-platform orders, wired to the
 * backend DeliveryPlatformsController moderation endpoints:
 *
 *   POST /delivery-platforms/orders/:orderId/accept    { prepTimeMinutes? }
 *   POST /delivery-platforms/orders/:orderId/reject     { reason }
 *   POST /delivery-platforms/orders/:orderId/prep-time  { minutes }
 *
 * These are branch-scoped routes (NOT under /delivery-platforms/dlq), so the
 * shared axios client attaches X-Branch-Id + auth automatically.
 *
 * Honesty contract (mirrors the service): the backend never advances the
 * internal order on a fabricated platform success — if the platform call
 * fails it throws, the order is untouched, and we surface the real error via
 * getApiErrorMessage. On success we invalidate the orders cache so the KDS
 * board, the admin queue and the POS pending list all re-fetch the new status.
 *
 * NOTE: this is a NEW file deliberately separate from deliveryPlatformsApi.ts
 * (config/logs/menu-sync) which another surface owns.
 */

const tt = (key: string, opts?: Record<string, unknown>) =>
  i18n.t(key, { ns: 'deliveryOrders', ...opts });

/** Invalidate every orders list (kitchen board, POS pending, admin queue). */
function useInvalidateOrders() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ['orders'], refetchType: 'all' });
    queryClient.invalidateQueries({ queryKey: ['tables'] });
  };
}

export interface AcceptDeliveryOrderVars {
  orderId: string;
  /** Optional prep time committed together with the accept ("Accept · 20 min"). */
  prepTimeMinutes?: number;
}

/**
 * Accept a PENDING_APPROVAL delivery order (optionally with a prep time).
 * Backend may return `{ alreadyAccepted: true }` when the order had already
 * moved past the approval gate — we toast a neutral message in that case
 * rather than a false "accepted just now".
 */
export const useAcceptDeliveryOrder = () => {
  const invalidate = useInvalidateOrders();
  return useMutation({
    mutationFn: async ({ orderId, prepTimeMinutes }: AcceptDeliveryOrderVars) => {
      const response = await api.post<Order & { alreadyAccepted?: boolean }>(
        `/delivery-platforms/orders/${orderId}/accept`,
        prepTimeMinutes !== undefined ? { prepTimeMinutes } : {},
      );
      return response.data;
    },
    onSuccess: (data) => {
      invalidate();
      if (data?.alreadyAccepted) {
        toast.info(tt('toast.alreadyAccepted'));
      } else {
        toast.success(tt('toast.accepted'));
      }
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, tt('toast.acceptFailed')));
    },
  });
};

export interface RejectDeliveryOrderVars {
  orderId: string;
  /** Required, sent to the platform so the customer/courier sees why. */
  reason: string;
}

/**
 * Reject a PENDING_APPROVAL / PENDING delivery order with a required reason.
 */
export const useRejectDeliveryOrder = () => {
  const invalidate = useInvalidateOrders();
  return useMutation({
    mutationFn: async ({ orderId, reason }: RejectDeliveryOrderVars) => {
      const response = await api.post<Order & { alreadyRejected?: boolean }>(
        `/delivery-platforms/orders/${orderId}/reject`,
        { reason },
      );
      return response.data;
    },
    onSuccess: (data) => {
      invalidate();
      if (data?.alreadyRejected) {
        toast.info(tt('toast.alreadyRejected'));
      } else {
        toast.success(tt('toast.rejected'));
      }
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, tt('toast.rejectFailed')));
    },
  });
};

export interface SetPrepTimeVars {
  orderId: string;
  /** Whole minutes, 1–240 (backend validates). */
  minutes: number;
}

/**
 * Set/commit the kitchen prep time for an already-accepted delivery order
 * (marks it preparing on the platform).
 */
export const useSetDeliveryPrepTime = () => {
  const invalidate = useInvalidateOrders();
  return useMutation({
    mutationFn: async ({ orderId, minutes }: SetPrepTimeVars) => {
      const response = await api.post<Order>(
        `/delivery-platforms/orders/${orderId}/prep-time`,
        { minutes },
      );
      return response.data;
    },
    onSuccess: (_data, variables) => {
      invalidate();
      toast.success(tt('toast.prepTimeSet', { minutes: variables.minutes }));
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, tt('toast.prepTimeFailed')));
    },
  });
};
