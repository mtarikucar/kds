import { INestApplication } from "@nestjs/common";
import { PrismaService } from "../src/prisma/prisma.service";
import { OrdersService } from "../src/modules/orders/services/orders.service";
import { bootE2EApp, resetDb, seedTenantBranchUser } from "./helpers/e2e-db";

/**
 * Real-DB coverage for order-driven stock deduction. Before v3.2.18,
 * stock_movements.userId was NOT NULL but the create fed order.userId, which is
 * null for customer / QR / delivery orders — the real engine then threw
 * "Argument `user` is missing". This exercises exactly that userless path.
 */
describe("Stock deduction — deductStockForOrder (real DB)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orders: OrdersService;

  beforeAll(async () => {
    ({ app, prisma } = await bootE2EApp());
    orders = app.get(OrdersService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  async function seedStockedProduct(tenantId: string, stock: number) {
    const category = await prisma.category.create({
      data: { name: "Drinks", tenantId },
    });
    return prisma.product.create({
      data: {
        name: "Cola",
        price: "10.00",
        categoryId: category.id,
        tenantId,
        isAvailable: true,
        stockTracked: true,
        currentStock: String(stock) as any,
      },
    });
  }

  async function seedOrder(
    tenantId: string,
    branchId: string,
    productId: string,
    qty: number,
    userId: string | null,
  ) {
    return prisma.order.create({
      data: {
        orderNumber: `E2E-${Date.now()}-${Math.round(qty * 1000)}`,
        type: "DINE_IN",
        status: "PENDING",
        totalAmount: "10.00",
        finalAmount: "10.00",
        tenantId,
        branchId,
        userId,
        orderItems: {
          create: [
            {
              productId,
              quantity: qty,
              unitPrice: "10.00",
              subtotal: "10.00",
            },
          ],
        },
      },
    });
  }

  it("records an OUT movement with userId=null for a customer (userless) order", async () => {
    const { tenantId, branchId } = await seedTenantBranchUser(prisma);
    const product = await seedStockedProduct(tenantId, 10);
    const order = await seedOrder(tenantId, branchId, product.id, 2, null);

    await orders.deductStockForOrder(order.id, tenantId);

    const movements = await prisma.stockMovement.findMany({
      where: { tenantId },
    });
    expect(movements).toHaveLength(1);
    expect(movements[0].userId).toBeNull();
    expect(movements[0].branchId).toBe(branchId);
    expect(movements[0].productId).toBe(product.id);
    expect(movements[0].quantity).toBe(2);

    const after = await prisma.product.findUnique({
      where: { id: product.id },
    });
    expect(Number(after!.currentStock)).toBe(8);
  });

  it("attributes the movement to the staff user for staff orders", async () => {
    const { tenantId, branchId, userId } = await seedTenantBranchUser(prisma);
    const product = await seedStockedProduct(tenantId, 5);
    const order = await seedOrder(tenantId, branchId, product.id, 1, userId);

    await orders.deductStockForOrder(order.id, tenantId);

    const movement = await prisma.stockMovement.findFirst({
      where: { tenantId },
    });
    expect(movement!.userId).toBe(userId);
  });
});
