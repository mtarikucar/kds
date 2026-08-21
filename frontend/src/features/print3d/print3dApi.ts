import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

export interface Print3dOffer {
  /** false ise mağaza kartı hiç basılmaz (katalog satırı yayında değil). */
  available: boolean;
  basePriceCents: number;
  perItemCents: number;
  currency: string;
  minItems: number;
  maxItems: number;
  partnerName: string;
  /** Sunucu yalnızca http(s) şemasını yayınlar; aksi hâlde null. */
  partnerUrl: string | null;
}

export interface Print3dJobItem {
  id: string;
  productName: string;
  productImageUrl: string | null;
  model3dUrl: string | null;
  position: number;
  status: string;
}

export interface Print3dJob {
  id: string;
  status: string;
  itemCount: number;
  totalCents: number;
  currency: string;
  partner: string;
  partnerRef: string | null;
  createdAt: string;
  items: Print3dJobItem[];
}

export const print3dKeys = {
  offer: () => ['print3d', 'offer'] as const,
  jobs: () => ['print3d', 'jobs'] as const,
  job: (id: string) => ['print3d', 'job', id] as const,
};

export const useGetPrint3dOffer = () =>
  useQuery({
    queryKey: print3dKeys.offer(),
    queryFn: async (): Promise<Print3dOffer> => {
      const r = await api.get('/v1/print3d/offer');
      return r.data;
    },
    // Fiyat katalogdan geliyor ve nadiren değişiyor; her mağaza açılışında
    // yeniden çekmek gereksiz.
    staleTime: 5 * 60 * 1000,
  });

export const useListPrint3dJobs = () =>
  useQuery({
    queryKey: print3dKeys.jobs(),
    queryFn: async (): Promise<Print3dJob[]> => {
      const r = await api.get('/v1/print3d/jobs');
      return r.data;
    },
  });

export const useGetPrint3dJob = (id?: string) =>
  useQuery({
    queryKey: print3dKeys.job(id ?? ''),
    enabled: !!id,
    queryFn: async (): Promise<Print3dJob> => {
      const r = await api.get(`/v1/print3d/jobs/${id}`);
      return r.data;
    },
  });
