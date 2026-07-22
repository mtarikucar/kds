import { ForbiddenException } from "@nestjs/common";
import { SelfPayIntentService } from "./self-pay-intent.service";
import { CustomerSelfPayService } from "./customer-self-pay.service";

/**
 * Task D1 — demo-account payment block. SelfPayIntentService.createPayIntent
 * (reached via CustomerSelfPayService.createPayIntent) is @Public /
 * unauthenticated — no req.user — so the guard is keyed off the tenantId
 * resolved from the customer session, checked immediately after
 * requireSession resolves and BEFORE the posSettings/order lookups or any
 * PayTR call. DemoGuardService is mocked here to keep this spec
 * unit-scoped.
 */
describe("SelfPayIntentService.createPayIntent demo-tenant block", () => {
  const SESSION_ID = "session-1";
  const TENANT_ID = "tenant-demo";

  let prisma: any;
  let paymentsService: any;
  let paytrAdapter: { getIframeToken: jest.Mock };
  let customerSessionService: { requireSession: jest.Mock };
  let config: { get: jest.Mock };
  let demoGuard: { assertNotDemo: jest.Mock };
  let intentService: SelfPayIntentService;
  let facade: CustomerSelfPayService;

  beforeEach(() => {
    prisma = {
      tenant: { findUnique: jest.fn() },
      posSettings: { findFirst: jest.fn() },
      orderItem: { findMany: jest.fn() },
      order: { findMany: jest.fn() },
      pendingSelfPayment: { findFirst: jest.fn(), update: jest.fn() },
      $transaction: jest.fn(),
    };
    paymentsService = {
      derivePerUnitNet: jest.fn(),
    };
    paytrAdapter = { getIframeToken: jest.fn() };
    customerSessionService = {
      requireSession: jest.fn().mockResolvedValue({
        tenantId: TENANT_ID,
        tableId: "table-1",
      }),
    };
    config = { get: jest.fn(() => undefined) };
    demoGuard = {
      assertNotDemo: jest.fn().mockRejectedValue(
        new ForbiddenException({
          statusCode: 403,
          error: "Demo Payment Blocked",
          errorCode: "DEMO_PAYMENT_BLOCKED",
          message: "Demo modunda ödeme alınamaz.",
        }),
      ),
    };
    intentService = new SelfPayIntentService(
      prisma,
      paymentsService,
      paytrAdapter as any,
      customerSessionService as any,
      config as any,
      { fetchOrderItemReservations: jest.fn(), assertOrdersSettleable: jest.fn() } as any,
      demoGuard as any,
    );
    facade = new CustomerSelfPayService(
      {} as any,
      intentService,
      {} as any,
      {} as any,
    );
  });

  it("rejects with 403 DEMO_PAYMENT_BLOCKED right after session resolution, before posSettings/order lookups or PayTR", async () => {
    await expect(
      facade.createPayIntent(
        SESSION_ID,
        { items: [{ orderItemId: "oi-1", quantity: 1 }] } as any,
        "127.0.0.1",
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ errorCode: "DEMO_PAYMENT_BLOCKED" }),
    });

    expect(customerSessionService.requireSession).toHaveBeenCalledWith(SESSION_ID);
    expect(demoGuard.assertNotDemo).toHaveBeenCalledWith(TENANT_ID);
    expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
    expect(prisma.posSettings.findFirst).not.toHaveBeenCalled();
    expect(prisma.pendingSelfPayment.findFirst).not.toHaveBeenCalled();
    expect(paytrAdapter.getIframeToken).not.toHaveBeenCalled();
  });

  it("throws ForbiddenException", async () => {
    await expect(
      facade.createPayIntent(
        SESSION_ID,
        { items: [{ orderItemId: "oi-1", quantity: 1 }] } as any,
        "127.0.0.1",
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
