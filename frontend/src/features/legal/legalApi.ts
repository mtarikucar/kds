import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';

/**
 * Legal documents — KVKK, mesafeli satış, iade politikası, terms,
 * privacy. The /legal/* public pages and the checkout consent
 * checkboxes both read through here. SuperAdmin uses `usePublishLegalDocument`
 * to roll out a new version.
 */

export type LegalDocumentKind =
  | 'KVKK'
  | 'DISTANCE_SALES'
  | 'REFUND_POLICY'
  | 'TERMS_OF_SERVICE'
  | 'PRIVACY_POLICY';

export interface LegalDocument {
  id: string;
  kind: LegalDocumentKind;
  version: string;
  locale: string;
  title: string;
  bodyMarkdown: string;
  effectiveAt: string;
  isCurrent: boolean;
  createdAt: string;
  updatedAt: string;
}

export const legalKeys = {
  all: ['legal'] as const,
  current: (kind: LegalDocumentKind, locale = 'tr') =>
    [...legalKeys.all, 'current', kind, locale] as const,
  list: (kind?: LegalDocumentKind, locale?: string) =>
    [...legalKeys.all, 'list', { kind, locale }] as const,
};

/**
 * Fetch the active version of a legal document (kind). Used by:
 *   - /legal/kvkk, /legal/distance-sales, /legal/refund pages — render
 *   - CheckoutPage — read the three ids and label text for the consent
 *     checkboxes; the id is echoed back to `create-intent` so the
 *     backend can confirm the user accepted the version actually shown.
 *
 * Cache is keyed on (kind, locale). Public endpoint — no auth needed.
 */
export const useGetCurrentLegalDocument = (
  kind: LegalDocumentKind,
  locale = 'tr',
) => {
  return useQuery({
    queryKey: legalKeys.current(kind, locale),
    queryFn: async (): Promise<LegalDocument> => {
      const response = await api.get(`/legal/documents/${kind}/current`, {
        params: { locale },
      });
      return response.data;
    },
    // Legal docs change rarely. 5-minute freshness window means a user
    // browsing the site doesn't re-fetch on every navigation, but a
    // newly-published version surfaces within minutes.
    staleTime: 5 * 60 * 1000,
  });
};

// ──────────────────────────────────────────────────────────────────
// Admin (SuperAdmin) endpoints
// ──────────────────────────────────────────────────────────────────

export interface PublishLegalDocumentInput {
  kind: LegalDocumentKind;
  version: string;
  locale: string;
  title: string;
  bodyMarkdown: string;
  effectiveAt?: string;
}

export const useListLegalDocuments = (
  filters: { kind?: LegalDocumentKind; locale?: string } = {},
) => {
  return useQuery({
    queryKey: legalKeys.list(filters.kind, filters.locale),
    queryFn: async (): Promise<LegalDocument[]> => {
      const response = await api.get('/superadmin/legal/documents', {
        params: filters,
      });
      return response.data;
    },
  });
};

export const usePublishLegalDocument = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: PublishLegalDocumentInput,
    ): Promise<LegalDocument> => {
      const response = await api.post('/superadmin/legal/documents/publish', input);
      return response.data;
    },
    // After a new version lands every consumer should refetch — the
    // checkout page caches the document id and that id is now stale.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: legalKeys.all });
    },
  });
};
