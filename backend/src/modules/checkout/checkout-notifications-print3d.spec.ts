import { CheckoutNotificationsService } from "./checkout-notifications.service";

/**
 * Yalnız-hizmet siparişinde hardware_order_items BOŞTUR (hizmet satırları
 * HardwareOrderItem üretmiyor), yani alıcı bugüne kadar ₺2.000'lik bir
 * siparişin ardından BOŞ kalem tablolu bir e-posta alıyordu.
 *
 * Constructor sırası gerçek dosyadan alındı: (bus, prisma, email, config) —
 * checkout-notifications.service.spec.ts'teki mevcut kurulumla aynı.
 * Gerçek e-posta metodu email.sendEmail({ to, subject, template, context }).
 */
describe("CheckoutNotificationsService — print3d order email", () => {
  let prisma: any;
  let email: any;
  let bus: any;
  let config: any;
  let svc: CheckoutNotificationsService;

  beforeEach(() => {
    prisma = {
      hardwareOrder: {
        findFirst: jest.fn().mockResolvedValue({
          id: "hw-abcdef12",
          currency: "TRY",
          createdAt: new Date("2026-08-21T00:00:00Z"),
          paymentRef: "CK-print3d-test-1",
          subtotalCents: 200_000,
          taxCents: 0,
          // Hizmet-yalnız sepette kargo ₺0'dır (bilinçli — quote.service.ts
          // hasHardware dalı). Bu satır o davranışı BOZMUYOR, yalnızca
          // gerçekçi bir print3d siparişi taklit ediyor.
          shippingCents: 0,
          totalCents: 200_000,
          shippingAddress: null,
          installation: null,
          items: [],
          print3dJob: {
            id: "job-1",
            itemCount: 10,
            totalCents: 200_000,
            items: [],
          },
        }),
      },
      tenant: {
        findUnique: jest.fn().mockResolvedValue({
          name: "Test Restoran",
          reportEmails: ["ops@test.com"],
          users: [],
        }),
      },
    };
    email = { sendEmail: jest.fn().mockResolvedValue(undefined) };
    bus = { on: jest.fn() };
    config = { get: jest.fn((_key: string, fallback?: any) => fallback) };
    svc = new CheckoutNotificationsService(bus, prisma, email, config);
  });

  it("renders a synthetic 3D print line instead of an empty item table", async () => {
    await svc.sendOrderPlacedEmail({
      tenantId: "t-1",
      hardwareOrderId: "hw-abcdef12",
    } as any);
    const ctx = email.sendEmail.mock.calls[0].at(-1);
    const items = (ctx.items ?? ctx.context?.items) as any[];
    expect(items).toHaveLength(1);
    expect(items[0].name).toContain("3D baskı figür");
    expect(items[0].name).toContain("10 ürün");
    expect(items[0].name).toContain("Figurunica");
    expect(items[0].qty).toBe(10);
    expect(items[0].lineTotal).toBe("2000.00 TRY");
  });

  it("includes the print3dJob relation in the order lookup", async () => {
    await svc.sendOrderPlacedEmail({
      tenantId: "t-1",
      hardwareOrderId: "hw-abcdef12",
    } as any);
    expect(prisma.hardwareOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({ print3dJob: expect.anything() }),
      }),
    );
  });
});
