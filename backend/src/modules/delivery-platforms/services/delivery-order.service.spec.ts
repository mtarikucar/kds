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
  let outbox: any;
  let svc: DeliveryOrderService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    kdsGateway = { emitNewOrder: jest.fn() };
    adapterFactory = { getAdapter: jest.fn() };
    logService = {
      log: jest.fn().mockResolvedValue(undefined),
      scrubPii: jest.fn((x: any) => x),
      markRetrySuccess: jest.fn().mockResolvedValue(undefined),
    };
    authService = { ensureValidToken: jest.fn() };
    configService = { recordError: jest.fn().mockResolvedValue({}) };
    commandQueue = { enqueue: jest.fn().mockResolvedValue({ id: 'cmd-1' }) };
    escpos = {
      buildKitchenTicket: jest.fn().mockReturnValue({ artifact: 'kitchen_ticket' }),
      toPrintCommand: jest.fn().mockReturnValue({ kind: 'print_receipt', payload: { data: 'x' } }),
    };
    outbox = { append: jest.fn().mockResolvedValue('evt-1') };
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
      outbox,
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

  // ── Auto-accept ack-first inline budget ─────────────────────────────────
  // The outbound accept must NOT hold the webhook 200 past the platform's ack
  // window. It runs inline with a short budget; over budget it is deferred to
  // the RetryScheduler (which re-dispatches the identical acceptOrder), and the
  // still-running attempt is reconciled so the scheduler never double-accepts.
  describe('auto-accept ack-first inline budget', () => {
    const BUDGET_ENV = 'DELIVERY_AUTOACCEPT_INLINE_BUDGET_MS';
    afterEach(() => {
      delete process.env[BUDGET_ENV];
    });

    function wireAutoAccept(acceptImpl: () => Promise<void>) {
      (prisma.deliveryPlatformConfig.findUnique as any).mockResolvedValue({
        id: 'cfg-1',
        isEnabled: true,
        autoAccept: true,
      });
      (prisma.branch.findFirst as any).mockResolvedValue({ id: 'br-1' });
      (prisma.$transaction as any).mockImplementation(async (cb: any) =>
        cb({
          order: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest
              .fn()
              .mockResolvedValue({ id: 'ord-1', tenantId: 't1', branchId: 'br-1' }),
          },
          menuItemMapping: { findMany: jest.fn().mockResolvedValue([]) },
          deliveryPlatformConfig: { findUnique: jest.fn() },
        }),
      );
      authService.ensureValidToken.mockResolvedValue({ id: 'cfg-1' });
      adapterFactory.getAdapter.mockReturnValue({
        acceptOrder: jest.fn(acceptImpl),
      });
    }

    const deferredLog = () =>
      (logService.log as jest.Mock).mock.calls.find(
        ([e]: any[]) =>
          e.success === false &&
          typeof e.error === 'string' &&
          e.error.includes('deferred'),
      );

    it('defers to the RetryScheduler when the accept exceeds the inline budget', async () => {
      process.env[BUDGET_ENV] = '5';
      // Accept takes far longer than the 5ms budget.
      wireAutoAccept(() => new Promise<void>((res) => setTimeout(res, 120)));
      (logService.log as jest.Mock).mockResolvedValue({ id: 'log-defer' });

      await svc.processIncomingOrder('t1', normalizedOrder);

      const call = deferredLog();
      expect(call).toBeTruthy();
      expect(call[0].nextRetryAt).toBeInstanceOf(Date);
      // Ack-first: the order still reaches KDS immediately, not gated on accept.
      expect(kdsGateway.emitNewOrder).toHaveBeenCalled();
    });

    it('reconciles a LATE-successful deferred accept so the scheduler will not double-accept', async () => {
      process.env[BUDGET_ENV] = '5';
      let resolveAccept!: () => void;
      wireAutoAccept(
        () => new Promise<void>((res) => (resolveAccept = () => res())),
      );
      (logService.log as jest.Mock).mockResolvedValue({ id: 'log-defer' });

      await svc.processIncomingOrder('t1', normalizedOrder);
      expect(deferredLog()).toBeTruthy();
      // Not reconciled yet — the accept is still in flight.
      expect(logService.markRetrySuccess).not.toHaveBeenCalled();

      resolveAccept();
      await new Promise((r) => setTimeout(r, 15)); // let the continuation run

      // The deferred ORDER_ACCEPTED row is marked done so the RetryScheduler
      // skips it (no second platform accept).
      expect(logService.markRetrySuccess).toHaveBeenCalledWith('log-defer');
    });

    it('trips the circuit breaker when a deferred accept LATER fails', async () => {
      process.env[BUDGET_ENV] = '5';
      let rejectAccept!: (e: any) => void;
      wireAutoAccept(
        () => new Promise<void>((_res, rej) => (rejectAccept = rej)),
      );
      (logService.log as jest.Mock).mockResolvedValue({ id: 'log-defer' });

      await svc.processIncomingOrder('t1', normalizedOrder);
      expect(configService.recordError).not.toHaveBeenCalled();

      rejectAccept(new Error('platform 503'));
      await new Promise((r) => setTimeout(r, 15));

      expect(configService.recordError).toHaveBeenCalledWith(
        'cfg-1',
        expect.stringContaining('accept_order:'),
      );
    });

    it('keeps the fast happy path inline (success, no defer) within budget', async () => {
      // Default budget (no env) — an instant accept resolves inline: no
      // deferred row, no markRetrySuccess, no recordError.
      wireAutoAccept(() => Promise.resolve());

      await svc.processIncomingOrder('t1', normalizedOrder);

      expect(deferredLog()).toBeFalsy();
      expect(logService.markRetrySuccess).not.toHaveBeenCalled();
      expect(configService.recordError).not.toHaveBeenCalled();
    });
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

  // ── Totals-drift guard (paid modifiers) ─────────────────────────────────

  describe('totals-drift guard — paid modifiers', () => {
    // Wire a create that ECHOES back the data the service computed, so the
    // outside-txn print-gating can read the real `requiresApproval`/`status`.
    function wireEchoingCreate() {
      (prisma.deliveryPlatformConfig.findUnique as any).mockResolvedValue({
        id: 'cfg-1',
        isEnabled: true,
        autoAccept: true,
      });
      (prisma.branch.findFirst as any).mockResolvedValue({ id: 'br-1' });
      const create = jest.fn().mockImplementation(async ({ data }: any) => ({
        id: 'ord-1',
        orderNumber: 'YEM-1',
        tenantId: 't1',
        branchId: 'br-1',
        type: 'DELIVERY',
        notes: data.notes ?? null,
        status: data.status,
        requiresApproval: data.requiresApproval,
        createdAt: new Date('2026-06-22T10:00:00Z'),
        table: null,
        orderItems: [],
      }));
      (prisma.$transaction as any).mockImplementation(async (cb: any) => {
        const tx: any = {
          order: { findFirst: jest.fn().mockResolvedValue(null), create },
          menuItemMapping: {
            findMany: jest.fn().mockResolvedValue([
              { externalItemId: 'x-1', productId: 'prod-1', product: {} },
            ]),
          },
          deliveryPlatformConfig: { findUnique: jest.fn() },
        };
        return cb(tx);
      });
      adapterFactory.getAdapter.mockReturnValue({
        acceptOrder: jest.fn().mockResolvedValue(undefined),
      });
      authService.ensureValidToken.mockResolvedValue({ id: 'cfg-1' });
      return { create };
    }

    it('does NOT trip the drift gate for an order whose platform total INCLUDES paid modifier charges', async () => {
      // 1 burger @ 50 + a paid modifier (extra cheese 10 x1) ⇒ line value 60.
      // The platform's totalAmount bakes the modifier in (totalAmount=60). The
      // pre-fix itemsSum (50*1) would have drifted by exactly the 10 modifier,
      // tripping the gate. With modifiers included, itemsSum=60 matches.
      const { create } = wireEchoingCreate();
      const orderWithModifier = {
        platform: 'YEMEKSEPETI',
        externalOrderId: 'ext-mod-1',
        items: [
          {
            externalItemId: 'x-1',
            name: 'Burger',
            quantity: 1,
            unitPrice: 50,
            modifiers: [{ name: 'Extra cheese', price: 10, quantity: 1 }],
          },
        ],
        totalAmount: 60,
        discount: 0,
        finalAmount: 60,
        customerName: 'X',
        customerPhone: '+90555',
        rawPayload: {},
      } as any;

      const out = await svc.processIncomingOrder('t1', orderWithModifier);

      // autoAccept=true + mapped item + no drift ⇒ auto-accepted (PENDING),
      // NOT gated into approval.
      const data = create.mock.calls[0][0].data;
      expect(data.requiresApproval).toBe(false);
      expect(data.status).toBe('PENDING');
      expect(out).toMatchObject({ requiresApproval: false, status: 'PENDING' });
    });

    it('DOES trip the drift gate when the platform total is genuinely inconsistent', async () => {
      // Same single item @ 50 (no modifiers) but the platform claims 100 ⇒
      // real 50% drift ⇒ forced to PENDING_APPROVAL. Guards against the fix
      // silently disabling the guard.
      const { create } = wireEchoingCreate();
      const driftingOrder = {
        platform: 'YEMEKSEPETI',
        externalOrderId: 'ext-mod-2',
        items: [
          {
            externalItemId: 'x-1',
            name: 'Burger',
            quantity: 1,
            unitPrice: 50,
            modifiers: [],
          },
        ],
        totalAmount: 100,
        discount: 0,
        finalAmount: 100,
        customerName: 'X',
        customerPhone: '+90555',
        rawPayload: {},
      } as any;

      await svc.processIncomingOrder('t1', driftingOrder);

      const data = create.mock.calls[0][0].data;
      expect(data.requiresApproval).toBe(true);
      expect(data.status).toBe('PENDING_APPROVAL');
    });
  });

  // ── Auto-print gating on approval ───────────────────────────────────────

  describe('kitchen-ticket auto-print — approval gating', () => {
    // Reuse the echoing create so the print-gating reads the real
    // requiresApproval the service computed.
    function wireForApprovalState(opts: {
      autoAccept: boolean;
      mapped: boolean;
      driftTotal?: number;
    }) {
      (prisma.deliveryPlatformConfig.findUnique as any).mockResolvedValue({
        id: 'cfg-1',
        isEnabled: true,
        autoAccept: opts.autoAccept,
      });
      (prisma.branch.findFirst as any).mockResolvedValue({ id: 'br-1' });
      const create = jest.fn().mockImplementation(async ({ data }: any) => ({
        id: 'ord-1',
        orderNumber: 'YEM-1',
        tenantId: 't1',
        branchId: 'br-1',
        type: 'DELIVERY',
        notes: data.notes ?? null,
        status: data.status,
        requiresApproval: data.requiresApproval,
        createdAt: new Date('2026-06-22T10:00:00Z'),
        table: null,
        orderItems: [],
      }));
      (prisma.$transaction as any).mockImplementation(async (cb: any) => {
        const tx: any = {
          order: { findFirst: jest.fn().mockResolvedValue(null), create },
          menuItemMapping: {
            findMany: jest
              .fn()
              .mockResolvedValue(
                opts.mapped
                  ? [{ externalItemId: 'x-1', productId: 'prod-1', product: {} }]
                  : [],
              ),
          },
          deliveryPlatformConfig: { findUnique: jest.fn() },
        };
        return cb(tx);
      });
      adapterFactory.getAdapter.mockReturnValue({
        acceptOrder: jest.fn().mockResolvedValue(undefined),
      });
      authService.ensureValidToken.mockResolvedValue({ id: 'cfg-1' });
      return { create };
    }

    const mappedOrder = {
      platform: 'YEMEKSEPETI',
      externalOrderId: 'ext-print',
      items: [
        {
          externalItemId: 'x-1',
          name: 'Burger',
          quantity: 1,
          unitPrice: 50,
          modifiers: [],
        },
      ],
      totalAmount: 50,
      discount: 0,
      finalAmount: 50,
      customerName: 'X',
      customerPhone: '+90555',
      rawPayload: {},
    } as any;

    it('an auto-accepted (PENDING) order DOES enqueue a kitchen print', async () => {
      const { create } = wireForApprovalState({ autoAccept: true, mapped: true });
      (prisma.device.findMany as any).mockResolvedValue([
        { id: 'prn-1', config: null },
      ]);

      await svc.processIncomingOrder('t1', mappedOrder);

      expect(create.mock.calls[0][0].data.requiresApproval).toBe(false);
      expect(commandQueue.enqueue).toHaveBeenCalledTimes(1);
      expect(commandQueue.enqueue).toHaveBeenCalledWith(
        't1',
        'prn-1',
        expect.objectContaining({ kind: 'print_receipt' }),
      );
    });

    it('a gated (PENDING_APPROVAL) order does NOT enqueue a kitchen print — not even a device lookup', async () => {
      // autoAccept=false ⇒ requiresApproval=true ⇒ no ingest-time print.
      const { create } = wireForApprovalState({ autoAccept: false, mapped: true });
      (prisma.device.findMany as any).mockResolvedValue([
        { id: 'prn-1', config: null },
      ]);

      const out = await svc.processIncomingOrder('t1', mappedOrder);

      expect(create.mock.calls[0][0].data.requiresApproval).toBe(true);
      // The order is still persisted + KDS-emitted...
      expect(out).toMatchObject({ requiresApproval: true });
      expect(kdsGateway.emitNewOrder).toHaveBeenCalled();
      // ...but NOTHING printed (printer never even queried).
      expect(prisma.device.findMany).not.toHaveBeenCalled();
      expect(escpos.buildKitchenTicket).not.toHaveBeenCalled();
      expect(commandQueue.enqueue).not.toHaveBeenCalled();
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

  // ── Inbound refunds (platform-owned money) ──────────────────────────────

  describe('applyPlatformRefund — inbound, platform-initiated', () => {
    // Helper: wire $transaction to run the callback against a tx whose
    // order.findFirst returns `order` and capture order.update calls.
    function wireTxn(order: any) {
      const update = jest.fn().mockResolvedValue({ ...order });
      (prisma.$transaction as any).mockImplementation(async (cb: any) =>
        cb({
          order: {
            findFirst: jest.fn().mockResolvedValue(order),
            update,
          },
        }),
      );
      return { update };
    }

    it('full refund → moves order to CANCELLED-with-refund and emits the domain event, no platform push-back', async () => {
      const order = {
        id: 'ord-1',
        branchId: 'br-1',
        status: 'PREPARING',
        finalAmount: 100,
        notes: null,
        externalData: {},
      };
      const { update } = wireTxn(order);
      (prisma.order.findUnique as any).mockResolvedValue({
        id: 'ord-1',
        branchId: 'br-1',
      });

      const result = await svc.applyPlatformRefund({
        platform: 'TRENDYOL',
        remoteOrderId: 'ext-1',
        tenantId: 't1',
        refundId: 'rf-1',
        reason: 'customer cancelled',
      });

      expect(result).toMatchObject({
        matched: true,
        applied: true,
        type: 'full',
      });
      // Order moved to CANCELLED with cancelledAt + refund recorded on
      // externalData.refunds[] + a note.
      const data = update.mock.calls[0][0].data;
      expect(data.status).toBe('CANCELLED');
      expect(data.cancelledAt).toBeInstanceOf(Date);
      expect(data.externalData.refunds).toHaveLength(1);
      expect(data.externalData.refunds[0]).toMatchObject({
        type: 'full',
        refundKey: 'id:rf-1',
      });
      expect(data.notes).toContain('[REFUND]');
      // NEVER pushes a refund back to the platform (it initiated).
      expect(adapterFactory.getAdapter).not.toHaveBeenCalled();
      // Domain event emitted for accounting consumers.
      expect(outbox.append).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'delivery.order.refunded.v1' }),
      );
      expect(kdsGateway.emitNewOrder).toHaveBeenCalled();
      expect(logService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ORDER_REFUNDED', success: true }),
      );
    });

    it('partial refund → keeps status, records the amount on externalData + notes (no refund column limitation)', async () => {
      const order = {
        id: 'ord-2',
        branchId: 'br-1',
        status: 'PREPARING',
        finalAmount: 100,
        notes: 'existing note',
        externalData: {},
      };
      const { update } = wireTxn(order);
      (prisma.order.findUnique as any).mockResolvedValue({
        id: 'ord-2',
        branchId: 'br-1',
      });

      const result = await svc.applyPlatformRefund({
        platform: 'TRENDYOL',
        remoteOrderId: 'ext-2',
        tenantId: 't1',
        refundAmount: 30,
      });

      expect(result).toMatchObject({
        matched: true,
        applied: true,
        type: 'partial',
      });
      const data = update.mock.calls[0][0].data;
      // Status NOT changed for a partial refund.
      expect(data.status).toBeUndefined();
      expect(data.externalData.refunds[0]).toMatchObject({
        type: 'partial',
        amount: 30,
      });
      expect(data.notes).toContain('existing note');
      expect(data.notes).toContain('Partial refund 30.00');
      expect(adapterFactory.getAdapter).not.toHaveBeenCalled();
    });

    it('is idempotent — a re-delivered refund (same refundId) is a no-op and does NOT re-emit', async () => {
      const order = {
        id: 'ord-3',
        branchId: 'br-1',
        status: 'CANCELLED',
        finalAmount: 100,
        notes: '[REFUND] Full refund from TRENDYOL',
        externalData: {
          refunds: [{ refundKey: 'id:rf-9', type: 'full', amount: null, at: 'x' }],
        },
      };
      const { update } = wireTxn(order);

      const result = await svc.applyPlatformRefund({
        platform: 'TRENDYOL',
        remoteOrderId: 'ext-3',
        tenantId: 't1',
        refundId: 'rf-9',
      });

      expect(result).toMatchObject({ matched: true, applied: false, duplicate: true });
      // No second mutation, no duplicate domain event.
      expect(update).not.toHaveBeenCalled();
      expect(outbox.append).not.toHaveBeenCalled();
    });

    it('clamps a partial refund so accumulated partials cannot exceed finalAmount', async () => {
      // finalAmount=100, a 60 partial already recorded ⇒ remaining=40. A second
      // 70 partial (distinct refundId so it isn't deduped) must clamp to 40.
      const order = {
        id: 'ord-clamp',
        branchId: 'br-1',
        status: 'PREPARING',
        finalAmount: 100,
        notes: null,
        externalData: {
          refunds: [
            { refundKey: 'id:rf-a', type: 'partial', amount: 60, at: 'x' },
          ],
        },
      };
      const { update } = wireTxn(order);
      (prisma.order.findUnique as any).mockResolvedValue({
        id: 'ord-clamp',
        branchId: 'br-1',
      });

      const result = await svc.applyPlatformRefund({
        platform: 'TRENDYOL',
        remoteOrderId: 'ext-clamp',
        tenantId: 't1',
        refundAmount: 70,
        refundId: 'rf-b',
      });

      expect(result).toMatchObject({ matched: true, applied: true, type: 'partial' });
      const data = update.mock.calls[0][0].data;
      const appended = data.externalData.refunds[1];
      // Clamped to the 40 remaining, not the requested 70.
      expect(appended.amount).toBe(40);
      expect(data.notes).toContain('Partial refund 40.00');
    });

    it('returns matched:false when no order matches', async () => {
      (prisma.$transaction as any).mockImplementation(async (cb: any) =>
        cb({ order: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() } }),
      );

      const result = await svc.applyPlatformRefund({
        platform: 'TRENDYOL',
        remoteOrderId: 'nope',
        tenantId: 't1',
      });

      expect(result).toEqual({ matched: false, applied: false });
      expect(outbox.append).not.toHaveBeenCalled();
    });
  });

  // ── Restaurant-initiated (outbound) refund support gate ─────────────────

  describe('refundOrderOnPlatform — outbound', () => {
    it('throws an honest "unsupported" error when the adapter has no refundOrder (no fake call)', async () => {
      (prisma.deliveryPlatformConfig.findUnique as any).mockResolvedValue({
        id: 'cfg-1',
      });
      // Adapter without refundOrder — the common Turkish-platform case.
      adapterFactory.getAdapter.mockReturnValue({ acceptOrder: jest.fn() });

      await expect(
        svc.refundOrderOnPlatform('t1', 'TRENDYOL', 'ext-1', 50),
      ).rejects.toThrow(/does not support a restaurant-initiated refund/);
      expect(logService.log).not.toHaveBeenCalled();
    });

    it('dispatches to adapter.refundOrder when implemented', async () => {
      (prisma.deliveryPlatformConfig.findUnique as any).mockResolvedValue({
        id: 'cfg-1',
      });
      authService.ensureValidToken.mockResolvedValue({ id: 'cfg-1' });
      const refundOrder = jest.fn().mockResolvedValue(undefined);
      adapterFactory.getAdapter.mockReturnValue({ refundOrder });

      await svc.refundOrderOnPlatform('t1', 'TRENDYOL', 'ext-1', 50);

      expect(refundOrder).toHaveBeenCalledWith(
        expect.anything(),
        'ext-1',
        50,
      );
      expect(logService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ORDER_REFUNDED',
          direction: 'OUTBOUND',
          success: true,
        }),
      );
    });
  });

  // ── Inbound order amendments ────────────────────────────────────────────

  describe('applyPlatformAmendment — inbound item/total changes', () => {
    const amendedOrder = {
      platform: 'TRENDYOL',
      externalOrderId: 'ext-amd',
      items: [
        { externalItemId: 'x-1', name: 'Burger', quantity: 3, unitPrice: 50, modifiers: [] },
      ],
      totalAmount: 150,
      discount: 0,
      finalAmount: 150,
      rawPayload: {},
    } as any;

    function wireAmendTxn(order: any) {
      const update = jest.fn().mockResolvedValue({ ...order });
      const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
      (prisma.$transaction as any).mockImplementation(async (cb: any) =>
        cb({
          order: { findFirst: jest.fn().mockResolvedValue(order), update },
          orderItem: { deleteMany },
          menuItemMapping: {
            findMany: jest
              .fn()
              .mockResolvedValue([
                { externalItemId: 'x-1', productId: 'prod-1', product: {} },
              ]),
          },
        }),
      );
      return { update, deleteMany };
    }

    it('re-resolves items + recomputes totals, replaces line items, and re-emits to KDS', async () => {
      const order = {
        id: 'ord-amd',
        branchId: 'br-1',
        status: 'PENDING',
        externalData: {},
      };
      const { update, deleteMany } = wireAmendTxn(order);
      (prisma.order.findUnique as any).mockResolvedValue({
        id: 'ord-amd',
        branchId: 'br-1',
        orderItems: [],
      });

      const result = await svc.applyPlatformAmendment('t1', amendedOrder);

      expect(result).toMatchObject({ matched: true, applied: true });
      // Old items wiped, new ones recreated with recomputed totals.
      expect(deleteMany).toHaveBeenCalledWith({ where: { orderId: 'ord-amd' } });
      const data = update.mock.calls[0][0].data;
      expect(data.totalAmount).toBe(150);
      expect(data.finalAmount).toBe(150);
      expect(data.orderItems.create).toHaveLength(1);
      expect(data.orderItems.create[0]).toMatchObject({
        productId: 'prod-1',
        quantity: 3,
        unitPrice: 50,
        subtotal: 150,
      });
      // Idempotency stamp recorded.
      expect(data.externalData.amendmentHash).toEqual(expect.any(String));
      // KDS re-emitted so the kitchen sees the change.
      expect(kdsGateway.emitNewOrder).toHaveBeenCalled();
      expect(outbox.append).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'delivery.order.amended.v1' }),
      );
      expect(logService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ORDER_AMENDED', success: true }),
      );
    });

    it('is idempotent — a re-delivered identical amendment is a no-op (no item rewrite, no re-emit)', async () => {
      // Pre-compute the same hash the service will derive by running it once
      // against a fresh order, then assert a second delivery with that hash
      // already stamped no-ops.
      const firstOrder = {
        id: 'ord-amd2',
        branchId: 'br-1',
        status: 'PENDING',
        externalData: {},
      };
      const w1 = wireAmendTxn(firstOrder);
      (prisma.order.findUnique as any).mockResolvedValue({
        id: 'ord-amd2',
        branchId: 'br-1',
        orderItems: [],
      });
      await svc.applyPlatformAmendment('t1', amendedOrder);
      const stampedHash = w1.update.mock.calls[0][0].data.externalData.amendmentHash;

      // Second delivery: order already carries that hash.
      jest.clearAllMocks();
      const w2 = wireAmendTxn({
        id: 'ord-amd2',
        branchId: 'br-1',
        status: 'PENDING',
        externalData: { amendmentHash: stampedHash },
      });

      const result = await svc.applyPlatformAmendment('t1', amendedOrder);

      expect(result).toMatchObject({ matched: true, applied: false, duplicate: true });
      expect(w2.deleteMany).not.toHaveBeenCalled();
      expect(w2.update).not.toHaveBeenCalled();
      expect(kdsGateway.emitNewOrder).not.toHaveBeenCalled();
      expect(outbox.append).not.toHaveBeenCalled();
    });

    it('REFUSES amending a committed/served/completed order', async () => {
      const { update, deleteMany } = wireAmendTxn({
        id: 'ord-served',
        branchId: 'br-1',
        status: 'SERVED',
        externalData: {},
      });

      const result = await svc.applyPlatformAmendment('t1', amendedOrder);

      expect(result).toMatchObject({ matched: true, applied: false, refused: true });
      expect(result.reason).toContain('SERVED');
      // No mutation of a served order.
      expect(deleteMany).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
      expect(kdsGateway.emitNewOrder).not.toHaveBeenCalled();
      expect(logService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ORDER_AMENDED', success: false }),
      );
    });

    it('returns matched:false when no order matches the amendment', async () => {
      (prisma.$transaction as any).mockImplementation(async (cb: any) =>
        cb({
          order: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() },
          orderItem: { deleteMany: jest.fn() },
          menuItemMapping: { findMany: jest.fn().mockResolvedValue([]) },
        }),
      );

      const result = await svc.applyPlatformAmendment('t1', amendedOrder);

      expect(result).toEqual({ matched: false, applied: false });
      expect(outbox.append).not.toHaveBeenCalled();
    });
  });
});
