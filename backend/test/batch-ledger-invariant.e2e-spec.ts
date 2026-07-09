import { ConflictException, INestApplication } from "@nestjs/common";
import { PrismaService } from "../src/prisma/prisma.service";
import { StockTransferService } from "../src/modules/stock-management/services/stock-transfer.service";
import { PurchaseInvoicesService } from "../src/modules/stock-management/services/purchase-invoices.service";
import { StockCountsService } from "../src/modules/stock-management/services/stock-counts.service";
import { CashierSessionService } from "../src/modules/cash-drawer/cashier-session.service";
import { bootE2EApp, resetDb, seedTenantBranchUser } from "./helpers/e2e-db";

/**
 * Real-Postgres invariant coverage for the batch cost sub-ledger:
 * after every physical stock write, Σ(StockBatch.quantity) must equal
 * StockItem.currentStock. This money code regressed twice under unit-mocked
 * tests (phantom/lost cost layers), so the invariant is asserted here against
 * the real engine — Decimal aggregates, Serializable transactions and all.
 * Also exercises the cashier one-OPEN-per-branch guard under real SSI.
 */
describe("Batch-ledger invariant Σ(batch)==currentStock (real DB)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await bootE2EApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  const scopeOf = (tenantId: string, branchId: string, userId: string) =>
    ({ tenantId, branchId, userId, role: "ADMIN" }) as any;

  async function seedItemWithBatch(
    tenantId: string,
    branchId: string,
    stock: number,
    cost: number,
  ) {
    const item = await prisma.stockItem.create({
      data: {
        name: `Tomato-${Date.now()}-${Math.random()}`,
        unit: "KG",
        currentStock: String(stock) as any,
        costPerUnit: String(cost) as any,
        tenantId,
        branchId,
      },
    });
    if (stock > 0) {
      await prisma.stockBatch.create({
        data: {
          quantity: String(stock) as any,
          costPerUnit: String(cost) as any,
          stockItemId: item.id,
          tenantId,
          branchId,
        },
      });
    }
    return item;
  }

  async function invariant(stockItemId: string) {
    const item = await prisma.stockItem.findUniqueOrThrow({
      where: { id: stockItemId },
    });
    const agg = await prisma.stockBatch.aggregate({
      where: { stockItemId, quantity: { gt: 0 } },
      _sum: { quantity: true },
    });
    return {
      stock: Number(item.currentStock),
      batches: Number(agg._sum.quantity ?? 0),
    };
  }

  it("holds across an inter-branch transfer (source drawdown + dest layer)", async () => {
    const { tenantId, branchId, userId } = await seedTenantBranchUser(prisma);
    const branchB = await prisma.branch.create({
      data: { tenantId, name: "Second" },
    });
    const src = await seedItemWithBatch(tenantId, branchId, 10, 2);
    const dst = await seedItemWithBatch(tenantId, branchB.id, 0, 0);

    const transfers = app.get(StockTransferService);
    const scope = scopeOf(tenantId, branchId, userId);
    const tr = await transfers.create(scope, userId, {
      toBranchId: branchB.id,
      items: [
        {
          sourceStockItemId: src.id,
          destStockItemId: dst.id,
          quantity: 4,
          unitCost: 2,
        },
      ],
    });
    await transfers.complete(scope, tr.id);

    expect(await invariant(src.id)).toEqual({ stock: 6, batches: 6 });
    expect(await invariant(dst.id)).toEqual({ stock: 4, batches: 4 });
  });

  it("holds across a supplier return (RMA)", async () => {
    const { tenantId, branchId, userId } = await seedTenantBranchUser(prisma);
    const item = await seedItemWithBatch(tenantId, branchId, 10, 2);
    const supplier = await prisma.supplier.create({
      data: { name: "E2E Supplier", tenantId },
    });

    const invoices = app.get(PurchaseInvoicesService);
    await invoices.createSupplierReturn(
      scopeOf(tenantId, branchId, userId),
      userId,
      {
        supplierId: supplier.id,
        items: [{ stockItemId: item.id, quantity: 4, unitCost: 2 }],
      },
    );

    expect(await invariant(item.id)).toEqual({ stock: 6, batches: 6 });
  });

  it("holds across a stock-count finalize in both directions", async () => {
    const { tenantId, branchId, userId } = await seedTenantBranchUser(prisma);
    const scope = scopeOf(tenantId, branchId, userId);
    const counts = app.get(StockCountsService);

    // shrinkage: counted 7 of 10 → batches drawn down to 7
    const shrink = await seedItemWithBatch(tenantId, branchId, 10, 2);
    const c1 = await prisma.stockCount.create({
      data: {
        tenantId,
        branchId,
        status: "IN_PROGRESS",
        items: {
          create: [
            {
              stockItemId: shrink.id,
              expectedQty: "10" as any,
              countedQty: "7" as any,
            },
          ],
        },
      },
    });
    await counts.finalize(c1.id, scope);
    expect(await invariant(shrink.id)).toEqual({ stock: 7, batches: 7 });

    // surplus: counted 12 of 10 → a new layer at the item's cost
    const surplus = await seedItemWithBatch(tenantId, branchId, 10, 2);
    const c2 = await prisma.stockCount.create({
      data: {
        tenantId,
        branchId,
        status: "IN_PROGRESS",
        items: {
          create: [
            {
              stockItemId: surplus.id,
              expectedQty: "10" as any,
              countedQty: "12" as any,
            },
          ],
        },
      },
    });
    await counts.finalize(c2.id, scope);
    expect(await invariant(surplus.id)).toEqual({ stock: 12, batches: 12 });
  });

  it("cashier open() enforces one OPEN session per branch on the real engine", async () => {
    const { tenantId, branchId, userId } = await seedTenantBranchUser(prisma);
    const sessions = app.get(CashierSessionService);
    const scope = scopeOf(tenantId, branchId, userId);

    await sessions.open(scope, userId, 500);
    await expect(sessions.open(scope, "other-user", 300)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
