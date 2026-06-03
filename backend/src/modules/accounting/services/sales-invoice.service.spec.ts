import { SalesInvoiceService } from './sales-invoice.service';
import { mockPrismaClient, MockPrismaClient } from '../../../common/test/prisma-mock.service';

/**
 * Iter-33 regression: findAll must clamp page/limit even if a caller
 * bypasses the DTO. The DTO already caps via @Max(200), but an
 * internal worker/RPC that constructs the query object directly would
 * be unguarded without the service-side Math.min.
 */
describe('SalesInvoiceService.findAll (iter-33)', () => {
  let prisma: MockPrismaClient;
  let svc: SalesInvoiceService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    const settings: any = { findByTenant: jest.fn() };
    const tax: any = { extractTax: jest.fn() };
    svc = new SalesInvoiceService(prisma as any, settings, tax);
    (prisma.salesInvoice.findMany as any).mockResolvedValue([]);
    (prisma.salesInvoice.count as any).mockResolvedValue(0);
  });

  it('caps limit at 200 even when caller passes a million', async () => {
    await svc.findAll('t1', { limit: 1_000_000 } as any);

    const findArgs = (prisma.salesInvoice.findMany as any).mock.calls[0][0];
    // Load-bearing: the take=200 ceiling protects against an unbounded
    // pull of nested-include invoice + items rows.
    expect(findArgs.take).toBe(200);
  });

  it('clamps page to 1 when caller passes 0 or negative', async () => {
    await svc.findAll('t1', { page: 0, limit: 20 } as any);
    const args1 = (prisma.salesInvoice.findMany as any).mock.calls[0][0];
    expect(args1.skip).toBe(0); // (1-1)*20

    await svc.findAll('t1', { page: -5, limit: 20 } as any);
    const args2 = (prisma.salesInvoice.findMany as any).mock.calls[1][0];
    expect(args2.skip).toBe(0);
  });

  it('falls back to limit=20 when caller passes a non-numeric value', async () => {
    await svc.findAll('t1', { limit: 'abc' as any } as any);
    const args = (prisma.salesInvoice.findMany as any).mock.calls[0][0];
    expect(args.take).toBe(20);
  });
});
