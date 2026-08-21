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

describe("Print3dService — production queue + transitions", () => {
  let prisma: any;
  let svc: Print3dService;
  let updated: any;

  const job = (status: string) => ({ id: "job-1", status, tenantId: "t-1" });

  beforeEach(() => {
    updated = null;
    prisma = {
      hardwareProduct: { findMany: jest.fn() },
      // withTenantNames ayrı bir sorgu atıyor (Print3dJob'ta Tenant ilişkisi
      // yok); mock'ta olmazsa listQueue "findMany of undefined" ile patlar.
      tenant: { findMany: jest.fn().mockResolvedValue([]) },
      print3dJob: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(async (args: any) => {
          updated = args.data;
          return { id: "job-1", ...args.data };
        }),
      },
      print3dJobItem: {
        findFirst: jest.fn().mockResolvedValue({ id: "item-1", jobId: "job-1" }),
        update: jest.fn(async (args: any) => args.data),
      },
    };
    svc = new Print3dService(prisma, { get: jest.fn() } as any);
  });

  it("allows queued -> in_production -> produced and refuses produced -> queued", async () => {
    prisma.print3dJob.findUnique.mockResolvedValue(job("queued"));
    await svc.updateStatus("job-1", { status: "in_production" });
    expect(updated.status).toBe("in_production");

    prisma.print3dJob.findUnique.mockResolvedValue(job("in_production"));
    await svc.updateStatus("job-1", { status: "produced" });
    expect(updated.status).toBe("produced");

    prisma.print3dJob.findUnique.mockResolvedValue(job("produced"));
    await expect(
      svc.updateStatus("job-1", { status: "queued" }),
    ).rejects.toMatchObject({
      response: { code: "PRINT3D_INVALID_TRANSITION", from: "produced", to: "queued" },
    });
  });

  it("allows cancelling from queued and in_production but not from produced", async () => {
    for (const from of ["queued", "in_production"]) {
      prisma.print3dJob.findUnique.mockResolvedValue(job(from));
      await svc.updateStatus("job-1", { status: "cancelled" });
      expect(updated.status).toBe("cancelled");
    }
    prisma.print3dJob.findUnique.mockResolvedValue(job("produced"));
    await expect(
      svc.updateStatus("job-1", { status: "cancelled" }),
    ).rejects.toMatchObject({
      response: { code: "PRINT3D_INVALID_TRANSITION" },
    });
  });

  it("stamps producedAt / cancelledAt on the terminal transitions", async () => {
    prisma.print3dJob.findUnique.mockResolvedValue(job("in_production"));
    await svc.updateStatus("job-1", { status: "produced" });
    expect(updated.producedAt).toBeInstanceOf(Date);
    expect(updated.cancelledAt).toBeUndefined();

    prisma.print3dJob.findUnique.mockResolvedValue(job("queued"));
    await svc.updateStatus("job-1", { status: "cancelled", opsNote: "iptal" });
    expect(updated.cancelledAt).toBeInstanceOf(Date);
    expect(updated.opsNote).toBe("iptal");
  });

  it("throws NotFound for an unknown job id", async () => {
    prisma.print3dJob.findUnique.mockResolvedValue(null);
    await expect(
      svc.updateStatus("nope", { status: "in_production" }),
    ).rejects.toThrow("3D baskı işi bulunamadı");
  });

  it("listQueue filters by status and partner and spans every tenant", async () => {
    await svc.listQueue({ status: "queued", partner: "figurunica" });
    expect(prisma.print3dJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "queued", partner: "figurunica" },
      }),
    );
  });

  it("updateItem refuses an itemId that belongs to another job", async () => {
    prisma.print3dJobItem.findFirst.mockResolvedValue(null);
    await expect(
      svc.updateItem("job-1", "item-of-another-job", { status: "printed" }),
    ).rejects.toThrow("3D baskı kalemi bulunamadı");
  });

  it("refuses a repeated same-status transition instead of silently re-applying it", async () => {
    // Bir operatörün çift-tıklaması ya da retry'ı AYNI durumu tekrar
    // gönderebilir. TRANSITIONS haritasında self-loop yok — sessizce
    // "başarılı" dönüp producedAt/cancelledAt'i yeniden damgalamak yerine
    // reddedilmeli.
    prisma.print3dJob.findUnique.mockResolvedValue(job("in_production"));
    await expect(
      svc.updateStatus("job-1", { status: "in_production" }),
    ).rejects.toMatchObject({
      response: {
        code: "PRINT3D_INVALID_TRANSITION",
        from: "in_production",
        to: "in_production",
      },
    });
    expect(prisma.print3dJob.update).not.toHaveBeenCalled();
  });

  it("refuses any further transition once a job is in a terminal status", async () => {
    for (const terminal of ["produced", "cancelled"]) {
      for (const to of ["queued", "in_production", "produced", "cancelled"]) {
        prisma.print3dJob.findUnique.mockResolvedValue(job(terminal));
        await expect(
          svc.updateStatus("job-1", { status: to as any }),
        ).rejects.toMatchObject({
          response: { code: "PRINT3D_INVALID_TRANSITION", from: terminal, to },
        });
      }
    }
    expect(prisma.print3dJob.update).not.toHaveBeenCalled();
  });
});
