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
});
