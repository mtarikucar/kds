import { QuoteService } from "./quote.service";
import {
  PRINT3D_BASE_PRICE_CENTS,
  PRINT3D_BASE_SKU,
  PRINT3D_ITEM_PRICE_CENTS,
  PRINT3D_ITEM_SKU,
} from "../print3d/print3d.const";

/**
 * v3.7.0 — 3D baskı figür hizmetinin PARA testleri.
 *
 * Burada çivilenen tek cümle: SEPET FİYATI İSTEMCİYE SORULMAZ. Adet seçilen
 * ürün sayısından türer, taban ve kalem satırları ayrılamaz, başka kiracının
 * ürünü hiç fiyatlanmaz, ve hizmet-yalnız sepette kargo sıfırdır.
 */
const TENANT = "tenant-1";
const uuid = (n: number) =>
  `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;

function catalogRow(sku: string, priceCents: number, over: any = {}) {
  return {
    sku,
    name: sku,
    status: "published",
    category: "service",
    priceCents,
    currency: "TRY",
    serviceMeta: {
      serviceType: "print3d",
      partner: "figurunica",
      role: sku === PRINT3D_BASE_SKU ? "base" : "item",
    },
    saleMode: "DIRECT_SALE",
    ...over,
  };
}

describe("QuoteService — 3D baskı figür (v3.7.0)", () => {
  let prisma: any;
  let catalog: any;
  let addons: any;
  let licensing: any;
  let svc: QuoteService;

  const priceCart = (cart: any) => svc.quote(cart, TENANT);

  /** N ürünlük tam sepet: taban + kalem. */
  const fullCart = (ids: string[], over: any = {}) => ({
    items: [
      { type: "service", code: PRINT3D_BASE_SKU, qty: 1 },
      { type: "service", code: PRINT3D_ITEM_SKU, qty: 1, productIds: ids, ...over },
    ],
  });

  /** Tenant-filtreli sorgu bu satırları döner. */
  const productRows = (ids: string[]) =>
    ids.map((id, i) => ({
      id,
      name: `Ürün ${i}`,
      image: null,
      model3dUrl: null,
      productImages: [],
    }));

  beforeEach(() => {
    prisma = {
      subscriptionPlan: { findUnique: jest.fn() },
      product: { findMany: jest.fn() },
    };
    catalog = {
      findBySkuOrThrow: jest.fn(async (sku: string) =>
        sku === PRINT3D_BASE_SKU
          ? catalogRow(PRINT3D_BASE_SKU, PRINT3D_BASE_PRICE_CENTS)
          : catalogRow(PRINT3D_ITEM_SKU, PRINT3D_ITEM_PRICE_CENTS),
      ),
    };
    addons = { findByCodeOrThrow: jest.fn() };
    licensing = {
      loadContext: jest.fn().mockResolvedValue({
        tenantId: TENANT,
        anchorAt: null,
        hasLicense: false,
        now: new Date("2026-08-20T00:00:00.000Z"),
        tz: "Europe/Istanbul",
      }),
      price: jest.fn(),
    };
    svc = new QuoteService(prisma, catalog, addons, licensing as any);
  });

  it("derives the print3d_item quantity from productIds.length and IGNORES the client qty", async () => {
    const ids = Array.from({ length: 7 }, (_, i) => uuid(i));
    prisma.product.findMany.mockResolvedValueOnce(productRows(ids));
    // İstemci qty:1 gönderiyor — 7 figürü 50 kuruşa almaya çalışıyor.
    const q = await priceCart(fullCart(ids));
    const item = q.lines.find((l) => l.code === PRINT3D_ITEM_SKU)!;
    expect(item.qty).toBe(7);
    expect(item.subtotalCents).toBe(35_000);
  });

  it("prices 1 base + N items as 150000 + 5000*N kuruş, KDV dahil", async () => {
    const ids = Array.from({ length: 10 }, (_, i) => uuid(i));
    prisma.product.findMany.mockResolvedValueOnce(productRows(ids));
    const q = await priceCart(fullCart(ids));
    expect(q.totalCents).toBe(200_000);
    expect(q.subtotalCents).toBe(166_667); // net
    expect(q.taxCents).toBe(33_333); // gömülü KDV, ÜSTE EKLENMEZ
  });

  it("charges ZERO shipping for a service-only print3d cart", async () => {
    const ids = [uuid(1)];
    prisma.product.findMany.mockResolvedValueOnce(productRows(ids));
    const q = await priceCart(fullCart(ids));
    // "Kargo dahil" vaadi. Bunu 5000'e çevirmek ilan edilen fiyatın üstüne
    // ₺50 bindirir ve yerleşimdeki 1 kuruş toleransını patlatır.
    expect(q.shippingCents).toBe(0);
    expect(q.totalCents).toBe(155_000);
  });

  it("rejects a print3d_item line with no matching print3d_base line", async () => {
    const ids = [uuid(1)];
    prisma.product.findMany.mockResolvedValueOnce(productRows(ids));
    await expect(
      priceCart({
        items: [
          { type: "service", code: PRINT3D_ITEM_SKU, qty: 1, productIds: ids },
        ],
      }),
    ).rejects.toMatchObject({
      response: { code: "PRINT3D_INCOMPLETE_CART" },
    });
  });

  it("rejects a print3d_base line with no matching print3d_item line", async () => {
    await expect(
      priceCart({ items: [{ type: "service", code: PRINT3D_BASE_SKU, qty: 1 }] }),
    ).rejects.toMatchObject({
      response: { code: "PRINT3D_INCOMPLETE_CART" },
    });
  });

  it("rejects a cart carrying two print3d_item lines", async () => {
    // İki kalem satırı: fiyatlama ikisini de ilk satırın productIds'iyle
    // çarpar, provizyon TEK iş basar → alıcı 2N figür öder, N alır.
    const ids = [uuid(1), uuid(2)];
    await expect(
      priceCart({
        items: [
          { type: "service", code: PRINT3D_BASE_SKU, qty: 1 },
          { type: "service", code: PRINT3D_ITEM_SKU, qty: 1, productIds: ids },
          { type: "service", code: PRINT3D_ITEM_SKU, qty: 1, productIds: ids },
        ],
      }),
    ).rejects.toMatchObject({
      response: { code: "PRINT3D_DUPLICATE_LINE" },
    });
  });

  it("rejects a cart carrying two print3d_base lines", async () => {
    const ids = [uuid(1)];
    prisma.product.findMany.mockResolvedValueOnce(productRows(ids));
    // 2 × ₺1.500 tahsil edilip yine tek iş üretilirdi.
    await expect(
      priceCart({
        items: [
          { type: "service", code: PRINT3D_BASE_SKU, qty: 1 },
          { type: "service", code: PRINT3D_BASE_SKU, qty: 1 },
          { type: "service", code: PRINT3D_ITEM_SKU, qty: 1, productIds: ids },
        ],
      }),
    ).rejects.toMatchObject({
      response: { code: "PRINT3D_INCOMPLETE_CART" },
    });
  });

  it("rejects a print3d line whose companion was dropped by a catalog warning", async () => {
    const ids = [uuid(1)];
    prisma.product.findMany.mockResolvedValueOnce(productRows(ids));
    catalog.findBySkuOrThrow.mockImplementation(async (sku: string) =>
      sku === PRINT3D_BASE_SKU
        ? catalogRow(PRINT3D_BASE_SKU, PRINT3D_BASE_PRICE_CENTS, { status: "draft" })
        : catalogRow(PRINT3D_ITEM_SKU, PRINT3D_ITEM_PRICE_CENTS),
    );
    // Taban satırı service_not_purchasable ile DÜŞÜYOR: alıcı ürün başına
    // ₺50 öder, hizmeti hiç almazdı.
    await expect(priceCart(fullCart(ids))).rejects.toMatchObject({
      response: { code: "PRINT3D_INCOMPLETE_CART" },
    });
  });

  it("rejects a productId that belongs to another tenant", async () => {
    const ids = [uuid(1), uuid(2)];
    prisma.product.findMany
      .mockResolvedValueOnce(productRows([uuid(1)])) // tenant-filtreli: biri eksik
      .mockResolvedValueOnce([{ id: uuid(2) }]); // filtresiz: satır BAŞKASININ
    await expect(priceCart(fullCart(ids))).rejects.toMatchObject({
      response: { code: "PRINT3D_FOREIGN_PRODUCT" },
    });
  });

  it("prices a DELETED product without throwing so a settled payment still provisions", async () => {
    const ids = [uuid(1), uuid(2)];
    prisma.product.findMany
      .mockResolvedValueOnce(productRows([uuid(1)]))
      .mockResolvedValueOnce([]); // filtresiz de boş → gerçekten silinmiş
    const q = await priceCart(fullCart(ids));
    const item = q.lines.find((l) => l.code === PRINT3D_ITEM_SKU)!;
    expect(item.qty).toBe(2); // tutar ids.length'ten türer, DEĞİŞMEZ
    const snaps = item.meta!.print3dSnapshots!;
    expect(snaps[1]).toMatchObject({ productId: null, name: "Silinmiş ürün" });
  });

  it("rejects an empty productIds selection", async () => {
    await expect(priceCart(fullCart([]))).rejects.toMatchObject({
      response: { code: "PRINT3D_NO_PRODUCTS" },
    });
  });

  it("rejects more than 50 products", async () => {
    const ids = Array.from({ length: 51 }, (_, i) => uuid(i));
    await expect(priceCart(fullCart(ids))).rejects.toMatchObject({
      response: { code: "PRINT3D_TOO_MANY_PRODUCTS" },
    });
  });

  it("deduplicates repeated productIds before deriving the quantity", async () => {
    const a = uuid(1);
    const b = uuid(2);
    prisma.product.findMany.mockResolvedValueOnce(productRows([a, b]));
    const q = await priceCart(fullCart([a, a, b]));
    expect(q.lines.find((l) => l.code === PRINT3D_ITEM_SKU)!.qty).toBe(2);
  });

  it("snapshots the primary image url, falling back to the legacy image column", async () => {
    const ids = [uuid(1), uuid(2), uuid(3)];
    prisma.product.findMany.mockResolvedValueOnce([
      {
        id: ids[0],
        name: "Yeni foto",
        image: "/legacy-0.jpg",
        model3dUrl: null,
        productImages: [{ image: { url: "/primary-0.jpg" } }],
      },
      {
        id: ids[1],
        name: "Eski foto",
        image: "/legacy-1.jpg",
        model3dUrl: null,
        productImages: [],
      },
      {
        id: ids[2],
        name: "Fotosuz",
        image: null,
        model3dUrl: null,
        productImages: [],
      },
    ]);
    const q = await priceCart(fullCart(ids));
    const snaps = q.lines.find((l) => l.code === PRINT3D_ITEM_SKU)!.meta!
      .print3dSnapshots!;
    expect(snaps.map((s) => s.imageUrl)).toEqual([
      "/primary-0.jpg",
      "/legacy-1.jpg",
      null, // fotoğrafsız ürün bir HATA değil: üretim yalnız ADLA çalışır
    ]);
    expect(snaps.map((s) => s.position)).toEqual([0, 1, 2]);
  });

  it("snapshots model3dUrl when the product already has one", async () => {
    const ids = [uuid(1)];
    prisma.product.findMany.mockResolvedValueOnce([
      {
        id: ids[0],
        name: "Kebap",
        image: null,
        model3dUrl: "https://cdn.example/kebap.glb",
        productImages: [],
      },
    ]);
    const q = await priceCart(fullCart(ids));
    // Meshy/AI hattı ÇALIŞTIRILMAZ; yalnızca mevcut değer kopyalanır.
    expect(
      q.lines.find((l) => l.code === PRINT3D_ITEM_SKU)!.meta!.print3dSnapshots![0]
        .model3dUrl,
    ).toBe("https://cdn.example/kebap.glb");
  });
});
