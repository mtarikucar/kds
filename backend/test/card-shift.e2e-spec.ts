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
import { TenantMarketplaceService } from "../src/modules/marketplace/tenant-marketplace.service";
import { TenantAddOnSweeperService } from "../src/modules/marketplace/tenant-addon-sweeper.service";
import { cardUidHash, cardUidLast4, normalizeCardUid } from "../src/modules/personnel/card-uid";

/**
 * The card rail, end to end.
 *
 * Two properties are only expressible here. (1) The tap endpoint requires BOTH
 * personnelManagement and cardShift — a method-level @RequiresFeature OVERRIDES
 * the class-level one, so owning only the card product must NOT open it.
 * (2) A one-time purchase leaves currentPeriodEnd NULL, which makes the sweeper
 * skip the row forever and the projector write validUntil = null: the ₺4.000
 * lock is permanent, while a lapsed LICENCE still darkens it without deleting
 * anything.
 */
describe("Card shift (HTTP, real DB, real guards)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenant: Awaited<ReturnType<typeof seedLiveTenant>>;
  let token: string;

  const TAP = "/api/personnel/attendance/card-tap";
  const UID = "04:A2:2B:9C";

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
    await prisma.attendance.deleteMany({ where: { tenantId: tenant.tenantId } });
    await prisma.tenantAddOn.deleteMany({ where: { tenantId: tenant.tenantId } });
    await prisma.user.update({
      where: { id: tenant.userId },
      data: {
        staffCardUidHash: null,
        staffCardUidEnc: null,
        staffCardLast4: null,
        staffCardAssignedAt: null,
        staffCardAssignedById: null,
      },
    });
    await project(app, tenant.tenantId);
  });

  const personnelModule = () =>
    upsertProduct(prisma, {
      code: "module_personnel",
      name: "Personel Yönetimi",
      kind: "module",
      priceCents: 99_000,
      grants: { "feature.personnelManagement": true },
      requiresLicense: true,
    });

  const cardModule = () =>
    upsertProduct(prisma, {
      code: "module_personnel_card_shift",
      name: "Kartlı Vardiya",
      kind: "module",
      billing: "oneTime",
      priceCents: 400_000,
      grants: { "feature.cardShift": true },
      requiresLicense: true,
    });

  const tap = (cardUid: string) =>
    request(app.getHttpServer())
      .post(TAP)
      .set("Authorization", `Bearer ${token}`)
      .set("X-Branch-Id", tenant.branchId)
      .send({ cardUid });

  /** Enrol a card straight onto the row — the assignment endpoint is gated the
   *  same way as the tap, and this suite is about the tap. */
  async function enrol(uid = UID) {
    await prisma.user.update({
      where: { id: tenant.userId },
      data: {
        staffCardUidHash: cardUidHash(tenant.tenantId, uid),
        staffCardLast4: cardUidLast4(uid),
        staffCardAssignedAt: new Date(),
      },
    });
  }

  async function fullyEntitled() {
    const personnel = await personnelModule();
    const card = await cardModule();
    await grantLicence(prisma, tenant.tenantId);
    await ownProduct(prisma, tenant.tenantId, personnel.id);
    await ownProduct(prisma, tenant.tenantId, card.id, { periodEnd: undefined });
    await project(app, tenant.tenantId);
  }

  it("card-tap requires authentication — no bearer token, no access", async () => {
    const res = await request(app.getHttpServer())
      .post(TAP)
      .set("X-Branch-Id", tenant.branchId)
      .send({ cardUid: UID });

    expect(res.status).toBe(401);
    // Whatever the auth guard returns, it must not be an entitlement denial —
    // that would mean EntitlementGuard ran before JwtAuthGuard populated
    // req.user, i.e. the exact wrong-order class of bug this suite exists to
    // catch.
    expect(res.body?.actionable).toBeUndefined();
  });

  it("card-tap is 403 without the cardShift product, with an offer attached", async () => {
    const personnel = await personnelModule();
    await cardModule();
    await grantLicence(prisma, tenant.tenantId);
    await ownProduct(prisma, tenant.tenantId, personnel.id);
    await project(app, tenant.tenantId);

    const res = await tap(UID).expect(403);

    expect(res.body.actionable).toMatchObject({
      requirement: expect.objectContaining({ key: "feature.cardShift" }),
    });
    expect(res.body.actionable.offer).toMatchObject({
      code: "module_personnel_card_shift",
    });
  });

  it("card-tap is 403 when cardShift is owned but personnelManagement is not", async () => {
    // K15. If the method decorator listed only cardShift it would OVERRIDE the
    // class-level personnelManagement requirement and this would be 404/200.
    const card = await cardModule();
    await grantLicence(prisma, tenant.tenantId);
    await ownProduct(prisma, tenant.tenantId, card.id);
    await project(app, tenant.tenantId);

    await tap(UID).expect(403);
  });

  it("an unknown card returns 404 CARD_NOT_RECOGNISED and writes no attendance row", async () => {
    await fullyEntitled();

    const res = await tap("99:99:99:99").expect(404);

    // HttpExceptionFilter maps a thrown exception's `code` onto the response
    // body's `errorCode` (not a top-level `code`, and `message` is a plain
    // string here, not an object) — see http-exception.filter.ts's
    // `errorCode = exceptionResponse.errorCode ?? exceptionResponse.code`.
    expect(
      res.body.errorCode ?? res.body.code ?? res.body.message?.code,
    ).toBe("CARD_NOT_RECOGNISED");
    const rows = await prisma.attendance.count({
      where: { tenantId: tenant.tenantId },
    });
    expect(rows).toBe(0);
  });

  it("a card belonging to another tenant is indistinguishable from an unknown card", async () => {
    await fullyEntitled();

    // A second, fully separate tenant enrols the SAME physical UID onto ONE of
    // its own staff members — a different tenantId salts the HMAC, so the hash
    // this tenant computes for that UID can never match that foreign row. The
    // tap on THIS tenant must 404 exactly like a UID nobody has ever enrolled,
    // with the identical code and no field that leaks "this UID exists
    // somewhere, just not here".
    const foreign = await seedLiveTenant(prisma);
    await prisma.user.update({
      where: { id: foreign.userId },
      data: {
        staffCardUidHash: cardUidHash(foreign.tenantId, UID),
        staffCardLast4: cardUidLast4(UID),
        staffCardAssignedAt: new Date(),
      },
    });

    const unknown = await tap("99:99:99:99").expect(404);
    const foreignCard = await tap(UID).expect(404);

    const unknownCode =
      unknown.body.errorCode ?? unknown.body.code ?? unknown.body.message?.code;
    const foreignCode =
      foreignCard.body.errorCode ??
      foreignCard.body.code ??
      foreignCard.body.message?.code;
    expect(foreignCode).toBe("CARD_NOT_RECOGNISED");
    expect(foreignCode).toBe(unknownCode);
    // Same shape end to end — no extra field, no different message text, no
    // hint that distinguishes "belongs to someone else" from "never enrolled".
    expect(Object.keys(foreignCard.body).sort()).toEqual(
      Object.keys(unknown.body).sort(),
    );
    expect(JSON.stringify(foreignCard.body)).not.toMatch(/04:A2:2B:9C|04A22B9C/i);

    const rows = await prisma.attendance.count({
      where: { tenantId: tenant.tenantId },
    });
    expect(rows).toBe(0);
  });

  it("a full tap cycle clocks in then clocks out on a real database", async () => {
    await fullyEntitled();
    await enrol();

    const first = await tap(UID).expect(201);
    expect(first.body.action).toBe("clockIn");

    // Step outside the 10s debounce window without sleeping the suite.
    await prisma.attendance.updateMany({
      where: { tenantId: tenant.tenantId },
      data: { updatedAt: new Date(Date.now() - 60_000) },
    });

    const second = await tap(UID).expect(201);
    expect(second.body.action).toBe("clockOut");

    const row = await prisma.attendance.findFirstOrThrow({
      where: { tenantId: tenant.tenantId },
    });
    expect(row.status).toBe("CLOCKED_OUT");
    expect(row.clockInSource).toBe("card");
    expect(row.clockOutSource).toBe("card");
  });

  it("a second tap inside the debounce window is ignored, not a clock-out", async () => {
    await fullyEntitled();
    await enrol();

    await tap(UID).expect(201);
    const dup = await tap(UID).expect(201);

    expect(dup.body.action).toBe("ignored");
    const row = await prisma.attendance.findFirstOrThrow({
      where: { tenantId: tenant.tenantId },
    });
    expect(row.status).toBe("CLOCKED_IN");
  });

  it("a one-time cardShift purchase leaves currentPeriodEnd NULL and the grant validUntil NULL", async () => {
    // K6: the sweeper filters on `currentPeriodEnd: { lte: now, not: null }`,
    // so a NULL row is never scanned and the lock never expires.
    await personnelModule();
    await cardModule();
    await grantLicence(prisma, tenant.tenantId);
    const marketplace = app.get(TenantMarketplaceService);
    // Both products are priced (deep-review C2): purchase() refuses to mint a
    // paid add-on without proof of payment unless it is a comp. Real callers
    // are checkout/PayTR settlement, which always carries a settled
    // paymentRef — mirror that here rather than reaching for the comp path,
    // which is a different (operator-grant) code path this test is not about.
    await marketplace.purchase(tenant.tenantId, {
      addOnCode: "module_personnel",
      paymentRef: "e2e-test-payment-personnel",
    });
    await marketplace.purchase(tenant.tenantId, {
      addOnCode: "module_personnel_card_shift",
      paymentRef: "e2e-test-payment-card-shift",
    });
    await project(app, tenant.tenantId);

    const owned = await prisma.tenantAddOn.findFirstOrThrow({
      where: { tenantId: tenant.tenantId, addOn: { code: "module_personnel_card_shift" } },
    });
    expect(owned.currentPeriodEnd).toBeNull();

    await app.get(TenantAddOnSweeperService).runOnce();

    const after = await prisma.tenantAddOn.findUniqueOrThrow({
      where: { id: owned.id },
    });
    expect(after.status).toBe("active");

    const grant = await prisma.featureEntitlement.findFirst({
      where: { tenantId: tenant.tenantId, key: "feature.cardShift" },
    });
    expect(grant).not.toBeNull();
    expect(grant!.validUntil).toBeNull();
  });

  it("a lapsed licence darkens card-tap but keeps the ownership row and the card assignment", async () => {
    await fullyEntitled();
    await enrol();
    await tap(UID).expect(201);

    const licence = await prisma.tenantAddOn.findFirstOrThrow({
      where: { tenantId: tenant.tenantId, addOn: { kind: "license" } },
    });
    await prisma.tenantAddOn.update({
      where: { id: licence.id },
      data: {
        status: "expired",
        currentPeriodEnd: new Date(Date.now() - 30 * 24 * 3600 * 1000),
      },
    });
    await project(app, tenant.tenantId);

    await tap(UID).expect(403);

    // K21: nothing is deleted. Paying restores it; nobody re-enrols a card.
    const stillOwned = await prisma.tenantAddOn.findFirst({
      where: {
        tenantId: tenant.tenantId,
        addOn: { code: "module_personnel_card_shift" },
      },
    });
    expect(stillOwned?.status).toBe("active");
    const staff = await prisma.user.findUniqueOrThrow({
      where: { id: tenant.userId },
    });
    expect(staff.staffCardUidHash).toBe(
      cardUidHash(tenant.tenantId, normalizeCardUid(UID)),
    );
  });
});
