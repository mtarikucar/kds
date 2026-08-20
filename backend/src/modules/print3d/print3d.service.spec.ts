import { Print3dService, sanitizePartnerUrl } from "./print3d.service";
import {
  PRINT3D_BASE_SKU,
  PRINT3D_ITEM_SKU,
  PRINT3D_PARTNER_URL_DEFAULT,
} from "./print3d.const";

describe("Print3dService — offer", () => {
  let prisma: any;
  let config: any;
  let svc: Print3dService;

  const rows = (over: Record<string, any> = {}) => [
    {
      sku: PRINT3D_BASE_SKU,
      priceCents: 150_000,
      currency: "TRY",
      status: "published",
      saleMode: "DIRECT_SALE",
      ...(over[PRINT3D_BASE_SKU] ?? {}),
    },
    {
      sku: PRINT3D_ITEM_SKU,
      priceCents: 5_000,
      currency: "TRY",
      status: "published",
      saleMode: "DIRECT_SALE",
      ...(over[PRINT3D_ITEM_SKU] ?? {}),
    },
  ];

  beforeEach(() => {
    prisma = {
      hardwareProduct: { findMany: jest.fn().mockResolvedValue(rows()) },
      print3dJob: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
      print3dJobItem: { update: jest.fn(), findFirst: jest.fn() },
    };
    config = { get: jest.fn().mockReturnValue(undefined) };
    svc = new Print3dService(prisma, config);
  });

  it("getOffer reads live prices from the two catalog rows, never the constants", async () => {
    prisma.hardwareProduct.findMany.mockResolvedValue(
      rows({ [PRINT3D_BASE_SKU]: { priceCents: 160_000 } }),
    );
    const offer = await svc.getOffer();
    expect(offer.basePriceCents).toBe(160_000);
    expect(offer.perItemCents).toBe(5_000);
    expect(offer.available).toBe(true);
    expect(offer.minItems).toBe(1);
    expect(offer.maxItems).toBe(50);
  });

  it("getOffer reports available:false when either SKU is unpublished", async () => {
    prisma.hardwareProduct.findMany.mockResolvedValue(
      rows({ [PRINT3D_ITEM_SKU]: { status: "archived" } }),
    );
    expect((await svc.getOffer()).available).toBe(false);
  });

  it("getOffer reports available:false when either SKU is not DIRECT_SALE", async () => {
    prisma.hardwareProduct.findMany.mockResolvedValue(
      rows({ [PRINT3D_BASE_SKU]: { saleMode: "QUOTE_ONLY" } }),
    );
    expect((await svc.getOffer()).available).toBe(false);
  });

  it("getOffer reports available:false when a catalog row is missing entirely", async () => {
    prisma.hardwareProduct.findMany.mockResolvedValue([rows()[0]]);
    expect((await svc.getOffer()).available).toBe(false);
  });

  it("getOffer falls back to https://figurunica.com when PRINT3D_PARTNER_URL is unset", async () => {
    const offer = await svc.getOffer();
    expect(offer.partnerUrl).toBe(PRINT3D_PARTNER_URL_DEFAULT);
    expect(offer.partnerName).toBe("Figurunica");
  });

  it("getOffer prefers PRINT3D_PARTNER_URL over the built-in default", async () => {
    config.get.mockReturnValue("https://partner.example");
    expect((await svc.getOffer()).partnerUrl).toBe("https://partner.example");
  });

  it("getOffer rejects a non-http(s) PRINT3D_PARTNER_URL", async () => {
    config.get.mockReturnValue("javascript:alert(1)");
    // Varsayılana DÜŞMEZ: açık bir yanlış yapılandırma sessizce düzeltilmez.
    // Rozet metni yine boş değil — bileşen <span>'e düşer.
    expect((await svc.getOffer()).partnerUrl).toBeNull();
  });
});

describe("sanitizePartnerUrl", () => {
  it("accepts http and https", () => {
    expect(sanitizePartnerUrl("https://figurunica.com")).toBe(
      "https://figurunica.com",
    );
    expect(sanitizePartnerUrl("http://figurunica.com")).toBe(
      "http://figurunica.com",
    );
  });

  it("rejects javascript:, protocol-relative and empty values", () => {
    expect(sanitizePartnerUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizePartnerUrl("//evil.example")).toBeNull();
    expect(sanitizePartnerUrl("")).toBeNull();
    expect(sanitizePartnerUrl(undefined)).toBeNull();
  });
});

describe("Print3dService — tenant reads", () => {
  let prisma: any;
  let svc: Print3dService;

  beforeEach(() => {
    prisma = {
      hardwareProduct: { findMany: jest.fn() },
      print3dJob: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
      print3dJobItem: { update: jest.fn(), findFirst: jest.fn() },
    };
    svc = new Print3dService(prisma, { get: jest.fn() } as any);
  });

  it("listMine is tenant-fenced", async () => {
    await svc.listMine("t-1");
    expect(prisma.print3dJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: "t-1" } }),
    );
  });

  it("getMine uses a composite tenant+id WHERE, never a bare id lookup", async () => {
    prisma.print3dJob.findFirst.mockResolvedValue({ id: "job-1", items: [] });
    await svc.getMine("t-1", "job-1");
    expect(prisma.print3dJob.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "job-1", tenantId: "t-1" } }),
    );
  });

  it("getMine throws NotFound for another tenant's job", async () => {
    prisma.print3dJob.findFirst.mockResolvedValue(null);
    await expect(svc.getMine("t-1", "job-of-t2")).rejects.toThrow(
      "3D baskı işi bulunamadı",
    );
  });
});
