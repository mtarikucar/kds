import { Test, TestingModule } from "@nestjs/testing";
import { Prisma } from "@prisma/client";
import { OrdersService } from "./orders.service";
import { PrismaService } from "../../../prisma/prisma.service";
import { KdsGateway } from "../../kds/kds.gateway";
import { ReceiptSnapshotBuilder } from "./receipt-snapshot.builder";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../../common/test/prisma-mock.service";

/**
 * Regression: deductStockForOrder must not break for orders with no staff
 * actor (customer / QR self-order / delivery-platform orders, whose
 * Order.userId is null). StockMovement.userId is nullable for exactly this
 * case — before the fix a NOT NULL userId made Prisma fall back to the checked
 * create variant and throw "Argument `user` is missing".
 */
describe("OrdersService.deductStockForOrder — userless orders", () => {
  let service: OrdersService;
  let prisma: MockPrismaClient;

  beforeEach(async () => {
    prisma = mockPrismaClient();
    (prisma.$transaction as any).mockImplementation(async (cb: any) =>
      cb(prisma),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        ReceiptSnapshotBuilder,
        { provide: PrismaService, useValue: prisma },
        {
          provide: KdsGateway,
          useValue: { emitNewOrder: jest.fn(), emitLowStockAlert: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(OrdersService);
  });

  it("records the OUT movement with userId=null when the order has no staff user", async () => {
    jest.spyOn(service, "findOneByTenant").mockResolvedValue({
      id: "order-1",
      orderNumber: "ORD-1",
      userId: null, // customer / QR / delivery order — no staff actor
      tenantId: "tenant-1",
      branchId: "branch-1",
      orderItems: [{ productId: "p-1", quantity: 2 }],
    } as any);

    (prisma.product.findUnique as any).mockResolvedValue({
      id: "p-1",
      name: "Cola",
      stockTracked: true,
      currentStock: new Prisma.Decimal("10"),
    });
    (prisma.product.update as any).mockResolvedValue({});
    (prisma.stockMovement.create as any).mockResolvedValue({});

    await service.deductStockForOrder("order-1", "tenant-1");

    expect(prisma.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: null,
          tenantId: "tenant-1",
          branchId: "branch-1",
          productId: "p-1",
          quantity: 2,
        }),
      }),
    );
  });

  it("still attributes the movement to the staff user for staff orders", async () => {
    jest.spyOn(service, "findOneByTenant").mockResolvedValue({
      id: "order-2",
      orderNumber: "ORD-2",
      userId: "user-9",
      tenantId: "tenant-1",
      branchId: "branch-1",
      orderItems: [{ productId: "p-1", quantity: 1 }],
    } as any);

    (prisma.product.findUnique as any).mockResolvedValue({
      id: "p-1",
      name: "Cola",
      stockTracked: true,
      currentStock: new Prisma.Decimal("5"),
    });
    (prisma.product.update as any).mockResolvedValue({});
    (prisma.stockMovement.create as any).mockResolvedValue({});

    await service.deductStockForOrder("order-2", "tenant-1");

    expect(prisma.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: "user-9" }),
      }),
    );
  });

  it("is idempotent — skips a product already deducted for the same order", async () => {
    jest.spyOn(service, "findOneByTenant").mockResolvedValue({
      id: "order-3",
      orderNumber: "ORD-3",
      userId: null,
      tenantId: "tenant-1",
      branchId: "branch-1",
      orderItems: [{ productId: "p-1", quantity: 2 }],
    } as any);
    (prisma.product.findUnique as any).mockResolvedValue({
      id: "p-1",
      name: "Cola",
      stockTracked: true,
      currentStock: new Prisma.Decimal("10"),
    });
    // An OUT movement for this order already exists → already counted.
    (prisma.stockMovement.findFirst as any).mockResolvedValue({ id: "mv-1" });

    await service.deductStockForOrder("order-3", "tenant-1");

    expect(prisma.product.update).not.toHaveBeenCalled();
    expect(prisma.stockMovement.create).not.toHaveBeenCalled();
  });

  it("floors at 0 on oversell instead of throwing (best-effort, never rolls back the sale)", async () => {
    jest.spyOn(service, "findOneByTenant").mockResolvedValue({
      id: "order-4",
      orderNumber: "ORD-4",
      userId: null,
      tenantId: "tenant-1",
      branchId: "branch-1",
      orderItems: [{ productId: "p-1", quantity: 3 }],
    } as any);
    (prisma.product.findUnique as any).mockResolvedValue({
      id: "p-1",
      name: "Cola",
      stockTracked: true,
      currentStock: new Prisma.Decimal("1"), // only 1 in stock, selling 3
    });
    (prisma.stockMovement.findFirst as any).mockResolvedValue(null);
    (prisma.product.update as any).mockResolvedValue({});
    (prisma.stockMovement.create as any).mockResolvedValue({});

    await expect(
      service.deductStockForOrder("order-4", "tenant-1"),
    ).resolves.not.toThrow();

    const updateArg = (prisma.product.update as any).mock.calls[0][0];
    expect(updateArg.data.currentStock.toString()).toBe("0");
    expect(updateArg.data.isAvailable).toBe(false);
  });

  it("records the ACTUAL removed quantity on oversell (cur, not requested) so a later reversal can't mint phantom stock", async () => {
    jest.spyOn(service, "findOneByTenant").mockResolvedValue({
      id: "order-5",
      orderNumber: "ORD-5",
      userId: null,
      tenantId: "tenant-1",
      branchId: "branch-1",
      orderItems: [{ productId: "p-1", quantity: 3 }], // sell 3
    } as any);
    (prisma.product.findUnique as any).mockResolvedValue({
      id: "p-1",
      name: "Cola",
      stockTracked: true,
      currentStock: new Prisma.Decimal("1"), // only 1 exists
    });
    (prisma.stockMovement.findFirst as any).mockResolvedValue(null);
    (prisma.product.update as any).mockResolvedValue({});
    (prisma.stockMovement.create as any).mockResolvedValue({});

    await service.deductStockForOrder("order-5", "tenant-1");

    // OUT movement records 1 (what left stock), NOT 3 (requested).
    expect(prisma.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "OUT", productId: "p-1", quantity: 1 }),
      }),
    );
  });
});

describe("OrdersService stock — combo: two lines of the same product", () => {
  let service: OrdersService;
  let prisma: MockPrismaClient;

  beforeEach(async () => {
    prisma = mockPrismaClient();
    (prisma.$transaction as any).mockImplementation(async (cb: any) =>
      cb(prisma),
    );
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        ReceiptSnapshotBuilder,
        { provide: PrismaService, useValue: prisma },
        {
          provide: KdsGateway,
          useValue: { emitNewOrder: jest.fn(), emitLowStockAlert: jest.fn() },
        },
      ],
    }).compile();
    service = module.get(OrdersService);
  });

  it("deducts the SUMMED quantity once — the old (order,product) key dropped the 2nd line", async () => {
    // A combo cola child (qty 1) + a standalone cola line (qty 2). Same product.
    jest.spyOn(service, "findOneByTenant").mockResolvedValue({
      id: "order-c",
      orderNumber: "ORD-C",
      userId: null,
      tenantId: "tenant-1",
      branchId: "branch-1",
      orderItems: [
        { productId: "p-cola", quantity: 1, parentOrderItemId: "parent-1" },
        { productId: "p-cola", quantity: 2 },
      ],
    } as any);
    (prisma.product.findUnique as any).mockResolvedValue({
      id: "p-cola",
      name: "Cola",
      stockTracked: true,
      currentStock: new Prisma.Decimal("10"),
    });
    (prisma.stockMovement.findFirst as any).mockResolvedValue(null);
    (prisma.product.update as any).mockResolvedValue({});
    (prisma.stockMovement.create as any).mockResolvedValue({});

    await service.deductStockForOrder("order-c", "tenant-1");

    // ONE deduction, qty 3 (1 + 2), stock 10 → 7.
    expect(prisma.product.update).toHaveBeenCalledTimes(1);
    const updateArg = (prisma.product.update as any).mock.calls[0][0];
    expect(updateArg.data.currentStock.toString()).toBe("7");
    expect(prisma.stockMovement.create).toHaveBeenCalledTimes(1);
    expect(prisma.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ productId: "p-cola", quantity: 3 }),
      }),
    );
  });

  it("reverses the SUMMED quantity once (symmetric)", async () => {
    jest.spyOn(service, "findOneByTenant").mockResolvedValue({
      id: "order-c",
      orderNumber: "ORD-C",
      userId: null,
      tenantId: "tenant-1",
      branchId: "branch-1",
      orderItems: [
        { productId: "p-cola", quantity: 1, parentOrderItemId: "parent-1" },
        { productId: "p-cola", quantity: 2 },
      ],
    } as any);
    (prisma.product.findUnique as any).mockResolvedValue({
      id: "p-cola",
      name: "Cola",
      stockTracked: true,
      currentStock: new Prisma.Decimal("7"),
    });
    (prisma.stockMovement.findFirst as any)
      .mockResolvedValueOnce({ id: "out-1", quantity: 3 }) // was deducted (recorded 3)
      .mockResolvedValueOnce(null); // not yet reversed
    (prisma.product.update as any).mockResolvedValue({});
    (prisma.stockMovement.create as any).mockResolvedValue({});

    await service.reverseProductStockForOrder("order-c", "tenant-1");

    const updateArg = (prisma.product.update as any).mock.calls[0][0];
    expect(updateArg.data.currentStock.toString()).toBe("10"); // 7 + 3
    expect(prisma.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ quantity: 3, type: "IN" }),
      }),
    );
  });
});

describe("OrdersService.reverseProductStockForOrder", () => {
  let service: OrdersService;
  let prisma: MockPrismaClient;

  beforeEach(async () => {
    prisma = mockPrismaClient();
    (prisma.$transaction as any).mockImplementation(async (cb: any) =>
      cb(prisma),
    );
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        ReceiptSnapshotBuilder,
        { provide: PrismaService, useValue: prisma },
        {
          provide: KdsGateway,
          useValue: { emitNewOrder: jest.fn(), emitLowStockAlert: jest.fn() },
        },
      ],
    }).compile();
    service = module.get(OrdersService);
    jest.spyOn(service, "findOneByTenant").mockResolvedValue({
      id: "order-1",
      orderNumber: "ORD-1",
      userId: null,
      tenantId: "tenant-1",
      branchId: "branch-1",
      orderItems: [{ productId: "p-1", quantity: 2 }],
    } as any);
    (prisma.product.findUnique as any).mockResolvedValue({
      id: "p-1",
      name: "Cola",
      stockTracked: true,
      currentStock: new Prisma.Decimal("8"),
    });
    (prisma.product.update as any).mockResolvedValue({});
    (prisma.stockMovement.create as any).mockResolvedValue({});
  });

  it("restores currentStock with a compensating IN when the order was deducted", async () => {
    // findFirst #1 (was-deducted? → yes, recorded 2), #2 (already-reversed? → no)
    (prisma.stockMovement.findFirst as any)
      .mockResolvedValueOnce({ id: "out-1", quantity: 2 })
      .mockResolvedValueOnce(null);

    await service.reverseProductStockForOrder("order-1", "tenant-1");

    const updateArg = (prisma.product.update as any).mock.calls[0][0];
    expect(updateArg.data.currentStock.toString()).toBe("10"); // 8 + 2
    expect(prisma.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "IN",
          reason: "Order ORD-1 reversal",
          quantity: 2,
        }),
      }),
    );
  });

  it("is a no-op when the product was never deducted for this order", async () => {
    (prisma.stockMovement.findFirst as any).mockResolvedValue(null); // not deducted
    await service.reverseProductStockForOrder("order-1", "tenant-1");
    expect(prisma.product.update).not.toHaveBeenCalled();
    expect(prisma.stockMovement.create).not.toHaveBeenCalled();
  });

  it("is idempotent — does not double-credit when a reversal already exists", async () => {
    // #1 was-deducted? → yes; #2 already-reversed? → yes
    (prisma.stockMovement.findFirst as any)
      .mockResolvedValueOnce({ id: "out-1", quantity: 2 })
      .mockResolvedValueOnce({ id: "rev-1" });
    await service.reverseProductStockForOrder("order-1", "tenant-1");
    expect(prisma.product.update).not.toHaveBeenCalled();
    expect(prisma.stockMovement.create).not.toHaveBeenCalled();
  });
});
