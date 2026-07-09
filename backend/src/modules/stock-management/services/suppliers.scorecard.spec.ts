import { SuppliersService } from './suppliers.service';

describe('SuppliersService.getScorecard', () => {
  const SCOPE = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'ADMIN' } as const;
  let prisma: any;
  let svc: SuppliersService;

  beforeEach(() => {
    prisma = {
      purchaseOrder: { findMany: jest.fn() },
      supplier: { findMany: jest.fn().mockResolvedValue([{ id: 'S1', name: 'Main' }]) },
    };
    svc = new SuppliersService(prisma);
  });

  it('computes on-time %, fill rate and spend per supplier', async () => {
    prisma.purchaseOrder.findMany.mockResolvedValue([
      {
        supplierId: 'S1', status: 'RECEIVED',
        expectedDate: new Date('2026-06-10'), receivedAt: new Date('2026-06-09'), // on time
        items: [{ quantityOrdered: 10, quantityReceived: 10, unitPrice: 5 }], // spend 50
      },
      {
        supplierId: 'S1', status: 'PARTIALLY_RECEIVED',
        expectedDate: new Date('2026-06-10'), receivedAt: new Date('2026-06-15'), // late
        items: [{ quantityOrdered: 10, quantityReceived: 5, unitPrice: 4 }], // spend 20
      },
    ]);

    const res = await svc.getScorecard(SCOPE);
    const s1 = res.suppliers[0];
    expect(s1.supplierId).toBe('S1');
    expect(s1.poCount).toBe(2);
    expect(s1.onTimePct).toBe(50); // 1 of 2 received on time
    expect(s1.fillRatePct).toBe(75); // (10+5)/(10+10)
    expect(s1.totalSpend).toBe(70); // 50 + 20
  });
});
