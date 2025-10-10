import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';

export interface PublicTenant {
  id: string;
  name: string;
  subdomain: string | null;
}

export const useGetPublicTenants = () => {
  return useQuery({
    queryKey: ['tenants', 'public'],
    queryFn: async (): Promise<PublicTenant[]> => {
      const response = await api.get('/tenants/public');
      return response.data;
    },
  });
};
