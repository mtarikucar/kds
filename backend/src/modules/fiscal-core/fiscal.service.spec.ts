import { FiscalService } from './fiscal.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';
import { FiscalProviderRegistry } from './fiscal-provider.registry';

/**
 * Behavioural tests for the fiscal service. The DB is mocked but the
 * pricing math (vat breakdown, total) runs for real — that math is the
 * compliance-sensitive part.
 */
describe('FiscalService.issueReceipt', () => {
  let prisma: MockPrismaClient;
  let registry: jest.Mocked<FiscalProviderRegistry>;
  let outbox: { append: jest.Mock };
  let svc: FiscalService;

  const TENANT = 't1';
  const DEVICE_ID = 'fd-1';

  beforeEach(() => {
    prisma = mockPrismaClient();
    outbox = { append: jest.fn().mockResolvedValue('outbox') };
    registry = { get: jest.fn() } as any;
    svc = new FiscalService(prisma as any, registry as any, outbox as any);
  });

  it('returns the existing row on idempotent retry', async () => {
    prisma.fiscalDeviceRecord.findUnique.mockResolvedValue({
      id: DEVICE_ID, tenantId: TENANT, providerId: 'mock', status: 'online',
    } as any);
    prisma.fiscalReceipt.findUnique.mockResolvedValue({ id: 'fr-1', tenantId: TENANT, status: 'issued' } as any);

    const out = await svc.issueReceipt({
      tenantId: TENANT,
      fiscalDeviceId: DEVICE_ID,
      lines: [{ productCode: 'X', name: 'X', qty: 1, unitPriceCents: 1200, vatRate: 20 }],
      payments: [{ method: 'cash', amountCents: 1200 }],
      idempotencyKey: 'dup-key',
    });
    expect(out.id).toBe('fr-1');
    expect(registry.get).not.toHaveBeenCalled();   // adapter not invoked on dup
  });

  it('computes VAT breakdown per rate and persists the queued row', async () => {
    prisma.fiscalDeviceRecord.findUnique.mockResolvedValue({
      id: DEVICE_ID, tenantId: TENANT, providerId: 'mock', status: 'online',
    } as any);
    prisma.fiscalReceipt.findUnique.mockResolvedValue(null);
    let capturedCreate: any = null;
    (prisma.fiscalReceipt.create as any).mockImplementation(async ({ data }: any) => {
      capturedCreate = data;
      return { id: 'fr-new', ...data };
    });
    (prisma.fiscalReceipt.update as any).mockImplementation(async ({ data }: any) => ({
      id: 'fr-new', tenantId: TENANT, status: data.status, ...data,
    }));
    const adapter = {
      issueReceipt: jest.fn().mockResolvedValue({ providerId: 'mock', receiptId: 'fr-new', status: 'issued', fiscalNo: '00000001' }),
    };
    registry.get.mockReturnValue(adapter as any);

    const out = await svc.issueReceipt({
      tenantId: TENANT,
      fiscalDeviceId: DEVICE_ID,
      lines: [
        { productCode: 'A', name: 'Burger', qty: 1, unitPriceCents: 12000, vatRate: 20 }, // 2000 vat
        { productCode: 'B', name: 'Bread',  qty: 2, unitPriceCents: 1100,  vatRate: 10 }, // 200 vat
      ],
      payments: [{ method: 'card', amountCents: 14200 }],
      idempotencyKey: 'k-1',
    });

    expect(adapter.issueReceipt).toHaveBeenCalled();
    expect(capturedCreate.totalCents).toBe(12000 + 2 * 1100);
    expect(capturedCreate.vatBreakdown).toEqual({ '20': 2000, '10': 200 });
    expect(out.status).toBe('issued');
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'fiscal.receipt.printed.v1' }),
    );
  });

  it('marks the row failed and emits a failure event when the adapter throws', async () => {
    prisma.fiscalDeviceRecord.findUnique.mockResolvedValue({
      id: DEVICE_ID, tenantId: TENANT, providerId: 'mock', status: 'online',
    } as any);
    prisma.fiscalReceipt.findUnique.mockResolvedValue(null);
    (prisma.fiscalReceipt.create as any).mockResolvedValue({ id: 'fr-x', tenantId: TENANT, status: 'queued' });
    (prisma.fiscalReceipt.update as any).mockImplementation(async ({ data }: any) => ({
      id: 'fr-x', tenantId: TENANT, ...data,
    }));
    const adapter = { issueReceipt: jest.fn().mockRejectedValue(new Error('serial port busy')) };
    registry.get.mockReturnValue(adapter as any);

    const out = await svc.issueReceipt({
      tenantId: TENANT,
      fiscalDeviceId: DEVICE_ID,
      lines: [{ productCode: 'X', name: 'X', qty: 1, unitPriceCents: 100, vatRate: 20 }],
      payments: [{ method: 'cash', amountCents: 100 }],
      idempotencyKey: 'k-2',
    });

    expect(out.status).toBe('failed');
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'fiscal.receipt.failed.v1' }),
    );
  });
});
