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

describe('ExpensesService.getBudgetVsActual', () => {
  const SCOPE = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'ADMIN' } as const;
  let prisma: any;
  let svc: ExpensesService;

  beforeEach(() => {
    prisma = {
      budget: { findMany: jest.fn() },
      expense: { groupBy: jest.fn() },
    };
    svc = new ExpensesService(prisma);
  });

  it('compares budget vs actual per category with variance + over-budget flag', async () => {
    prisma.budget.findMany.mockResolvedValue([
      { category: 'RENT', amount: 5000 },
      { category: 'MARKETING', amount: 1000 },
    ]);
    // actuals via summary → expense.groupBy
    prisma.expense.groupBy.mockResolvedValue([
      { category: 'RENT', _sum: { amount: 5000, taxAmount: 0 }, _count: 1 },
      { category: 'MARKETING', _sum: { amount: 1500, taxAmount: 0 }, _count: 2 }, // over budget
    ]);

    const res = await svc.getBudgetVsActual(SCOPE, 2026, 6);
    expect(res.totalBudget).toBe(6000);
    expect(res.totalActual).toBe(6500);
    expect(res.totalVariance).toBe(-500);
    const mkt = res.byCategory.find((c: any) => c.category === 'MARKETING');
    expect(mkt).toMatchObject({ budget: 1000, actual: 1500, variance: -500, overBudget: true });
    const rent = res.byCategory.find((c: any) => c.category === 'RENT');
    expect(rent).toMatchObject({ variance: 0, overBudget: false });
  });
});

describe('ExpensesService.setBudget', () => {
  it('upserts on the (tenant,branch,category,year,month) natural key with a Decimal amount', async () => {
    const prisma: any = {
      budget: { upsert: jest.fn().mockResolvedValue({ id: 'b1' }) },
    };
    const svc = new ExpensesService(prisma);
    const SCOPE = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'ADMIN' } as any;

    await svc.setBudget(SCOPE, { category: 'RENT', year: 2026, month: 7, amount: 15000 });

    const arg = prisma.budget.upsert.mock.calls[0][0];
    expect(arg.where.tenantId_branchId_category_year_month).toEqual({
      tenantId: 't1', branchId: 'b1', category: 'RENT', year: 2026, month: 7,
    });
    expect(arg.create.amount.toString()).toBe('15000');
    expect(arg.update.amount.toString()).toBe('15000');
  });
});
