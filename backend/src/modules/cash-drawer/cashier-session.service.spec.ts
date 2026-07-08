import {
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CashierSessionService } from './cashier-session.service';

/**
 * Cashier shift lifecycle + EOD reconciliation. expected = openingFloat +
 * cash sales + cash-in − cash-out over the shift; over/short = counted −
 * expected, where counted is derived from the physical denomination count.
 */
describe('CashierSessionService', () => {
  const SCOPE = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'ADMIN' } as const;
  let prisma: any;
  let svc: CashierSessionService;

  beforeEach(() => {
    prisma = {
      cashierSession: {
        findFirst: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'sess-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ id: 'sess-1', status: 'CLOSED' }),
      },
      payment: { aggregate: jest.fn() },
      cashDrawerMovement: { groupBy: jest.fn() },
    };
    // open() runs its check-then-create inside a Serializable transaction;
    // pass the same mock through as the tx client.
    prisma.$transaction = jest
      .fn()
      .mockImplementation(async (cb: any) =>
        typeof cb === 'function' ? cb(prisma) : cb,
      );
    svc = new CashierSessionService(prisma);
  });

  it('opens a session when the cashier has none open', async () => {
    prisma.cashierSession.findFirst.mockResolvedValue(null);
    await svc.open(SCOPE, 'cashier-9', 500);
    const data = prisma.cashierSession.create.mock.calls[0][0].data;
    expect(data.userId).toBe('cashier-9');
    expect(Number(data.openingFloat)).toBe(500);
    expect(data.status).toBe('OPEN');
  });

  it('rejects opening a second session for a cashier who already has one open', async () => {
    prisma.cashierSession.findFirst.mockResolvedValue({ id: 'already-open' });
    await expect(svc.open(SCOPE, 'cashier-9', 500)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.cashierSession.create).not.toHaveBeenCalled();
  });

  it('opens inside a Serializable txn and maps a serialization abort (P2034) to Conflict', async () => {
    // Two concurrent opens both pass the findFirst check; Postgres SSI aborts
    // the loser with 40001 → Prisma P2034 → the same "already open" Conflict.
    const p2034 = new Prisma.PrismaClientKnownRequestError('write conflict', {
      code: 'P2034',
      clientVersion: 'test',
    });
    prisma.$transaction.mockRejectedValueOnce(p2034);
    await expect(svc.open(SCOPE, 'cashier-9', 500)).rejects.toBeInstanceOf(
      ConflictException,
    );
    // and the guard genuinely runs under Serializable
    prisma.cashierSession.findFirst.mockResolvedValue(null);
    await svc.open(SCOPE, 'cashier-9', 500);
    expect(prisma.$transaction.mock.calls[1][1]).toEqual({
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it('closes with expected = float + sales + in − out, counted from denominations, over/short = diff', async () => {
    prisma.cashierSession.findFirst.mockResolvedValue({
      id: 'sess-1', status: 'OPEN', openingFloat: 500, openedAt: new Date('2026-06-01T08:00:00Z'),
    });
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 1000 } }); // cash sales
    prisma.cashDrawerMovement.groupBy.mockResolvedValue([
      { type: 'CASH_IN', _sum: { amount: 50 } },
      { type: 'CASH_OUT', _sum: { amount: 30 } },
    ]);

    // Denomination count sums to 1500 (7×200 + 5×20). expected = 1520 → short 20.
    await svc.close(SCOPE, 'sess-1', {
      denominationBreakdown: { '200': 7, '20': 5 },
    });

    const data = prisma.cashierSession.updateMany.mock.calls[0][0].data;
    expect(Number(data.expectedCash)).toBe(1520); // 500 + 1000 + 50 − 30
    expect(Number(data.countedCash)).toBe(1500); // derived from denominations
    expect(Number(data.overShort)).toBe(-20); // 1500 − 1520 (short)
    expect(Number(data.cashSales)).toBe(1000);
    expect(Number(data.cashIn)).toBe(50);
    expect(Number(data.cashOut)).toBe(30);
    expect(data.status).toBe('CLOSED');
  });

  it('rejects closing an already-closed session', async () => {
    prisma.cashierSession.findFirst.mockResolvedValue({ id: 'sess-1', status: 'CLOSED', openingFloat: 500, openedAt: new Date() });
    await expect(
      svc.close(SCOPE, 'sess-1', { countedCash: 100 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('X-report reads running expected mid-shift without closing', async () => {
    prisma.cashierSession.findFirst.mockResolvedValue({
      id: 'sess-1', status: 'OPEN', openingFloat: 500, openedAt: new Date('2026-06-01T08:00:00Z'),
    });
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 1000 } });
    prisma.cashDrawerMovement.groupBy.mockResolvedValue([
      { type: 'CASH_IN', _sum: { amount: 50 } },
      { type: 'CASH_OUT', _sum: { amount: 30 } },
    ]);

    const x = await svc.getXReport(SCOPE, 'sess-1');
    expect(x.expectedCash).toBe(1520); // 500 + 1000 + 50 − 30
    expect(x.cashSales).toBe(1000);
    expect(x.status).toBe('OPEN');
    // must NOT close the session
    expect(prisma.cashierSession.updateMany).not.toHaveBeenCalled();
  });

  it('X-report rejects a session that is not open', async () => {
    prisma.cashierSession.findFirst.mockResolvedValue({ id: 'sess-1', status: 'CLOSED', openingFloat: 500, openedAt: new Date() });
    await expect(svc.getXReport(SCOPE, 'sess-1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('CashierSessionService — safe drops / petty cash reduce expected cash', () => {
  const SCOPE = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'ADMIN' } as const;
  let prisma: any;
  let svc: CashierSessionService;
  beforeEach(() => {
    prisma = {
      cashierSession: { findFirst: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }), findUnique: jest.fn() },
      payment: { aggregate: jest.fn() },
      cashDrawerMovement: { groupBy: jest.fn() },
    };
    // open() runs its check-then-create inside a Serializable transaction;
    // pass the same mock through as the tx client.
    prisma.$transaction = jest
      .fn()
      .mockImplementation(async (cb: any) =>
        typeof cb === 'function' ? cb(prisma) : cb,
      );
    svc = new CashierSessionService(prisma);
  });

  it('counts SAFE_DROP + BANK_DEPOSIT + PETTY_CASH as cash-out in the X-report', async () => {
    prisma.cashierSession.findFirst.mockResolvedValue({ id: 's1', status: 'OPEN', openingFloat: 500, openedAt: new Date('2026-06-01T08:00:00Z') });
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 1000 } });
    prisma.cashDrawerMovement.groupBy.mockResolvedValue([
      { type: 'CASH_OUT', _sum: { amount: 30 } },
      { type: 'SAFE_DROP', _sum: { amount: 200 } },
      { type: 'BANK_DEPOSIT', _sum: { amount: 100 } },
      { type: 'PETTY_CASH', _sum: { amount: 20 } },
    ]);
    const x = await svc.getXReport(SCOPE, 's1');
    // expected = 500 + 1000 − (30 + 200 + 100 + 20) = 1150
    expect(x.expectedCash).toBe(1150);
    expect(x.cashOut).toBe(350);
  });
});
