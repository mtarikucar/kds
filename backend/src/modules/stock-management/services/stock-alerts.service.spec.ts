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

    const kdsMock = {
      server: {
        to: jest.fn().mockReturnThis(),
        emit,
      },
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

    await service.checkLowStock(tenantId);

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      'stock:low-alert',
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

    await service.checkLowStock(tenantId);
    await service.checkLowStock(tenantId);

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

    await service.checkLowStock(tenantId);
    await service.checkLowStock(tenantId);

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

    await service.checkLowStock(tenantId);
    await service.checkLowStock(tenantId);
    await service.checkLowStock(tenantId);

    // Tick 1: emit (new low-stock). Tick 2: silent (empty set, nothing to
    // alert about). Tick 3: emit (Onion newly dropped — fresh problem).
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it('does not emit when the item set is empty', async () => {
    (prisma.$queryRaw as any).mockResolvedValueOnce([]);

    await service.checkLowStock(tenantId);

    expect(emit).not.toHaveBeenCalled();
  });

  it('isolates per-tenant state — tenant-A alert does not silence tenant-B', async () => {
    const sameItemSet = [
      { id: 'item-1', name: 'Tomato', unit: 'kg', currentStock: 1, minStock: 5 },
    ];
    (prisma.$queryRaw as any)
      .mockResolvedValueOnce(sameItemSet)
      .mockResolvedValueOnce(sameItemSet);

    await service.checkLowStock('tenant-A');
    await service.checkLowStock('tenant-B');

    // Both tenants get their first-ever emit — no cross-tenant interference.
    expect(emit).toHaveBeenCalledTimes(2);
  });
});
