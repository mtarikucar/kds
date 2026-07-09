import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';

export const useEDocumentReadiness = () => {
  return useQuery({
    queryKey: ['accounting', 'e-document', 'readiness'],
    queryFn: async () => {
      const r = await api.get('/accounting-settings/e-document/readiness');
      return r.data as {
        mukellefQuery: string;
        signer: string;
        signerConfigured: boolean;
      };
    },
  });
};

export const useResyncFailedEDocuments = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const r = await api.post('/accounting-settings/e-document/resync-failed');
      return r.data as { retried: number };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounting'] }),
  });
};

export const useIssueCreditNote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (invoiceId: string) => {
      const r = await api.post(`/sales-invoices/${invoiceId}/credit-note`);
      return r.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sales-invoices'] }),
  });
};
