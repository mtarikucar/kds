import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';
import * as Sentry from '@sentry/node';
import { PaymentFinalizer } from './payment-finalizer.service';
import {
  OrderStatus,
  PaymentStatus,
} from '../../../common/constants/order-status.enum';
import { TableStatus } from '../../tables/dto/create-table.dto';

jest.mock('@sentry/node', () => ({
  captureException: jest.fn(),
}));

/**
 * Dedicated spec for PaymentFinalizer — the in-transaction finalization
 * cluster lifted out of PaymentsService. Every mutating method takes the
 * active `tx` (Prisma.TransactionClient) as its FIRST argument and runs no
 * $transaction of its own, so each is driven directly here with a
 * deep-mocked tx. The post-commit helpers (loyalty, auto-invoice, socket
 * emit) take the real PrismaService / collaborators.
 *
 * Assertions target the exact where/data Prisma shapes and the branch
 * decisions (table release vs. not, customer-stats dedupe, retry loop) —
 * each test FAILS if the corresponding branch regresses.
 */
describe('PaymentFinalizer', () => {
  const TENANT_ID = 'tenant-1';
  const ORDER_ID = 'order-1';
  const TABLE_ID = 'table-1';

  let prisma: DeepMockProxy<PrismaClient>;
  let tx: DeepMockProxy<Prisma.TransactionClient>;
  let receiptSnapshotBuilder: { buildReceiptSnapshot: jest.Mock };
  let loyalty: { earnPointsFromOrder: jest.Mock };
  let salesInvoice: {
    createFromOrder: jest.Mock;
    createFromPayment: jest.Mock;
  };
  let accountingSettings: { findByTenant: jest.Mock };
  let kdsGateway: { emitPaymentSuccess: jest.Mock };
  let finalizer: PaymentFinalizer;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = mockDeep<PrismaClient>();
    tx = mockDeep<Prisma.TransactionClient>();
    receiptSnapshotBuilder = {
      buildReceiptSnapshot: jest.fn().mockReturnValue({ snap: true }),
    };
    loyalty = { earnPointsFromOrder: jest.fn().mockResolvedValue(undefined) };
    salesInvoice = {
      createFromOrder: jest.fn().mockResolvedValue(undefined),
      createFromPayment: jest.fn().mockResolvedValue(undefined),
    };
    accountingSettings = {
      findByTenant: jest.fn().mockResolvedValue({ autoGenerateInvoice: true }),
    };
    kdsGateway = { emitPaymentSuccess: jest.fn() };
    finalizer = new PaymentFinalizer(
      prisma as any,
      receiptSnapshotBuilder as any,
      loyalty as any,
      salesInvoice as any,
      accountingSettings as any,
      kdsGateway as any,
    );
  });

  function makeOrder(overrides: Partial<any> = {}) {
    return {
      id: ORDER_ID,
      tableId: TABLE_ID,
      customerId: null,
      customerPhone: null,
      finalAmount: new Prisma.Decimal('100.00'),
      tenantId: TENANT_ID,
      ...overrides,
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // acquireOrderLock
  // ────────────────────────────────────────────────────────────────────
  describe('acquireOrderLock', () => {
    it('issues a SELECT ... FOR UPDATE scoped to (id, tenantId) and resolves when the row exists', async () => {
      (tx.$queryRaw as unknown as jest.Mock).mockResolvedValue([
        { id: ORDER_ID },
      ]);
      await expect(
        finalizer.acquireOrderLock(tx, ORDER_ID, TENANT_ID),
      ).resolves.toBeUndefined();
      // The tagged-template carries the orderId + tenantId as bound params.
      const callArgs = (tx.$queryRaw as unknown as jest.Mock).mock.calls[0];
      expect(callArgs.slice(1)).toEqual([ORDER_ID, TENANT_ID]);
    });

    it('throws NotFoundException when the lock target row is absent (foreign/missing)', async () => {
      (tx.$queryRaw as unknown as jest.Mock).mockResolvedValue([]);
      await expect(
        finalizer.acquireOrderLock(tx, ORDER_ID, TENANT_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // assertNoConflictingSelfPayIntent
  // ────────────────────────────────────────────────────────────────────
  describe('assertNoConflictingSelfPayIntent', () => {
    it('no-ops when no PENDING intent exists', async () => {
      (tx.pendingSelfPayment.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(
        finalizer.assertNoConflictingSelfPayIntent(tx, ORDER_ID, TENANT_ID),
      ).resolves.toBeUndefined();
      expect(tx.pendingSelfPayment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: TENANT_ID,
            status: 'PENDING',
          }),
        }),
      );
    });

    it('throws ConflictException when a live intent references THIS order', async () => {
      (tx.pendingSelfPayment.findFirst as jest.Mock).mockResolvedValue({
        itemsByOrder: [{ orderId: 'other' }, { orderId: ORDER_ID }],
        expiresAt: new Date(Date.now() + 60000),
      });
      await expect(
        finalizer.assertNoConflictingSelfPayIntent(tx, ORDER_ID, TENANT_ID),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('does NOT throw when the live intent references a DIFFERENT order', async () => {
      (tx.pendingSelfPayment.findFirst as jest.Mock).mockResolvedValue({
        itemsByOrder: [{ orderId: 'other-order' }],
        expiresAt: new Date(Date.now() + 60000),
      });
      await expect(
        finalizer.assertNoConflictingSelfPayIntent(tx, ORDER_ID, TENANT_ID),
      ).resolves.toBeUndefined();
    });

    it('no-ops when itemsByOrder is not an array (defensive)', async () => {
      (tx.pendingSelfPayment.findFirst as jest.Mock).mockResolvedValue({
        itemsByOrder: null,
        expiresAt: new Date(Date.now() + 60000),
      });
      await expect(
        finalizer.assertNoConflictingSelfPayIntent(tx, ORDER_ID, TENANT_ID),
      ).resolves.toBeUndefined();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // finalizeFullyPaid
  // ────────────────────────────────────────────────────────────────────
  describe('finalizeFullyPaid', () => {
    it('flips the order to PAID, releases the table (no other active orders), and bumps customer stats', async () => {
      const order = makeOrder({ customerId: 'cust-1' });
      (tx.order.update as jest.Mock).mockResolvedValue({});
      // No OTHER active orders remain on the table → release it.
      (tx.order.count as jest.Mock).mockResolvedValue(0);
      (tx.table.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (tx.customer.findFirst as jest.Mock).mockResolvedValue({
        id: 'cust-1',
        tenantId: TENANT_ID,
        totalOrders: 2,
        totalSpent: new Prisma.Decimal('50.00'),
      });
      // Atomic-increment path: 1st update returns the post-increment row (feeds
      // the derived averageOrder), 2nd persists averageOrder.
      (tx.customer.update as jest.Mock)
        .mockResolvedValueOnce({
          totalOrders: 3,
          totalSpent: new Prisma.Decimal('150.00'),
        })
        .mockResolvedValueOnce({});

      await finalizer.finalizeFullyPaid(
        tx,
        order,
        undefined,
        new Prisma.Decimal('100.00'),
      );

      // Order → PAID with paidAt stamped.
      expect(tx.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ORDER_ID },
          data: expect.objectContaining({
            status: OrderStatus.PAID,
            paidAt: expect.any(Date),
          }),
        }),
      );
      // Table released via compound (id, tenantId) updateMany — never update().
      expect(tx.table.updateMany).toHaveBeenCalledWith({
        where: { id: TABLE_ID, tenantId: TENANT_ID },
        data: { status: TableStatus.AVAILABLE },
      });
      // Customer stats via ATOMIC increments: totalOrders +1, totalSpent +100
      // (closingAmount), then averageOrder derived from the returned totals
      // (150/3 = 50). Two update() calls, no updateMany.
      const first = (tx.customer.update as jest.Mock).mock.calls[0][0];
      expect(first.where).toEqual({ id: 'cust-1' });
      expect(first.data.totalOrders).toEqual({ increment: 1 });
      expect(first.data.totalSpent.increment.toFixed(2)).toBe('100.00');
      expect(first.data.lastVisit).toBeInstanceOf(Date);
      const second = (tx.customer.update as jest.Mock).mock.calls[1][0].data;
      expect(second.averageOrder.toFixed(2)).toBe('50.00');
      expect(tx.customer.updateMany).not.toHaveBeenCalled();
    });

    it('does NOT release the table while other active orders remain on it', async () => {
      const order = makeOrder({ customerId: null });
      (tx.order.update as jest.Mock).mockResolvedValue({});
      (tx.order.count as jest.Mock).mockResolvedValue(2); // siblings still open
      (tx.table.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

      await finalizer.finalizeFullyPaid(
        tx,
        order,
        undefined,
        new Prisma.Decimal('100.00'),
      );

      // count filters out PAID/CANCELLED siblings and excludes self.
      expect(tx.order.count).toHaveBeenCalledWith({
        where: {
          tableId: TABLE_ID,
          id: { not: ORDER_ID },
          status: { notIn: [OrderStatus.PAID, OrderStatus.CANCELLED] },
        },
      });
      expect(tx.table.updateMany).not.toHaveBeenCalled();
    });

    it('creates a new customer from customerPhone when the order is unlinked, and writes the phone onto the order', async () => {
      const order = makeOrder({ customerId: null, customerPhone: null });
      (tx.customer.findFirst as jest.Mock)
        .mockResolvedValueOnce(null) // phone lookup miss → create
        .mockResolvedValueOnce({
          id: 'cust-new',
          tenantId: TENANT_ID,
          totalOrders: 0,
          totalSpent: new Prisma.Decimal('0'),
        });
      (tx.customer.create as jest.Mock).mockResolvedValue({ id: 'cust-new' });
      (tx.order.update as jest.Mock).mockResolvedValue({});
      (tx.order.count as jest.Mock).mockResolvedValue(0);
      (tx.table.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (tx.customer.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      await finalizer.finalizeFullyPaid(
        tx,
        order,
        '5551234567',
        new Prisma.Decimal('100.00'),
      );

      expect(tx.customer.create).toHaveBeenCalledWith({
        data: {
          phone: '5551234567',
          name: 'Customer 5551234567',
          tenantId: TENANT_ID,
        },
      });
      // Order update both links the new customerId AND stamps customerPhone.
      const data = (tx.order.update as jest.Mock).mock.calls[0][0].data;
      expect(data.customerId).toBe('cust-new');
      expect(data.customerPhone).toBe('5551234567');
    });

    it('never overwrites an existing order.customerPhone with the closing-payment phone', async () => {
      const order = makeOrder({
        customerId: 'cust-1',
        customerPhone: '5550000000',
      });
      (tx.order.update as jest.Mock).mockResolvedValue({});
      (tx.order.count as jest.Mock).mockResolvedValue(0);
      (tx.table.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (tx.customer.findFirst as jest.Mock).mockResolvedValue({
        id: 'cust-1',
        tenantId: TENANT_ID,
        totalOrders: 1,
        totalSpent: new Prisma.Decimal('10'),
      });
      (tx.customer.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      await finalizer.finalizeFullyPaid(
        tx,
        order,
        '5559999999', // a typo'd phone on the closing payment
        new Prisma.Decimal('100.00'),
      );

      const data = (tx.order.update as jest.Mock).mock.calls[0][0].data;
      expect(data).not.toHaveProperty('customerPhone');
    });

    it('skips the customer-stats bump when bumpCustomerStats:false (write-off path)', async () => {
      const order = makeOrder({ customerId: 'cust-1' });
      (tx.order.update as jest.Mock).mockResolvedValue({});
      (tx.order.count as jest.Mock).mockResolvedValue(0);
      (tx.table.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      await finalizer.finalizeFullyPaid(
        tx,
        order,
        undefined,
        new Prisma.Decimal('100.00'),
        { bumpCustomerStats: false },
      );

      expect(tx.customer.findFirst).not.toHaveBeenCalled();
      expect(tx.customer.updateMany).not.toHaveBeenCalled();
    });

    it('does not touch the table when the order has no tableId (counter/QR order)', async () => {
      const order = makeOrder({ tableId: null, customerId: null });
      (tx.order.update as jest.Mock).mockResolvedValue({});

      await finalizer.finalizeFullyPaid(
        tx,
        order,
        undefined,
        new Prisma.Decimal('100.00'),
      );

      expect(tx.order.count).not.toHaveBeenCalled();
      expect(tx.table.updateMany).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // linkCustomerForPayment — per-payment dedupe
  // ────────────────────────────────────────────────────────────────────
  describe('linkCustomerForPayment', () => {
    const payment = {
      id: 'pay-1',
      orderId: ORDER_ID,
      tenantId: TENANT_ID,
      amount: new Prisma.Decimal('40.00'),
    };

    it('bumps totalOrders (atomic increment) on the FIRST payment and grows totalSpent atomically', async () => {
      (tx.customer.findFirst as jest.Mock).mockResolvedValue({
        id: 'cust-1',
        totalOrders: 5,
        totalSpent: new Prisma.Decimal('200.00'),
      });
      (tx.payment.update as jest.Mock).mockResolvedValue({});
      // No prior completed payment by this customer on this order.
      (tx.payment.count as jest.Mock).mockResolvedValue(0);
      // 1st update returns the AUTHORITATIVE post-increment row (drives the
      // derived averageOrder); 2nd update persists averageOrder.
      (tx.customer.update as jest.Mock)
        .mockResolvedValueOnce({
          totalOrders: 6,
          totalSpent: new Prisma.Decimal('240.00'),
        })
        .mockResolvedValueOnce({});

      await finalizer.linkCustomerForPayment(tx, payment, '5551234567');

      // Payment row linked to the customer.
      expect(tx.payment.update).toHaveBeenCalledWith({
        where: { id: 'pay-1' },
        data: { customerId: 'cust-1' },
      });
      // Dedupe count excludes THIS payment.
      expect(tx.payment.count).toHaveBeenCalledWith({
        where: {
          orderId: ORDER_ID,
          status: PaymentStatus.COMPLETED,
          customerId: 'cust-1',
          id: { not: 'pay-1' },
        },
      });
      // Atomic increments — NOT absolute writes (lost-update-safe under the
      // caller's READ COMMITTED tx).
      const first = (tx.customer.update as jest.Mock).mock.calls[0][0].data;
      expect(first.totalSpent.increment.toFixed(2)).toBe('40.00');
      expect(first.totalOrders).toEqual({ increment: 1 });
      // averageOrder derived from the returned post-increment totals: 240 / 6.
      const second = (tx.customer.update as jest.Mock).mock.calls[1][0].data;
      expect(second.averageOrder.toFixed(2)).toBe('40.00');
    });

    it('does NOT increment totalOrders when the customer already paid on this order (only totalSpent grows)', async () => {
      (tx.customer.findFirst as jest.Mock).mockResolvedValue({
        id: 'cust-1',
        totalOrders: 5,
        totalSpent: new Prisma.Decimal('200.00'),
      });
      (tx.payment.update as jest.Mock).mockResolvedValue({});
      (tx.payment.count as jest.Mock).mockResolvedValue(1); // a prior swipe exists
      (tx.customer.update as jest.Mock)
        .mockResolvedValueOnce({
          totalOrders: 5,
          totalSpent: new Prisma.Decimal('240.00'),
        })
        .mockResolvedValueOnce({});

      await finalizer.linkCustomerForPayment(tx, payment, '5551234567');

      const first = (tx.customer.update as jest.Mock).mock.calls[0][0].data;
      expect(first.totalSpent.increment.toFixed(2)).toBe('40.00');
      expect(first.totalOrders).toBeUndefined(); // omitted → no increment
      const second = (tx.customer.update as jest.Mock).mock.calls[1][0].data;
      expect(second.averageOrder.toFixed(2)).toBe('48.00'); // 240 / 5
    });

    it('creates the customer when the phone is unseen for the tenant', async () => {
      (tx.customer.findFirst as jest.Mock).mockResolvedValue(null);
      (tx.customer.create as jest.Mock).mockResolvedValue({
        id: 'cust-new',
        totalOrders: 0,
        totalSpent: new Prisma.Decimal('0'),
      });
      (tx.payment.update as jest.Mock).mockResolvedValue({});
      (tx.payment.count as jest.Mock).mockResolvedValue(0);
      (tx.customer.update as jest.Mock).mockResolvedValue({});

      await finalizer.linkCustomerForPayment(tx, payment, '5557654321');

      expect(tx.customer.create).toHaveBeenCalledWith({
        data: {
          phone: '5557654321',
          name: 'Customer 5557654321',
          tenantId: TENANT_ID,
        },
      });
      expect(tx.payment.update).toHaveBeenCalledWith({
        where: { id: 'pay-1' },
        data: { customerId: 'cust-new' },
      });
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // buildReceiptSnapshotForPayment — graceful degrade
  // ────────────────────────────────────────────────────────────────────
  describe('buildReceiptSnapshotForPayment', () => {
    it('returns JsonNull when the tenant lookup misses (early exit, no order read)', async () => {
      (tx.tenant.findUnique as jest.Mock).mockResolvedValue(null);
      const result = await finalizer.buildReceiptSnapshotForPayment(
        tx,
        ORDER_ID,
        TENANT_ID,
        { method: 'CASH', transactionId: null },
      );
      expect(result).toBe(Prisma.JsonNull);
      expect(tx.order.findFirst).not.toHaveBeenCalled();
    });

    it('returns JsonNull when the order is not found for (id, tenantId)', async () => {
      (tx.tenant.findUnique as jest.Mock).mockResolvedValue({
        id: TENANT_ID,
        name: 'T',
        currency: 'TRY',
      });
      (tx.order.findFirst as jest.Mock).mockResolvedValue(null);
      const result = await finalizer.buildReceiptSnapshotForPayment(
        tx,
        ORDER_ID,
        TENANT_ID,
        { method: 'CASH', transactionId: null },
      );
      expect(result).toBe(Prisma.JsonNull);
    });

    it('degrades to JsonNull when the builder throws (snapshot must not block the write)', async () => {
      (tx.tenant.findUnique as jest.Mock).mockResolvedValue({
        id: TENANT_ID,
        name: 'T',
        currency: 'TRY',
      });
      (tx.order.findFirst as jest.Mock).mockResolvedValue({
        id: ORDER_ID,
        orderItems: [],
        table: null,
      });
      receiptSnapshotBuilder.buildReceiptSnapshot.mockImplementation(() => {
        throw new Error('boom');
      });
      const result = await finalizer.buildReceiptSnapshotForPayment(
        tx,
        ORDER_ID,
        TENANT_ID,
        { method: 'CASH', transactionId: null },
      );
      expect(result).toBe(Prisma.JsonNull);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // creditLoyaltyForFinalizedOrder — post-commit, idempotent, swallows
  // ────────────────────────────────────────────────────────────────────
  describe('creditLoyaltyForFinalizedOrder', () => {
    it('credits loyalty for a PAID order with a linked customer', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        customerId: 'cust-1',
        finalAmount: new Prisma.Decimal('100.00'),
        status: 'PAID',
        orderNumber: 'ORD-7',
      });
      await finalizer.creditLoyaltyForFinalizedOrder(ORDER_ID, TENANT_ID);
      expect(loyalty.earnPointsFromOrder).toHaveBeenCalledWith(
        'cust-1',
        TENANT_ID,
        ORDER_ID,
        'ORD-7',
        expect.anything(),
      );
    });

    it('does nothing when the order has no customer', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        customerId: null,
        finalAmount: new Prisma.Decimal('100.00'),
        status: 'PAID',
        orderNumber: 'ORD-7',
      });
      await finalizer.creditLoyaltyForFinalizedOrder(ORDER_ID, TENANT_ID);
      expect(loyalty.earnPointsFromOrder).not.toHaveBeenCalled();
    });

    it('does nothing when the order is not PAID', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        customerId: 'cust-1',
        finalAmount: new Prisma.Decimal('100.00'),
        status: 'SERVED',
        orderNumber: 'ORD-7',
      });
      await finalizer.creditLoyaltyForFinalizedOrder(ORDER_ID, TENANT_ID);
      expect(loyalty.earnPointsFromOrder).not.toHaveBeenCalled();
    });

    it('swallows a loyalty failure (post-commit must not throw)', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        customerId: 'cust-1',
        finalAmount: new Prisma.Decimal('100.00'),
        status: 'PAID',
        orderNumber: 'ORD-7',
      });
      loyalty.earnPointsFromOrder.mockRejectedValue(new Error('loyalty down'));
      await expect(
        finalizer.creditLoyaltyForFinalizedOrder(ORDER_ID, TENANT_ID),
      ).resolves.toBeUndefined();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // maybeGenerateAutoInvoice — bounded retry + Sentry on exhaustion
  // ────────────────────────────────────────────────────────────────────
  describe('maybeGenerateAutoInvoice', () => {
    it('no-ops when autoGenerateInvoice is disabled', async () => {
      accountingSettings.findByTenant.mockResolvedValue({
        autoGenerateInvoice: false,
      });
      await finalizer.maybeGenerateAutoInvoice(ORDER_ID, TENANT_ID);
      expect(salesInvoice.createFromOrder).not.toHaveBeenCalled();
      expect(salesInvoice.createFromPayment).not.toHaveBeenCalled();
    });

    it('routes to createFromOrder when no paymentId is supplied', async () => {
      await finalizer.maybeGenerateAutoInvoice(ORDER_ID, TENANT_ID);
      expect(salesInvoice.createFromOrder).toHaveBeenCalledWith(
        ORDER_ID,
        TENANT_ID,
      );
      expect(salesInvoice.createFromPayment).not.toHaveBeenCalled();
    });

    it('routes to createFromPayment when a paymentId is supplied (per-payment fatura)', async () => {
      await finalizer.maybeGenerateAutoInvoice(ORDER_ID, TENANT_ID, 'pay-9');
      expect(salesInvoice.createFromPayment).toHaveBeenCalledWith(
        'pay-9',
        TENANT_ID,
      );
      expect(salesInvoice.createFromOrder).not.toHaveBeenCalled();
    });

    it('retries up to 3 times with backoff and succeeds on the 3rd attempt', async () => {
      jest.useFakeTimers();
      try {
        salesInvoice.createFromOrder
          .mockRejectedValueOnce(new Error('try1'))
          .mockRejectedValueOnce(new Error('try2'))
          .mockResolvedValueOnce(undefined);

        const promise = finalizer.maybeGenerateAutoInvoice(ORDER_ID, TENANT_ID);
        // Drive both backoff timers (250ms then 500ms) to completion.
        await jest.runAllTimersAsync();
        await promise;

        expect(salesInvoice.createFromOrder).toHaveBeenCalledTimes(3);
        // Success on the final attempt → no Sentry capture.
        expect(Sentry.captureException).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('captures to Sentry with REVENUE_SYNC_FAILED after exhausting all 3 attempts', async () => {
      jest.useFakeTimers();
      try {
        salesInvoice.createFromOrder.mockRejectedValue(new Error('always'));

        const promise = finalizer.maybeGenerateAutoInvoice(ORDER_ID, TENANT_ID);
        await jest.runAllTimersAsync();
        await promise;

        expect(salesInvoice.createFromOrder).toHaveBeenCalledTimes(3);
        expect(Sentry.captureException).toHaveBeenCalledWith(
          expect.any(Error),
          expect.objectContaining({
            tags: expect.objectContaining({ event: 'REVENUE_SYNC_FAILED' }),
            extra: expect.objectContaining({ orderId: ORDER_ID }),
          }),
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('captures the settings-lookup phase to Sentry when findByTenant itself throws', async () => {
      accountingSettings.findByTenant.mockRejectedValue(
        new Error('settings down'),
      );
      await finalizer.maybeGenerateAutoInvoice(ORDER_ID, TENANT_ID);
      expect(Sentry.captureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          extra: expect.objectContaining({ phase: 'settings-lookup' }),
        }),
      );
    });

    it('no-ops when the optional accounting services are absent', async () => {
      const bare = new PaymentFinalizer(
        prisma as any,
        receiptSnapshotBuilder as any,
        loyalty as any,
        undefined,
        undefined,
        kdsGateway as any,
      );
      await expect(
        bare.maybeGenerateAutoInvoice(ORDER_ID, TENANT_ID),
      ).resolves.toBeUndefined();
      expect(accountingSettings.findByTenant).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // maybeIssueYazarkasaReceipt — gated physical-ÖKC fiscal issuance
  // ────────────────────────────────────────────────────────────────────
  describe('maybeIssueYazarkasaReceipt', () => {
    let fiscal: { issueReceipt: jest.Mock };

    function makeFinalizerWithFiscal() {
      fiscal = { issueReceipt: jest.fn().mockResolvedValue({}) };
      return new PaymentFinalizer(
        prisma as any,
        receiptSnapshotBuilder as any,
        loyalty as any,
        salesInvoice as any,
        accountingSettings as any,
        kdsGateway as any,
        fiscal as any,
      );
    }

    it('no-ops when FiscalService is not wired (the common bare-construction case)', async () => {
      // `finalizer` from beforeEach has no fiscalService.
      await expect(
        finalizer.maybeIssueYazarkasaReceipt(ORDER_ID, TENANT_ID),
      ).resolves.toBeUndefined();
      expect(prisma.fiscalDeviceRecord.findFirst).not.toHaveBeenCalled();
    });

    it('GATE: looks up a non-retired, non-efatura physical device and no-ops when none exists (dormant)', async () => {
      const f = makeFinalizerWithFiscal();
      (prisma.fiscalDeviceRecord.findFirst as jest.Mock).mockResolvedValue(null);

      await f.maybeIssueYazarkasaReceipt(ORDER_ID, TENANT_ID);

      // The cloud e-Fatura pseudo-device is excluded so we never
      // double-fiscalize against the accounting e-document rail.
      expect(prisma.fiscalDeviceRecord.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: TENANT_ID,
            status: { not: 'retired' },
            providerId: { not: 'efatura' },
          }),
        }),
      );
      expect(fiscal.issueReceipt).not.toHaveBeenCalled();
    });

    it('COUPLED-FIŞ GUARD: skips issuance when a fiscal-coupled terminal already printed the fiş', async () => {
      const f = makeFinalizerWithFiscal();
      (prisma.fiscalDeviceRecord.findFirst as jest.Mock).mockResolvedValue({
        id: 'dev-okc-1',
        branchId: 'br-1',
        providerId: 'hugin',
        status: 'online',
      });
      // A GMP-3 card terminal recorded a fiscalNo for this order → the device
      // printed the mali fiş atomically. A second standalone fiş would
      // double-fiscalize, so issuance must be skipped.
      (prisma.paymentTerminalCharge.findFirst as jest.Mock).mockResolvedValue({
        id: 'chg-coupled-1',
      });

      await f.maybeIssueYazarkasaReceipt(ORDER_ID, TENANT_ID);

      expect(prisma.paymentTerminalCharge.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orderId: ORDER_ID, tenantId: TENANT_ID, fiscalNo: { not: null } },
        }),
      );
      expect(prisma.order.findFirst).not.toHaveBeenCalled();
      expect(fiscal.issueReceipt).not.toHaveBeenCalled();
    });

    it('COUPLED-FIŞ GUARD: proceeds to issue when NO coupled charge printed a fiş', async () => {
      const f = makeFinalizerWithFiscal();
      (prisma.fiscalDeviceRecord.findFirst as jest.Mock).mockResolvedValue({
        id: 'dev-okc-1',
        branchId: 'br-1',
        providerId: 'hugin',
        status: 'online',
      });
      (prisma.paymentTerminalCharge.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.order.findFirst as jest.Mock).mockResolvedValue({
        id: ORDER_ID,
        branchId: 'br-order',
        status: 'PAID',
        discount: new Prisma.Decimal('0'),
        orderItems: [
          {
            productId: 'p1',
            quantity: 1,
            unitPrice: new Prisma.Decimal('10.00'),
            modifierTotal: new Prisma.Decimal('0'),
            taxRate: 10,
            product: { name: 'Tea' },
          },
        ],
        payments: [],
      });

      await f.maybeIssueYazarkasaReceipt(ORDER_ID, TENANT_ID);

      expect(fiscal.issueReceipt).toHaveBeenCalledTimes(1);
    });

    it('issues a yazarkasa receipt with a deterministic per-order idempotency key and lines built from the paid order', async () => {
      const f = makeFinalizerWithFiscal();
      (prisma.fiscalDeviceRecord.findFirst as jest.Mock).mockResolvedValue({
        id: 'dev-okc-1',
        branchId: 'br-1',
        providerId: 'hugin',
        status: 'online',
      });
      (prisma.order.findFirst as jest.Mock).mockResolvedValue({
        id: ORDER_ID,
        branchId: 'br-order',
        status: 'PAID',
        discount: new Prisma.Decimal('0'),
        orderItems: [
          {
            productId: 'p1',
            quantity: 2,
            unitPrice: new Prisma.Decimal('50.00'),
            modifierTotal: new Prisma.Decimal('0'),
            taxRate: 20,
            product: { name: 'Coffee' },
          },
        ],
        // No COMPLETED payment rows → balanced cash fallback (= net).
        payments: [],
      });

      await f.maybeIssueYazarkasaReceipt(ORDER_ID, TENANT_ID);

      expect(fiscal.issueReceipt).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_ID,
          branchId: 'br-order',
          fiscalDeviceId: 'dev-okc-1',
          orderId: ORDER_ID,
          idempotencyKey: `order-fiscal:${ORDER_ID}`,
          kind: 'cash_receipt',
          lines: [
            expect.objectContaining({
              productCode: 'p1',
              name: 'Coffee',
              qty: 2,
              unitPriceCents: 5000,
              vatRate: 20,
              discountCents: 0,
            }),
          ],
          // no completed payments → single balanced cash fallback (2 * 5000)
          payments: [{ method: 'cash', amountCents: 10000 }],
        }),
      );
    });

    it('apportions the order discount across lines and emits the real cash/card tender split', async () => {
      const f = makeFinalizerWithFiscal();
      (prisma.fiscalDeviceRecord.findFirst as jest.Mock).mockResolvedValue({
        id: 'dev-okc-1',
        branchId: 'br-1',
        providerId: 'hugin',
        status: 'online',
      });
      // Two lines worth 6000c + 4000c = 10000c gross; a 1000c order discount
      // apportions 600c / 400c by value → net 9000c. Customer paid 5000 cash +
      // 4000 card = 9000 → the real split must be passed through verbatim.
      (prisma.order.findFirst as jest.Mock).mockResolvedValue({
        id: ORDER_ID,
        branchId: 'br-order',
        status: 'PAID',
        discount: new Prisma.Decimal('10.00'),
        orderItems: [
          {
            productId: 'p1',
            quantity: 2,
            unitPrice: new Prisma.Decimal('30.00'), // 6000c
            modifierTotal: new Prisma.Decimal('0'),
            taxRate: 20,
            product: { name: 'Burger' },
          },
          {
            productId: 'p2',
            quantity: 1,
            unitPrice: new Prisma.Decimal('40.00'), // 4000c
            modifierTotal: new Prisma.Decimal('0'),
            taxRate: 10,
            product: { name: 'Salad' },
          },
        ],
        payments: [
          { method: 'CASH', amount: new Prisma.Decimal('50.00'), status: 'COMPLETED' },
          { method: 'CARD', amount: new Prisma.Decimal('40.00'), status: 'COMPLETED' },
          // A FAILED row must be ignored by the tender reconciliation.
          { method: 'CARD', amount: new Prisma.Decimal('99.00'), status: 'FAILED' },
        ],
      });

      await f.maybeIssueYazarkasaReceipt(ORDER_ID, TENANT_ID);

      const arg = fiscal.issueReceipt.mock.calls[0][0];
      expect(arg.lines).toEqual([
        expect.objectContaining({ productCode: 'p1', unitPriceCents: 3000, discountCents: 600 }),
        expect.objectContaining({ productCode: 'p2', unitPriceCents: 4000, discountCents: 400 }),
      ]);
      // Real per-method split, FAILED row excluded, sums to net 9000c.
      expect(arg.payments).toEqual([
        { method: 'cash', amountCents: 5000 },
        { method: 'card', amountCents: 4000 },
      ]);
    });

    it('includes paid modifiers in the fiş line value and keeps the real card tender (modifier blocker regression)', async () => {
      const f = makeFinalizerWithFiscal();
      (prisma.fiscalDeviceRecord.findFirst as jest.Mock).mockResolvedValue({
        id: 'dev-okc-1',
        branchId: 'br-1',
        providerId: 'hugin',
        status: 'online',
      });
      // Base 100 + per-unit paid modifier 20, qty 1, paid by CARD.
      // subtotal = 120 → finalAmount = 120 → Payment(card) = 120. The fiş line
      // MUST be 12000c (not the base 10000c) and the tender MUST stay card.
      (prisma.order.findFirst as jest.Mock).mockResolvedValue({
        id: ORDER_ID,
        branchId: 'br-order',
        status: 'PAID',
        discount: new Prisma.Decimal('0'),
        orderItems: [
          {
            productId: 'p1',
            quantity: 1,
            unitPrice: new Prisma.Decimal('100.00'),
            modifierTotal: new Prisma.Decimal('20.00'),
            taxRate: 20,
            product: { name: 'Pizza' },
          },
        ],
        payments: [
          { method: 'CARD', amount: new Prisma.Decimal('120.00'), status: 'COMPLETED' },
        ],
      });

      await f.maybeIssueYazarkasaReceipt(ORDER_ID, TENANT_ID);

      const arg = fiscal.issueReceipt.mock.calls[0][0];
      expect(arg.lines[0]).toMatchObject({
        unitPriceCents: 12000, // 100 base + 20 modifier
        qty: 1,
        discountCents: 0,
      });
      // Real card tender preserved (NOT collapsed to the cash fallback).
      expect(arg.payments).toEqual([{ method: 'card', amountCents: 12000 }]);
    });

    it('skips issuance when the tenant has e-Fatura auto-sync active (double-fiscalization guard)', async () => {
      const f = makeFinalizerWithFiscal();
      (prisma.fiscalDeviceRecord.findFirst as jest.Mock).mockResolvedValue({
        id: 'dev-okc-1',
        branchId: 'br-1',
        providerId: 'hugin',
        status: 'online',
      });
      accountingSettings.findByTenant.mockResolvedValue({
        autoGenerateInvoice: true,
        autoSync: true,
        provider: 'PARASUT',
      });

      await f.maybeIssueYazarkasaReceipt(ORDER_ID, TENANT_ID);

      // The e-Fatura rail owns fiscalization → no physical fiş, and we never
      // even reach the order lookup.
      expect(fiscal.issueReceipt).not.toHaveBeenCalled();
      expect(prisma.order.findFirst).not.toHaveBeenCalled();
    });

    it('no-ops when the order is not (PAID) found or has no items', async () => {
      const f = makeFinalizerWithFiscal();
      (prisma.fiscalDeviceRecord.findFirst as jest.Mock).mockResolvedValue({
        id: 'dev-okc-1',
        branchId: 'br-1',
        providerId: 'beko',
        status: 'online',
      });
      (prisma.order.findFirst as jest.Mock).mockResolvedValue(null);

      await f.maybeIssueYazarkasaReceipt(ORDER_ID, TENANT_ID);
      expect(fiscal.issueReceipt).not.toHaveBeenCalled();
    });

    it('BEST-EFFORT: swallows a fiscal failure and captures to Sentry (never blocks payment)', async () => {
      const f = makeFinalizerWithFiscal();
      (prisma.fiscalDeviceRecord.findFirst as jest.Mock).mockResolvedValue({
        id: 'dev-okc-1',
        branchId: 'br-1',
        providerId: 'hugin',
        status: 'online',
      });
      (prisma.order.findFirst as jest.Mock).mockResolvedValue({
        id: ORDER_ID,
        branchId: 'br-order',
        status: 'PAID',
        discount: new Prisma.Decimal('0'),
        orderItems: [
          {
            productId: 'p1',
            quantity: 1,
            unitPrice: new Prisma.Decimal('10.00'),
            modifierTotal: new Prisma.Decimal('0'),
            taxRate: 10,
            product: { name: 'X' },
          },
        ],
        payments: [],
      });
      fiscal.issueReceipt.mockRejectedValue(new Error('queue down'));

      await expect(
        f.maybeIssueYazarkasaReceipt(ORDER_ID, TENANT_ID),
      ).resolves.toBeUndefined();
      expect(Sentry.captureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          tags: expect.objectContaining({ event: 'FISCAL_RECEIPT_FAILED' }),
          extra: expect.objectContaining({ orderId: ORDER_ID }),
        }),
      );
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // safeEmitPaymentSuccess — swallows socket errors
  // ────────────────────────────────────────────────────────────────────
  describe('safeEmitPaymentSuccess', () => {
    const payment = {
      id: 'pay-1',
      branchId: 'br-1',
      orderId: ORDER_ID,
      amount: new Prisma.Decimal('40.00'),
      method: 'CASH',
      receiptSnapshot: { snap: true },
    };

    it('emits payment:success with the JWT user echoed as initiatedByUserId', () => {
      finalizer.safeEmitPaymentSuccess(TENANT_ID, payment, 'user-7');
      expect(kdsGateway.emitPaymentSuccess).toHaveBeenCalledWith(
        TENANT_ID,
        'br-1',
        expect.objectContaining({
          id: 'pay-1',
          orderId: ORDER_ID,
          method: 'CASH',
        }),
        'user-7',
      );
    });

    it('passes null initiatedByUserId by default (webhook / self-pay origin)', () => {
      finalizer.safeEmitPaymentSuccess(TENANT_ID, payment);
      expect(kdsGateway.emitPaymentSuccess).toHaveBeenCalledWith(
        TENANT_ID,
        'br-1',
        expect.any(Object),
        null,
      );
    });

    it('swallows a gateway throw — an emit failure must never fail the payment', () => {
      kdsGateway.emitPaymentSuccess.mockImplementation(() => {
        throw new Error('socket down');
      });
      expect(() =>
        finalizer.safeEmitPaymentSuccess(TENANT_ID, payment, 'user-7'),
      ).not.toThrow();
    });

    it('no-ops silently when no KdsGateway is wired', () => {
      const noGw = new PaymentFinalizer(
        prisma as any,
        receiptSnapshotBuilder as any,
        loyalty as any,
        salesInvoice as any,
        accountingSettings as any,
        undefined,
      );
      expect(() =>
        noGw.safeEmitPaymentSuccess(TENANT_ID, payment, 'user-7'),
      ).not.toThrow();
    });
  });
});
