import { CustomerOrdersController } from './customer-orders.controller';

/**
 * Thin-controller spec for CustomerOrdersController. Public mutations forward
 * the dto (tenantId is resolved server-side from the session — the controller
 * never reads it).
 *
 * v3 branch-scope: staff routes no longer read the tenant-wide `req.tenantId`.
 * They take the branch-fenced `@CurrentScope()` and forward the whole scope
 * (the actor id comes off `scope.userId`). Forwarding the tenant-only id was
 * the cross-branch read leak this change closes.
 */
describe('CustomerOrdersController', () => {
  let svc: Record<string, jest.Mock>;
  let ctrl: CustomerOrdersController;
  const scope = {
    tenantId: 't1',
    branchId: 'b1',
    userId: 'staff-1',
    role: 'WAITER',
  } as any;

  beforeEach(() => {
    svc = {
      createOrder: jest.fn().mockResolvedValue({ id: 'o1' }),
      getSessionOrders: jest.fn().mockResolvedValue([]),
      getOrderById: jest.fn().mockResolvedValue({ id: 'o1' }),
      createWaiterRequest: jest.fn().mockResolvedValue({ id: 'w1' }),
      getSessionWaiterRequests: jest.fn().mockResolvedValue([]),
      createBillRequest: jest.fn().mockResolvedValue({ id: 'b1' }),
      getSessionBillRequests: jest.fn().mockResolvedValue([]),
      getActiveWaiterRequests: jest.fn().mockResolvedValue([]),
      acknowledgeWaiterRequest: jest.fn().mockResolvedValue({ id: 'w1' }),
      completeWaiterRequest: jest.fn().mockResolvedValue({ id: 'w1' }),
      getActiveBillRequests: jest.fn().mockResolvedValue([]),
      acknowledgeBillRequest: jest.fn().mockResolvedValue({ id: 'b1' }),
      completeBillRequest: jest.fn().mockResolvedValue({ id: 'b1' }),
    };
    ctrl = new CustomerOrdersController(svc as any);
  });

  it('createOrder forwards ONLY the dto (no tenantId from controller)', async () => {
    const dto = { sessionId: 'abc' } as any;
    await ctrl.createOrder(dto);
    expect(svc.createOrder).toHaveBeenCalledWith(dto);
  });

  it('getSessionOrders forwards the sessionId param', async () => {
    await ctrl.getSessionOrders('sess-1');
    expect(svc.getSessionOrders).toHaveBeenCalledWith('sess-1');
  });

  it('getOrderById forwards orderId + sessionId query', async () => {
    await ctrl.getOrderById('o1', 'sess-1');
    expect(svc.getOrderById).toHaveBeenCalledWith('o1', 'sess-1');
  });

  it('createWaiterRequest forwards the dto', async () => {
    const dto = { sessionId: 'abc' } as any;
    await ctrl.createWaiterRequest(dto);
    expect(svc.createWaiterRequest).toHaveBeenCalledWith(dto);
  });

  it('createBillRequest forwards the dto', async () => {
    const dto = { sessionId: 'abc' } as any;
    await ctrl.createBillRequest(dto);
    expect(svc.createBillRequest).toHaveBeenCalledWith(dto);
  });

  it('getActiveWaiterRequests forwards the branch scope (not a bare tenantId)', async () => {
    await ctrl.getActiveWaiterRequests(scope);
    expect(svc.getActiveWaiterRequests).toHaveBeenCalledWith(scope);
    // Guard against a regression back to the tenant-wide leak.
    expect(svc.getActiveWaiterRequests).not.toHaveBeenCalledWith('t1');
  });

  it('acknowledgeWaiterRequest forwards id, actor user id AND the branch scope', async () => {
    await ctrl.acknowledgeWaiterRequest('w1', scope);
    expect(svc.acknowledgeWaiterRequest).toHaveBeenCalledWith('w1', 'staff-1', scope);
  });

  it('completeWaiterRequest forwards id, actor user id AND the branch scope', async () => {
    await ctrl.completeWaiterRequest('w1', scope);
    expect(svc.completeWaiterRequest).toHaveBeenCalledWith('w1', 'staff-1', scope);
  });

  it('getActiveBillRequests forwards the branch scope (not a bare tenantId)', async () => {
    await ctrl.getActiveBillRequests(scope);
    expect(svc.getActiveBillRequests).toHaveBeenCalledWith(scope);
    expect(svc.getActiveBillRequests).not.toHaveBeenCalledWith('t1');
  });

  it('acknowledgeBillRequest forwards id, actor, branch scope', async () => {
    await ctrl.acknowledgeBillRequest('b1', scope);
    expect(svc.acknowledgeBillRequest).toHaveBeenCalledWith('b1', 'staff-1', scope);
  });

  it('completeBillRequest forwards id, actor, branch scope', async () => {
    await ctrl.completeBillRequest('b1', scope);
    expect(svc.completeBillRequest).toHaveBeenCalledWith('b1', 'staff-1', scope);
  });
});
