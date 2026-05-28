import { BadRequestException } from '@nestjs/common';
import { LoyaltyService, LoyaltyTransactionType } from './loyalty.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';

/**
 * Iter-37 regressions:
 *
 *  1. earnPointsFromOrder MUST run its EARNED-row dedup INSIDE the
 *     same Serializable txn that writes the credit. The earlier
 *     implementation read existing OUTSIDE then called awardPoints
 *     (which opens its own txn) — two concurrent retries both saw
 *     existing=null and both credited.
 *
 *  2. addPoints MUST reject unknown LoyaltyTransactionType strings
 *     instead of casting and persisting whatever the caller passed.
 */
describe('LoyaltyService (iter-37)', () => {
  let prisma: MockPrismaClient;
  let svc: LoyaltyService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new LoyaltyService(prisma as any);
  });

  describe('earnPointsFromOrder dedup inside txn', () => {
    it('reads the EARNED-row dedup on the TXN client, not bare prisma', async () => {
      const txMock: any = {
        loyaltyTransaction: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 'lt-1' }),
        },
        customer: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'cust-1', tenantId: 't1', loyaltyPoints: 0,
          }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      };
      (prisma.$transaction as any).mockImplementation(async (cb: any, _opts: any) => cb(txMock));
      // Tier check happens outside the txn — short-circuit it.
      (prisma.customer.findFirst as any).mockResolvedValue({
        id: 'cust-1', loyaltyTier: 'BRONZE',
      });
      (prisma.loyaltyTransaction.aggregate as any).mockResolvedValue({ _sum: { points: 0 } });

      await svc.earnPointsFromOrder('cust-1', 't1', 'order-1', 'ORD-1', 100);

      // Load-bearing: the dedup query landed on the txn client.
      // Any future refactor that moves it back to `this.prisma...` will
      // make txMock.findFirst stay at 0 calls and fail this assertion.
      expect(txMock.loyaltyTransaction.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            customerId: 'cust-1',
            orderId: 'order-1',
            type: LoyaltyTransactionType.EARNED,
          }),
        }),
      );
    });

    it('does NOT double-credit when the in-txn dedup finds an existing EARNED row', async () => {
      const txMock: any = {
        loyaltyTransaction: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'lt-existing', points: 100,
          }),
          create: jest.fn(),
        },
        customer: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'cust-1', tenantId: 't1', loyaltyPoints: 100,
          }),
          updateMany: jest.fn(),
        },
      };
      (prisma.$transaction as any).mockImplementation(async (cb: any, _opts: any) => cb(txMock));

      const result = await svc.earnPointsFromOrder('cust-1', 't1', 'order-1', 'ORD-1', 100);

      expect(result.transaction).toEqual({ id: 'lt-existing', points: 100 });
      // Crucially: no write happened on the retry path.
      expect(txMock.customer.updateMany).not.toHaveBeenCalled();
      expect(txMock.loyaltyTransaction.create).not.toHaveBeenCalled();
    });

    it('skips the tier check on idempotent retries (no extra DB work)', async () => {
      const txMock: any = {
        loyaltyTransaction: {
          findFirst: jest.fn().mockResolvedValue({ id: 'lt-prior' }),
          create: jest.fn(),
        },
        customer: {
          findFirst: jest.fn().mockResolvedValue({ id: 'cust-1', loyaltyPoints: 50 }),
          updateMany: jest.fn(),
        },
      };
      (prisma.$transaction as any).mockImplementation(async (cb: any, _opts: any) => cb(txMock));

      await svc.earnPointsFromOrder('cust-1', 't1', 'order-1', 'ORD-1', 100);

      // checkAndUpgradeTier runs outside the txn against `this.prisma`;
      // on an idempotent retry, no aggregate or upgrade should happen.
      expect((prisma.loyaltyTransaction.aggregate as any).mock.calls.length).toBe(0);
    });
  });

  describe('addPoints type validation', () => {
    it('rejects an unknown transaction type string', async () => {
      await expect(
        svc.addPoints({
          customerId: 'cust-1',
          tenantId: 't1',
          points: 10,
          type: 'GIFT',  // not in LoyaltyTransactionType enum
          description: 'gift',
          source: 'admin',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects lowercase variants (canonical enum is upper)', async () => {
      await expect(
        svc.addPoints({
          customerId: 'cust-1',
          tenantId: 't1',
          points: 10,
          type: 'earned',
          description: 'x',
          source: 'admin',
        }),
      ).rejects.toThrow(/Invalid loyalty transaction type/);
    });
  });
});
