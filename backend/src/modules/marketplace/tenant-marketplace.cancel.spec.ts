import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TenantMarketplaceService } from './tenant-marketplace.service';
import { AddOnCatalogService } from './addon-catalog.service';
import {
  mockPrismaClient,
  MockPrismaClient,
} from '../../common/test/prisma-mock.service';
import { EventTypes } from '../outbox/event-types';

/**
 * Spec for TenantMarketplaceService.cancel / listMine — the cancellation
 * branches the purchase-focused spec does not cover: not-found + non-active
 * guards, the immediate-vs-at-period-end data shape, the race count check,
 * the immediate-only AddOnCancelled emit, and listMine's scoping/ordering.
 */
describe('TenantMarketplaceService.cancel', () => {
  let prisma: MockPrismaClient;
  let catalog: jest.Mocked<AddOnCatalogService>;
  let outbox: { append: jest.Mock };
  let svc: TenantMarketplaceService;

  const TENANT = 't1';

  beforeEach(() => {
    prisma = mockPrismaClient();
    catalog = { findByCodeOrThrow: jest.fn() } as any;
    outbox = { append: jest.fn().mockResolvedValue('ok') };
    svc = new TenantMarketplaceService(prisma as any, catalog, outbox as any);
    (prisma.$transaction as any).mockImplementation(async (fn: any) =>
      fn(prisma),
    );
  });

  it('throws NotFound when the add-on does not belong to the tenant', async () => {
    (prisma.tenantAddOn.findFirst as any).mockResolvedValue(null);

    await expect(svc.cancel(TENANT, 'ta-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects cancelling an add-on that is not active', async () => {
    (prisma.tenantAddOn.findFirst as any).mockResolvedValue({
      id: 'ta-1',
      status: 'cancelled',
    });

    await expect(svc.cancel(TENANT, 'ta-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('immediate cancel sets status=cancelled + endedAt and emits AddOnCancelled', async () => {
    (prisma.tenantAddOn.findFirst as any).mockResolvedValue({
      id: 'ta-1',
      status: 'active',
    });
    (prisma.tenantAddOn.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.tenantAddOn.findFirstOrThrow as any).mockResolvedValue({
      id: 'ta-1',
      status: 'cancelled',
    });

    await svc.cancel(TENANT, 'ta-1', true);

    const data = (prisma.tenantAddOn.updateMany as any).mock.calls[0][0].data;
    expect(data.status).toBe('cancelled');
    expect(data.cancelAtPeriodEnd).toBe(false);
    expect(data.endedAt).toBeInstanceOf(Date);
    // the claim is gated on status=active for concurrency safety
    const where = (prisma.tenantAddOn.updateMany as any).mock.calls[0][0].where;
    expect(where).toEqual({ id: 'ta-1', tenantId: TENANT, status: 'active' });
    // immediate revoke emits the outbox event
    expect(outbox.append).toHaveBeenCalledTimes(1);
    expect(outbox.append.mock.calls[0][0].type).toBe(EventTypes.AddOnCancelled);
  });

  it('at-period-end cancel only sets cancelAtPeriodEnd and does NOT emit', async () => {
    (prisma.tenantAddOn.findFirst as any).mockResolvedValue({
      id: 'ta-1',
      status: 'active',
    });
    (prisma.tenantAddOn.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.tenantAddOn.findFirstOrThrow as any).mockResolvedValue({
      id: 'ta-1',
      status: 'active',
      cancelAtPeriodEnd: true,
    });

    await svc.cancel(TENANT, 'ta-1', false);

    const data = (prisma.tenantAddOn.updateMany as any).mock.calls[0][0].data;
    expect(data.cancelAtPeriodEnd).toBe(true);
    expect(data.cancelledAt).toBeInstanceOf(Date);
    // the row stays active => status field untouched
    expect(data).not.toHaveProperty('status');
    expect(data).not.toHaveProperty('endedAt');
    // no immediate revoke => no outbox emit
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('throws when the claim updateMany loses the race (count 0)', async () => {
    (prisma.tenantAddOn.findFirst as any).mockResolvedValue({
      id: 'ta-1',
      status: 'active',
    });
    (prisma.tenantAddOn.updateMany as any).mockResolvedValue({ count: 0 });

    await expect(svc.cancel(TENANT, 'ta-1', true)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.tenantAddOn.findFirstOrThrow as any).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalled();
  });
});

describe('TenantMarketplaceService.listMine', () => {
  let prisma: MockPrismaClient;
  let svc: TenantMarketplaceService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new TenantMarketplaceService(
      prisma as any,
      { findByCodeOrThrow: jest.fn() } as any,
      { append: jest.fn() } as any,
    );
  });

  it('lists the tenant rows newest-first with the catalog row included', async () => {
    (prisma.tenantAddOn.findMany as any).mockResolvedValue([]);

    await svc.listMine('t1');

    const args = (prisma.tenantAddOn.findMany as any).mock.calls[0][0];
    expect(args.where).toEqual({ tenantId: 't1' });
    expect(args.include).toEqual({ addOn: true });
    expect(args.orderBy).toEqual({ activatedAt: 'desc' });
  });
});
