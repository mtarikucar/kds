import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OrdersService } from './orders.service';
import { ReceiptSnapshotBuilder } from './receipt-snapshot.builder';
import { TaxCalculationService } from '../../accounting/services/tax-calculation.service';
import {
  mockPrismaClient,
  MockPrismaClient,
} from '../../../common/test/prisma-mock.service';
import { BranchScope } from '../../../common/scoping/branch-scope';
import { UserRole } from '../../../common/constants/roles.enum';
import { OrderStatus } from '../../../common/constants/order-status.enum';

/**
 * Characterization spec for the line-item PRICING / TOTALS / TAX math that
 * createInner() and update() share. Pins the CURRENT byte-for-byte money
 * behaviour BEFORE the OrderPricingCalculator extraction so the refactor is
 * provably behaviour-preserving:
 *   - server-side price + per-item modifierTotal (priceAdjustment * qty)
 *   - subtotal = qty * (price + modifierTotal)  (KDV-inclusive)
 *   - totalAmount = Σ subtotal
 *   - per-line taxAmount via TaxCalculationService.extractTax (real impl)
 *   - adjustedTaxAmount = round(Σ tax * (1 - discount/total) * 100)/100
 *   - discount policy divergence: create THROWS on over-discount,
 *     update CAPS via Math.min.
 */
describe('OrdersService — line-item pricing / totals / tax (characterization)', () => {
  let service: OrdersService;
  let prisma: MockPrismaClient;
  const realTax = new TaxCalculationService();

  const tenantId = 'tenant-1';
  const userId = 'user-1';
  const scope: BranchScope = {
    tenantId,
    branchId: 'branch-1',
    userId,
    role: UserRole.WAITER,
  };

  // Two products with DIFFERENT tax rates so multi-line tax accumulation is
  // exercised (and the proportional discount adjustment is non-trivial).
  const productA = {
    id: 'p-A',
    name: 'Adana',
    price: new Prisma.Decimal('30.00'),
    taxRate: 18,
    tenantId,
    isAvailable: true,
  };
  const productB = {
    id: 'p-B',
    name: 'Ayran',
    price: new Prisma.Decimal('10.50'),
    taxRate: 8,
    tenantId,
    isAvailable: true,
  };
  const modX = {
    id: 'm-X',
    name: 'Extra Cheese',
    priceAdjustment: new Prisma.Decimal('5.00'),
    groupId: 'g-1',
    tenantId,
    isAvailable: true,
  };

  function buildService() {
    service = new OrdersService(
      prisma as any,
      new ReceiptSnapshotBuilder(),
      { emitNewOrder: jest.fn(), emitLowStockAlert: jest.fn(), emitOrderUpdated: jest.fn() } as any,
      undefined,
      undefined,
      undefined,
      realTax,
      undefined,
      undefined,
    );
  }

  beforeEach(() => {
    prisma = mockPrismaClient();
    (prisma.$transaction as any).mockImplementation(async (cb: any) =>
      typeof cb === 'function' ? cb(prisma) : Promise.all(cb),
    );
    prisma.table.findFirst.mockResolvedValue(null as any);
    (prisma.$queryRaw as any).mockResolvedValue([]);
    buildService();
  });

  describe('create() pricing', () => {
    beforeEach(() => {
      prisma.product.findMany.mockResolvedValue([productA, productB] as any);
      prisma.modifier.findMany.mockResolvedValue([modX] as any);
      prisma.productModifierGroup.findMany.mockResolvedValue([
        { productId: 'p-A', groupId: 'g-1' },
      ] as any);
      // Echo the create payload back so we can read computed money fields.
      (prisma.order.create as any).mockImplementation(async ({ data }: any) => ({
        id: 'order-1',
        branchId: data.branchId,
        ...data,
        orderItems: [],
      }));
      (prisma.order.update as any).mockResolvedValue({ id: 'order-1' } as any);
    });

    it('computes subtotal, totals, modifierTotal and per-line tax (multi-line, with modifier)', async () => {
      await service.create(scope, {
        type: 'DINE_IN',
        items: [
          { productId: 'p-A', quantity: 2, modifiers: [{ modifierId: 'm-X', quantity: 1 }] },
          { productId: 'p-B', quantity: 3 },
        ],
      } as any);

      const createArg = (prisma.order.create as jest.Mock).mock.calls[0][0];
      const data = createArg.data;
      const items = data.orderItems.create;

      // Line A: 2 * (30 + 5*1) = 70 ; modifierTotal = 5
      expect(items[0].subtotal).toBe(70);
      expect(items[0].modifierTotal).toBe(5);
      expect(items[0].unitPrice).toBe(30);
      expect(items[0].taxRate).toBe(18);
      // extractTax(70, 18): 70 - 70/1.18 = 10.68 (round half-up 2dp)
      expect(items[0].taxAmount).toBe(realTax.extractTax(70, 18).taxAmount);

      // Line B: 3 * (10.5 + 0) = 31.5 ; modifierTotal = 0
      expect(items[1].subtotal).toBe(31.5);
      expect(items[1].modifierTotal).toBe(0);
      expect(items[1].taxRate).toBe(8);
      expect(items[1].taxAmount).toBe(realTax.extractTax(31.5, 8).taxAmount);

      // totalAmount = 70 + 31.5 = 101.5 ; no discount → finalAmount equal
      expect(data.totalAmount).toBe(101.5);
      expect(data.discount).toBe(0);
      expect(data.finalAmount).toBe(101.5);

      // adjustedTaxAmount with discount 0 = round(Σtax * 1 * 100)/100
      const grossTax =
        realTax.extractTax(70, 18).taxAmount + realTax.extractTax(31.5, 8).taxAmount;
      expect(data.taxAmount).toBe(Math.round(grossTax * 1 * 100) / 100);
    });

    it('applies a valid discount and proportionally adjusts tax', async () => {
      prisma.product.findMany.mockResolvedValue([productB] as any);
      await service.create(scope, {
        type: 'DINE_IN',
        items: [{ productId: 'p-B', quantity: 2 }], // 2 * 10.5 = 21
        discount: 6,
      } as any);

      const data = (prisma.order.create as jest.Mock).mock.calls[0][0].data;
      expect(data.totalAmount).toBe(21);
      expect(data.discount).toBe(6);
      expect(data.finalAmount).toBe(15);

      const grossTax = realTax.extractTax(21, 8).taxAmount;
      const ratio = 6 / 21;
      expect(data.taxAmount).toBe(Math.round(grossTax * (1 - ratio) * 100) / 100);
    });

    it('THROWS when discount exceeds the order total (create policy)', async () => {
      prisma.product.findMany.mockResolvedValue([productB] as any);
      await expect(
        service.create(scope, {
          type: 'DINE_IN',
          items: [{ productId: 'p-B', quantity: 1 }], // total 10.5
          discount: 999,
        } as any),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.order.create).not.toHaveBeenCalled();
    });
  });

  describe('update() pricing', () => {
    const existingOrder = {
      id: 'order-1',
      branchId: 'branch-1',
      tenantId,
      status: OrderStatus.PENDING,
      discount: new Prisma.Decimal('0'),
      totalAmount: new Prisma.Decimal('50'),
      orderItems: [],
      table: null,
      user: null,
    };

    beforeEach(() => {
      // findOne (pre-tx) + the in-tx editable count.
      prisma.order.findFirst.mockResolvedValue(existingOrder as any);
      (prisma.order.count as any).mockResolvedValue(1);
      (prisma.orderItemPayment.count as any).mockResolvedValue(0);
      (prisma.pendingSelfPayment.findMany as any).mockResolvedValue([]);
      prisma.modifier.findMany.mockResolvedValue([modX] as any);
      prisma.orderItem.deleteMany.mockResolvedValue({ count: 0 } as any);
      (prisma.order.update as any).mockImplementation(async ({ data }: any) => ({
        id: 'order-1',
        branchId: 'branch-1',
        ...data,
        orderItems: [],
      }));
    });

    it('recomputes totals/tax identically to create on item rewrite', async () => {
      prisma.product.findMany.mockResolvedValue([productA, productB] as any);
      await service.update(scope, 'order-1', {
        items: [
          { productId: 'p-A', quantity: 2, modifiers: [{ modifierId: 'm-X', quantity: 1 }] },
          { productId: 'p-B', quantity: 3 },
        ],
      } as any);

      const data = (prisma.order.update as jest.Mock).mock.calls[0][0].data;
      const items = data.orderItems.create;
      expect(items[0].subtotal).toBe(70);
      expect(items[0].modifierTotal).toBe(5);
      expect(items[0].taxAmount).toBe(realTax.extractTax(70, 18).taxAmount);
      expect(items[1].subtotal).toBe(31.5);
      expect(data.totalAmount).toBe(101.5);
      expect(data.finalAmount).toBe(101.5);
      const grossTax =
        realTax.extractTax(70, 18).taxAmount + realTax.extractTax(31.5, 8).taxAmount;
      expect(data.taxAmount).toBe(Math.round(grossTax * 1 * 100) / 100);
    });

    it('CAPS the discount at the new total instead of throwing (update policy)', async () => {
      prisma.product.findMany.mockResolvedValue([productB] as any);
      await service.update(scope, 'order-1', {
        items: [{ productId: 'p-B', quantity: 1 }], // total 10.5
        discount: 999,
      } as any);

      const data = (prisma.order.update as jest.Mock).mock.calls[0][0].data;
      expect(data.totalAmount).toBe(10.5);
      expect(data.discount).toBe(10.5); // capped, not 999
      expect(data.finalAmount).toBe(0);
    });
  });
});
