import { INestApplication } from "@nestjs/common";
import { ThrottlerStorage, ThrottlerStorageRecord } from "@nestjs/throttler";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { CountryService } from "../src/common/country/country.service";
import { SuperAdminTenantsService } from "../src/modules/superadmin/services/superadmin-tenants.service";
import {
  bootHttpApp,
  bootE2EApp,
  resetDb,
  seedTenantBranchUser,
} from "./helpers/e2e-db";

/**
 * `/auth/register` carries a tight throttle (3/hour/IP — see
 * REGISTER_THROTTLE in auth.controller.ts) and this suite registers several
 * tenants from the same supertest client/IP across its `it`s. Timer-free
 * resettable stand-in, copied from card-shift.e2e-spec.ts's
 * ResettableThrottlerStorage (see that file's doc comment for why the
 * library's own ThrottlerStorageService cannot simply be `.clear()`ed
 * between tests — its per-hit setTimeout throws on an orphaned timer).
 */
class ResettableThrottlerStorage implements ThrottlerStorage {
  private readonly records = new Map<
    string,
    {
      totalHits: Map<string, number>;
      expiresAt: number;
      blockExpiresAt: number;
      isBlocked: boolean;
    }
  >();

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const now = Date.now();
    let record = this.records.get(key);
    if (!record || record.expiresAt <= now) {
      record = {
        totalHits: new Map(),
        expiresAt: now + ttl,
        blockExpiresAt: 0,
        isBlocked: false,
      };
      this.records.set(key, record);
    }
    if (record.isBlocked && record.blockExpiresAt <= now) {
      record.isBlocked = false;
      record.totalHits.set(throttlerName, 0);
    }
    const totalHits = (record.totalHits.get(throttlerName) ?? 0) + 1;
    record.totalHits.set(throttlerName, totalHits);
    if (totalHits > limit && !record.isBlocked) {
      record.isBlocked = true;
      record.blockExpiresAt = now + blockDuration;
    }
    return {
      totalHits,
      timeToExpire: Math.ceil((record.expiresAt - now) / 1000),
      isBlocked: record.isBlocked,
      timeToBlockExpire: Math.ceil((record.blockExpiresAt - now) / 1000),
    };
  }

  reset(): void {
    this.records.clear();
  }
}

/**
 * The gap this whole task exists to close: v3.7.0 shipped a multi-country
 * architecture (COUNTRY_PROFILES / CountryService / CountryCapabilityResolver)
 * but nothing ever SET Tenant.countryCode — every tenant landed on the
 * schema default ("TR") with no way to leave it. This spec proves the fix
 * BEHAVIORALLY, against a real Postgres and the full HTTP guard/validation
 * pipeline, not just "the column got written":
 *
 *   - a tenant registered with countryCode=UZ is genuinely UZ afterward
 *   - it resolves UZS (not TRY) through the tenant-settings API
 *   - it ACCEPTS a 12% QQS tax rate on a product (UZ's own band) and
 *     REJECTS 20% (a TR-only rate that is not one of UZ's [0, 6, 12])
 *   - a superadmin country correction invalidates the process-lifetime
 *     CountryService cache and takes effect on the very next read — no
 *     process restart required
 */
describe("Tenant country selection (HTTP, real Postgres)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const throttlerStorage = new ResettableThrottlerStorage();

  beforeAll(async () => {
    ({ app, prisma } = await bootHttpApp((builder) =>
      builder.overrideProvider(ThrottlerStorage).useValue(throttlerStorage),
    ));
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    throttlerStorage.reset();
    await resetDb(prisma);
  });

  function uniqueEmail(label: string): string {
    return `e2e-country-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  }

  async function registerTenant(overrides: Record<string, unknown> = {}) {
    return request(app.getHttpServer())
      .post("/api/auth/register")
      .send({
        email: uniqueEmail("uz"),
        password: "Passw0rd1",
        firstName: "Aziz",
        lastName: "Karimov",
        restaurantName: "Toshkent Oshxonasi",
        phone: "+998901234567",
        countryCode: "UZ",
        ...overrides,
      });
  }

  describe("registration requires an explicit, valid country", () => {
    it("400s when countryCode is omitted — a tenant must never silently default", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/auth/register")
        .send({
          email: uniqueEmail("no-country"),
          password: "Passw0rd1",
          firstName: "A",
          lastName: "B",
          restaurantName: "Diner",
          phone: "+905551234567",
        });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/countryCode/i);
    });

    it("400s for a countryCode with no COUNTRY_PROFILES entry — never silently resolves to the default", async () => {
      const res = await registerTenant({
        countryCode: "US",
        phone: "+15551234567",
        email: uniqueEmail("unsupported"),
      });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/countryCode/i);
    });
  });

  describe("a tenant registered as UZ actually gets UZ", () => {
    it("is written UZ / UZS at the database row level", async () => {
      const res = await registerTenant();
      expect(res.status).toBe(201);

      const tenant = await prisma.tenant.findUnique({
        where: { id: res.body.user.tenantId },
      });
      expect(tenant?.countryCode).toBe("UZ");
      expect(tenant?.currency).toBe("UZS");
    });

    it("resolves UZS + the UZ tax bands through the tenant-settings API", async () => {
      const res = await registerTenant();
      const token = res.body.accessToken;
      const branchId = res.body.user.primaryBranchId;

      const settings = await request(app.getHttpServer())
        .get("/api/tenants/settings")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Branch-Id", branchId)
        .expect(200);

      expect(settings.body.countryCode).toBe("UZ");
      expect(settings.body.currency).toBe("UZS");
      expect(settings.body.taxRates).toEqual(
        expect.arrayContaining([0, 6, 12]),
      );
      expect(settings.body.defaultTaxRate).toBe(12);
    });

    it("THE DECISIVE PROOF: accepts a 12% product tax rate (UZ's own QQS band) and rejects TR-only 20%", async () => {
      const res = await registerTenant();
      expect(res.status).toBe(201);
      const token = res.body.accessToken;
      const branchId = res.body.user.primaryBranchId;

      const category = await request(app.getHttpServer())
        .post("/api/menu/categories")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Branch-Id", branchId)
        .send({ name: "Asosiy taomlar" })
        .expect(201);

      // Accepted: 12% is UZ's own defaultTaxRate (COUNTRY_PROFILES.UZ).
      const accepted = await request(app.getHttpServer())
        .post("/api/menu/products")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Branch-Id", branchId)
        .send({
          name: "Osh",
          price: 45000,
          categoryId: category.body.id,
          taxRate: 12,
        });
      expect(accepted.status).toBe(201);
      expect(accepted.body.taxRate).toBe(12);

      // Rejected: 20% is a TR-only rate — not in UZ's [0, 6, 12]. Proves the
      // band is genuinely COUNTRY-SPECIFIC, not "any number is accepted now".
      const rejected = await request(app.getHttpServer())
        .post("/api/menu/products")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Branch-Id", branchId)
        .send({
          name: "Osh (invalid tax)",
          price: 45000,
          categoryId: category.body.id,
          taxRate: 20,
        });
      expect(rejected.status).toBe(400);
      expect(JSON.stringify(rejected.body)).toMatch(/taxRate/i);
    });
  });

  describe("a Turkish registration is unaffected by the new capture path", () => {
    it("still lands on TR / TRY and accepts the TR tax band", async () => {
      const res = await registerTenant({
        countryCode: "TR",
        phone: "+905551234567",
        email: uniqueEmail("tr"),
      });
      expect(res.status).toBe(201);
      const token = res.body.accessToken;
      const branchId = res.body.user.primaryBranchId;

      const tenant = await prisma.tenant.findUnique({
        where: { id: res.body.user.tenantId },
      });
      expect(tenant?.countryCode).toBe("TR");
      expect(tenant?.currency).toBe("TRY");

      const category = await request(app.getHttpServer())
        .post("/api/menu/categories")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Branch-Id", branchId)
        .send({ name: "Ana Yemekler" })
        .expect(201);

      const accepted = await request(app.getHttpServer())
        .post("/api/menu/products")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Branch-Id", branchId)
        .send({
          name: "Adana Kebap",
          price: 245,
          categoryId: category.body.id,
          taxRate: 20,
        });
      expect(accepted.status).toBe(201);

      // UZ's 12% is NOT one of TR's bands [0, 1, 10, 20].
      const rejected = await request(app.getHttpServer())
        .post("/api/menu/products")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Branch-Id", branchId)
        .send({
          name: "Invalid",
          price: 100,
          categoryId: category.body.id,
          taxRate: 12,
        });
      expect(rejected.status).toBe(400);
    });
  });
});

/**
 * Separate describe (its own app instance) so the CountryService singleton
 * this spec inspects is not shared with — and not warmed by — the HTTP
 * specs above.
 */
describe("Superadmin country correction invalidates the live CountryService cache", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let countryService: CountryService;
  let superAdminTenants: SuperAdminTenantsService;

  beforeAll(async () => {
    ({ app, prisma } = await bootE2EApp());
    // Resolved from the SAME DI container the whole app runs on — proves
    // the REAL production wiring (RequestContextInterceptor's CountryService
    // singleton and SuperAdminTenantsService's injected CountryService are
    // the same instance), not a hand-rolled substitute.
    countryService = app.get(CountryService);
    superAdminTenants = app.get(SuperAdminTenantsService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  it("a correction takes effect on the very next read — no process restart required", async () => {
    const { tenantId } = await seedTenantBranchUser(prisma);

    // Warm the cache exactly the way RequestContextInterceptor does on the
    // first request for this tenant in the process's lifetime.
    const before = await countryService.forTenant(tenantId);
    expect(before.code).toBe("TR");
    expect(countryService.cachedCodeFor(tenantId)).toBe("TR");

    await superAdminTenants.updateCountry(
      tenantId,
      { countryCode: "UZ" } as any,
      "sa-1",
      "ops@platform.test",
    );

    // THE proof: the cache was actually cleared, not just "a mock was
    // called". Without SuperAdminTenantsService calling
    // CountryService.invalidate(), this would still read "TR" — stuck
    // until the process restarts.
    expect(countryService.cachedCodeFor(tenantId)).toBeNull();

    const after = await countryService.forTenant(tenantId);
    expect(after.code).toBe("UZ");
    expect(after.currency).toBe("UZS");
    expect(countryService.cachedCodeFor(tenantId)).toBe("UZ");

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    expect(tenant?.countryCode).toBe("UZ");
    expect(tenant?.currency).toBe("UZS");
  });
});
