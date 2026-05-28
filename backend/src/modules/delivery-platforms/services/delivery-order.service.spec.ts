import { DeliveryOrderService } from './delivery-order.service';
import { mockPrismaClient, MockPrismaClient } from '../../../common/test/prisma-mock.service';

/**
 * Iter-39 regressions: processIncomingOrder must
 *   (a) bump configService.recordError when adapter.acceptOrder
 *       fails — third outbound surface that iter-38 missed.
 *   (b) read config ONCE before the txn, not twice (the earlier
 *       double-read could disagree under admin-toggle race —
 *       order persisted as auto-accepted but the platform-side
 *       accept never fired).
 */
describe('DeliveryOrderService (iter-39)', () => {
  let prisma: MockPrismaClient;
  let kdsGateway: any;
  let adapterFactory: any;
  let logService: any;
  let authService: any;
  let configService: any;
  let svc: DeliveryOrderService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    kdsGateway = { emitNewOrder: jest.fn() };
    adapterFactory = { getAdapter: jest.fn() };
    logService = {
      log: jest.fn().mockResolvedValue(undefined),
      scrubPii: jest.fn((x: any) => x),
    };
    authService = { ensureValidToken: jest.fn() };
    configService = { recordError: jest.fn().mockResolvedValue({}) };
    svc = new DeliveryOrderService(
      prisma as any,
      kdsGateway,
      adapterFactory,
      logService,
      authService,
      configService,
    );
  });

  const normalizedOrder = {
    platform: 'YEMEKSEPETI',
    externalOrderId: 'ext-1',
    items: [],
    totalAmount: 100,
    discount: 0,
    finalAmount: 100,
    customerName: 'X',
    customerPhone: '+90555',
    rawPayload: {},
  } as any;

  it('reads platform config exactly once across the whole flow (iter-39)', async () => {
    (prisma.deliveryPlatformConfig.findUnique as any).mockResolvedValue({
      id: 'cfg-1',
      isEnabled: true,
      autoAccept: true,
    });
    (prisma.$transaction as any).mockImplementation(async (cb: any) => {
      const tx: any = {
        order: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 'ord-1', tenantId: 't1' }),
        },
        menuItemMapping: { findMany: jest.fn().mockResolvedValue([]) },
        // Inside-txn config read MUST NOT happen anymore (iter-39).
        deliveryPlatformConfig: {
          findUnique: jest.fn().mockImplementation(() => {
            throw new Error('inside-txn config read should not happen — iter-39 removed it');
          }),
        },
      };
      return cb(tx);
    });
    authService.ensureValidToken.mockResolvedValue({ id: 'cfg-1' });
    adapterFactory.getAdapter.mockReturnValue({
      acceptOrder: jest.fn().mockResolvedValue(undefined),
    });

    await svc.processIncomingOrder('t1', normalizedOrder);

    // Single bare-prisma read; no second outside-txn read either.
    expect((prisma.deliveryPlatformConfig.findUnique as any).mock.calls.length).toBe(1);
  });

  it('bumps configService.recordError when adapter.acceptOrder throws', async () => {
    (prisma.deliveryPlatformConfig.findUnique as any).mockResolvedValue({
      id: 'cfg-1',
      isEnabled: true,
      autoAccept: true,
    });
    (prisma.$transaction as any).mockImplementation(async (cb: any) => {
      const tx: any = {
        order: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 'ord-1', tenantId: 't1' }),
        },
        menuItemMapping: { findMany: jest.fn().mockResolvedValue([]) },
        deliveryPlatformConfig: { findUnique: jest.fn() },
      };
      return cb(tx);
    });
    authService.ensureValidToken.mockResolvedValue({ id: 'cfg-1' });
    adapterFactory.getAdapter.mockReturnValue({
      acceptOrder: jest.fn().mockRejectedValue(new Error('platform 500')),
    });

    await svc.processIncomingOrder('t1', normalizedOrder);

    // Load-bearing: without this call, a permanently-broken
    // acceptOrder endpoint loops forever — every webhook accepts the
    // order locally but never on the platform side.
    expect(configService.recordError).toHaveBeenCalledWith(
      'cfg-1',
      expect.stringContaining('accept_order:'),
    );
  });

  it('does NOT call recordError on the happy auto-accept path', async () => {
    (prisma.deliveryPlatformConfig.findUnique as any).mockResolvedValue({
      id: 'cfg-1',
      isEnabled: true,
      autoAccept: true,
    });
    (prisma.$transaction as any).mockImplementation(async (cb: any) => {
      const tx: any = {
        order: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 'ord-1' }),
        },
        menuItemMapping: { findMany: jest.fn().mockResolvedValue([]) },
        deliveryPlatformConfig: { findUnique: jest.fn() },
      };
      return cb(tx);
    });
    authService.ensureValidToken.mockResolvedValue({ id: 'cfg-1' });
    adapterFactory.getAdapter.mockReturnValue({
      acceptOrder: jest.fn().mockResolvedValue(undefined),
    });

    await svc.processIncomingOrder('t1', normalizedOrder);

    expect(configService.recordError).not.toHaveBeenCalled();
  });

  it('skips both platform-accept and recordError when config has autoAccept=false', async () => {
    (prisma.deliveryPlatformConfig.findUnique as any).mockResolvedValue({
      id: 'cfg-1',
      isEnabled: true,
      autoAccept: false,
    });
    (prisma.$transaction as any).mockImplementation(async (cb: any) => {
      const tx: any = {
        order: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 'ord-1' }),
        },
        menuItemMapping: { findMany: jest.fn().mockResolvedValue([]) },
        deliveryPlatformConfig: { findUnique: jest.fn() },
      };
      return cb(tx);
    });
    const adapterMock = { acceptOrder: jest.fn() };
    adapterFactory.getAdapter.mockReturnValue(adapterMock);

    await svc.processIncomingOrder('t1', normalizedOrder);

    expect(adapterMock.acceptOrder).not.toHaveBeenCalled();
    expect(configService.recordError).not.toHaveBeenCalled();
  });
});
