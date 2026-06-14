import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FiscalService } from './fiscal.service';
import {
  mockPrismaClient,
  MockPrismaClient,
} from '../../common/test/prisma-mock.service';
import { FiscalProviderRegistry } from './fiscal-provider.registry';

/**
 * Branch-state coverage for the manual recovery paths (cancelReceipt /
 * retryFailed / closeDay). The existing fiscal.service.spec asserts the
 * branch-scope WHERE shape and the happy issue/cancel/retry paths; this
 * spec drives the GUARD branches that gate those operations — each test
 * fails if the corresponding 404/400/no-op guard regresses.
 */
describe('FiscalService — recovery guard branches', () => {
  let prisma: MockPrismaClient;
  let registry: jest.Mocked<FiscalProviderRegistry>;
  let outbox: { append: jest.Mock };
  let svc: FiscalService;

  const scope = {
    tenantId: 't-1',
    branchId: 'b-1',
    userId: 'u-1',
    role: 'ADMIN',
  } as any;

  beforeEach(() => {
    prisma = mockPrismaClient();
    outbox = { append: jest.fn().mockResolvedValue('outbox') };
    registry = { get: jest.fn() } as any;
    svc = new FiscalService(prisma as any, registry as any, outbox as any);
  });

  // ── cancelReceipt ──────────────────────────────────────────────────
  describe('cancelReceipt', () => {
    it('throws NotFound when no row matches the branch scope', async () => {
      (prisma.fiscalReceipt.findFirst as any).mockResolvedValue(null);
      await expect(
        svc.cancelReceipt(scope, 'missing', 'x'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(registry.get).not.toHaveBeenCalled();
    });

    it('rejects cancelling a receipt that is not in the issued state', async () => {
      (prisma.fiscalReceipt.findFirst as any).mockResolvedValue({
        id: 'fr-1',
        status: 'queued',
        providerId: 'mock',
      });
      await expect(
        svc.cancelReceipt(scope, 'fr-1', 'x'),
      ).rejects.toThrow(/Only issued receipts/);
      expect(registry.get).not.toHaveBeenCalled();
    });

    it('calls the provider then flips the row to cancelled with the reason', async () => {
      (prisma.fiscalReceipt.findFirst as any).mockResolvedValue({
        id: 'fr-1',
        status: 'issued',
        providerId: 'mock',
      });
      const provider = {
        cancelReceipt: jest.fn().mockResolvedValue(undefined),
      };
      registry.get.mockReturnValue(provider as any);
      (prisma.fiscalReceipt.update as any).mockResolvedValue({
        id: 'fr-1',
        status: 'cancelled',
      });

      await svc.cancelReceipt(scope, 'fr-1', 'duplicate fiş');

      expect(provider.cancelReceipt).toHaveBeenCalledWith(
        'fr-1',
        'duplicate fiş',
      );
      expect(prisma.fiscalReceipt.update).toHaveBeenCalledWith({
        where: { id: 'fr-1' },
        data: { status: 'cancelled', lastError: 'cancelled: duplicate fiş' },
      });
    });
  });

  // ── retryFailed ────────────────────────────────────────────────────
  describe('retryFailed', () => {
    it('throws NotFound when no row matches the branch scope', async () => {
      (prisma.fiscalReceipt.findFirst as any).mockResolvedValue(null);
      await expect(svc.retryFailed(scope, 'missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns the row unchanged when it is already issued (idempotent no-op)', async () => {
      const row = { id: 'fr-1', status: 'issued' };
      (prisma.fiscalReceipt.findFirst as any).mockResolvedValue(row);
      const result = await svc.retryFailed(scope, 'fr-1');
      expect(result).toBe(row);
      expect(registry.get).not.toHaveBeenCalled();
      expect(prisma.fiscalReceipt.update).not.toHaveBeenCalled();
    });

    it('rejects retrying a cancelled receipt', async () => {
      (prisma.fiscalReceipt.findFirst as any).mockResolvedValue({
        id: 'fr-1',
        status: 'cancelled',
      });
      await expect(svc.retryFailed(scope, 'fr-1')).rejects.toThrow(
        /Cannot retry a cancelled/,
      );
    });

    it('enforces the 30s cooldown when the previous attempt was recent', async () => {
      (prisma.fiscalReceipt.findFirst as any).mockResolvedValue({
        id: 'fr-1',
        status: 'failed',
        providerId: 'mock',
        updatedAt: new Date(Date.now() - 5_000), // 5s ago, inside cooldown
        lines: [],
      });
      await expect(svc.retryFailed(scope, 'fr-1')).rejects.toThrow(
        /Cooldown active/,
      );
      // Provider must not be hit while the cooldown is active.
      expect(registry.get).not.toHaveBeenCalled();
    });

    it('re-dispatches with the ORIGINAL idempotency key once the cooldown elapses', async () => {
      (prisma.fiscalReceipt.findFirst as any).mockResolvedValue({
        id: 'fr-1',
        status: 'failed',
        providerId: 'mock',
        branchId: 'b-1',
        fiscalDeviceId: 'd-1',
        orderId: null,
        idempotencyKey: 'orig-key',
        totalCents: 1200,
        updatedAt: new Date(0), // long ago → past cooldown
        lines: [
          {
            productCode: 'X',
            name: 'X',
            qty: 1,
            unitPriceCents: 1200,
            vatRate: 20,
            vatGroup: null,
            discountCents: 0,
          },
        ],
      });
      const provider = {
        issueReceipt: jest.fn().mockResolvedValue({
          providerId: 'mock',
          receiptId: 'fr-1',
          status: 'issued',
          fiscalNo: '0001',
        }),
      };
      registry.get.mockReturnValue(provider as any);
      (prisma.fiscalReceipt.update as any).mockImplementation(
        async ({ data }: any) => ({ id: 'fr-1', ...data }),
      );

      await svc.retryFailed(scope, 'fr-1');

      const arg = provider.issueReceipt.mock.calls[0][0];
      expect(arg.idempotencyKey).toBe('orig-key'); // SAME key → provider dedupes
      expect(arg.lines[0]).toEqual(
        expect.objectContaining({ productCode: 'X', qty: 1, vatRate: 20 }),
      );
      // Success → row flipped to issued + attempts incremented.
      const updateData = (prisma.fiscalReceipt.update as any).mock.calls[0][0]
        .data;
      expect(updateData.status).toBe('issued');
      expect(updateData.attempts).toEqual({ increment: 1 });
    });
  });

  // ── closeDay ───────────────────────────────────────────────────────
  describe('closeDay', () => {
    it('throws NotFound when the device is absent / out of branch scope', async () => {
      (prisma.fiscalDeviceRecord.findFirst as any).mockResolvedValue(null);
      await expect(svc.closeDay(scope, 'dev-x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects closing the day on a retired device', async () => {
      (prisma.fiscalDeviceRecord.findFirst as any).mockResolvedValue({
        id: 'dev-1',
        providerId: 'mock',
        status: 'retired',
      });
      await expect(svc.closeDay(scope, 'dev-1')).rejects.toThrow(
        /retired/,
      );
      expect(registry.get).not.toHaveBeenCalled();
    });
  });
});
