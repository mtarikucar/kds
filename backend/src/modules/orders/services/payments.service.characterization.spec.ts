import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaymentsService } from './payments.service';
import {
  mockPrismaClient,
  MockPrismaClient,
} from '../../../common/test/prisma-mock.service';
import { OrderStatus, PaymentStatus } from '../../../common/constants/order-status.enum';

/**
 * CHARACTERIZATION TESTS — pin the CURRENT behaviour of the three payment
 * entry points that previously lacked live unit coverage (create,
 * splitBill, updateStatus) plus the idempotency-replay branches and,
 * CRITICALLY, the assertNoConflictingSelfPayIntent self-pay guard on
 * BOTH create() and splitBill().
 *
 * These tests were written GREEN against the un-refactored 2158-LOC
 * facade and must stay byte-identical-green through the extraction into
 * PaymentMathCalculator + PaymentFinalizer. They reuse the same mock-
 * prisma harness as payments.service.spec.ts; $transaction(fn) runs the
 * callback synchronously against the same mock.
 */
describe('PaymentsService — characterization (create / splitBill / updateStatus)', () => {
  const TENANT_ID = 'tenant-1';
  const ORDER_ID = 'order-1';
  const TABLE_ID = 'table-1';
  const BRANCH_ID = 'branch-1';

  let prisma: MockPrismaClient;
  let ordersService: { findOne: jest.Mock; findOneByTenant: jest.Mock };
  let customersService: any;
  let receiptSnapshotBuilder: any;
  let salesInvoice: any;
  let accountingSettings: any;
  let stockDeduction: any;
  let loyalty: any;
  let kdsGateway: { emitPaymentSuccess: jest.Mock };
  let svc: PaymentsService;

  function wireTransaction() {
    (prisma.$transaction as unknown as jest.Mock).mockImplementation(
      async (fn: any, _opts?: any) => {
        if (typeof fn === 'function') return fn(prisma);
        return Promise.all(fn);
      },
    );
    (prisma.$queryRaw as unknown as jest.Mock).mockResolvedValue([
      { id: ORDER_ID },
    ]);
  }

  function makeOrder(overrides: Partial<any> = {}) {
    return {
      id: ORDER_ID,
      orderNumber: 'ORD-001',
      tenantId: TENANT_ID,
      branchId: BRANCH_ID,
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

  beforeEach(() => {
    prisma = mockPrismaClient();
    ordersService = {
      findOne: jest.fn().mockResolvedValue(makeOrder()),
      findOneByTenant: jest.fn().mockResolvedValue(makeOrder()),
    };
    customersService = {};
    receiptSnapshotBuilder = {
      buildReceiptSnapshot: jest.fn().mockReturnValue({}),
      buildKitchenTicketSnapshot: jest.fn().mockReturnValue({}),
    };
    salesInvoice = {
      createFromOrder: jest.fn().mockResolvedValue(undefined),
      createFromPayment: jest.fn().mockResolvedValue(undefined),
    };
    accountingSettings = {
      findByTenant: jest.fn().mockResolvedValue({ autoGenerateInvoice: false }),
    };
    stockDeduction = {
      reverseForOrder: jest.fn().mockResolvedValue(undefined),
    };
    loyalty = {
      earnPointsFromOrder: jest.fn().mockResolvedValue(undefined),
    };
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
    // Default: no conflicting self-pay intent. findFirst (used by the
    // guard) and findMany (used by payByItems) both empty.
    (prisma.pendingSelfPayment.findFirst as unknown as jest.Mock).mockResolvedValue(null);
    (prisma.pendingSelfPayment.findMany as unknown as jest.Mock).mockResolvedValue([]);
  });

  // ────────────────────────────────────────────────────────────────────
  // create() — happy path / idempotency replay / self-pay guard
  // ────────────────────────────────────────────────────────────────────

  describe('create()', () => {
    it('records a full payment, flips the order to PAID and releases the table', async () => {
      const order = makeOrder();
      (prisma.order.findFirst as unknown as jest.Mock).mockResolvedValue(order);
      // No prior completed payments → remaining = finalAmount.
      (prisma.payment.aggregate as unknown as jest.Mock).mockResolvedValue({
        _sum: { amount: new Prisma.Decimal('0') },
      });
      // payment.create returns the created row (with order include).
      (prisma.payment.create as unknown as jest.Mock).mockResolvedValue({
        id: 'payment-1',
        orderId: ORDER_ID,
        branchId: BRANCH_ID,
        amount: new Prisma.Decimal('100.00'),
        method: 'CASH',
        status: PaymentStatus.COMPLETED,
        receiptSnapshot: null,
        order: { id: ORDER_ID, orderItems: [] },
      });
      // After insert, total paid == finalAmount → fully paid.
      (prisma.payment.aggregate as unknown as jest.Mock)
        .mockResolvedValueOnce({ _sum: { amount: new Prisma.Decimal('0') } })
        .mockResolvedValueOnce({
          _sum: { amount: new Prisma.Decimal('100.00') },
        });
      (prisma.order.count as unknown as jest.Mock).mockResolvedValue(0);

      const result = await svc.create(
        ORDER_ID,
        { amount: 100.0, method: 'CASH' as any },
        TENANT_ID,
        'waiter-1',
      );

      // Self-pay guard was consulted inside the tx.
      expect(prisma.pendingSelfPayment.findFirst).toHaveBeenCalled();
      // Payment row written with COMPLETED + branch derived from order.
      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amount: 100.0,
            method: 'CASH',
            status: PaymentStatus.COMPLETED,
            orderId: ORDER_ID,
            tenantId: TENANT_ID,
            branchId: BRANCH_ID,
          }),
        }),
      );
      // Order finalized → PAID.
      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ORDER_ID },
          data: expect.objectContaining({ status: OrderStatus.PAID }),
        }),
      );
      // Table released via compound (id, tenantId) updateMany.
      expect(prisma.table.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: TABLE_ID, tenantId: TENANT_ID },
          data: { status: 'AVAILABLE' },
        }),
      );
      // Post-commit emit forwards the waiter userId.
      expect(kdsGateway.emitPaymentSuccess).toHaveBeenCalledTimes(1);
      const [emitTenantId, , , emitUserId] =
        kdsGateway.emitPaymentSuccess.mock.calls[0];
      expect(emitTenantId).toBe(TENANT_ID);
      expect(emitUserId).toBe('waiter-1');
      expect(result.id).toBe('payment-1');
    });

    it('rejects an overpayment beyond the ±0.01 tolerance', async () => {
      const order = makeOrder({ finalAmount: new Prisma.Decimal('100.00') });
      (prisma.order.findFirst as unknown as jest.Mock).mockResolvedValue(order);
      (prisma.payment.aggregate as unknown as jest.Mock).mockResolvedValue({
        _sum: { amount: new Prisma.Decimal('0') },
      });

      await expect(
        svc.create(
          ORDER_ID,
          { amount: 100.02, method: 'CASH' as any },
          TENANT_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('accepts a payment within the +0.01 tolerance (float-legacy caller)', async () => {
      const order = makeOrder({ finalAmount: new Prisma.Decimal('100.00') });
      (prisma.order.findFirst as unknown as jest.Mock).mockResolvedValue(order);
      (prisma.payment.aggregate as unknown as jest.Mock)
        .mockResolvedValueOnce({ _sum: { amount: new Prisma.Decimal('0') } })
        .mockResolvedValueOnce({
          _sum: { amount: new Prisma.Decimal('100.01') },
        });
      (prisma.payment.create as unknown as jest.Mock).mockResolvedValue({
        id: 'payment-tol',
        orderId: ORDER_ID,
        branchId: BRANCH_ID,
        amount: new Prisma.Decimal('100.01'),
        method: 'CASH',
        status: PaymentStatus.COMPLETED,
      });
      (prisma.order.count as unknown as jest.Mock).mockResolvedValue(0);

      // amount 100.01 == remaining(100) + tolerance(0.01) → allowed.
      await expect(
        svc.create(
          ORDER_ID,
          { amount: 100.01, method: 'CASH' as any },
          TENANT_ID,
        ),
      ).resolves.toBeDefined();
      expect(prisma.payment.create).toHaveBeenCalled();
    });

    it('returns the existing payment on the idempotency fast-path (no tx)', async () => {
      const cached = {
        id: 'payment-cached',
        orderId: ORDER_ID,
        idempotencyKey: 'idem-create-1',
        order: { id: ORDER_ID, orderItems: [] },
      };
      (prisma.payment.findFirst as unknown as jest.Mock).mockResolvedValueOnce(
        cached,
      );

      const result = await svc.create(
        ORDER_ID,
        { amount: 100.0, method: 'CASH' as any, idempotencyKey: 'idem-create-1' },
        TENANT_ID,
      );

      expect(result).toBe(cached);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('resolves a P2002 idempotency race to the already-stored payment', async () => {
      const order = makeOrder();
      (prisma.order.findFirst as unknown as jest.Mock).mockResolvedValue(order);
      // No fast-path hit on the first findFirst.
      (prisma.payment.findFirst as unknown as jest.Mock)
        .mockResolvedValueOnce(null) // fast-path miss
        .mockResolvedValueOnce({
          id: 'payment-winner',
          orderId: ORDER_ID,
          idempotencyKey: 'idem-race',
          order: { id: ORDER_ID, orderItems: [] },
        }); // post-P2002 recovery read
      (prisma.payment.aggregate as unknown as jest.Mock).mockResolvedValue({
        _sum: { amount: new Prisma.Decimal('0') },
      });
      // payment.create throws the unique-violation.
      (prisma.payment.create as unknown as jest.Mock).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'x',
        }),
      );

      const result = await svc.create(
        ORDER_ID,
        { amount: 100.0, method: 'CASH' as any, idempotencyKey: 'idem-race' },
        TENANT_ID,
      );

      expect((result as any).id).toBe('payment-winner');
    });

    it('throws ConflictException when a customer has a live PENDING self-pay intent on this order', async () => {
      const order = makeOrder();
      (prisma.order.findFirst as unknown as jest.Mock).mockResolvedValue(order);
      (prisma.payment.aggregate as unknown as jest.Mock).mockResolvedValue({
        _sum: { amount: new Prisma.Decimal('0') },
      });
      // A non-expired PENDING intent references THIS order.
      (prisma.pendingSelfPayment.findFirst as unknown as jest.Mock).mockResolvedValue({
        itemsByOrder: [{ orderId: ORDER_ID }],
        expiresAt: new Date(Date.now() + 60_000),
      });

      await expect(
        svc.create(
          ORDER_ID,
          { amount: 100.0, method: 'CASH' as any },
          TENANT_ID,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      // The guard fires BEFORE any payment row is written.
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('does NOT block create() when the pending intent is for a DIFFERENT order', async () => {
      const order = makeOrder();
      (prisma.order.findFirst as unknown as jest.Mock).mockResolvedValue(order);
      (prisma.payment.aggregate as unknown as jest.Mock)
        .mockResolvedValueOnce({ _sum: { amount: new Prisma.Decimal('0') } })
        .mockResolvedValueOnce({
          _sum: { amount: new Prisma.Decimal('100.00') },
        });
      (prisma.pendingSelfPayment.findFirst as unknown as jest.Mock).mockResolvedValue({
        itemsByOrder: [{ orderId: 'some-other-order' }],
        expiresAt: new Date(Date.now() + 60_000),
      });
      (prisma.payment.create as unknown as jest.Mock).mockResolvedValue({
        id: 'payment-ok',
        orderId: ORDER_ID,
        branchId: BRANCH_ID,
        amount: new Prisma.Decimal('100.00'),
        method: 'CASH',
        status: PaymentStatus.COMPLETED,
      });
      (prisma.order.count as unknown as jest.Mock).mockResolvedValue(0);

      await expect(
        svc.create(
          ORDER_ID,
          { amount: 100.0, method: 'CASH' as any },
          TENANT_ID,
        ),
      ).resolves.toBeDefined();
      expect(prisma.payment.create).toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // splitBill()
  // ────────────────────────────────────────────────────────────────────

  describe('splitBill()', () => {
    function stageOrderForSplit(overrides: Partial<any> = {}) {
      const order = {
        ...makeOrder(overrides),
        orderItems: [],
        payments: [],
      };
      // preCheck read, then in-tx read.
      (prisma.order.findFirst as unknown as jest.Mock).mockResolvedValue(order);
      return order;
    }

    it('creates one payment per split entry and finalizes when fully paid', async () => {
      stageOrderForSplit();
      (prisma.payment.create as unknown as jest.Mock).mockImplementation(
        async ({ data }: any) => ({
          id: `pay-${data.amount}`,
          orderId: ORDER_ID,
          branchId: BRANCH_ID,
          ...data,
          status: PaymentStatus.COMPLETED,
        }),
      );
      (prisma.payment.aggregate as unknown as jest.Mock).mockResolvedValue({
        _sum: { amount: new Prisma.Decimal('100.00') },
      });
      (prisma.order.count as unknown as jest.Mock).mockResolvedValue(0);

      const result = await svc.splitBill(
        ORDER_ID,
        {
          splitType: 'CUSTOM' as any,
          payments: [
            { amount: 60.0, method: 'CASH' as any, label: 'Ali' },
            { amount: 40.0, method: 'CARD' as any, label: 'Veli' },
          ],
        },
        TENANT_ID,
        'waiter-2',
      );

      expect(prisma.pendingSelfPayment.findFirst).toHaveBeenCalled();
      expect(prisma.payment.create).toHaveBeenCalledTimes(2);
      expect(result.orderFullyPaid).toBe(true);
      expect(result.payments).toHaveLength(2);
      // __replayed internal tag stripped from the response.
      for (const p of result.payments) {
        expect((p as any).__replayed).toBeUndefined();
      }
      // Fresh inserts each emit payment:success.
      expect(kdsGateway.emitPaymentSuccess).toHaveBeenCalledTimes(2);
      // splitBill finalizes WITHOUT bumping customer stats.
      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: OrderStatus.PAID }),
        }),
      );
      expect(prisma.customer.updateMany).not.toHaveBeenCalled();
    });

    it('rejects a split whose total is below remaining beyond tolerance', async () => {
      stageOrderForSplit();

      await expect(
        svc.splitBill(
          ORDER_ID,
          {
            splitType: 'CUSTOM' as any,
            payments: [
              { amount: 50.0, method: 'CASH' as any },
              { amount: 49.0, method: 'CASH' as any },
            ],
          },
          TENANT_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('recovers a P2002 split entry as a replayed payment (no double-emit)', async () => {
      stageOrderForSplit();
      let calls = 0;
      (prisma.payment.create as unknown as jest.Mock).mockImplementation(
        async ({ data }: any) => {
          calls += 1;
          if (calls === 2) {
            throw new Prisma.PrismaClientKnownRequestError('dup', {
              code: 'P2002',
              clientVersion: 'x',
            });
          }
          return {
            id: 'pay-fresh',
            orderId: ORDER_ID,
            branchId: BRANCH_ID,
            ...data,
            status: PaymentStatus.COMPLETED,
          };
        },
      );
      // The P2002 recovery read returns the already-stored entry.
      (prisma.payment.findFirst as unknown as jest.Mock).mockResolvedValue({
        id: 'pay-replayed',
        orderId: ORDER_ID,
        branchId: BRANCH_ID,
        amount: new Prisma.Decimal('40.00'),
        method: 'CARD',
        status: PaymentStatus.COMPLETED,
      });
      (prisma.payment.aggregate as unknown as jest.Mock).mockResolvedValue({
        _sum: { amount: new Prisma.Decimal('100.00') },
      });
      (prisma.order.count as unknown as jest.Mock).mockResolvedValue(0);

      const result = await svc.splitBill(
        ORDER_ID,
        {
          splitType: 'CUSTOM' as any,
          idempotencyKey: 'batch-1',
          payments: [
            { amount: 60.0, method: 'CASH' as any },
            { amount: 40.0, method: 'CARD' as any },
          ],
        },
        TENANT_ID,
      );

      expect(result.payments).toHaveLength(2);
      // Only the fresh insert emits; the replayed entry is skipped.
      expect(kdsGateway.emitPaymentSuccess).toHaveBeenCalledTimes(1);
      // __replayed stripped from response.
      for (const p of result.payments) {
        expect((p as any).__replayed).toBeUndefined();
      }
    });

    it('throws ConflictException when a customer has a live PENDING self-pay intent on this order', async () => {
      stageOrderForSplit();
      (prisma.pendingSelfPayment.findFirst as unknown as jest.Mock).mockResolvedValue({
        itemsByOrder: [{ orderId: ORDER_ID }],
        expiresAt: new Date(Date.now() + 60_000),
      });

      await expect(
        svc.splitBill(
          ORDER_ID,
          {
            splitType: 'CUSTOM' as any,
            payments: [
              { amount: 60.0, method: 'CASH' as any },
              { amount: 40.0, method: 'CARD' as any },
            ],
          },
          TENANT_ID,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('rejects splitting an already-paid order', async () => {
      (prisma.order.findFirst as unknown as jest.Mock).mockResolvedValue(
        makeOrder({ status: OrderStatus.PAID }),
      );

      await expect(
        svc.splitBill(
          ORDER_ID,
          {
            splitType: 'CUSTOM' as any,
            payments: [{ amount: 100.0, method: 'CASH' as any }],
          },
          TENANT_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // updateStatus() — transitions + REFUND unwind
  // ────────────────────────────────────────────────────────────────────

  describe('updateStatus()', () => {
    it('rejects an invalid transition (COMPLETED → PENDING)', async () => {
      (prisma.payment.findFirst as unknown as jest.Mock).mockResolvedValue({
        id: 'p1',
        status: PaymentStatus.COMPLETED,
        tenantId: TENANT_ID,
        order: makeOrder({ status: OrderStatus.PAID }),
      });

      await expect(
        svc.updateStatus('p1', PaymentStatus.PENDING, TENANT_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('completes a PENDING → COMPLETED transition via compound updateMany', async () => {
      (prisma.payment.findFirst as unknown as jest.Mock).mockResolvedValue({
        id: 'p1',
        status: PaymentStatus.PENDING,
        tenantId: TENANT_ID,
        order: makeOrder(),
      });
      (prisma.payment.updateMany as unknown as jest.Mock).mockResolvedValue({
        count: 1,
      });
      (prisma.payment.findFirstOrThrow as unknown as jest.Mock).mockResolvedValue({
        id: 'p1',
        status: PaymentStatus.COMPLETED,
      });

      const result = await svc.updateStatus(
        'p1',
        PaymentStatus.COMPLETED,
        TENANT_ID,
      );

      expect(prisma.payment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'p1', tenantId: TENANT_ID },
          data: expect.objectContaining({ status: PaymentStatus.COMPLETED }),
        }),
      );
      expect((result as any).status).toBe(PaymentStatus.COMPLETED);
    });

    it('REFUND of the only completed payment → order CANCELLED + stock reversal + stats rollback', async () => {
      const payment = {
        id: 'p-refund',
        amount: new Prisma.Decimal('100.00'),
        status: PaymentStatus.COMPLETED,
        orderId: ORDER_ID,
        tenantId: TENANT_ID,
        order: makeOrder({
          status: OrderStatus.PAID,
          customerId: 'cust-1',
          finalAmount: new Prisma.Decimal('100.00'),
        }),
      };
      (prisma.payment.findFirst as unknown as jest.Mock).mockResolvedValue(
        payment,
      );
      (prisma.payment.updateMany as unknown as jest.Mock).mockResolvedValue({
        count: 1,
      });
      (prisma.orderItemPayment.deleteMany as unknown as jest.Mock).mockResolvedValue({
        count: 0,
      });
      (prisma.payment.findUnique as unknown as jest.Mock).mockResolvedValue({
        id: 'p-refund',
        status: PaymentStatus.REFUNDED,
      });
      // Remaining completed sum after the refund = 0 (< finalAmount).
      (prisma.payment.aggregate as unknown as jest.Mock).mockResolvedValue({
        _sum: { amount: new Prisma.Decimal('0') },
      });
      // No other completed payments survive → full unwind path.
      (prisma.payment.count as unknown as jest.Mock).mockResolvedValue(0);
      (prisma.customer.findFirst as unknown as jest.Mock).mockResolvedValue({
        id: 'cust-1',
        totalOrders: 3,
        totalSpent: new Prisma.Decimal('300.00'),
      });

      const result = await svc.updateStatus(
        'p-refund',
        PaymentStatus.REFUNDED,
        TENANT_ID,
      );

      // Atomic claim flips status → REFUNDED.
      expect(prisma.payment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'p-refund', status: PaymentStatus.COMPLETED },
          data: expect.objectContaining({ status: PaymentStatus.REFUNDED }),
        }),
      );
      // Allocations freed.
      expect(prisma.orderItemPayment.deleteMany).toHaveBeenCalledWith({
        where: { paymentId: 'p-refund' },
      });
      // Order → CANCELLED (single-payment unwind).
      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ORDER_ID },
          data: expect.objectContaining({ status: OrderStatus.CANCELLED }),
        }),
      );
      // Customer stats rolled back by this payment's amount.
      expect(prisma.customer.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ totalOrders: 2 }),
        }),
      );
      // Stock reversal ran AFTER commit because order moved to CANCELLED.
      expect(stockDeduction.reverseForOrder).toHaveBeenCalledWith(
        ORDER_ID,
        TENANT_ID,
      );
      expect((result as any).status).toBe(PaymentStatus.REFUNDED);
    });

    it('REFUND with other completed payments surviving → order back to SERVED, no stock reversal', async () => {
      const payment = {
        id: 'p-refund-2',
        amount: new Prisma.Decimal('40.00'),
        status: PaymentStatus.COMPLETED,
        orderId: ORDER_ID,
        tenantId: TENANT_ID,
        order: makeOrder({
          status: OrderStatus.PAID,
          customerId: null,
          finalAmount: new Prisma.Decimal('100.00'),
        }),
      };
      (prisma.payment.findFirst as unknown as jest.Mock).mockResolvedValue(
        payment,
      );
      (prisma.payment.updateMany as unknown as jest.Mock).mockResolvedValue({
        count: 1,
      });
      (prisma.orderItemPayment.deleteMany as unknown as jest.Mock).mockResolvedValue({
        count: 0,
      });
      (prisma.payment.findUnique as unknown as jest.Mock).mockResolvedValue({
        id: 'p-refund-2',
        status: PaymentStatus.REFUNDED,
      });
      // Remaining completed (60) < finalAmount (100) → unwind needed.
      (prisma.payment.aggregate as unknown as jest.Mock).mockResolvedValue({
        _sum: { amount: new Prisma.Decimal('60.00') },
      });
      // Other completed payments survive → partial unwind to SERVED.
      (prisma.payment.count as unknown as jest.Mock).mockResolvedValue(1);

      await svc.updateStatus('p-refund-2', PaymentStatus.REFUNDED, TENANT_ID);

      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ORDER_ID },
          data: expect.objectContaining({ status: OrderStatus.SERVED }),
        }),
      );
      // Table kept OCCUPIED.
      expect(prisma.table.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'OCCUPIED' },
        }),
      );
      // No stock reversal on the partial unwind.
      expect(stockDeduction.reverseForOrder).not.toHaveBeenCalled();
    });
  });
});
