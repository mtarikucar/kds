import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DeliveryTestService } from './delivery-test.service';
import { mockPrismaClient, MockPrismaClient } from '../../../common/test/prisma-mock.service';

/**
 * Built-in delivery test-order simulator. Load-bearing contracts:
 *   (a) REFUSES unless the platform config's environment === "sandbox" — a
 *       synthetic order must never be injected into a production-configured
 *       platform (auto-accept would push a fake order back to the live one).
 *   (b) the synthetic order it hands to processIncomingOrder is unmistakably
 *       a test: TEST- externalOrderId + a loud note, with totals that match
 *       the line items (so the order-service totals sanity check passes).
 *   (c) prefers the tenant's existing MenuItemMappings, else clearly-labelled
 *       TEST items.
 */
describe('DeliveryTestService', () => {
  let prisma: MockPrismaClient;
  let configService: any;
  let orderService: { processIncomingOrder: jest.Mock };
  let svc: DeliveryTestService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    configService = { findOneInternal: jest.fn() };
    orderService = {
      processIncomingOrder: jest
        .fn()
        .mockResolvedValue({ id: 'ord-1', externalOrderId: 'TEST-x' }),
    };
    svc = new DeliveryTestService(
      prisma as any,
      configService as any,
      orderService as any,
    );
  });

  it('rejects an unknown platform before touching the config', async () => {
    await expect(svc.simulateOrder('t1', 'DOORDASH')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(configService.findOneInternal).not.toHaveBeenCalled();
    expect(orderService.processIncomingOrder).not.toHaveBeenCalled();
  });

  it('REFUSES a production-configured platform (sandbox-only guard)', async () => {
    configService.findOneInternal.mockResolvedValue({
      id: 'cfg-1',
      environment: 'production',
    });

    await expect(svc.simulateOrder('t1', 'GETIR')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    // Critical: the fake order never reaches the real ingest path.
    expect(orderService.processIncomingOrder).not.toHaveBeenCalled();
  });

  it('REFUSES when environment is missing/undefined (defaults to production)', async () => {
    configService.findOneInternal.mockResolvedValue({ id: 'cfg-1' });

    await expect(svc.simulateOrder('t1', 'GETIR')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(orderService.processIncomingOrder).not.toHaveBeenCalled();
  });

  it('propagates NotFoundException when the platform was never configured', async () => {
    configService.findOneInternal.mockRejectedValue(
      new NotFoundException('Configuration for GETIR not found'),
    );

    await expect(svc.simulateOrder('t1', 'GETIR')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(orderService.processIncomingOrder).not.toHaveBeenCalled();
  });

  it('on a sandbox config, runs a TEST-labelled synthetic order through processIncomingOrder', async () => {
    configService.findOneInternal.mockResolvedValue({
      id: 'cfg-1',
      environment: 'sandbox',
    });
    (prisma.menuItemMapping.findMany as any).mockResolvedValue([]);

    const result = await svc.simulateOrder('t1', 'GETIR');

    expect(orderService.processIncomingOrder).toHaveBeenCalledTimes(1);
    const [tenantId, order] = orderService.processIncomingOrder.mock.calls[0];
    expect(tenantId).toBe('t1');
    expect(order.platform).toBe('GETIR');
    // Guard rail #2: unmistakably a test, and the dedup/accept key is TEST-.
    expect(order.externalOrderId).toMatch(/^TEST-/);
    expect(order.notes).toMatch(/TEST ORDER/i);
    expect(order.rawPayload.__test).toBe(true);
    expect(result).toBe(
      await orderService.processIncomingOrder.mock.results[0].value,
    );
  });

  it('builds clearly-labelled TEST items with self-consistent totals when no mappings exist', async () => {
    configService.findOneInternal.mockResolvedValue({
      id: 'cfg-1',
      environment: 'sandbox',
    });
    (prisma.menuItemMapping.findMany as any).mockResolvedValue([]);

    await svc.simulateOrder('t1', 'YEMEKSEPETI');

    const [, order] = orderService.processIncomingOrder.mock.calls[0];
    expect(order.items.length).toBeGreaterThan(0);
    // Every fallback item is labelled and uses a TEST external id.
    for (const it of order.items) {
      expect(it.name).toMatch(/\[TEST\]/);
      expect(it.externalItemId).toMatch(/^TEST-ITEM-/);
    }
    // Totals must equal the sum of line items so the order-service drift
    // check (5% tolerance) passes and the order isn't forced to approval
    // for a phantom totals mismatch.
    const itemsSum = order.items.reduce(
      (s: number, it: any) => s + it.unitPrice * it.quantity,
      0,
    );
    expect(order.totalAmount).toBeCloseTo(itemsSum, 2);
    expect(order.finalAmount).toBeCloseTo(itemsSum, 2);
    expect(order.discount).toBe(0);
  });

  it('prefers the tenant existing menu mappings (up to two) for the synthetic basket', async () => {
    configService.findOneInternal.mockResolvedValue({
      id: 'cfg-1',
      environment: 'sandbox',
    });
    (prisma.menuItemMapping.findMany as any).mockResolvedValue([
      { externalItemId: 'ext-burger', product: { name: 'Burger', price: 120 } },
      { externalItemId: 'ext-cola', product: { name: 'Cola', price: 30 } },
    ]);

    await svc.simulateOrder('t1', 'TRENDYOL');

    const [, order] = orderService.processIncomingOrder.mock.calls[0];
    expect(order.items.map((i: any) => i.externalItemId)).toEqual([
      'ext-burger',
      'ext-cola',
    ]);
    // Reuses the real mapping ids so the order exercises item-mapping + KDS.
    expect(order.items[0].name).toContain('Burger');
    const itemsSum = order.items.reduce(
      (s: number, it: any) => s + it.unitPrice * it.quantity,
      0,
    );
    expect(order.totalAmount).toBeCloseTo(itemsSum, 2);
  });
});
