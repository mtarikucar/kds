import { PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";
import { explodeComboLine, ComboCatalog } from "./combo-pricing";

/**
 * REAL-DB integration for the combo write path. Only runs when COMBO_E2E_DB is
 * set (an isolated throwaway Postgres) so the normal mocked suite is unaffected.
 * Proves: schema/migration is applied, the two-phase order write (order +
 * createMany children carrying parentOrderItemId + orderId) satisfies every FK,
 * Σ(children.subtotal) === combo price, parent is a 0₺ grouping row, and each
 * child carries its own component KDV.
 */
const RUN = !!process.env.COMBO_E2E_DB;
const d = RUN ? describe : describe.skip;

d("combo order — real DB write path", () => {
  // Constructed in beforeAll (NOT at collection time) so the default,
  // COMBO_E2E_DB-less `jest` run never builds a client with an undefined url.
  let prisma: PrismaClient;
  const ids = {
    tenant: randomUUID(),
    branch: randomUUID(),
    cat: randomUUID(),
    burger: randomUUID(),
    fries: randomUUID(),
    cola: randomUUID(),
    combo: randomUUID(),
  };

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: { db: { url: process.env.COMBO_E2E_DB } },
    });
    await prisma.tenant.create({
      data: { id: ids.tenant, name: "E2E" },
    });
    await prisma.branch.create({
      data: { id: ids.branch, name: "Main", tenantId: ids.tenant },
    });
    await prisma.category.create({
      data: { id: ids.cat, name: "Menü", tenantId: ids.tenant },
    });
    const mk = (id: string, name: string, price: number, tax: number) =>
      prisma.product.create({
        data: {
          id,
          name,
          price,
          taxRate: tax,
          categoryId: ids.cat,
          tenantId: ids.tenant,
        },
      });
    await mk(ids.burger, "Burger", 120, 10);
    await mk(ids.fries, "Patates", 40, 10);
    await mk(ids.cola, "Kola", 35, 20);
    await prisma.product.create({
      data: {
        id: ids.combo,
        name: "Maxi Menü",
        price: 150,
        taxRate: 10,
        productType: "COMBO",
        categoryId: ids.cat,
        tenantId: ids.tenant,
      },
    });
    const grp = async (name: string, componentId: string) => {
      const g = await prisma.comboGroup.create({
        data: {
          comboProductId: ids.combo,
          tenantId: ids.tenant,
          name,
          minSelect: 1,
          maxSelect: 1,
        },
      });
      await prisma.comboGroupItem.create({
        data: {
          groupId: g.id,
          componentProductId: componentId,
          tenantId: ids.tenant,
          isDefault: true,
        },
      });
      return g.id;
    };
    await grp("Ana Ürün", ids.burger);
    await grp("Yan Ürün", ids.fries);
    await grp("İçecek", ids.cola);
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.tenant.delete({ where: { id: ids.tenant } }).catch(() => {});
    await prisma.$disconnect();
  });

  it("writes parent + children atomically and reads back a kuruş-exact, per-line-KDV combo", async () => {
    const combo = await prisma.product.findUniqueOrThrow({
      where: { id: ids.combo },
      include: {
        comboGroups: {
          include: { items: { include: { componentProduct: true } } },
        },
      },
    });
    const catalog: ComboCatalog = {
      combo: { id: combo.id, price: combo.price },
      groups: combo.comboGroups.map((g) => ({
        id: g.id,
        name: g.name,
        minSelect: g.minSelect,
        maxSelect: g.maxSelect,
        items: g.items.map((it) => ({
          componentProductId: it.componentProductId,
          quantity: it.quantity,
          priceDelta: it.priceDelta,
          isDefault: it.isDefault,
          component: {
            id: it.componentProduct.id,
            price: it.componentProduct.price,
            taxRate: it.componentProduct.taxRate,
          },
        })),
      })),
    };
    const exploded = explodeComboLine(catalog, [], 1, new Date());
    const parentId = randomUUID();

    // Two-phase write mirrors OrdersService.createInner.
    const order = await prisma.$transaction(async (tx) => {
      const o = await tx.order.create({
        data: {
          orderNumber: `E2E-${Date.now()}`,
          type: "DINE_IN",
          status: "PENDING",
          tenantId: ids.tenant,
          branchId: ids.branch,
          totalAmount: exploded.lineTotal,
          finalAmount: exploded.lineTotal,
          taxAmount: exploded.lineTax,
          orderItems: {
            create: [
              {
                id: parentId,
                productId: ids.combo,
                quantity: 1,
                unitPrice: 0,
                subtotal: 0,
                taxRate: 0,
                taxAmount: 0,
                listUnitPrice: exploded.parent.listUnitPrice,
              },
            ],
          },
        },
      });
      await tx.orderItem.createMany({
        data: exploded.children.map((c) => ({
          orderId: o.id,
          parentOrderItemId: parentId,
          productId: c.productId,
          quantity: c.quantity,
          unitPrice: c.unitPrice,
          subtotal: c.subtotal,
          taxRate: c.taxRate,
          taxAmount: c.taxAmount,
          listUnitPrice: c.listUnitPrice,
        })),
      });
      return o;
    });

    const items = await prisma.orderItem.findMany({
      where: { orderId: order.id },
    });
    const parent = items.find((i) => i.id === parentId)!;
    const children = items.filter((i) => i.parentOrderItemId === parentId);

    expect(children).toHaveLength(3);
    expect(Number(parent.subtotal)).toBe(0);
    expect(Number(parent.taxAmount)).toBe(0);
    const sum = children.reduce((s, c) => s + Number(c.subtotal), 0);
    expect(sum).toBeCloseTo(150, 2);
    // Cola child carries 20% KDV, others 10%.
    const cola = children.find((c) => c.productId === ids.cola)!;
    expect(cola.taxRate).toBe(20);
    for (const c of children) {
      const expectedTax =
        Math.round(((Number(c.subtotal) * c.taxRate) / (100 + c.taxRate)) * 100) /
        100;
      expect(Number(c.taxAmount)).toBeCloseTo(expectedTax, 2);
    }
    // Order-level tax equals the sum of child taxes.
    expect(Number(order.taxAmount)).toBeCloseTo(
      children.reduce((s, c) => s + Number(c.taxAmount), 0),
      2,
    );
  });
});
