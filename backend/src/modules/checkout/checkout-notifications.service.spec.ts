import { ConfigService } from '@nestjs/config';
import { CheckoutNotificationsService } from './checkout-notifications.service';
import { EventTypes } from '../outbox/event-types';

/**
 * v2.8.86 — CheckoutNotificationsService.
 *
 * Listens for hardware.order.placed.v1 and sends the buyer the
 * order-placed email. Recipient resolution prefers the tenant's
 * first ACTIVE ADMIN user; falls back to reportEmails[0]; skips
 * + logs when neither is available.
 *
 * Bus-contract corner: a thrown handler is logged but not re-raised
 * (iter-14 isolation). We test by directly invoking the listener
 * registered with bus.on — that gives us the same surface the
 * worker would hit at runtime.
 */
describe('CheckoutNotificationsService (v2.8.86)', () => {
  let prisma: any;
  let email: any;
  let bus: any;
  let config: any;
  let svc: CheckoutNotificationsService;
  let listener: (event: { payload: any; id: string }) => Promise<void>;

  beforeEach(() => {
    prisma = {
      hardwareOrder: {
        findFirst: jest.fn(),
      },
      tenant: {
        findUnique: jest.fn(),
      },
    };
    email = {
      sendEmail: jest.fn().mockResolvedValue(true),
    };
    bus = {
      on: jest.fn((type, handler) => {
        if (type === EventTypes.HardwareOrderPlaced) listener = handler;
      }),
    };
    config = {
      get: jest.fn((_key: string, fallback?: any) => fallback),
    } as unknown as ConfigService;
    svc = new CheckoutNotificationsService(bus, prisma, email, config);
    svc.onModuleInit();
  });

  function mockOrder(overrides: any = {}) {
    return {
      id: 'hw-order-1234567890abcdef',
      tenantId: 't-1',
      status: 'paid',
      subtotalCents: 100000,
      taxCents: 20000,
      shippingCents: 5000,
      totalCents: 125000,
      currency: 'TRY',
      shippingAddress: null,
      billingAddress: null,
      installation: null,
      paymentRef: 'CK-test-1',
      createdAt: new Date('2026-05-30T12:00:00Z'),
      items: [
        {
          name: 'Yazarkasa Hugin Tiger T300',
          qty: 2,
          unitCents: 50000,
        },
      ],
      ...overrides,
    };
  }

  function mockTenant(overrides: any = {}) {
    return {
      name: 'TestRest A.Ş.',
      reportEmails: [],
      users: [
        {
          email: 'admin@testrest.example',
          firstName: 'Ali',
          lastName: 'Veli',
        },
      ],
      ...overrides,
    };
  }

  it('subscribes to hardware.order.placed.v1 on init', () => {
    expect(bus.on).toHaveBeenCalledWith(
      EventTypes.HardwareOrderPlaced,
      expect.any(Function),
    );
  });

  it('sends order-placed email to the tenant\'s ACTIVE ADMIN on the happy path', async () => {
    prisma.hardwareOrder.findFirst.mockResolvedValue(mockOrder());
    prisma.tenant.findUnique.mockResolvedValue(mockTenant());

    await listener({
      id: 'evt-1',
      payload: {
        tenantId: 't-1',
        hardwareOrderId: 'hw-order-1234567890abcdef',
        totalCents: 125000,
        currency: 'TRY',
        paymentRef: 'CK-test-1',
      },
    });

    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    const call = email.sendEmail.mock.calls[0][0];
    expect(call.to).toBe('admin@testrest.example');
    expect(call.template).toBe('order-placed');
    expect(call.subject).toContain('hw-order');
    expect(call.context.tenantName).toBe('TestRest A.Ş.');
    expect(call.context.recipientName).toBe('Ali Veli');
    expect(call.context.items).toEqual([
      { name: 'Yazarkasa Hugin Tiger T300', qty: 2, lineTotal: '1000.00 TRY' },
    ]);
    expect(call.context.total).toBe('1250.00 TRY');
    expect(call.context.paymentRef).toBe('CK-test-1');
  });

  it('falls back to reportEmails[0] when no ACTIVE ADMIN exists (degraded path, but a placed order must NEVER go undelivered)', async () => {
    prisma.hardwareOrder.findFirst.mockResolvedValue(mockOrder());
    prisma.tenant.findUnique.mockResolvedValue(
      mockTenant({ users: [], reportEmails: ['ops@testrest.example'] }),
    );

    await listener({
      id: 'evt-1',
      payload: {
        tenantId: 't-1',
        hardwareOrderId: 'hw-order-1234567890abcdef',
        totalCents: 125000,
        currency: 'TRY',
        paymentRef: null,
      },
    });

    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    expect(email.sendEmail.mock.calls[0][0].to).toBe('ops@testrest.example');
  });

  it('skips + logs when neither admin nor reportEmails resolves', async () => {
    prisma.hardwareOrder.findFirst.mockResolvedValue(mockOrder());
    prisma.tenant.findUnique.mockResolvedValue(
      mockTenant({ users: [], reportEmails: [] }),
    );

    await listener({
      id: 'evt-1',
      payload: {
        tenantId: 't-1',
        hardwareOrderId: 'hw-order-1234567890abcdef',
        totalCents: 125000,
        currency: 'TRY',
        paymentRef: null,
      },
    });

    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('does not send when the HardwareOrder is missing (event raced ahead of commit?)', async () => {
    prisma.hardwareOrder.findFirst.mockResolvedValue(null);

    await listener({
      id: 'evt-1',
      payload: {
        tenantId: 't-1',
        hardwareOrderId: 'hw-missing',
        totalCents: 0,
        currency: 'TRY',
        paymentRef: null,
      },
    });

    expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('tenant-scopes the HardwareOrder lookup (defence in depth — event payload says tenantId)', async () => {
    prisma.hardwareOrder.findFirst.mockResolvedValue(mockOrder());
    prisma.tenant.findUnique.mockResolvedValue(mockTenant());

    await listener({
      id: 'evt-1',
      payload: {
        tenantId: 't-1',
        hardwareOrderId: 'hw-order-1234567890abcdef',
        totalCents: 125000,
        currency: 'TRY',
        paymentRef: null,
      },
    });

    const where = prisma.hardwareOrder.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({
      id: 'hw-order-1234567890abcdef',
      tenantId: 't-1',
    });
  });

  it('renders structured shippingAddress JSON into address lines', async () => {
    prisma.hardwareOrder.findFirst.mockResolvedValue(
      mockOrder({
        shippingAddress: {
          recipientName: 'Mehmet Mağaza',
          line1: 'Atatürk Cad. 12',
          line2: 'Kat 3 Daire 5',
          district: 'Kadıköy',
          city: 'İstanbul',
          postalCode: '34710',
          country: 'Türkiye',
        },
      }),
    );
    prisma.tenant.findUnique.mockResolvedValue(mockTenant());

    await listener({
      id: 'evt-1',
      payload: {
        tenantId: 't-1',
        hardwareOrderId: 'hw-order-1234567890abcdef',
        totalCents: 125000,
        currency: 'TRY',
        paymentRef: null,
      },
    });

    const ctx = email.sendEmail.mock.calls[0][0].context;
    expect(ctx.shippingAddressLines).toEqual([
      'Mehmet Mağaza',
      'Atatürk Cad. 12',
      'Kat 3 Daire 5',
      'Kadıköy, İstanbul',
      '34710',
      'Türkiye',
    ]);
  });

  it('flags installationRequested in the template context when installation === "requested"', async () => {
    prisma.hardwareOrder.findFirst.mockResolvedValue(
      mockOrder({ installation: 'requested' }),
    );
    prisma.tenant.findUnique.mockResolvedValue(mockTenant());

    await listener({
      id: 'evt-1',
      payload: {
        tenantId: 't-1',
        hardwareOrderId: 'hw-order-1234567890abcdef',
        totalCents: 125000,
        currency: 'TRY',
        paymentRef: null,
      },
    });

    expect(email.sendEmail.mock.calls[0][0].context.installationRequested).toBe(true);
  });

  it('swallows email-send errors so the bus dispatch loop is not aborted (iter-14 contract)', async () => {
    prisma.hardwareOrder.findFirst.mockResolvedValue(mockOrder());
    prisma.tenant.findUnique.mockResolvedValue(mockTenant());
    email.sendEmail.mockRejectedValue(new Error('smtp timeout'));

    // The listener must not throw — bus contract is per-listener isolation;
    // an unhandled throw would propagate up to OutboxWorkerService and
    // cause double provisioning on the next attempt.
    await expect(
      listener({
        id: 'evt-1',
        payload: {
          tenantId: 't-1',
          hardwareOrderId: 'hw-order-1234567890abcdef',
          totalCents: 125000,
          currency: 'TRY',
          paymentRef: null,
        },
      }),
    ).resolves.not.toThrow();
  });
});
