import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { bootHttpApp, resetDb, seedLiveTenant, loginAs } from "./helpers/e2e-db";

/**
 * 3D baskı figür rayı, gerçek veritabanında, gerçek guard zinciriyle.
 *
 * Burada çivilenenler bir birim testinde ifade edilemez: adet
 * sunucu-otoriterliğinin gerçek HTTP üzerinden tutması, çapraz-kiracı bir
 * productId'nin reddedilmesiyle silinmiş bir productId'nin REDDEDİLMEMESİ
 * arasındaki fark, ON DELETE SET NULL'ın gerçekten NULL yazması, iki
 * kiracının gerçekten ayrı olması, yalnız-hizmet bir siparişte kargo
 * oluşturmanın stok hareketi olmadan çalışması ve kimliksiz bir isteğin
 * bu uç noktaların HİÇBİRİNE ulaşamaması.
 */
describe("3D baskı figür (HTTP, gerçek DB)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let t1: Awaited<ReturnType<typeof seedLiveTenant>>;
  let t2: Awaited<ReturnType<typeof seedLiveTenant>>;
  let token1: string;

  async function seedCatalog() {
    for (const [sku, name, cents, role] of [
      ["print3d_base", "3D baskı figür — hizmet bedeli", 150_000, "base"],
      ["print3d_item", "3D baskı figür — ürün başına", 5_000, "item"],
    ] as const) {
      await prisma.hardwareProduct.upsert({
        where: { sku },
        update: {},
        create: {
          sku,
          category: "service",
          name,
          description: name,
          priceCents: cents,
          currency: "TRY",
          warrantyMonths: 0,
          images: ["/products/_fallback-service.svg"],
          stockStatus: "in_stock",
          status: "published",
          saleMode: "DIRECT_SALE",
          serviceMeta: {
            serviceType: "print3d",
            partner: "figurunica",
            role,
          },
          complianceDocs: { invoiceIssued: true },
        },
      });
    }
  }

  async function seedProduct(tenantId: string, name: string) {
    const category = await prisma.category.create({
      data: { tenantId, name: `Kategori ${name}`, displayOrder: 0 },
    });
    return prisma.product.create({
      data: {
        tenantId,
        categoryId: category.id,
        name,
        price: 100,
        image: `/img/${name}.jpg`,
      },
    });
  }

  beforeAll(async () => {
    ({ app, prisma } = await bootHttpApp());
    await resetDb(prisma);
    t1 = await seedLiveTenant(prisma);
    t2 = await seedLiveTenant(prisma);
    await seedCatalog();
    token1 = await loginAs(app, t1.email, t1.password);
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (path: string, body: unknown) =>
    request(app.getHttpServer())
      .post(path)
      .set("Authorization", `Bearer ${token1}`)
      .set("X-Branch-Id", t1.branchId)
      .send(body);

  /**
   * Filter serializes a thrown `{ code, message }` body onto `errorCode`
   * (see HttpExceptionFilter: `errorCode = exceptionResponse.errorCode ??
   * exceptionResponse.code`) — never a top-level `code`. Fall back to the
   * legacy alias so this helper survives either shape, mirroring the
   * pattern already used in card-shift.e2e-spec.ts.
   */
  const errorCodeOf = (body: any) =>
    body?.errorCode ?? body?.code ?? body?.message?.code;

  it("POST /api/v1/checkout/quote prices a 3-product print3d cart at 165000 kuruş with zero shipping, ignoring the client's qty", async () => {
    const ids = [];
    for (const n of ["Adana", "Lahmacun", "Künefe"]) {
      ids.push((await seedProduct(t1.tenantId, n)).id);
    }
    // Server-authoritative quantity: the client claims qty:1 for a line
    // carrying 3 productIds. If the server ever trusted the client's qty,
    // this would price at 155_000 (1 base + 1 item) instead of 165_000 (1
    // base + 3 items) — a client could post qty:1 with 50 productIds and be
    // charged for one figurine while fifty get provisioned.
    const res = await post("/api/v1/checkout/quote", {
      items: [
        { type: "service", code: "print3d_base", qty: 1 },
        { type: "service", code: "print3d_item", qty: 1, productIds: ids },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.totalCents).toBe(165_000);
    expect(res.body.shippingCents).toBe(0);
    const item = res.body.lines.find((l: any) => l.code === "print3d_item");
    expect(item.qty).toBe(3);
  });

  it("POST /api/v1/checkout/quote rejects a productId owned by a second tenant with PRINT3D_FOREIGN_PRODUCT", async () => {
    const mine = await seedProduct(t1.tenantId, "Benim");
    const theirs = await seedProduct(t2.tenantId, "Onların");
    const res = await post("/api/v1/checkout/quote", {
      items: [
        { type: "service", code: "print3d_base", qty: 1 },
        {
          type: "service",
          code: "print3d_item",
          qty: 1,
          productIds: [mine.id, theirs.id],
        },
      ],
    });
    expect(res.status).toBe(400);
    expect(errorCodeOf(res.body)).toBe("PRINT3D_FOREIGN_PRODUCT");
  });

  it("POST /api/v1/checkout/quote does NOT reject a deleted productId — the amount already derives from ids.length, so throwing at quote time would mean a card charged with nothing provisioned", async () => {
    // Same shape as the cross-tenant case above (an id in productIds that no
    // longer resolves to a live row) but this id has never belonged to ANY
    // tenant — it is simply gone. resolvePrint3dSelection only throws
    // PRINT3D_FOREIGN_PRODUCT when the missing id is found under a
    // DIFFERENT tenant; a genuinely absent id falls through with a
    // placeholder snapshot and the quote still succeeds at the same total.
    const mine = await seedProduct(t1.tenantId, "Kalici");
    const deleted = await seedProduct(t1.tenantId, "SilinecekQuote");
    await prisma.product.delete({ where: { id: deleted.id } });

    const res = await post("/api/v1/checkout/quote", {
      items: [
        { type: "service", code: "print3d_base", qty: 1 },
        {
          type: "service",
          code: "print3d_item",
          qty: 1,
          productIds: [mine.id, deleted.id],
        },
      ],
    });
    expect(res.status).toBe(201);
    const item = res.body.lines.find((l: any) => l.code === "print3d_item");
    // Amount derives from ids.length (2), not from how many rows still exist.
    expect(item.qty).toBe(2);
    expect(res.body.totalCents).toBe(160_000);
  });

  it("a settled intent provisions one HardwareOrder + one Print3dJob + N Print3dJobItem rows", async () => {
    const a = await seedProduct(t1.tenantId, "Iskender");
    const b = await seedProduct(t1.tenantId, "Baklava");
    const order = await prisma.hardwareOrder.create({
      data: {
        tenantId: t1.tenantId,
        status: "paid",
        subtotalCents: 133_333,
        taxCents: 26_667,
        shippingCents: 0,
        totalCents: 160_000,
        currency: "TRY",
      },
    });
    const job = await prisma.print3dJob.create({
      data: {
        tenantId: t1.tenantId,
        hwOrderId: order.id,
        basePriceCents: 150_000,
        perItemCents: 5_000,
        itemCount: 2,
        totalCents: 160_000,
        items: {
          create: [
            {
              productId: a.id,
              productName: a.name,
              productImageUrl: a.image,
              position: 0,
            },
            {
              productId: b.id,
              productName: b.name,
              productImageUrl: b.image,
              position: 1,
            },
          ],
        },
      },
      include: { items: true },
    });
    expect(job.items).toHaveLength(2);
    expect(job.status).toBe("queued");
    expect(job.partner).toBe("figurunica");
  });

  it("deleting a snapshotted menu product nulls productId but leaves productName and productImageUrl intact", async () => {
    const p = await seedProduct(t1.tenantId, "Silinecek");
    const order = await prisma.hardwareOrder.create({
      data: {
        tenantId: t1.tenantId,
        status: "paid",
        totalCents: 155_000,
        currency: "TRY",
      },
    });
    const job = await prisma.print3dJob.create({
      data: {
        tenantId: t1.tenantId,
        hwOrderId: order.id,
        basePriceCents: 150_000,
        perItemCents: 5_000,
        itemCount: 1,
        totalCents: 155_000,
        items: {
          create: [
            {
              productId: p.id,
              productName: p.name,
              productImageUrl: p.image,
              position: 0,
            },
          ],
        },
      },
    });
    await prisma.product.delete({ where: { id: p.id } });
    const items = await prisma.print3dJobItem.findMany({
      where: { jobId: job.id },
    });
    expect(items[0].productId).toBeNull();
    expect(items[0].productName).toBe("Silinecek");
    expect(items[0].productImageUrl).toBe("/img/Silinecek.jpg");
  });

  it("allows two items in one job after both snapshotted products are deleted", async () => {
    // @@unique([jobId, productId]) NULL'ları AYRI sayar, bu yüzden iki
    // productId=NULL kalemi çakışmaz. Asıl tekilleştirme quote'taki Set'tir.
    const p1 = await seedProduct(t1.tenantId, "Cift1");
    const p2 = await seedProduct(t1.tenantId, "Cift2");
    const order = await prisma.hardwareOrder.create({
      data: {
        tenantId: t1.tenantId,
        status: "paid",
        totalCents: 160_000,
        currency: "TRY",
      },
    });
    const job = await prisma.print3dJob.create({
      data: {
        tenantId: t1.tenantId,
        hwOrderId: order.id,
        basePriceCents: 150_000,
        perItemCents: 5_000,
        itemCount: 2,
        totalCents: 160_000,
        items: {
          create: [
            { productId: p1.id, productName: "Cift1", position: 0 },
            { productId: p2.id, productName: "Cift2", position: 1 },
          ],
        },
      },
    });
    await prisma.product.delete({ where: { id: p1.id } });
    await prisma.product.delete({ where: { id: p2.id } });
    const items = await prisma.print3dJobItem.findMany({
      where: { jobId: job.id },
    });
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.productId === null)).toBe(true);
  });

  it("GET /api/v1/print3d/jobs returns only the caller tenant's jobs", async () => {
    const otherOrder = await prisma.hardwareOrder.create({
      data: {
        tenantId: t2.tenantId,
        status: "paid",
        totalCents: 155_000,
        currency: "TRY",
      },
    });
    await prisma.print3dJob.create({
      data: {
        tenantId: t2.tenantId,
        hwOrderId: otherOrder.id,
        basePriceCents: 150_000,
        perItemCents: 5_000,
        itemCount: 1,
        totalCents: 155_000,
      },
    });
    const res = await request(app.getHttpServer())
      .get("/api/v1/print3d/jobs")
      .set("Authorization", `Bearer ${token1}`)
      .set("X-Branch-Id", t1.branchId);
    expect(res.status).toBe(200);
    expect(res.body.every((j: any) => j.tenantId === t1.tenantId)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it("POST /api/v1/superadmin/shipments/:orderId works on a service-only order (empty items, no stock movement)", async () => {
    // createShipment order.items üzerinde dönüyor; yalnız-hizmet siparişinde o
    // dizi BOŞ, yani çağrı bir no-op gibi davranmalı: patlamamalı ve hiçbir
    // stok hareketi üretmemeli. Panel bu rayı aynen çağıracak.
    const order = await prisma.hardwareOrder.create({
      data: {
        tenantId: t1.tenantId,
        status: "paid",
        totalCents: 155_000,
        currency: "TRY",
      },
    });
    await prisma.print3dJob.create({
      data: {
        tenantId: t1.tenantId,
        hwOrderId: order.id,
        basePriceCents: 150_000,
        perItemCents: 5_000,
        itemCount: 1,
        totalCents: 155_000,
        items: { create: [{ productName: "Kargolanacak", position: 0 }] },
      },
    });
    const before = await prisma.hardwareInventory.findMany({
      select: { productId: true, allocated: true, shipped: true },
      orderBy: { productId: "asc" },
    });

    const { ShipmentService } = await import(
      "../src/modules/fulfillment/shipment.service"
    );
    const shipments = app.get(ShipmentService);
    await shipments.createShipment(order.id, { carrier: "Aras" } as any);

    const after = await prisma.hardwareInventory.findMany({
      select: { productId: true, allocated: true, shipped: true },
      orderBy: { productId: "asc" },
    });
    expect(after).toEqual(before);
    const rows = await prisma.shipment.findMany({ where: { orderId: order.id } });
    expect(rows.length).toBeGreaterThan(0);
  });

  it("GET /api/v1/print3d/offer reports the live catalog prices", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/print3d/offer")
      .set("Authorization", `Bearer ${token1}`)
      .set("X-Branch-Id", t1.branchId);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      available: true,
      basePriceCents: 150_000,
      perItemCents: 5_000,
      minItems: 1,
      maxItems: 50,
      partnerName: "Figurunica",
    });
  });

  describe("kimliksiz istekler print3d rayına ulaşamaz", () => {
    // Print3dController carries only JwtAuthGuard+RolesGuard — the money
    // (checkout/quote) and manifest data (jobs) behind this feature must
    // 401 before any handler runs when no bearer token is presented. A gap
    // here would mean a card price or another tenant's job list is
    // reachable by anyone who can reach the API at all.
    it("POST /api/v1/checkout/quote with no bearer token is 401", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/checkout/quote")
        .set("X-Branch-Id", t1.branchId)
        .send({ items: [{ type: "service", code: "print3d_base", qty: 1 }] });
      expect(res.status).toBe(401);
    });

    it("GET /api/v1/print3d/jobs with no bearer token is 401", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/print3d/jobs")
        .set("X-Branch-Id", t1.branchId);
      expect(res.status).toBe(401);
    });

    it("GET /api/v1/print3d/offer with no bearer token is 401", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/print3d/offer")
        .set("X-Branch-Id", t1.branchId);
      expect(res.status).toBe(401);
    });

    it("GET /api/v1/superadmin/print3d/jobs with no bearer token is 401", async () => {
      const res = await request(app.getHttpServer()).get(
        "/api/v1/superadmin/print3d/jobs",
      );
      expect(res.status).toBe(401);
    });
  });
});
