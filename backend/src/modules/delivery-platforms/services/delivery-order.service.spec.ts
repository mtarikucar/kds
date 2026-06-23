import { DeliveryOrderService } from './delivery-order.service';
import { mockPrismaClient, MockPrismaClient } from '../../../common/test/prisma-mock.service';

/**
 * Iter-39 regressions: processIncomingOrder must
 *   (a) bump configService.recordError when adapter.acceptOrder
 *       fails — third outbound surface that iter-38 missed.
 *   (b) read config ONCE before the txn, not twice (the earlier
 *       double-read could disagree under admin-toggle race —
 *       order persisted as auto-accepted but the platform-side
 *       accept never fired).
 */
describe('DeliveryOrderService (iter-39)', () => {
  let prisma: MockPrismaClient;
  let kdsGateway: any;
  let adapterFactory: any;
  let logService: any;
  let authService: any;
  let configService: any;
  let commandQueue: any;
  let escpos: any;
  let svc: DeliveryOrderService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    kdsGateway = { emitNewOrder: jest.fn() };
    adapterFactory = { getAdapter: jest.fn() };
    logService = {
      log: jest.fn().mockResolvedValue(undefined),
      scrubPii: jest.fn((x: any) => x),
    };
    authService = { ensureValidToken: jest.fn() };
    configService = { recordError: jest.fn().mockResolvedValue({}) };
    commandQueue = { enqueue: jest.fn().mockResolvedValue({ id: 'cmd-1' }) };
    escpos = {
      buildKitchenTicket: jest.fn().mockReturnValue({ artifact: 'kitchen_ticket' }),
      toPrintCommand: jest.fn().mockReturnValue({ kind: 'print_receipt', payload: { data: 'x' } }),
    };
    // No kitchen printer by default — the auto-print path is best-effort and
    // most existing tests don't care. Tests that exercise printing override this.
    (prisma.device.findMany as any).mockResolvedValue([]);
    svc = new DeliveryOrderService(
      prisma as any,
      kdsGateway,
      adapterFactory,
      logService,
      authService,
      configService,
      commandQueue,
      escpos,
    );
  });

  const normalizedOrder = {
    platform: 'YEMEKSEPETI',
    externalOrderId: 'ext-1',
    items: [],
    totalAmount: 100,
    discount: 0,
    finalAmount: 100,
    customerName: 'X',
    customerPhone: '+90555',
    rawPayload: {},
  } as any;

  it('reads platform config exactly once across the whole flow (iter-39)', async () => {
    (prisma.deliveryPlatformConfig.findUnique as any).mockResolvedValue({
      id: 'cfg-1',
      isEnabled: true,
      autoAccept: true,
    });
    // v3.0.0 — Order.branchId is NOT NULL; service resolves a fallback
    // branch before the txn. Without this mock the early-return path
    // short-circuits everything that follows.
    (prisma.branch.findFirst as any).mockResolvedValue({ id: 'br-1' });
    (prisma.$transaction as any).mockImplementation(async (cb: any) => {
      const tx: any = {
        order: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 'ord-1', tenantId: 't1', branchId: 'br-1' }),
        },
        menuItemMapping: { findMany: jest.fn().mockResolvedValue([]) },
        // Inside-txn config read MUST NOT happen anymore (iter-39).
        deliveryPlatformConfig: {
          findUnique: jest.fn().mockImplementation(() => {
            throw new Error('inside-txn config read should not happen — iter-39 removed it');
          }),
        },
      };
      return cb(tx);
    });
    authService.ensureValidToken.mockResolvedValue({ id: 'cfg-1' });
    adapterFactory.getAdapter.mockReturnValue({
      acceptOrder: jest.fn().mockResolvedValue(undefined),
    });

    await svc.processIncomingOrder('t1', normalizedOrder);

    // Single bare-prisma read; no second outside-txn read either.
    expect((prisma.deliveryPlatformConfig.findUnique as any).mock.calls.length).toBe(1);
  });

  it('bumps configService.recordError when adapter.acceptOrder throws', async () => {
    (prisma.deliveryPlatformConfig.findUnique as any).mockResolvedValue({
      id: 'cfg-1',
      isEnabled: true,
      autoAccept: true,
    });
    (prisma.branch.findFirst as any).mockResolvedValue({ id: 'br-1' });
    (prisma.$transaction as any).mockImplementation(async (cb: any) => {
      const tx: any = {
        order: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 'ord-1', tenantId: 't1', branchId: 'br-1' }),
        },
        menuItemMapping: { findMany: jest.fn().mockResolvedValue([]) },
        deliveryPlatformConfig: { findUnique: jest.fn() },
      };
      return cb(tx);
    });
    authService.ensureValidToken.mockResolvedValue({ id: 'cfg-1' });
    adapterFactory.getAdapter.mockReturnValue({
      acceptOrder: jest.fn().mockRejectedValue(new Error('platform 500')),
    });

    await svc.processIncomingOrder('t1', normalizedOrder);

    // Load-bearing: without this call, a permanently-broken
    // acceptOrder endpoint loops forever — every webhook accepts the
    // order locally but never on the platform side.
    expect(configService.recordError).toHaveBeenCalledWith(
      'cfg-1',
      expect.stringContaining('accept_order:'),
    );
  });

  it('does NOT call recordError on the happy auto-accept path', async () => {
    (prisma.deliveryPlatformConfig.findUnique as any).mockResolvedValue({
      id: 'cfg-1',
      isEnabled: true,
      autoAccept: true,
    });
    (prisma.branch.findFirst as any).mockResolvedValue({ id: 'br-1' });
    (prisma.$transaction as any).mockImplementation(async (cb: any) => {
      const tx: any = {
        order: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 'ord-1', branchId: 'br-1' }),
        },
        menuItemMapping: { findMany: jest.fn().mockResolvedValue([]) },
        deliveryPlatformConfig: { findUnique: jest.fn() },
      };
      return cb(tx);
    });
    authService.ensureValidToken.mockResolvedValue({ id: 'cfg-1' });
    adapterFactory.getAdapter.mockReturnValue({
      acceptOrder: jest.fn().mockResolvedValue(undefined),
    });

    await svc.processIncomingOrder('t1', normalizedOrder);

    expect(configService.recordError).not.toHaveBeenCalled();
  });

  it('skips both platform-accept and recordError when config has autoAccept=false', async () => {
    (prisma.deliveryPlatformConfig.findUnique as any).mockResolvedValue({
      id: 'cfg-1',
      isEnabled: true,
      autoAccept: false,
    });
    (prisma.branch.findFirst as any).mockResolvedValue({ id: 'br-1' });
    (prisma.$transaction as any).mockImplementation(async (cb: any) => {
      const tx: any = {
        order: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 'ord-1', branchId: 'br-1' }),
        },
        menuItemMapping: { findMany: jest.fn().mockResolvedValue([]) },
        deliveryPlatformConfig: { findUnique: jest.fn() },
      };
      return cb(tx);
    });
    const adapterMock = { acceptOrder: jest.fn() };
    adapterFactory.getAdapter.mockReturnValue(adapterMock);

    await svc.processIncomingOrder('t1', normalizedOrder);

    expect(adapterMock.acceptOrder).not.toHaveBeenCalled();
    expect(configService.recordError).not.toHaveBeenCalled();
  });

  // ── Auto-print kitchen ticket ───────────────────────────────────────────

  describe('kitchen-ticket auto-print', () => {
    const createdOrder = {
      id: 'ord-1',
      orderNumber: 'YEM-1',
      tenantId: 't1',
      branchId: 'br-1',
      type: 'DELIVERY',
      notes: null,
      createdAt: new Date('2026-06-22T10:00:00Z'),
      table: null,
      orderItems: [],
    };

    function mockCreateOrder() {
      (prisma.deliveryPlatformConfig.findUnique as any).mockResolvedValue({
        id: 'cfg-1',
        isEnabled: true,
        autoAccept: false,
      });
      (prisma.branch.findFirst as any).mockResolvedValue({ id: 'br-1' });
      (prisma.$transaction as any).mockImplementation(async (cb: any) => {
        const tx: any = {
          order: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue(createdOrder),
          },
          menuItemMapping: { findMany: jest.fn().mockResolvedValue([]) },
          deliveryPlatformConfig: { findUnique: jest.fn() },
        };
        return cb(tx);
      });
    }

    it('enqueues a print_receipt command to each kitchen_printer in the branch', async () => {
      mockCreateOrder();
      (prisma.device.findMany as any).mockResolvedValue([
        { id: 'prn-1', config: { paperWidth: '58mm' } },
        { id: 'prn-2', config: null },
      ]);

      await svc.processIncomingOrder('t1', normalizedOrder);

      // Only kitchen printers in the order's branch are queried.
      expect((prisma.device.findMany as any).mock.calls[0][0]).toMatchObject({
        where: { tenantId: 't1', branchId: 'br-1', kind: 'kitchen_printer' },
      });
      // One ESC/POS build + one print command per printer.
      expect(escpos.buildKitchenTicket).toHaveBeenCalledTimes(2);
      expect(escpos.buildKitchenTicket).toHaveBeenCalledWith(expect.anything(), {
        paperWidth: '58mm',
      });
      expect(commandQueue.enqueue).toHaveBeenCalledTimes(2);
      expect(commandQueue.enqueue).toHaveBeenCalledWith(
        't1',
        'prn-1',
        expect.objectContaining({
          kind: 'print_receipt',
          idempotencyKey: 'delivery-kitchen:ord-1:prn-1',
        }),
      );
    });

    it('skips printing (no throw) when the branch has no kitchen printer', async () => {
      mockCreateOrder();
      (prisma.device.findMany as any).mockResolvedValue([]);

      const out = await svc.processIncomingOrder('t1', normalizedOrder);

      expect(out).toBeTruthy();
      expect(escpos.buildKitchenTicket).not.toHaveBeenCalled();
      expect(commandQueue.enqueue).not.toHaveBeenCalled();
    });

    it('NEVER lets a print failure block order ingestion', async () => {
      mockCreateOrder();
      (prisma.device.findMany as any).mockResolvedValue([
        { id: 'prn-1', config: null },
      ]);
      commandQueue.enqueue.mockRejectedValue(new Error('printer offline'));

      // The order must still be returned (persisted + KDS-emitted) despite the
      // enqueue throwing.
      const out = await svc.processIncomingOrder('t1', normalizedOrder);

      expect(out).toMatchObject({ id: 'ord-1' });
      expect(kdsGateway.emitNewOrder).toHaveBeenCalled();
    });
  });

  // ── Inbound cancellation ────────────────────────────────────────────────

  describe('applyPlatformStatusUpdate — inbound cancellation', () => {
    it('maps a platform CANCELLED to the internal Order without pushing back', async () => {
      (prisma.order.updateMany as any).mockResolvedValue({ count: 1 });
      (prisma.order.findFirst as any).mockResolvedValue({
        id: 'ord-1',
        branchId: 'br-1',
      });

      const result = await svc.applyPlatformStatusUpdate({
        platform: 'TRENDYOL',
        remoteOrderId: 'ext-9',
        tenantId: 't1',
        platformStatus: 'CANCELLED',
      });

      expect(result).toEqual({ matched: true, mappedTo: 'CANCELLED' });
      // updateMany excludes already-terminal states (idempotency) and sets
      // cancelledAt.
      const call = (prisma.order.updateMany as any).mock.calls[0][0];
      expect(call.where.status.notIn).toEqual(
        expect.arrayContaining(['CANCELLED', 'PAID']),
      );
      expect(call.data.status).toBe('CANCELLED');
      expect(call.data.cancelledAt).toBeInstanceOf(Date);
      // No outbound adapter call — the platform already knows.
      expect(adapterFactory.getAdapter).not.toHaveBeenCalled();
      // Logged with the precise ORDER_CANCELLED action.
      expect(logService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ORDER_CANCELLED', success: true }),
      );
    });

    it('is idempotent — a duplicate cancel webhook is a no-op (count=0)', async () => {
      (prisma.order.updateMany as any).mockResolvedValue({ count: 0 });

      const result = await svc.applyPlatformStatusUpdate({
        platform: 'TRENDYOL',
        remoteOrderId: 'ext-9',
        tenantId: 't1',
        platformStatus: 'cancelled',
      });

      expect(result).toEqual({ matched: false, mappedTo: 'CANCELLED' });
      expect(kdsGateway.emitNewOrder).not.toHaveBeenCalled();
      expect(adapterFactory.getAdapter).not.toHaveBeenCalled();
    });
  });
});
