import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaymentsService } from './payments.service';
import { mockPrismaClient, MockPrismaClient } from '../../../common/test/prisma-mock.service';
import { OrderStatus, PaymentStatus } from '../../../common/constants/order-status.enum';

/**
 * Unit tests for the progressive ("Dutch-style") per-item payment path
 * + the helpers shared with create / splitBill. The Prisma client is
 * mocked with jest-mock-extended; `$transaction(fn)` is configured to
 * call the callback with the same mock so the algorithm-level tests
 * exercise the real code path. Atomicity / isolation aren't simulated
 * — separate concerns covered by e2e.
 */
describe('PaymentsService — progressive per-item payments', () => {
  const TENANT_ID = 'tenant-1';
  const ORDER_ID = 'order-1';
  const TABLE_ID = 'table-1';

  let prisma: MockPrismaClient;
  let ordersService: { findOne: jest.Mock };
  let customersService: any;
  let receiptSnapshotBuilder: any;
  let salesInvoice: any;
  let accountingSettings: any;
  let stockDeduction: any;
  let loyalty: any;
  let kdsGateway: { emitPaymentSuccess: jest.Mock };
  let svc: PaymentsService;

  /**
   * Plug $transaction into the mocked Prisma so the callback executes
   * synchronously against the same mock. Tests can override per-method
   * resolutions via prisma.<model>.<method>.mockResolvedValue(...).
   */
  function wireTransaction() {
    (prisma.$transaction as unknown as jest.Mock).mockImplementation(
      async (fn: any) => {
        if (typeof fn === 'function') return fn(prisma);
        return Promise.all(fn);
      },
    );
    // acquireOrderLock issues a SELECT … FOR UPDATE via $queryRaw; mock
    // it to confirm the lock target exists.
    (prisma.$queryRaw as unknown as jest.Mock).mockResolvedValue([
      { id: ORDER_ID },
    ]);
  }

  /** Build an Order mock that's not paid yet. */
  function makeOrder(overrides: Partial<any> = {}) {
    return {
      id: ORDER_ID,
      orderNumber: 'ORD-001',
      tenantId: TENANT_ID,
      tableId: TABLE_ID,
      type: 'DINE_IN',
      status: OrderStatus.SERVED,
      totalAmount: new Prisma.Decimal('100.00'),
      discount: new Prisma.Decimal('0'),
      finalAmount: new Prisma.Decimal('100.00'),
      customerId: null,
      customerPhone: null,
      requiresApproval: false,
      ...overrides,
    };
  }

  function makeItem(id: string, qty: number, unitPrice: string | number, opts: Partial<any> = {}) {
    const subtotal = new Prisma.Decimal(unitPrice).mul(qty);
    return {
      id,
      orderId: ORDER_ID,
      productId: `prod-${id}`,
      quantity: qty,
      unitPrice: new Prisma.Decimal(unitPrice),
      subtotal,
      modifierTotal: new Prisma.Decimal(opts.modifierTotal ?? '0'),
      taxAmount: new Prisma.Decimal(opts.taxAmount ?? '0'),
      taxRate: 10,
      notes: null,
      status: 'READY',
      ...opts,
    };
  }

  beforeEach(() => {
    prisma = mockPrismaClient();
    ordersService = {
      findOne: jest.fn().mockResolvedValue(makeOrder()),
    };
    customersService = {};
    // Receipt snapshot is wired in but exercised only via the
    // service's own buildReceiptSnapshotForPayment helper which short-
    // circuits when the (mocked) tenant lookup returns undefined.
    receiptSnapshotBuilder = {
      buildReceiptSnapshot: jest.fn().mockReturnValue({}),
      buildKitchenTicketSnapshot: jest.fn().mockReturnValue({}),
    };
    salesInvoice = { createFromOrder: jest.fn().mockResolvedValue(undefined), createFromPayment: jest.fn().mockResolvedValue(undefined) };
    accountingSettings = {
      findByTenant: jest.fn().mockResolvedValue({ autoGenerateInvoice: false }),
    };
    stockDeduction = {};
    // LoyaltyService is the 5th constructor parameter (between
    // receiptSnapshotBuilder and salesInvoiceService). payByItems +
    // splitBill + create all call earnPointsFromOrder post-commit;
    // omit this mock and the service throws on the post-commit step.
    loyalty = {
      earnPointsFromOrder: jest.fn().mockResolvedValue(undefined),
    };
    // KdsGateway is optional in the service constructor; injecting a
    // mock lets us assert that the post-payment emit fires with the
    // right initiatedByUserId for waiter vs. webhook origins (the
    // dedup signal the frontend uses to suppress double-prints).
    kdsGateway = { emitPaymentSuccess: jest.fn() };
    svc = new PaymentsService(
      prisma as any,
      ordersService as any,
      customersService,
      receiptSnapshotBuilder,
      loyalty,
      salesInvoice,
      accountingSettings,
      stockDeduction,
      kdsGateway as any,
    );
    wireTransaction();
    // Default: no pending self-pay intents reserve items in any test.
    // Specific specs can override to test the reservation block.
    (prisma.pendingSelfPayment.findMany as unknown as jest.Mock).mockResolvedValue([]);
  });

  // ──────────────────────────────────────────────────────────────────
  // payByItems — happy path / closing payment / overpayment / dupes
  // ──────────────────────────────────────────────────────────────────

  describe('payByItems', () => {
    it('settles a single unit, leaves order open, writes the allocation row', async () => {
      const order = makeOrder({
        finalAmount: new Prisma.Decimal('100.00'),
        totalAmount: new Prisma.Decimal('100.00'),
      });
      const itemA = makeItem('item-A', 2, '25.00');
      const itemB = makeItem('item-B', 1, '50.00');
      (order as any).orderItems = [itemA, itemB];

      (prisma.order.findFirst as unknown as jest.Mock).mockResolvedValue(order);
      (prisma.orderItemPayment.groupBy as unknown as jest.Mock).mockResolvedValue([]);
      (prisma.payment.create as unknown as jest.Mock).mockResolvedValue({
        id: 'payment-1',
        amount: new Prisma.Decimal('25.00'),
        method: 'CASH',
        status: PaymentStatus.COMPLETED,
        orderId: ORDER_ID,
        tenantId: TENANT_ID,
        notes: 'Ali',
        paidAt: new Date(),
      });
      (prisma.orderItemPayment.createMany as unknown as jest.Mock).mockResolvedValue({ count: 1 });
      // After insert, sum-of-completed remains < finalAmount → no PAID transition.
      (prisma.payment.aggregate as unknown as jest.Mock).mockResolvedValue({
        _sum: { amount: new Prisma.Decimal('25.00') },
      });
      // getPayableItems re-fetch at the end:
      (prisma.order.findFirst as unknown as jest.Mock)
        .mockResolvedValueOnce(order) // inside tx
        .mockResolvedValueOnce({
          ...order,
          orderItems: [
            { ...itemA, product: { name: 'Cola' }, modifiers: [], orderItemPayments: [{ quantity: 1, paymentId: 'payment-1', amount: new Prisma.Decimal('25.00') }] },
            { ...itemB, product: { name: 'Burger' }, modifiers: [], orderItemPayments: [] },
          ],
          payments: [
            {
              id: 'payment-1',
              amount: new Prisma.Decimal('25.00'),
              method: 'CASH',
              notes: 'Ali',
              paidAt: new Date(),
              orderItemPayments: [{ orderItemId: 'item-A', quantity: 1, amount: new Prisma.Decimal('25.00') }],
            },
          ],
        });

      const result = await svc.payByItems(
        ORDER_ID,
        {
          items: [{ orderItemId: 'item-A', quantity: 1 }],
          method: 'CASH' as any,
          notes: 'Ali',
        },
        TENANT_ID,
      );

      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            method: 'CASH',
            status: PaymentStatus.COMPLETED,
            orderId: ORDER_ID,
            tenantId: TENANT_ID,
            notes: 'Ali',
          }),
        }),
      );
      expect(prisma.orderItemPayment.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            paymentId: 'payment-1',
            orderItemId: 'item-A',
            quantity: 1,
            tenantId: TENANT_ID,
          }),
        ],
      });
      // Not fully paid yet → no PAID transition.
      expect(prisma.order.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: OrderStatus.PAID }) }),
      );
      expect(result.orderFullyPaid).toBe(false);
    });

    it('closes the order, releases the table when last unit is paid', async () => {
      const order = makeOrder({
        finalAmount: new Prisma.Decimal('50.00'),
        totalAmount: new Prisma.Decimal('50.00'),
      });
      const itemA = makeItem('item-A', 1, '50.00');
      (order as any).orderItems = [itemA];

      (prisma.order.findFirst as unknown as jest.Mock).mockResolvedValue(order);
      (prisma.orderItemPayment.groupBy as unknown as jest.Mock).mockResolvedValue([]);
      (prisma.orderItemPayment.aggregate as unknown as jest.Mock).mockResolvedValue({
        _sum: { amount: new Prisma.Decimal('0') },
      });
      (prisma.payment.create as unknown as jest.Mock).mockResolvedValue({
        id: 'payment-1',
        amount: new Prisma.Decimal('50.00'),
        method: 'CASH',
        status: PaymentStatus.COMPLETED,
        orderId: ORDER_ID,
        tenantId: TENANT_ID,
      });
      (prisma.payment.aggregate as unknown as jest.Mock).mockResolvedValue({
        _sum: { amount: new Prisma.Decimal('50.00') },
      });
      (prisma.order.count as unknown as jest.Mock).mockResolvedValue(0);
      (prisma.customer.findUnique as unknown as jest.Mock).mockResolvedValue(null);
      // getPayableItems final read:
      (prisma.order.findFirst as unknown as jest.Mock)
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce({
          ...order,
          status: OrderStatus.PAID,
          orderItems: [{ ...itemA, product: { name: 'Burger' }, modifiers: [], orderItemPayments: [{ quantity: 1 }] }],
          payments: [
            { id: 'payment-1', amount: new Prisma.Decimal('50.00'), method: 'CASH', notes: null, paidAt: new Date(), orderItemPayments: [] },
          ],
        });

      const result = await svc.payByItems(
        ORDER_ID,
        { items: [{ orderItemId: 'item-A', quantity: 1 }], method: 'CASH' as any },
        TENANT_ID,
      );

      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ORDER_ID },
          data: expect.objectContaining({ status: OrderStatus.PAID }),
        }),
      );
      // v2.8.93 — table release uses updateMany with (id, tenantId)
      // compound WHERE so a spoofed tableId can't mark another tenant's
      // table AVAILABLE. The pre-fix `update({where:{id}})` shape is
      // gone.
      expect(prisma.table.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: TABLE_ID, tenantId: TENANT_ID },
          data: { status: 'AVAILABLE' },
        }),
      );
      expect(result.orderFullyPaid).toBe(true);
    });

    it('rejects when requested quantity exceeds remaining', async () => {
      const order = makeOrder({ finalAmount: new Prisma.Decimal('50.00') });
      const itemA = makeItem('item-A', 2, '25.00'); // qty 2 max
      (order as any).orderItems = [itemA];
      (prisma.order.findFirst as unknown as jest.Mock).mockResolvedValue(order);
      // Already paid 1 unit:
      (prisma.orderItemPayment.groupBy as unknown as jest.Mock).mockResolvedValue([
        { orderItemId: 'item-A', _sum: { quantity: 1 } },
      ]);

      await expect(
        svc.payByItems(
          ORDER_ID,
          { items: [{ orderItemId: 'item-A', quantity: 2 }], method: 'CASH' as any },
          TENANT_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('rejects items not belonging to the order', async () => {
      const order = makeOrder();
      (order as any).orderItems = [makeItem('item-A', 1, '50.00')];
      (prisma.order.findFirst as unknown as jest.Mock).mockResolvedValue(order);

      await expect(
        svc.payByItems(
          ORDER_ID,
          { items: [{ orderItemId: 'item-NOT-MINE', quantity: 1 }], method: 'CASH' as any },
          TENANT_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects duplicate orderItemIds in the same request', async () => {
      const order = makeOrder();
      const itemA = makeItem('item-A', 2, '25.00');
      (order as any).orderItems = [itemA];
      (prisma.order.findFirst as unknown as jest.Mock).mockResolvedValue(order);

      await expect(
        svc.payByItems(
          ORDER_ID,
          {
            items: [
              { orderItemId: 'item-A', quantity: 1 },
              { orderItemId: 'item-A', quantity: 1 },
            ],
            method: 'CASH' as any,
          },
          TENANT_ID,
        ),
      ).rejects.toThrow(/[Dd]uplicate/);
    });

    it('rejects paying for a cancelled order', async () => {
      const order = makeOrder({ status: OrderStatus.CANCELLED });
      (order as any).orderItems = [makeItem('item-A', 1, '50.00')];
      (prisma.order.findFirst as unknown as jest.Mock).mockResolvedValue(order);

      await expect(
        svc.payByItems(
          ORDER_ID,
          { items: [{ orderItemId: 'item-A', quantity: 1 }], method: 'CASH' as any },
          TENANT_ID,
        ),
      ).rejects.toThrow(/cancelled/i);
    });

    it('rejects paying for an order in PENDING_APPROVAL with requiresApproval', async () => {
      const order = makeOrder({
        status: OrderStatus.PENDING_APPROVAL,
        requiresApproval: true,
      });
      (order as any).orderItems = [makeItem('item-A', 1, '50.00')];
      (prisma.order.findFirst as unknown as jest.Mock).mockResolvedValue(order);

      await expect(
        svc.payByItems(
          ORDER_ID,
          { items: [{ orderItemId: 'item-A', quantity: 1 }], method: 'CASH' as any },
          TENANT_ID,
        ),
      ).rejects.toThrow(/approval/i);
    });

    it('returns the cached payment on idempotency replay without re-creating', async () => {
      const cached = {
        id: 'payment-existing',
        amount: new Prisma.Decimal('25.00'),
        method: 'CASH',
        status: PaymentStatus.COMPLETED,
        orderId: ORDER_ID,
        tenantId: TENANT_ID,
        orderItemPayments: [
          { orderItemId: 'item-A', quantity: 1, amount: new Prisma.Decimal('25.00') },
        ],
      };
      (prisma.payment.findFirst as unknown as jest.Mock).mockResolvedValueOnce(cached);
      // getPayableItems still runs to build the remaining summary:
      (prisma.order.findFirst as unknown as jest.Mock).mockResolvedValueOnce({
        ...makeOrder(),
        orderItems: [
          {
            ...makeItem('item-A', 2, '25.00'),
            product: { name: 'Cola' },
            modifiers: [],
            orderItemPayments: [{ quantity: 1 }],
          },
        ],
        payments: [
          {
            id: 'payment-existing',
            amount: new Prisma.Decimal('25.00'),
            method: 'CASH',
            notes: null,
            paidAt: new Date(),
            orderItemPayments: [],
          },
        ],
      });

      const result = await svc.payByItems(
        ORDER_ID,
        {
          items: [{ orderItemId: 'item-A', quantity: 1 }],
          method: 'CASH' as any,
          idempotencyKey: 'idem-key-12345',
        },
        TENANT_ID,
      );

      expect(result.payment).toBe(cached);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.payment.create).not.toHaveBeenCalled();
      expect(prisma.orderItemPayment.createMany).not.toHaveBeenCalled();
    });

    it('does NOT double-count tax (subtotal is already KDV-inclusive)', async () => {
      // Regression for the original perUnitGross bug: orders are stored
      // with KDV-inclusive subtotals (orders.service.ts extracts tax
      // FROM subtotal, doesn't add to it). order.totalAmount = sum of
      // subtotals. If perUnitGross adds taxAmount on top, every payment
      // overcharges by the embedded tax and the order silently flips
      // to PAID at totalPaid > finalAmount.
      const order = makeOrder({
        totalAmount: new Prisma.Decimal('11.00'),
        discount: new Prisma.Decimal('0'),
        finalAmount: new Prisma.Decimal('11.00'),
      });
      // 10% KDV is *already inside* the 11.00 subtotal; taxAmount of
      // 1.00 is just the extracted-portion bookkeeping, not an addition.
      const item = makeItem('item-A', 1, '11.00', {
        subtotal: new Prisma.Decimal('11.00'),
        taxAmount: new Prisma.Decimal('1.00'),
      });
      (order as any).orderItems = [item];

      (prisma.order.findFirst as unknown as jest.Mock).mockResolvedValue(order);
      (prisma.orderItemPayment.groupBy as unknown as jest.Mock).mockResolvedValue([]);
      (prisma.orderItemPayment.aggregate as unknown as jest.Mock).mockResolvedValue({
        _sum: { amount: new Prisma.Decimal('0') },
      });
      (prisma.payment.create as unknown as jest.Mock).mockImplementation(
        async ({ data }: any) => ({
          id: 'payment-1',
          ...data,
          status: PaymentStatus.COMPLETED,
          paidAt: new Date(),
        }),
      );
      (prisma.payment.aggregate as unknown as jest.Mock).mockResolvedValue({
        _sum: { amount: new Prisma.Decimal('11.00') },
      });
      (prisma.order.count as unknown as jest.Mock).mockResolvedValue(0);
      (prisma.order.findFirst as unknown as jest.Mock)
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce({
          ...order,
          orderItems: [{ ...item, product: { name: 'X' }, modifiers: [], orderItemPayments: [{ quantity: 1 }] }],
          payments: [],
        });

      await svc.payByItems(
        ORDER_ID,
        { items: [{ orderItemId: 'item-A', quantity: 1 }], method: 'CASH' as any },
        TENANT_ID,
      );

      const create = (prisma.payment.create as unknown as jest.Mock).mock.calls[0][0];
      // 11.00 — NOT 12.00. Old buggy formula would have summed
      // subtotal(11) + modifierTotal(0) + taxAmount(1) = 12.
      expect(new Prisma.Decimal(create.data.amount).toFixed(2)).toBe('11.00');
    });

    it('does NOT double-count modifier value (already inside subtotal)', async () => {
      // orders.service.ts:190 stores `subtotal = qty * (price + modifierTotal)`.
      // modifierTotal is bookkeeping for receipt rendering, not a
      // value to add on top of subtotal.
      const order = makeOrder({
        totalAmount: new Prisma.Decimal('30.00'),
        finalAmount: new Prisma.Decimal('30.00'),
      });
      const item = makeItem('item-A', 2, '15.00', {
        subtotal: new Prisma.Decimal('30.00'), // 2 × (10 base + 5 modifier)
        modifierTotal: new Prisma.Decimal('5.00'),
      });
      (order as any).orderItems = [item];

      (prisma.order.findFirst as unknown as jest.Mock).mockResolvedValue(order);
      (prisma.orderItemPayment.groupBy as unknown as jest.Mock).mockResolvedValue([]);
      (prisma.orderItemPayment.aggregate as unknown as jest.Mock).mockResolvedValue({
        _sum: { amount: new Prisma.Decimal('0') },
      });
      (prisma.payment.create as unknown as jest.Mock).mockImplementation(
        async ({ data }: any) => ({ id: 'p1', ...data, status: PaymentStatus.COMPLETED, paidAt: new Date() }),
      );
      (prisma.payment.aggregate as unknown as jest.Mock).mockResolvedValue({
        _sum: { amount: new Prisma.Decimal('15.00') },
      });
      (prisma.order.findFirst as unknown as jest.Mock)
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce({
          ...order,
          orderItems: [{ ...item, product: { name: 'X' }, modifiers: [], orderItemPayments: [] }],
          payments: [],
        });

      await svc.payByItems(
        ORDER_ID,
        { items: [{ orderItemId: 'item-A', quantity: 1 }], method: 'CASH' as any },
        TENANT_ID,
      );

      const create = (prisma.payment.create as unknown as jest.Mock).mock.calls[0][0];
      // 15.00 (subtotal/qty = 30/2), NOT 20.00 (would be 30/2 + 5).
      expect(new Prisma.Decimal(create.data.amount).toFixed(2)).toBe('15.00');
    });

    it('idempotency replay re-derives orderFullyPaid from current state', async () => {
      // The in-tx P2002 branch returns isFullyPaid=false by design;
      // the outer code must re-derive from getPayableItems so a retry
      // after the closing payment still tells the caller orderFullyPaid=true.
      const cached = {
        id: 'payment-existing',
        amount: new Prisma.Decimal('50.00'),
        status: PaymentStatus.COMPLETED,
        method: 'CASH',
        notes: null,
        orderId: ORDER_ID,
        tenantId: TENANT_ID,
        orderItemPayments: [
          { orderItemId: 'item-A', quantity: 1, amount: new Prisma.Decimal('50.00') },
        ],
      };
      (prisma.payment.findFirst as unknown as jest.Mock).mockResolvedValueOnce(cached);
      // getPayableItems read: item paid in full → remainingQuantity=0
      (prisma.order.findFirst as unknown as jest.Mock).mockResolvedValueOnce({
        ...makeOrder({
          finalAmount: new Prisma.Decimal('50.00'),
          status: OrderStatus.PAID,
        }),
        orderItems: [
          {
            ...makeItem('item-A', 1, '50.00'),
            product: { name: 'X' },
            modifiers: [],
            orderItemPayments: [{ quantity: 1 }],
          },
        ],
        payments: [],
      });

      const result = await svc.payByItems(
        ORDER_ID,
        {
          items: [{ orderItemId: 'item-A', quantity: 1 }],
          method: 'CASH' as any,
          idempotencyKey: 'idem-replay-fp',
        },
        TENANT_ID,
      );

      expect(result.orderFullyPaid).toBe(true);
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('applies discount pro-rata so closing payment hits exactly finalAmount', async () => {
      // 100 TL pre-discount, 10 TL discount → 90 TL final. Two equal items.
      // Each item per-unit = 50, after 10% discount factor = 45. Two items
      // sum to 90; the last unit paid eats any rounding residual.
      const order = makeOrder({
        totalAmount: new Prisma.Decimal('100.00'),
        discount: new Prisma.Decimal('10.00'),
        finalAmount: new Prisma.Decimal('90.00'),
      });
      const itemA = makeItem('item-A', 1, '50.00');
      const itemB = makeItem('item-B', 1, '50.00');
      (order as any).orderItems = [itemA, itemB];

      (prisma.order.findFirst as unknown as jest.Mock).mockResolvedValue(order);
      (prisma.orderItemPayment.groupBy as unknown as jest.Mock).mockResolvedValue([]);
      (prisma.orderItemPayment.aggregate as unknown as jest.Mock).mockResolvedValue({
        _sum: { amount: new Prisma.Decimal('0') },
      });
      (prisma.payment.create as unknown as jest.Mock).mockImplementation(
        async ({ data }: any) => ({
          id: 'payment-1',
          ...data,
          status: PaymentStatus.COMPLETED,
          paidAt: new Date(),
        }),
      );
      // After both items paid, aggregate returns full 90.
      (prisma.payment.aggregate as unknown as jest.Mock).mockResolvedValue({
        _sum: { amount: new Prisma.Decimal('90.00') },
      });
      (prisma.order.count as unknown as jest.Mock).mockResolvedValue(0);
      (prisma.order.findFirst as unknown as jest.Mock)
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce({
          ...order,
          status: OrderStatus.PAID,
          orderItems: [
            { ...itemA, product: { name: 'A' }, modifiers: [], orderItemPayments: [{ quantity: 1 }] },
            { ...itemB, product: { name: 'B' }, modifiers: [], orderItemPayments: [{ quantity: 1 }] },
          ],
          payments: [],
        });

      const result = await svc.payByItems(
        ORDER_ID,
        {
          items: [
            { orderItemId: 'item-A', quantity: 1 },
            { orderItemId: 'item-B', quantity: 1 },
          ],
          method: 'CARD' as any,
          transactionId: 'TX-123',
        },
        TENANT_ID,
      );

      // Verify the derived payment.amount equals exactly 90.00.
      const createCall = (prisma.payment.create as unknown as jest.Mock).mock.calls[0][0];
      expect(new Prisma.Decimal(createCall.data.amount).toFixed(2)).toBe('90.00');
      expect(createCall.data.transactionId).toBe('TX-123');
      expect(result.orderFullyPaid).toBe(true);
    });

    it('last-unit residual eats sub-kuruş rounding (3 units totaling 10.01)', async () => {
      // 10.01 TL split across 3 units → per-unit ≈ 3.336666… Each rounds
      // to 3.34 (HALF_UP) but the third (last) entry is set as
      // total - sum(prior) so the order closes at exactly 10.01.
      const order = makeOrder({
        totalAmount: new Prisma.Decimal('10.01'),
        discount: new Prisma.Decimal('0'),
        finalAmount: new Prisma.Decimal('10.01'),
      });
      const itemA = makeItem('item-A', 3, '3.336666666');
      // Force the subtotal/taxAmount sum to exactly 10.01 regardless of
      // unitPrice rounding so the helper math has a clean target.
      itemA.subtotal = new Prisma.Decimal('10.01');
      itemA.modifierTotal = new Prisma.Decimal('0');
      itemA.taxAmount = new Prisma.Decimal('0');
      (order as any).orderItems = [itemA];

      // Three sequential calls — track running prior allocations.
      let priorSum = new Prisma.Decimal('0');
      let paidQty = 0;

      (prisma.order.findFirst as unknown as jest.Mock).mockImplementation(async () => ({
        ...order,
        orderItems: [itemA],
      }));
      (prisma.orderItemPayment.groupBy as unknown as jest.Mock).mockImplementation(async () => [
        { orderItemId: 'item-A', _sum: { quantity: paidQty } },
      ]);
      (prisma.orderItemPayment.aggregate as unknown as jest.Mock).mockImplementation(async () => ({
        _sum: { amount: priorSum },
      }));
      (prisma.payment.create as unknown as jest.Mock).mockImplementation(async ({ data }: any) => {
        priorSum = priorSum.add(new Prisma.Decimal(data.amount));
        return { id: `payment-${paidQty + 1}`, ...data, status: PaymentStatus.COMPLETED, paidAt: new Date() };
      });
      (prisma.orderItemPayment.createMany as unknown as jest.Mock).mockImplementation(
        async ({ data }: any) => {
          paidQty += data[0].quantity;
          return { count: data.length };
        },
      );
      (prisma.payment.aggregate as unknown as jest.Mock).mockImplementation(async () => ({
        _sum: { amount: priorSum },
      }));
      (prisma.order.count as unknown as jest.Mock).mockResolvedValue(0);
      // Stub getPayableItems read.
      const stubPayableRead = () => ({
        ...order,
        orderItems: [{ ...itemA, product: { name: 'X' }, modifiers: [], orderItemPayments: [] }],
        payments: [],
      });
      (prisma.order.findFirst as unknown as jest.Mock).mockImplementation(async () => stubPayableRead());

      for (let i = 0; i < 3; i++) {
        await svc.payByItems(
          ORDER_ID,
          { items: [{ orderItemId: 'item-A', quantity: 1 }], method: 'CASH' as any },
          TENANT_ID,
        );
      }

      // After three single-unit payments, prior sum must equal exactly 10.01.
      expect(priorSum.toFixed(2)).toBe('10.01');
    });
    it('payByItems emits payment:success with initiatedByUserId (waiter)', async () => {
      // The frontend de-dups its own auto-print on the originating
      // tablet by comparing payment:success.initiatedByUserId to the
      // logged-in user's id. If the service forgets to forward the
      // userId, every waiter cash payment double-prints. Locking
      // this in with a spec so a future refactor can't regress it.
      const order = makeOrder({
        finalAmount: new Prisma.Decimal('100.00'),
        totalAmount: new Prisma.Decimal('100.00'),
      });
      const itemA = makeItem('item-A', 1, '50.00');
      const itemB = makeItem('item-B', 1, '50.00');
      (order as any).orderItems = [itemA, itemB];

      (prisma.order.findFirst as unknown as jest.Mock).mockResolvedValue(order);
      (prisma.orderItemPayment.groupBy as unknown as jest.Mock).mockResolvedValue([]);
      (prisma.orderItemPayment.aggregate as unknown as jest.Mock).mockResolvedValue({
        _sum: { amount: new Prisma.Decimal('0') },
      });
      (prisma.payment.create as unknown as jest.Mock).mockResolvedValue({
        id: 'payment-1',
        orderId: ORDER_ID,
        amount: new Prisma.Decimal('50.00'),
        method: 'CASH',
        status: PaymentStatus.COMPLETED,
        receiptSnapshot: null,
      });
      (prisma.payment.aggregate as unknown as jest.Mock).mockResolvedValue({
        _sum: { amount: new Prisma.Decimal('50.00') },
      });
      // getPayableItems read at the end of payByItems.
      (prisma.order.findFirst as unknown as jest.Mock)
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce({
          ...order,
          orderItems: [
            { ...itemA, product: { name: 'A' }, modifiers: [], orderItemPayments: [{ quantity: 1 }] },
            { ...itemB, product: { name: 'B' }, modifiers: [], orderItemPayments: [] },
          ],
          payments: [],
        });

      const WAITER_USER_ID = 'waiter-jwt-id';
      await svc.payByItems(
        ORDER_ID,
        { items: [{ orderItemId: 'item-A', quantity: 1 }], method: 'CASH' as any },
        TENANT_ID,
        WAITER_USER_ID,
      );

      expect(kdsGateway.emitPaymentSuccess).toHaveBeenCalledTimes(1);
      // v3.0.0 — emit signature is now (tenantId, branchId, payment, userId).
      // branchId is forwarded from the payment.branchId (derived from
      // order.branchId) so the socket room is per-branch.
      const [emitTenantId, , emitPayment, emitUserId] =
        kdsGateway.emitPaymentSuccess.mock.calls[0];
      expect(emitTenantId).toBe(TENANT_ID);
      expect(emitPayment.id).toBe('payment-1');
      expect(emitUserId).toBe(WAITER_USER_ID);
    });

    it('payByItems emits with initiatedByUserId=null on webhook origin', async () => {
      // Customer self-pay path: CustomerSelfPayService.handleWebhookSuccess
      // calls payByItems without a userId. The emit must echo null so
      // EVERY tablet (no logged-in user matches) prints the receipt.
      const order = makeOrder({
        finalAmount: new Prisma.Decimal('50.00'),
        totalAmount: new Prisma.Decimal('50.00'),
      });
      const itemA = makeItem('item-A', 1, '50.00');
      (order as any).orderItems = [itemA];

      (prisma.order.findFirst as unknown as jest.Mock).mockResolvedValue(order);
      (prisma.orderItemPayment.groupBy as unknown as jest.Mock).mockResolvedValue([]);
      (prisma.orderItemPayment.aggregate as unknown as jest.Mock).mockResolvedValue({
        _sum: { amount: new Prisma.Decimal('0') },
      });
      (prisma.payment.create as unknown as jest.Mock).mockResolvedValue({
        id: 'payment-webhook-1',
        orderId: ORDER_ID,
        amount: new Prisma.Decimal('50.00'),
        method: 'CARD',
        status: PaymentStatus.COMPLETED,
        receiptSnapshot: null,
      });
      (prisma.payment.aggregate as unknown as jest.Mock).mockResolvedValue({
        _sum: { amount: new Prisma.Decimal('50.00') },
      });
      (prisma.order.count as unknown as jest.Mock).mockResolvedValue(0);
      (prisma.order.findFirst as unknown as jest.Mock)
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce({
          ...order,
          orderItems: [{ ...itemA, product: { name: 'A' }, modifiers: [], orderItemPayments: [{ quantity: 1 }] }],
          payments: [],
        });

      // No userId passed (mimics CustomerSelfPayService.handleWebhookSuccess).
      await svc.payByItems(
        ORDER_ID,
        { items: [{ orderItemId: 'item-A', quantity: 1 }], method: 'CARD' as any },
        TENANT_ID,
      );

      expect(kdsGateway.emitPaymentSuccess).toHaveBeenCalledTimes(1);
      // v3.0.0 — 4-arg emit: (tenantId, branchId, payment, userId).
      // Webhook path passes null for the userId so every tablet prints.
      const [, , , emitUserId] = kdsGateway.emitPaymentSuccess.mock.calls[0];
      expect(emitUserId).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // getPayableItems — paid/remaining shape
  // ──────────────────────────────────────────────────────────────────

  describe('getPayableItems', () => {
    it('reports paid and remaining quantities per item', async () => {
      const itemA = makeItem('item-A', 2, '25.00');
      const itemB = makeItem('item-B', 1, '50.00');

      (prisma.order.findFirst as unknown as jest.Mock).mockResolvedValue({
        ...makeOrder({ finalAmount: new Prisma.Decimal('100.00') }),
        orderItems: [
          {
            ...itemA,
            product: { name: 'Cola' },
            modifiers: [],
            orderItemPayments: [{ quantity: 1, paymentId: 'p1' }],
          },
          {
            ...itemB,
            product: { name: 'Burger' },
            modifiers: [],
            orderItemPayments: [],
          },
        ],
        payments: [
          {
            id: 'p1',
            amount: new Prisma.Decimal('25.00'),
            method: 'CASH',
            notes: 'Ali',
            paidAt: new Date(),
            orderItemPayments: [{ orderItemId: 'item-A', quantity: 1, amount: new Prisma.Decimal('25.00') }],
          },
        ],
      });

      const summary = await svc.getPayableItems(ORDER_ID, TENANT_ID);

      expect(summary.finalAmount).toBe('100.00');
      expect(summary.paidAmount).toBe('25.00');
      expect(summary.remainingAmount).toBe('75.00');
      expect(summary.remainingQuantity).toBe(2); // itemA:1 + itemB:1
      const a = summary.items.find((i) => i.orderItemId === 'item-A')!;
      expect(a.paidQuantity).toBe(1);
      expect(a.remainingQuantity).toBe(1);
      expect(a.unitTotal).toBe('25.00');
      expect(a.itemTotal).toBe('50.00'); // server-authoritative discount-adjusted line total
      const b = summary.items.find((i) => i.orderItemId === 'item-B')!;
      expect(b.paidQuantity).toBe(0);
      expect(b.remainingQuantity).toBe(1);
      expect(b.itemTotal).toBe('50.00');
    });

    it('writeOff: closes order via HOUSE payment, no CRM stat bump', async () => {
      // 2/3 paid via progressive; manager writes off the rest. Expected:
      // - one HOUSE Payment with remaining amount
      // - order → PAID, table → AVAILABLE
      // - no customer.totalSpent bump (it's not real revenue)
      const order = makeOrder({
        finalAmount: new Prisma.Decimal('100.00'),
        totalAmount: new Prisma.Decimal('100.00'),
      });
      (prisma.order.findFirst as unknown as jest.Mock).mockResolvedValue(order);
      // Already paid 60 of 100 → 40 to be written off.
      (prisma.payment.aggregate as unknown as jest.Mock).mockResolvedValue({
        _sum: { amount: new Prisma.Decimal('60.00') },
      });
      (prisma.payment.findFirst as unknown as jest.Mock).mockResolvedValueOnce(null); // no prior idempotent match
      (prisma.payment.create as unknown as jest.Mock).mockImplementation(
        async ({ data }: any) => ({
          id: 'payment-house-1',
          ...data,
          status: PaymentStatus.COMPLETED,
          paidAt: new Date(),
        }),
      );
      (prisma.order.count as unknown as jest.Mock).mockResolvedValue(0);

      const result = await (svc as any).writeOff(
        ORDER_ID,
        { reason: 'no-show' },
        TENANT_ID,
      );

      const createCall = (prisma.payment.create as unknown as jest.Mock).mock.calls[0][0];
      expect(createCall.data.method).toBe('HOUSE');
      expect(new Prisma.Decimal(createCall.data.amount).toFixed(2)).toBe('40.00');
      expect(createCall.data.notes).toBe('no-show');
      // No customer stat bump.
      expect(prisma.customer.update).not.toHaveBeenCalled();
      // Order flipped to PAID.
      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: OrderStatus.PAID }),
        }),
      );
      expect(result.orderFullyPaid).toBe(true);
    });

    it('per-payment customer linkage bumps stats by THIS payment only', async () => {
      // Customer A pays 25, customer B pays 75 with their own phone.
      // Each gets their own Customer record bumped by their own slice.
      const order = makeOrder({
        finalAmount: new Prisma.Decimal('100.00'),
        totalAmount: new Prisma.Decimal('100.00'),
      });
      const itemA = makeItem('item-A', 1, '25.00');
      const itemB = makeItem('item-B', 1, '75.00');
      (order as any).orderItems = [itemA, itemB];

      (prisma.order.findFirst as unknown as jest.Mock).mockResolvedValue(order);
      (prisma.orderItemPayment.groupBy as unknown as jest.Mock).mockResolvedValue([]);
      (prisma.orderItemPayment.aggregate as unknown as jest.Mock).mockResolvedValue({
        _sum: { amount: new Prisma.Decimal('0') },
      });
      (prisma.payment.create as unknown as jest.Mock).mockImplementation(
        async ({ data }: any) => ({
          id: 'p-A',
          ...data,
          status: PaymentStatus.COMPLETED,
          paidAt: new Date(),
        }),
      );
      (prisma.customer.findFirst as unknown as jest.Mock).mockResolvedValue(null);
      (prisma.customer.create as unknown as jest.Mock).mockResolvedValue({
        id: 'cust-A',
        phone: '+905551112233',
        totalOrders: 0,
        totalSpent: new Prisma.Decimal('0'),
      });
      (prisma.customer.findUnique as unknown as jest.Mock).mockResolvedValue({
        id: 'cust-A',
        totalOrders: 0,
        totalSpent: new Prisma.Decimal('0'),
      });
      (prisma.payment.count as unknown as jest.Mock).mockResolvedValue(0);
      (prisma.payment.aggregate as unknown as jest.Mock).mockResolvedValue({
        _sum: { amount: new Prisma.Decimal('25.00') },
      });
      (prisma.order.findFirst as unknown as jest.Mock)
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce({
          ...order,
          orderItems: [
            { ...itemA, product: { name: 'A' }, modifiers: [], orderItemPayments: [{ quantity: 1 }] },
            { ...itemB, product: { name: 'B' }, modifiers: [], orderItemPayments: [] },
          ],
          payments: [],
        });

      await svc.payByItems(
        ORDER_ID,
        {
          items: [{ orderItemId: 'item-A', quantity: 1 }],
          method: 'CASH' as any,
          customerPhone: '+905551112233',
        },
        TENANT_ID,
      );

      // Stats bump = payment.amount (25), not order.finalAmount (100).
      const updateCalls = (prisma.customer.update as unknown as jest.Mock).mock.calls;
      const bumpCall = updateCalls.find((c) => c[0]?.data?.totalSpent);
      expect(bumpCall).toBeDefined();
      expect(new Prisma.Decimal(bumpCall[0].data.totalSpent).toFixed(2)).toBe('25.00');
    });

    it('itemTotal applies discount pro-rata', async () => {
      // 100 TL total, 10 TL discount → 90 TL final. 50 TL line gets
      // 90% factor = 45.00 itemTotal.
      (prisma.order.findFirst as unknown as jest.Mock).mockResolvedValue({
        ...makeOrder({
          totalAmount: new Prisma.Decimal('100.00'),
          discount: new Prisma.Decimal('10.00'),
          finalAmount: new Prisma.Decimal('90.00'),
        }),
        orderItems: [
          {
            ...makeItem('item-A', 1, '50.00'),
            product: { name: 'A' },
            modifiers: [],
            orderItemPayments: [],
          },
          {
            ...makeItem('item-B', 1, '50.00'),
            product: { name: 'B' },
            modifiers: [],
            orderItemPayments: [],
          },
        ],
        payments: [],
      });

      const summary = await svc.getPayableItems(ORDER_ID, TENANT_ID);
      expect(summary.items.every((i) => i.itemTotal === '45.00')).toBe(true);
    });
  });
});
