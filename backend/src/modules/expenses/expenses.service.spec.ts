import { ExpensesService } from './expenses.service';

describe('ExpensesService', () => {
  const SCOPE = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'ADMIN' } as const;
  let prisma: any;
  let svc: ExpensesService;

  beforeEach(() => {
    prisma = {
      expense: {
        create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'e1', ...data })),
        groupBy: jest.fn(),
      },
    };
    svc = new ExpensesService(prisma);
  });

  it('records an expense with amount + optional tax', async () => {
    const e = await svc.create(SCOPE, 'u1', {
      category: 'RENT', description: 'June rent', amount: 5000, taxAmount: 900, expenseDate: '2026-06-01',
    });
    expect(e.category).toBe('RENT');
    expect(Number(e.amount)).toBe(5000);
    expect(Number(e.taxAmount)).toBe(900);
    expect(e.tenantId).toBe('t1');
    expect(e.branchId).toBe('b1');
  });

  it('summarises totals + per-category breakdown, sorted desc', async () => {
    prisma.expense.groupBy.mockResolvedValue([
      { category: 'RENT', _sum: { amount: 5000, taxAmount: 0 }, _count: 1 },
      { category: 'SALARY', _sum: { amount: 12000, taxAmount: 0 }, _count: 3 },
    ]);
    const res = await svc.summary('t1');
    expect(res.total).toBe(17000);
    expect(res.byCategory[0]).toMatchObject({ category: 'SALARY', amount: 12000, count: 3 });
    expect(res.byCategory[1]).toMatchObject({ category: 'RENT', amount: 5000 });
  });
});
