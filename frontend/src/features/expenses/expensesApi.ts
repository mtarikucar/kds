import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import { useBranchScopeStore } from '../../store/branchScopeStore';

export const EXPENSE_CATEGORIES = [
  'RENT',
  'SALARY',
  'UTILITIES',
  'SUPPLIES',
  'MAINTENANCE',
  'MARKETING',
  'TAX',
  'OTHER',
] as const;

export interface Expense {
  id: string;
  category: string;
  description: string;
  amount: number;
  taxAmount?: number | null;
  expenseDate: string;
  createdAt: string;
}

export interface CreateExpenseInput {
  category: string;
  description: string;
  amount: number;
  taxAmount?: number;
  expenseDate: string;
  notes?: string;
}

export const useExpenses = (params?: {
  category?: string;
  startDate?: string;
  endDate?: string;
}) => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery({
    queryKey: ['expenses', params, branchId],
    queryFn: async (): Promise<Expense[]> => {
      const response = await api.get('/expenses', { params });
      return response.data;
    },
  });
};

export const useExpenseSummary = (params?: {
  startDate?: string;
  endDate?: string;
}) => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery({
    queryKey: ['expenses', 'summary', params, branchId],
    queryFn: async () => {
      const response = await api.get('/expenses/summary', { params });
      return response.data;
    },
  });
};

export const useCreateExpense = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateExpenseInput): Promise<Expense> => {
      const response = await api.post('/expenses', input);
      return response.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expenses'] }),
  });
};

export type UpdateExpenseInput = Partial<CreateExpenseInput> & { id: string };

/**
 * PATCH /expenses/:id — edit a recorded expense in place.
 * NOTE: the backend endpoint ships in a separate expenses PR; this hook (and
 * the row-edit UI it powers) must be merged only after that PR lands.
 */
export const useUpdateExpense = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: UpdateExpenseInput): Promise<Expense> => {
      const response = await api.patch(`/expenses/${id}`, input);
      return response.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expenses'] }),
  });
};

export const useDeleteExpense = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/expenses/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expenses'] }),
  });
};

export const useBudgetVsActual = (year: number, month: number) => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery({
    queryKey: ['expenses', 'budget-vs-actual', year, month, branchId],
    queryFn: async () => {
      const response = await api.get('/expenses/budget-vs-actual', {
        params: { year, month },
      });
      return response.data;
    },
    enabled: !!year && !!month,
  });
};

export const useSetBudget = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      category: string;
      year: number;
      month: number;
      amount: number;
    }) => {
      const response = await api.post('/expenses/budget', input);
      return response.data;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['expenses', 'budget-vs-actual'] }),
  });
};
