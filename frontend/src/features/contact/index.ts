import { useMutation } from '@tanstack/react-query';
import api from '../../lib/api';
import { ContactFormData, ContactResponse } from '../../types/contact';

export const useCreateContactMessage = () => {
  return useMutation<ContactResponse, Error, ContactFormData>({
    mutationFn: async (data: ContactFormData) => {
      const response = await api.post('/contact', data);
      return response.data;
    },
  });
};
