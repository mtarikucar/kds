import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { CountryService } from "./country.service";
import { mockPrismaClient, MockPrismaClient } from "../test/prisma-mock.service";
import { PrismaService } from "../../prisma/prisma.service";

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

  describe("cachedCodeFor / invalidate", () => {
    it("is null before the tenant has ever been resolved", () => {
      expect(svc.cachedCodeFor("never-seen")).toBeNull();
    });

    it("forTenant() populates the cache so cachedCodeFor() finds it synchronously", async () => {
      (prisma.tenant.findUnique as any).mockResolvedValue({ countryCode: "UZ" });
      await svc.forTenant("t1");
      expect(svc.cachedCodeFor("t1")).toBe("UZ");
      // and it doesn't require a second DB round-trip to answer
      expect(prisma.tenant.findUnique).toHaveBeenCalledTimes(1);
    });

    it("caches the RESOLVED profile code, not the raw stored value — an unknown code caches the TR fallback", async () => {
      (prisma.tenant.findUnique as any).mockResolvedValue({ countryCode: "XX" });
      await svc.forTenant("t1");
      expect(svc.cachedCodeFor("t1")).toBe("TR");
    });

    it("invalidate() clears the cache so the next forTenant() re-reads", async () => {
      (prisma.tenant.findUnique as any).mockResolvedValue({ countryCode: "UZ" });
      await svc.forTenant("t1");
      expect(prisma.tenant.findUnique).toHaveBeenCalledTimes(1);

      svc.invalidate("t1");
      expect(svc.cachedCodeFor("t1")).toBeNull();

      await svc.forTenant("t1");
      expect(prisma.tenant.findUnique).toHaveBeenCalledTimes(2);
    });

    it("invalidate() on a tenant never cached is a harmless no-op", () => {
      expect(() => svc.invalidate("nope")).not.toThrow();
    });
  });
});

// Task 2 shipped CountryService with no module registration at all — every
// test of it used `new CountryService(prisma as any)`, which bypasses Nest's
// DI entirely and would never notice it being unresolvable. Injecting it
// anywhere (RequestContextInterceptor included) threw
// UnknownDependenciesException at bootstrap. Prove real DI resolution here
// instead of trusting the hand-constructed instance above.
//
// ConfigService isn't the subject of this test — it's a dependency of
// EmailService, CommonModule's pre-existing sibling provider — but the real
// ConfigModule.forRoot() only exists in AppModule, so this standalone module
// graph needs a stand-in or CommonModule fails to compile at all.
@Global()
@Module({
  providers: [{ provide: ConfigService, useValue: { get: () => undefined } }],
  exports: [ConfigService],
})
class StubConfigGlobalsModule {}

describe("CountryService module registration", () => {
  it("resolves through real Nest DI via CommonModule", async () => {
    const { CommonModule } = await import("../common.module");

    // overrideProvider, not a stand-in @Global() module: CommonModule
    // imports PrismaModule directly, and a concrete provider from an
    // imported module beats a same-token global stub — so without this the
    // REAL PrismaService is constructed and `new PrismaClient()` throws
    // whenever DATABASE_URL is absent, which is exactly the CI unit-test
    // job (no database). This test is about CountryService resolving, not
    // about Prisma.
    const moduleRef = await Test.createTestingModule({
      imports: [StubConfigGlobalsModule, CommonModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    expect(moduleRef.get(CountryService)).toBeInstanceOf(CountryService);
  });
});
