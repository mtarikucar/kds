import { BadRequestException } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';

/**
 * Iter-78 regression — CustomersService.findAll passes opts.search
 * directly into Prisma's `contains` ILIKE on name + email + phone.
 * The endpoint is reachable by WAITER (front-of-house POS), so the
 * abuse surface is broader than iter-74's admin-gated users.findAll.
 * A 1MB needle triggers 3 × full-text-scan-with-1MB-comparison per
 * customer row — for a tenant with 10K customers that's ~30GB of
 * comparison work and the connection holds open through it. iter-78
 * caps at 200 chars (same shape as iter-74) to close the lever.
 */
describe('CustomersService.findAll search cap (iter-78)', () => {
  let prisma: MockPrismaClient;
  let svc: CustomersService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new CustomersService(prisma as any);
    (prisma.customer.findMany as any).mockResolvedValue([]);
    (prisma.customer.count as any).mockResolvedValue(0);
    // $transaction needs to behave like Promise.all over its array form
    // since findAll calls $transaction([findMany, count]).
    (prisma.$transaction as any).mockImplementation(async (ops: any[]) => Promise.all(ops));
  });

  it('accepts a normal search needle', async () => {
    await expect(svc.findAll('t1', 'ADMIN', { search: 'mehmet' })).resolves.toBeDefined();
  });

  it('rejects a 201-char search (the load-bearing boundary)', async () => {
    await expect(svc.findAll('t1', 'WAITER', { search: 'x'.repeat(201) })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects a 1MB search (paranoid upper)', async () => {
    await expect(
      svc.findAll('t1', 'WAITER', { search: 'x'.repeat(1_000_000) }),
    ).rejects.toThrow(/200 chars/);
  });

  it('builds the tenant-scoped WHERE with the OR branches across name/phone/email', async () => {
    let capturedWhere: any = null;
    (prisma.customer.findMany as any).mockImplementation(async ({ where }: any) => {
      capturedWhere = where;
      return [];
    });

    await svc.findAll('t1', 'WAITER', { search: 'mehmet' });

    expect(capturedWhere.tenantId).toBe('t1');
    expect(capturedWhere.OR).toEqual([
      { name: { contains: 'mehmet', mode: 'insensitive' } },
      { phone: { contains: 'mehmet' } },
      { email: { contains: 'mehmet', mode: 'insensitive' } },
    ]);
  });

  it('skips the OR clause entirely when search is absent (full tenant listing)', async () => {
    let capturedWhere: any = null;
    (prisma.customer.findMany as any).mockImplementation(async ({ where }: any) => {
      capturedWhere = where;
      return [];
    });

    await svc.findAll('t1', 'WAITER', {});

    expect(capturedWhere).toEqual({ tenantId: 't1' });
  });
});
