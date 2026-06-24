import { Test, TestingModule } from '@nestjs/testing';
import { StockAlertsService } from './stock-alerts.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { KdsGateway } from '../../kds/kds.gateway';
import {
  mockPrismaClient,
  MockPrismaClient,
} from '../../../common/test/prisma-mock.service';

/**
 * Verifies the alert-fatigue dedup logic: same set of low-stock items
 * across cron ticks emits only once until either the set changes or
 * 24 hours pass.
 */
describe('StockAlertsService — emit dedup', () => {
  let service: StockAlertsService;
  let prisma: MockPrismaClient;
  let emit: jest.Mock;

  const tenantId = 'tenant-1';

  beforeEach(async () => {
    prisma = mockPrismaClient();
    emit = jest.fn();

    // Emits now go through the branch-aware gateway helper (the old bare-room
    // server.to().emit reached zero clients). emit = the helper spy.
    const kdsMock = {
      emitStockLowAlert: emit,
      emitStockExpiryAlert: jest.fn(),
      server: {},
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StockAlertsService,
        { provide: PrismaService, useValue: prisma },
        { provide: KdsGateway, useValue: kdsMock },
      ],
    }).compile();

    service = module.get(StockAlertsService);
  });

  it('emits on first tick with low-stock items', async () => {
    (prisma.$queryRaw as any).mockResolvedValueOnce([
      { id: 'item-1', name: 'Tomato', unit: 'kg', currentStock: 1, minStock: 5 },
    ]);

    await service.checkLowStock(tenantId, 'branch-1');

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      tenantId,
      'branch-1',
      expect.objectContaining({ count: 1 }),
    );
  });

  it('does NOT re-emit on a second tick with the same item set', async () => {
    const lowStockSet = [
      { id: 'item-1', name: 'Tomato', unit: 'kg', currentStock: 1, minStock: 5 },
    ];
    (prisma.$queryRaw as any)
      .mockResolvedValueOnce(lowStockSet)
      .mockResolvedValueOnce(lowStockSet);

    await service.checkLowStock(tenantId, 'branch-1');
    await service.checkLowStock(tenantId, 'branch-1');

    // First tick fires, second tick is silent — that's the dedup we want.
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('emits again when a new item drops below threshold', async () => {
    (prisma.$queryRaw as any)
      .mockResolvedValueOnce([
        { id: 'item-1', name: 'Tomato', unit: 'kg', currentStock: 1, minStock: 5 },
      ])
      .mockResolvedValueOnce([
        { id: 'item-1', name: 'Tomato', unit: 'kg', currentStock: 1, minStock: 5 },
        { id: 'item-2', name: 'Onion', unit: 'kg', currentStock: 2, minStock: 5 },
      ]);

    await service.checkLowStock(tenantId, 'branch-1');
    await service.checkLowStock(tenantId, 'branch-1');

    // Set changed: item-2 newly below threshold → second emit fires.
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it('emits again after items recover then a new item drops', async () => {
    (prisma.$queryRaw as any)
      .mockResolvedValueOnce([
        { id: 'item-1', name: 'Tomato', unit: 'kg', currentStock: 1, minStock: 5 },
      ])
      .mockResolvedValueOnce([]) // operator restocked tomato
      .mockResolvedValueOnce([
        { id: 'item-2', name: 'Onion', unit: 'kg', currentStock: 2, minStock: 5 },
      ]);

    await service.checkLowStock(tenantId, 'branch-1');
    await service.checkLowStock(tenantId, 'branch-1');
    await service.checkLowStock(tenantId, 'branch-1');

    // Tick 1: emit (new low-stock). Tick 2: silent (empty set, nothing to
    // alert about). Tick 3: emit (Onion newly dropped — fresh problem).
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it('does not emit when the item set is empty', async () => {
    (prisma.$queryRaw as any).mockResolvedValueOnce([]);

    await service.checkLowStock(tenantId, 'branch-1');

    expect(emit).not.toHaveBeenCalled();
  });

  it('isolates per-tenant state — tenant-A alert does not silence tenant-B', async () => {
    const sameItemSet = [
      { id: 'item-1', name: 'Tomato', unit: 'kg', currentStock: 1, minStock: 5 },
    ];
    (prisma.$queryRaw as any)
      .mockResolvedValueOnce(sameItemSet)
      .mockResolvedValueOnce(sameItemSet);

    await service.checkLowStock('tenant-A', 'branch-1');
    await service.checkLowStock('tenant-B', 'branch-1');

    // Both tenants get their first-ever emit — no cross-tenant interference.
    expect(emit).toHaveBeenCalledTimes(2);
  });

  // The scheduler now runs once PER active branch of a tenant. Dedup state is
  // keyed per (tenant, branch), so two branches of the SAME tenant with the
  // same item set must each get their own first emit — branch-1's alert must
  // not silence branch-2's.
  it('isolates per-branch state — same tenant, two branches each emit', async () => {
    const sameItemSet = [
      { id: 'item-1', name: 'Tomato', unit: 'kg', currentStock: 1, minStock: 5 },
    ];
    (prisma.$queryRaw as any)
      .mockResolvedValueOnce(sameItemSet)
      .mockResolvedValueOnce(sameItemSet);

    await service.checkLowStock(tenantId, 'branch-1');
    await service.checkLowStock(tenantId, 'branch-2');

    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenNthCalledWith(
      1,
      tenantId,
      'branch-1',
      expect.objectContaining({ count: 1 }),
    );
    expect(emit).toHaveBeenNthCalledWith(
      2,
      tenantId,
      'branch-2',
      expect.objectContaining({ count: 1 }),
    );
  });

  // Dedup still works within a single branch across consecutive scheduler
  // ticks: the same item set on branch-1 emits once, not on every hourly run.
  it('dedups per-branch across ticks (same branch, same set → one emit)', async () => {
    const sameItemSet = [
      { id: 'item-1', name: 'Tomato', unit: 'kg', currentStock: 1, minStock: 5 },
    ];
    (prisma.$queryRaw as any)
      .mockResolvedValueOnce(sameItemSet)
      .mockResolvedValueOnce(sameItemSet);

    await service.checkLowStock(tenantId, 'branch-1');
    await service.checkLowStock(tenantId, 'branch-1');

    expect(emit).toHaveBeenCalledTimes(1);
  });

  // v3 branch-scope: the dashboard passes branchId so the raw low-stock
  // SQL gains `AND si."branchId" = $branchId`; the scheduler omits it and
  // runs tenant-wide.
  it('checkLowStock adds the branchId predicate + bound value when branchId is supplied', async () => {
    (prisma.$queryRaw as any).mockResolvedValueOnce([]);

    await service.checkLowStock('tenant-1', 'branch-9');

    // The single Prisma.sql arg carries both the branch predicate text and
    // the branchId as a bound parameter (never string-interpolated).
    const sqlArg = (prisma.$queryRaw as any).mock.calls[0][0];
    expect(sqlArg.sql).toMatch(/si\."branchId"\s*=/);
    expect(sqlArg.values).toContain('branch-9');
    expect(sqlArg.values).toContain('tenant-1');
  });

  it('checkLowStock omits the branchId predicate when branchId is absent (tenant-wide scheduler path)', async () => {
    (prisma.$queryRaw as any).mockResolvedValueOnce([]);

    await service.checkLowStock('tenant-1');

    const sqlArg = (prisma.$queryRaw as any).mock.calls[0][0];
    expect(sqlArg.sql).not.toMatch(/si\."branchId"\s*=/);
    expect(sqlArg.values).not.toContain('branch-9');
  });
});

describe('StockAlertsService.checkExpiringBatches — branch fence', () => {
  let service: StockAlertsService;
  let prisma: MockPrismaClient;

  beforeEach(async () => {
    prisma = mockPrismaClient();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StockAlertsService,
        { provide: PrismaService, useValue: prisma },
        { provide: KdsGateway, useValue: { server: undefined } },
      ],
    }).compile();
    service = module.get(StockAlertsService);
    (prisma.stockSettings.findFirst as any).mockResolvedValue({
      lowStockAlertDays: 3,
    });
    (prisma.stockBatch.findMany as any).mockResolvedValue([]);
  });

  it('fences the batch query by branchId when supplied', async () => {
    await service.checkExpiringBatches('tenant-1', undefined, 'branch-9');
    const where = (prisma.stockBatch.findMany as any).mock.calls[0][0].where;
    expect(where.tenantId).toBe('tenant-1');
    expect(where.branchId).toBe('branch-9');
  });

  it('omits branchId (tenant-wide) when not supplied', async () => {
    await service.checkExpiringBatches('tenant-1');
    const where = (prisma.stockBatch.findMany as any).mock.calls[0][0].where;
    expect(where.tenantId).toBe('tenant-1');
    expect('branchId' in where).toBe(false);
  });
});
