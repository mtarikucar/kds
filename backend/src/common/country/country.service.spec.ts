import { CountryService } from "./country.service";
import { mockPrismaClient, MockPrismaClient } from "../test/prisma-mock.service";

describe("CountryService", () => {
  let prisma: MockPrismaClient;
  let svc: CountryService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new CountryService(prisma as any);
  });

  it("forCode returns the profile", () => {
    expect(svc.forCode("UZ").currency).toBe("UZS");
  });

  it("forCode falls back to the default for an unknown code rather than throwing", () => {
    // A tenant row can only hold what we wrote, but a bad manual UPDATE must
    // not take the whole request down — fall back and log.
    expect(svc.forCode("XX").code).toBe("TR");
  });

  it("forTenant reads the tenant's countryCode", async () => {
    (prisma.tenant.findUnique as any).mockResolvedValue({ countryCode: "UZ" });
    const p = await svc.forTenant("t1");
    expect(p.currency).toBe("UZS");
  });

  it("forTenant falls back to the default when the tenant is missing", async () => {
    (prisma.tenant.findUnique as any).mockResolvedValue(null);
    expect((await svc.forTenant("nope")).code).toBe("TR");
  });

  it("currencyForTenant is derived from the profile, never read off Tenant.currency", async () => {
    // Tenant.currency is a WRITTEN mirror; the profile is the truth. A row
    // whose currency disagrees with its country must resolve to the profile.
    (prisma.tenant.findUnique as any).mockResolvedValue({
      countryCode: "UZ",
      currency: "TRY", // stale/corrupt
    });
    expect(await svc.currencyForTenant("t1")).toBe("UZS");
  });
});
