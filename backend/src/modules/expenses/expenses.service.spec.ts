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
      expensePeriodLock: {
        findUnique: jest.fn().mockResolvedValue(null),
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

describe('ExpensesService.update', () => {
  const SCOPE = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'ADMIN' } as const;
  let prisma: any;
  let svc: ExpensesService;

  beforeEach(() => {
    prisma = {
      expense: {
        findFirst: jest.fn().mockResolvedValue({ expenseDate: new Date('2026-06-01T00:00:00Z') }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ id: 'e1', description: 'updated' }),
      },
      expensePeriodLock: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    svc = new ExpensesService(prisma);
  });

  it('updates via a branch-scoped compound WHERE on BOTH the pre-read and the mutation (IDOR guard)', async () => {
    const res = await svc.update(SCOPE, 'e1', { description: 'updated', amount: 250.5 });

    expect(prisma.expense.findFirst.mock.calls[0][0].where).toMatchObject({
      id: 'e1', tenantId: 't1', branchId: 'b1',
    });
    const arg = prisma.expense.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'e1', tenantId: 't1', branchId: 'b1' });
    expect(arg.data.description).toBe('updated');
    expect(arg.data.amount.toString()).toBe('250.5');
    expect(res).toMatchObject({ id: 'e1' });
  });

  it('only writes the provided fields (partial update)', async () => {
    await svc.update(SCOPE, 'e1', { notes: 'n' });
    const { data } = prisma.expense.updateMany.mock.calls[0][0];
    expect(Object.keys(data)).toEqual(['notes']);
  });

  it('404s when the id belongs to another tenant/branch (pre-read misses)', async () => {
    prisma.expense.findFirst.mockResolvedValue(null);
    await expect(svc.update(SCOPE, 'foreign', { amount: 1 })).rejects.toThrow('Expense not found');
    expect(prisma.expense.updateMany).not.toHaveBeenCalled();
  });

  it('404s when the compound-WHERE mutation claims nothing (pre-read race)', async () => {
    prisma.expense.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.update(SCOPE, 'e1', { amount: 1 })).rejects.toThrow('Expense not found');
  });

  it("400s 'Dönem kilitli' when the record's current month is locked", async () => {
    prisma.expensePeriodLock.findUnique.mockResolvedValue({ id: 'lock1' });
    await expect(svc.update(SCOPE, 'e1', { amount: 1 })).rejects.toThrow('Dönem kilitli');
    expect(prisma.expense.updateMany).not.toHaveBeenCalled();
    // lock lookup keyed on the tenant + the existing record's UTC month
    expect(prisma.expensePeriodLock.findUnique.mock.calls[0][0].where).toEqual({
      tenantId_year_month: { tenantId: 't1', year: 2026, month: 6 },
    });
  });

  it("400s 'Dönem kilitli' when the expense is being MOVED INTO a locked month", async () => {
    // current month (June) open, target month (May) locked
    prisma.expensePeriodLock.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'lock-may' });
    await expect(
      svc.update(SCOPE, 'e1', { expenseDate: '2026-05-15' }),
    ).rejects.toThrow('Dönem kilitli');
    expect(prisma.expense.updateMany).not.toHaveBeenCalled();
    expect(prisma.expensePeriodLock.findUnique.mock.calls[1][0].where).toEqual({
      tenantId_year_month: { tenantId: 't1', year: 2026, month: 5 },
    });
  });
});

describe('ExpensesService create/remove period-lock enforcement', () => {
  const SCOPE = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'ADMIN' } as const;

  it("create 400s 'Dönem kilitli' when the expense date falls in a locked month", async () => {
    const prisma: any = {
      expense: { create: jest.fn() },
      expensePeriodLock: { findUnique: jest.fn().mockResolvedValue({ id: 'lock1' }) },
    };
    const svc = new ExpensesService(prisma);
    await expect(
      svc.create(SCOPE, 'u1', {
        category: 'RENT', description: 'June rent', amount: 5000, expenseDate: '2026-06-01',
      }),
    ).rejects.toThrow('Dönem kilitli');
    expect(prisma.expense.create).not.toHaveBeenCalled();
  });

  it("remove 400s 'Dönem kilitli' for a record inside a locked month (nothing deleted)", async () => {
    const prisma: any = {
      expense: {
        findFirst: jest.fn().mockResolvedValue({ expenseDate: new Date('2026-06-10T00:00:00Z') }),
        deleteMany: jest.fn(),
      },
      expensePeriodLock: { findUnique: jest.fn().mockResolvedValue({ id: 'lock1' }) },
    };
    const svc = new ExpensesService(prisma);
    await expect(svc.remove(SCOPE, 'e1')).rejects.toThrow('Dönem kilitli');
    expect(prisma.expense.deleteMany).not.toHaveBeenCalled();
  });

  it('remove still deletes through the branch-scoped compound WHERE when the month is open', async () => {
    const prisma: any = {
      expense: {
        findFirst: jest.fn().mockResolvedValue({ expenseDate: new Date('2026-06-10T00:00:00Z') }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      expensePeriodLock: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const svc = new ExpensesService(prisma);
    await expect(svc.remove(SCOPE, 'e1')).resolves.toEqual({ id: 'e1' });
    expect(prisma.expense.deleteMany.mock.calls[0][0].where).toEqual({
      id: 'e1', tenantId: 't1', branchId: 'b1',
    });
  });

  it('remove 404s for a cross-branch id without touching the period-lock table', async () => {
    const prisma: any = {
      expense: {
        findFirst: jest.fn().mockResolvedValue(null),
        deleteMany: jest.fn(),
      },
      expensePeriodLock: { findUnique: jest.fn() },
    };
    const svc = new ExpensesService(prisma);
    await expect(svc.remove(SCOPE, 'foreign')).rejects.toThrow('Expense not found');
    expect(prisma.expensePeriodLock.findUnique).not.toHaveBeenCalled();
    expect(prisma.expense.deleteMany).not.toHaveBeenCalled();
  });
});

describe('ExpensesService period-lock CRUD', () => {
  const SCOPE = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'ADMIN' } as const;

  it('lockPeriod upserts on the (tenant, year, month) natural key recording who locked', async () => {
    const prisma: any = {
      expensePeriodLock: { upsert: jest.fn().mockResolvedValue({ id: 'lock1' }) },
    };
    const svc = new ExpensesService(prisma);
    await svc.lockPeriod(SCOPE, { year: 2026, month: 6 });

    const arg = prisma.expensePeriodLock.upsert.mock.calls[0][0];
    expect(arg.where.tenantId_year_month).toEqual({ tenantId: 't1', year: 2026, month: 6 });
    expect(arg.create).toMatchObject({ tenantId: 't1', year: 2026, month: 6, lockedByUserId: 'u1' });
    // idempotent re-lock: no fields are rewritten on conflict
    expect(arg.update).toEqual({});
  });

  it('unlockPeriod deletes tenant-scoped and 404s when no lock exists', async () => {
    const prisma: any = {
      expensePeriodLock: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const svc = new ExpensesService(prisma);
    await expect(svc.unlockPeriod(SCOPE, 2026, 6)).resolves.toEqual({ year: 2026, month: 6 });
    expect(prisma.expensePeriodLock.deleteMany.mock.calls[0][0].where).toEqual({
      tenantId: 't1', year: 2026, month: 6,
    });

    prisma.expensePeriodLock.deleteMany.mockResolvedValue({ count: 0 });
    await expect(svc.unlockPeriod(SCOPE, 2026, 7)).rejects.toThrow('Period lock not found');
  });

  it('listPeriodLocks lists only this tenant, newest first', async () => {
    const prisma: any = {
      expensePeriodLock: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = new ExpensesService(prisma);
    await svc.listPeriodLocks(SCOPE);
    const arg = prisma.expensePeriodLock.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ tenantId: 't1' });
    expect(arg.orderBy).toEqual([{ year: 'desc' }, { month: 'desc' }]);
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
