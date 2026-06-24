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
 * M7 — staff POS order path must enforce ModifierGroup required / min / max
 * the SAME way the customer QR path does. Pre-fix a waiter could ring an
 * order missing a required group (e.g. steak with no cooking temperature) or
 * exceeding a group's max; the QR path rejected the identical payload.
 *
 * Exercises both POST /orders (create) and PATCH /orders/:id (update).
 */
describe('OrdersService — staff modifier-group required/min/max (M7)', () => {
  let service: OrdersService;
  let prisma: MockPrismaClient;
  const realTax = new TaxCalculationService();

  const tenantId = 'tenant-1';
  const scope: BranchScope = {
    tenantId,
    branchId: 'branch-1',
    userId: 'user-1',
    role: UserRole.WAITER,
  };

  // "Cooking Temperature": required, single (max 1). modifiers rare/medium/well.
  const tempGroup = {
    isActive: true,
    isRequired: true,
    minSelections: 0,
    maxSelections: 1,
    displayName: 'Cooking Temperature',
    modifiers: [{ id: 'rare' }, { id: 'medium' }, { id: 'well' }],
  };
  // "Sauces": optional, max 2.
  const sauceGroup = {
    isActive: true,
    isRequired: false,
    minSelections: 0,
    maxSelections: 2,
    displayName: 'Sauces',
    modifiers: [{ id: 's1' }, { id: 's2' }, { id: 's3' }],
  };

  const steak = {
    id: 'p-steak',
    name: 'Steak',
    price: new Prisma.Decimal('100.00'),
    taxRate: 18,
    tenantId,
    isAvailable: true,
    modifierGroups: [{ group: tempGroup }, { group: sauceGroup }],
  };

  // DB rows the modifier.findMany / productModifierGroup.findMany return.
  const dbModifiers = [
    { id: 'rare', name: 'Rare', priceAdjustment: new Prisma.Decimal('0'), groupId: 'g-temp', tenantId, isAvailable: true },
    { id: 'medium', name: 'Medium', priceAdjustment: new Prisma.Decimal('0'), groupId: 'g-temp', tenantId, isAvailable: true },
    { id: 's1', name: 'Sauce1', priceAdjustment: new Prisma.Decimal('0'), groupId: 'g-sauce', tenantId, isAvailable: true },
    { id: 's2', name: 'Sauce2', priceAdjustment: new Prisma.Decimal('0'), groupId: 'g-sauce', tenantId, isAvailable: true },
    { id: 's3', name: 'Sauce3', priceAdjustment: new Prisma.Decimal('0'), groupId: 'g-sauce', tenantId, isAvailable: true },
  ];

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
    prisma.product.findMany.mockResolvedValue([steak] as any);
    prisma.modifier.findMany.mockResolvedValue(dbModifiers as any);
    // belongs-to-product junction: both groups apply to the steak.
    prisma.productModifierGroup.findMany.mockResolvedValue([
      { productId: 'p-steak', groupId: 'g-temp' },
      { productId: 'p-steak', groupId: 'g-sauce' },
    ] as any);
    (prisma.order.create as any).mockImplementation(async ({ data }: any) => ({
      id: 'order-1',
      branchId: data.branchId,
      ...data,
      orderItems: [],
    }));
    (prisma.order.update as any).mockResolvedValue({ id: 'order-1', branchId: 'branch-1' } as any);
    buildService();
  });

  describe('create() — POST /orders', () => {
    it('rejects when a required group (cooking temperature) is omitted', async () => {
      await expect(
        service.create(scope, {
          type: 'DINE_IN',
          items: [{ productId: 'p-steak', quantity: 1, modifiers: [] }],
        } as any),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it('rejects when a group max (max 2 sauces) is exceeded', async () => {
      await expect(
        service.create(scope, {
          type: 'DINE_IN',
          items: [
            {
              productId: 'p-steak',
              quantity: 1,
              modifiers: [
                { modifierId: 'rare', quantity: 1 },
                { modifierId: 's1', quantity: 1 },
                { modifierId: 's2', quantity: 1 },
                { modifierId: 's3', quantity: 1 },
              ],
            },
          ],
        } as any),
      ).rejects.toThrow(/at most 2 selection/);
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it('accepts a valid selection (required temp + within sauce max)', async () => {
      await service.create(scope, {
        type: 'DINE_IN',
        items: [
          {
            productId: 'p-steak',
            quantity: 1,
            modifiers: [
              { modifierId: 'medium', quantity: 1 },
              { modifierId: 's1', quantity: 1 },
            ],
          },
        ],
      } as any);
      expect(prisma.order.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('update() — PATCH /orders/:id', () => {
    const existingOrder = {
      id: 'order-1',
      branchId: 'branch-1',
      tenantId,
      status: OrderStatus.PENDING,
      discount: new Prisma.Decimal('0'),
      totalAmount: new Prisma.Decimal('100'),
      orderItems: [],
      table: null,
      user: null,
    };

    beforeEach(() => {
      prisma.order.findFirst.mockResolvedValue(existingOrder as any);
      (prisma.order.count as any).mockResolvedValue(1);
      (prisma.orderItemPayment.count as any).mockResolvedValue(0);
      (prisma.pendingSelfPayment.findMany as any).mockResolvedValue([]);
      prisma.orderItem.deleteMany.mockResolvedValue({ count: 0 } as any);
      (prisma.order.update as any).mockImplementation(async ({ data }: any) => ({
        id: 'order-1',
        branchId: 'branch-1',
        ...data,
        orderItems: [],
      }));
    });

    it('rejects when a PATCH omits a required group', async () => {
      await expect(
        service.update(scope, 'order-1', {
          items: [{ productId: 'p-steak', quantity: 1, modifiers: [] }],
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when a PATCH exceeds a group max', async () => {
      await expect(
        service.update(scope, 'order-1', {
          items: [
            {
              productId: 'p-steak',
              quantity: 1,
              modifiers: [
                { modifierId: 'rare', quantity: 1 },
                { modifierId: 's1', quantity: 1 },
                { modifierId: 's2', quantity: 1 },
                { modifierId: 's3', quantity: 1 },
              ],
            },
          ],
        } as any),
      ).rejects.toThrow(/at most 2 selection/);
    });

    it('rejects a foreign modifier on update (belongs-to-product guard it previously lacked)', async () => {
      // 'medium' is valid, but 'not-a-real-mod' belongs to no active group.
      prisma.modifier.findMany.mockResolvedValue([
        ...dbModifiers,
        { id: 'foreign', name: 'Foreign', priceAdjustment: new Prisma.Decimal('0'), groupId: 'g-other', tenantId, isAvailable: true },
      ] as any);
      await expect(
        service.update(scope, 'order-1', {
          items: [
            {
              productId: 'p-steak',
              quantity: 1,
              modifiers: [
                { modifierId: 'medium', quantity: 1 },
                { modifierId: 'foreign', quantity: 1 },
              ],
            },
          ],
        } as any),
      ).rejects.toThrow(/not allowed on product/);
    });

    it('accepts a valid PATCH selection', async () => {
      await service.update(scope, 'order-1', {
        items: [
          {
            productId: 'p-steak',
            quantity: 1,
            modifiers: [{ modifierId: 'medium', quantity: 1 }],
          },
        ],
      } as any);
      expect(prisma.order.update).toHaveBeenCalled();
    });
  });
});
