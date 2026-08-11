import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { bootHttpApp, resetDb, seedLiveTenant, loginAs } from "./helpers/e2e-db";
import {
  grantLicence,
  ownProduct,
  project,
  upsertProduct,
} from "./helpers/e2e-entitlements";

/**
 * The licence rule, end to end, on a real database through the real guard
 * chain.
 *
 * This is the property the whole v3.3.0 commercial model rests on, and it is
 * not expressible in a unit test: the grant has to travel catalog row →
 * ownership row → projector → feature_entitlements → EntitlementGuard → HTTP
 * status. Every link is a place it has silently broken before — a fixture
 * granting through a dead plan column, a projector that read ownership but
 * ignored `requiresLicense`, a guard registered in the wrong module.
 *
 * Four things have to hold:
 *   1. buying nothing still gets you the whole free core, unlimited;
 *   2. a paid module without a licence is refused, with an offer attached;
 *   3. owning the module is not enough — the licence has to be live;
 *   4. when the licence lapses the module goes dark WITHOUT losing ownership,
 *      and comes back when the licence does.
 */
describe("Licensing gate (HTTP, real DB, real guards)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenant: Awaited<ReturnType<typeof seedLiveTenant>>;
  let token: string;

  const PERSONNEL_ROUTE = "/api/personnel/shift-templates";

  // ONE tenant, ONE login for the whole file. `/api/auth/login` is throttled
  // at 5/min per IP — a login per test trips it and the suite starts failing
  // on 429s that have nothing to do with entitlement. Ownership is what varies
  // between these tests, so it is ownership that gets reset, not the tenant.
  beforeAll(async () => {
    ({ app, prisma } = await bootHttpApp());
    await resetDb(prisma);
    tenant = await seedLiveTenant(prisma);
    await project(app, tenant.tenantId);
    token = await loginAs(app, tenant.email, tenant.password);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Back to "has bought nothing", then re-project so the entitlement cache
    // reflects it (projectTenant invalidates).
    await prisma.tenantAddOn.deleteMany({ where: { tenantId: tenant.tenantId } });
    await project(app, tenant.tenantId);
  });

  async function personnelModule() {
    return upsertProduct(prisma, {
      code: "module_personnel",
      name: "Personel Yönetimi",
      kind: "module",
      priceCents: 99_000,
      grants: { "feature.personnelManagement": true },
      requiresLicense: true,
    });
  }

  const get = (token: string, branchId: string, route: string) =>
    request(app.getHttpServer())
      .get(route)
      .set("Authorization", `Bearer ${token}`)
      .set("X-Branch-Id", branchId);

  it("gives the free core to a tenant that has bought nothing", async () => {
    // No licence, no products, no plan. Tables are core, and core is free and
    // unlimited — under the tier model this same tenant was capped at 5.
    await get(token, tenant.branchId, "/api/tables").expect(200);
  });

  it("refuses a paid module to an unlicensed tenant and says what to buy", async () => {
    await personnelModule();
    await project(app, tenant.tenantId);

    const res = await get(token, tenant.branchId, PERSONNEL_ROUTE).expect(403);

    // A bare 403 makes the customer call support. The body carries the
    // requirement and the cheapest product that satisfies it, which is what
    // the upsell renders — and it comes from the same catalog read checkout
    // prices from, so the number shown is the number charged.
    // The payload rides in `actionable`: the global filter rebuilds every
    // error body from a fixed shape, so anything the exception attaches has to
    // be explicitly carried. It was not, and the resolved offer — a catalog
    // read plus a proration, computed on every single denial — never left the
    // process.
    expect(res.body.actionable).toMatchObject({
      requirement: expect.objectContaining({ key: "feature.personnelManagement" }),
      licenseRequired: true,
    });
    expect(res.body.actionable.offer).toMatchObject({
      code: "module_personnel",
      annualPriceCents: 99_000,
    });
  });

  it("still refuses when the module is OWNED but no licence is live", async () => {
    // The rule that makes the licence a real prerequisite rather than a
    // suggestion. Ownership alone must not open the gate.
    const module = await personnelModule();
    await ownProduct(prisma, tenant.tenantId, module.id);
    await project(app, tenant.tenantId);

    await get(token, tenant.branchId, PERSONNEL_ROUTE).expect(403);
  });

  it("opens the gate once the licence and the module are both live", async () => {
    const module = await personnelModule();
    await grantLicence(prisma, tenant.tenantId);
    await ownProduct(prisma, tenant.tenantId, module.id);
    await project(app, tenant.tenantId);

    await get(token, tenant.branchId, PERSONNEL_ROUTE).expect(200);
  });

  it("keeps the module live while the licence is inside its grace window", async () => {
    // Manual renewal + 7 days of grace: an account that has not paid yet on
    // the anniversary morning must not lose its modules that morning.
    const module = await personnelModule();
    await grantLicence(prisma, tenant.tenantId, {
      status: "past_due",
      periodEnd: new Date(Date.now() - 2 * 24 * 3600 * 1000),
    });
    await ownProduct(prisma, tenant.tenantId, module.id);
    await project(app, tenant.tenantId);

    await get(token, tenant.branchId, PERSONNEL_ROUTE).expect(200);
  });

  it("darkens the module when the licence expires, WITHOUT deleting ownership", async () => {
    const module = await personnelModule();
    const licence = await grantLicence(prisma, tenant.tenantId);
    await ownProduct(prisma, tenant.tenantId, module.id);
    await project(app, tenant.tenantId);
    await get(token, tenant.branchId, PERSONNEL_ROUTE).expect(200);

    // Licence lapses past grace.
    await prisma.tenantAddOn.update({
      where: { id: licence.id },
      data: {
        status: "expired",
        currentPeriodEnd: new Date(Date.now() - 30 * 24 * 3600 * 1000),
      },
    });
    await project(app, tenant.tenantId);

    await get(token, tenant.branchId, PERSONNEL_ROUTE).expect(403);

    // The promise made to the customer: nothing is deleted. The module is
    // still owned, so paying restores it instead of re-buying it.
    const stillOwned = await prisma.tenantAddOn.findFirst({
      where: { tenantId: tenant.tenantId, addOnId: module.id },
    });
    expect(stillOwned?.status).toBe("active");

    // And the free core never went dark with it.
    await get(token, tenant.branchId, "/api/tables").expect(200);
  });

  it("restores the module when the licence is renewed — no repurchase", async () => {
    const module = await personnelModule();
    const licence = await grantLicence(prisma, tenant.tenantId, {
      status: "expired",
      periodEnd: new Date(Date.now() - 30 * 24 * 3600 * 1000),
    });
    await ownProduct(prisma, tenant.tenantId, module.id);
    await project(app, tenant.tenantId);
    await get(token, tenant.branchId, PERSONNEL_ROUTE).expect(403);

    await prisma.tenantAddOn.update({
      where: { id: licence.id },
      data: {
        status: "active",
        currentPeriodEnd: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      },
    });
    await project(app, tenant.tenantId);

    await get(token, tenant.branchId, PERSONNEL_ROUTE).expect(200);
  });

  it("publishes a price list with no monthly cadence in it", async () => {
    // v3.3.0 shipped with the previous catalog still published, so the public
    // price list advertised eight MONTHLY products next to the annual ones —
    // and the pricer sold them as flat one-time charges. Nothing non-annual
    // and non-oneTime may ever appear here again.
    await upsertProduct(prisma, {
      code: "module_personnel",
      kind: "module",
      grants: { "feature.personnelManagement": true },
    });
    await prisma.marketplaceAddOn.create({
      data: {
        code: "legacy_monthly_thing",
        name: "Legacy",
        kind: "SOFTWARE",
        billing: "MONTHLY",
        priceCents: 4_999,
        grants: {},
        status: "archived",
      },
    });

    const res = await request(app.getHttpServer())
      .get("/api/v1/catalog/pricing")
      .expect(200);

    expect(res.body.products.length).toBeGreaterThan(0);
    for (const product of res.body.products) {
      expect(["annual", "oneTime"]).toContain(product.billing);
    }
  });
});
