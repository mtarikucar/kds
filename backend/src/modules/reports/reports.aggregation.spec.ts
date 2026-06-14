import {
  mockPrismaClient,
  MockPrismaClient,
} from '../../common/test/prisma-mock.service';
import { ReportsService } from './reports.service';

/**
 * Spec for the ReportsService money-aggregation paths the existing
 * getDateRange spec does not touch: sales-summary roll-up (cents-exact
 * average + daily grouping + payment breakdown), top-products limit
 * clamping + product join + Unknown fallback, payment-method breakdown,
 * and the 24-slot orders-by-hour grouping. Explicit start/end dates are
 * passed so getDateRange short-circuits (no tenant-tz lookup).
 */
describe('ReportsService aggregation', () => {
  let prisma: MockPrismaClient;
  let svc: ReportsService;

  const tenantId = 't-1';
  const start = new Date('2026-01-01T00:00:00Z');
  const end = new Date('2026-01-03T00:00:00Z');

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new ReportsService(prisma as any);
  });

  describe('getSalesSummary', () => {
    it('computes totals, cents-exact average order value, and a sorted daily series', async () => {
      // _sum.finalAmount 100, discount 7, _count 3 ->
      //   avg = round(10000 / 3) cents = 3333 -> 33.33
      (prisma.order.aggregate as any).mockResolvedValue({
        _sum: { finalAmount: 100, discount: 7 },
        _count: 3,
      });
      (prisma.payment.groupBy as any).mockResolvedValue([
        { method: 'CASH', _sum: { amount: 60 }, _count: 2 },
        { method: 'CARD', _sum: { amount: 40 }, _count: 1 },
      ]);
      // daily breakdown: two days, out of order to prove the sort
      (prisma.order.findMany as any).mockResolvedValue([
        { createdAt: new Date('2026-01-02T10:00:00Z'), finalAmount: 30 },
        { createdAt: new Date('2026-01-01T10:00:00Z'), finalAmount: 40 },
        { createdAt: new Date('2026-01-01T12:00:00Z'), finalAmount: 30 },
      ]);

      const res = await svc.getSalesSummary(tenantId, start, end);

      expect(res.totalSales).toBe(100);
      expect(res.totalOrders).toBe(3);
      expect(res.averageOrderValue).toBe(33.33);
      expect(res.totalDiscount).toBe(7);
      // payment breakdown mapped through cents
      expect(res.paymentMethodBreakdown).toEqual([
        { method: 'CASH', total: 60, count: 2 },
        { method: 'CARD', total: 40, count: 1 },
      ]);
      // daily series sorted ascending by date, summed per day
      expect(res.dailySales).toEqual([
        { date: '2026-01-01', sales: 70, orders: 2 },
        { date: '2026-01-02', sales: 30, orders: 1 },
      ]);
    });

    it('reports a zero average order value when there are no paid orders', async () => {
      (prisma.order.aggregate as any).mockResolvedValue({
        _sum: { finalAmount: null, discount: null },
        _count: 0,
      });
      (prisma.payment.groupBy as any).mockResolvedValue([]);
      (prisma.order.findMany as any).mockResolvedValue([]);

      const res = await svc.getSalesSummary(tenantId, start, end);

      expect(res.totalSales).toBe(0);
      expect(res.totalOrders).toBe(0);
      expect(res.averageOrderValue).toBe(0);
      expect(res.dailySales).toEqual([]);
    });

    it('scopes the aggregate to a branch when branchId is supplied', async () => {
      (prisma.order.aggregate as any).mockResolvedValue({
        _sum: { finalAmount: 0, discount: 0 },
        _count: 0,
      });
      (prisma.payment.groupBy as any).mockResolvedValue([]);
      (prisma.order.findMany as any).mockResolvedValue([]);

      await svc.getSalesSummary(tenantId, start, end, 'b-9');

      const where = (prisma.order.aggregate as any).mock.calls[0][0].where;
      expect(where.branchId).toBe('b-9');
      expect(where.tenantId).toBe(tenantId);
    });
  });

  describe('getTopProducts', () => {
    it('clamps the limit to 1..100 and joins product names + categories', async () => {
      (prisma.orderItem.groupBy as any).mockResolvedValue([
        { productId: 'p-1', _sum: { quantity: 5, subtotal: 250 } },
        { productId: 'p-missing', _sum: { quantity: 2, subtotal: 80 } },
      ]);
      (prisma.product.findMany as any).mockResolvedValue([
        { id: 'p-1', name: 'Burger', category: { name: 'Mains' } },
      ]);

      const res = await svc.getTopProducts(tenantId, start, end, 999);

      // limit 999 clamped to 100
      expect((prisma.orderItem.groupBy as any).mock.calls[0][0].take).toBe(100);
      expect(res.products[0]).toEqual({
        productId: 'p-1',
        productName: 'Burger',
        quantitySold: 5,
        revenue: 250,
        categoryName: 'Mains',
      });
      // a missing product falls back to "Unknown Product"
      expect(res.products[1].productName).toBe('Unknown Product');
      expect(res.products[1].quantitySold).toBe(2);
    });

    it('clamps a non-positive limit up to 1', async () => {
      (prisma.orderItem.groupBy as any).mockResolvedValue([]);
      (prisma.product.findMany as any).mockResolvedValue([]);

      await svc.getTopProducts(tenantId, start, end, 0);

      expect((prisma.orderItem.groupBy as any).mock.calls[0][0].take).toBe(1);
    });
  });

  describe('getPaymentMethodBreakdown', () => {
    it('maps each method to a numeric total and count', async () => {
      (prisma.payment.groupBy as any).mockResolvedValue([
        { method: 'CARD', _sum: { amount: 120.5 }, _count: 4 },
        { method: 'CASH', _sum: { amount: null }, _count: 0 },
      ]);

      const res = await svc.getPaymentMethodBreakdown(tenantId, start, end);

      expect(res.breakdown).toEqual([
        { method: 'CARD', totalAmount: 120.5, count: 4 },
        { method: 'CASH', totalAmount: 0, count: 0 },
      ]);
    });
  });

  describe('getOrdersByHour', () => {
    it('buckets paid orders into 24 hour slots (UTC tenant) with cents-exact sales', async () => {
      (prisma.tenant.findUnique as any).mockResolvedValue({ timezone: 'UTC' });
      (prisma.order.findMany as any).mockResolvedValue([
        { createdAt: new Date('2026-01-01T09:15:00Z'), finalAmount: 10 },
        { createdAt: new Date('2026-01-01T09:45:00Z'), finalAmount: 20 },
        { createdAt: new Date('2026-01-01T13:00:00Z'), finalAmount: 5 },
      ]);

      const res = await svc.getOrdersByHour(
        tenantId,
        new Date('2026-01-01T12:00:00Z'),
      );

      expect(res.hourlyData).toHaveLength(24);
      // 09:00 slot: 2 orders, 10 + 20 = 30
      expect(res.hourlyData[9]).toEqual({
        hour: 9,
        orderCount: 2,
        totalSales: 30,
      });
      // 13:00 slot: 1 order, 5
      expect(res.hourlyData[13]).toEqual({
        hour: 13,
        orderCount: 1,
        totalSales: 5,
      });
      // an untouched slot stays zeroed
      expect(res.hourlyData[0]).toEqual({
        hour: 0,
        orderCount: 0,
        totalSales: 0,
      });
    });
  });
});
