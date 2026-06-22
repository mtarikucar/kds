import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { getApiErrorMessage } from '../../lib/api-error';
import i18n from '../../i18n/config';

/**
 * Partner Display API key management (tenant ADMIN, gated on the
 * `externalDisplay` plan feature).
 *
 * The `/v1/partner` prefix is tenant-wide (class-level @SkipBranchScope on the
 * backend, fenced by req.user.tenantId) and is already mirrored into
 * `TENANT_WIDE_PATH_PREFIXES` in lib/api.ts, so the shared `api` client omits
 * the X-Branch-Id header for these calls.
 */

/** Valid partner-key scopes (must mirror the backend SCOPES const). */
export const PARTNER_KEY_SCOPES = [
  'menu:read',
  'orders:write',
  'orders:read',
  'payments:write',
  'requests:write',
  'realtime:subscribe',
] as const;

export type PartnerKeyScope = (typeof PARTNER_KEY_SCOPES)[number];

export interface PartnerApiKey {
  id: string;
  keyId: string;
  name: string;
  scopes: string[];
  allowedReturnOrigins: string[];
  allowedBranchIds: string[];
  status: 'active' | 'revoked';
  lastUsedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  revokedAt: string | null;
  // Present only on the create-response (returned ONCE, never stored).
  secret?: string;
}

export interface CreatePartnerKeyInput {
  name: string;
  scopes?: string[];
  allowedReturnOrigins?: string[];
  allowedBranchIds?: string[];
}

export const partnerKeyKeys = {
  all: ['partner-keys'] as const,
};

export const useListPartnerKeys = () =>
  useQuery({
    queryKey: partnerKeyKeys.all,
    queryFn: async (): Promise<PartnerApiKey[]> => {
      const r = await api.get('/v1/partner/api-keys');
      return r.data;
    },
  });

export const useCreatePartnerKey = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreatePartnerKeyInput): Promise<PartnerApiKey> => {
      const r = await api.post('/v1/partner/api-keys', input);
      return r.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: partnerKeyKeys.all });
      toast.success(
        i18n.t('partnerKeys:toast.created', {
          defaultValue: 'API anahtarı oluşturuldu. Gizli anahtarı şimdi kaydedin — bir daha gösterilmeyecek.',
        }),
      );
    },
    onError: (e) =>
      toast.error(
        getApiErrorMessage(
          e,
          i18n.t('partnerKeys:toast.createFailed', { defaultValue: 'API anahtarı oluşturulamadı' }),
        ),
      ),
  });
};

export const useRevokePartnerKey = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await api.delete(`/v1/partner/api-keys/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: partnerKeyKeys.all });
      toast.success(
        i18n.t('partnerKeys:toast.revoked', { defaultValue: 'API anahtarı iptal edildi' }),
      );
    },
    onError: (e) =>
      toast.error(
        getApiErrorMessage(
          e,
          i18n.t('partnerKeys:toast.revokeFailed', { defaultValue: 'API anahtarı iptal edilemedi' }),
        ),
      ),
  });
};
