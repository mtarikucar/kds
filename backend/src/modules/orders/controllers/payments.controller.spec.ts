import { PaymentsController } from './payments.controller';

/**
 * Thin-controller spec for the per-order PaymentsController
 * (route base `orders/:orderId/payments`). Each handler must:
 *   - forward the path :orderId,
 *   - forward the DTO body,
 *   - forward req.tenantId,
 *   - null-coalesce req.user?.id to null when the request carries no user
 *     (webhook / self-pay origins) for the write paths.
 *
 * No NestJS DI container — the handlers are plain methods, so we construct
 * the controller with a jest-mocked PaymentsService and assert the exact
 * forwarding shape. A regression in argument order / coalescing fails here.
 */
describe('PaymentsController (orders/:orderId/payments)', () => {
  let svc: {
    create: jest.Mock;
    findByOrder: jest.Mock;
    splitBill: jest.Mock;
    payByItems: jest.Mock;
    getPayableItems: jest.Mock;
    writeOff: jest.Mock;
  };
  let ctrl: PaymentsController;

  beforeEach(() => {
    svc = {
      create: jest.fn().mockResolvedValue({ id: 'pay-1' }),
      findByOrder: jest.fn().mockResolvedValue([]),
      splitBill: jest.fn().mockResolvedValue({ payments: [] }),
      payByItems: jest.fn().mockResolvedValue({ id: 'pay-2' }),
      getPayableItems: jest.fn().mockResolvedValue({ items: [] }),
      writeOff: jest.fn().mockResolvedValue({ orderFullyPaid: true }),
    };
    ctrl = new PaymentsController(svc as any);
  });

  const reqWithUser = { tenantId: 'tenant-1', user: { id: 'user-7' } };
  const reqNoUser = { tenantId: 'tenant-1' }; // no `user` → coalesce to null

  it('create forwards orderId, dto, tenantId and the JWT user id', () => {
    const dto = { amount: 100, method: 'CASH' } as any;
    ctrl.create('order-1', dto, reqWithUser as any);
    expect(svc.create).toHaveBeenCalledWith(
      'order-1',
      dto,
      'tenant-1',
      'user-7',
    );
  });

  it('create coalesces a missing req.user.id to null (webhook origin)', () => {
    const dto = { amount: 100, method: 'CASH' } as any;
    ctrl.create('order-1', dto, reqNoUser as any);
    expect(svc.create).toHaveBeenCalledWith('order-1', dto, 'tenant-1', null);
  });

  it('findAll delegates to findByOrder with orderId + tenantId only', () => {
    ctrl.findAll('order-1', reqWithUser as any);
    expect(svc.findByOrder).toHaveBeenCalledWith('order-1', 'tenant-1');
  });

  it('splitBill forwards orderId, dto, tenantId and the user id', () => {
    const dto = { splits: [] } as any;
    ctrl.splitBill('order-1', dto, reqWithUser as any);
    expect(svc.splitBill).toHaveBeenCalledWith(
      'order-1',
      dto,
      'tenant-1',
      'user-7',
    );
  });

  it('splitBill coalesces a missing user id to null', () => {
    const dto = { splits: [] } as any;
    ctrl.splitBill('order-1', dto, reqNoUser as any);
    expect(svc.splitBill).toHaveBeenCalledWith('order-1', dto, 'tenant-1', null);
  });

  it('payByItems forwards orderId, dto, tenantId and the user id', () => {
    const dto = { items: [], method: 'CARD' } as any;
    ctrl.payByItems('order-1', dto, reqWithUser as any);
    expect(svc.payByItems).toHaveBeenCalledWith(
      'order-1',
      dto,
      'tenant-1',
      'user-7',
    );
  });

  it('getPayableItems delegates with orderId + tenantId only (read path)', () => {
    ctrl.getPayableItems('order-1', reqWithUser as any);
    expect(svc.getPayableItems).toHaveBeenCalledWith('order-1', 'tenant-1');
  });

  it('writeOff forwards orderId, dto, tenantId and the user id', () => {
    const dto = { reason: 'no-show' } as any;
    ctrl.writeOff('order-1', dto, reqWithUser as any);
    expect(svc.writeOff).toHaveBeenCalledWith(
      'order-1',
      dto,
      'tenant-1',
      'user-7',
    );
  });

  it('writeOff coalesces a missing user id to null', () => {
    const dto = { reason: 'comp' } as any;
    ctrl.writeOff('order-1', dto, reqNoUser as any);
    expect(svc.writeOff).toHaveBeenCalledWith('order-1', dto, 'tenant-1', null);
  });

  it('returns the service result to the caller (passthrough)', async () => {
    await expect(
      ctrl.getPayableItems('order-1', reqWithUser as any),
    ).resolves.toEqual({ items: [] });
  });
});
