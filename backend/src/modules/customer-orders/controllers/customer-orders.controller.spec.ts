import { CustomerOrdersController } from './customer-orders.controller';

/**
 * Thin-controller spec for CustomerOrdersController. Public mutations forward
 * the dto (tenantId is resolved server-side from the session — the controller
 * never reads it). Staff routes read req.tenantId (+ req.user.id for the
 * acknowledge/complete actor) and forward both.
 */
describe('CustomerOrdersController', () => {
  let svc: Record<string, jest.Mock>;
  let ctrl: CustomerOrdersController;
  const req = { tenantId: 't1', user: { id: 'staff-1' } };

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

  it('getActiveWaiterRequests forwards req.tenantId', async () => {
    await ctrl.getActiveWaiterRequests(req as any);
    expect(svc.getActiveWaiterRequests).toHaveBeenCalledWith('t1');
  });

  it('acknowledgeWaiterRequest forwards id, actor user id AND tenantId', async () => {
    await ctrl.acknowledgeWaiterRequest('w1', req as any);
    expect(svc.acknowledgeWaiterRequest).toHaveBeenCalledWith('w1', 'staff-1', 't1');
  });

  it('completeWaiterRequest forwards id, actor user id AND tenantId', async () => {
    await ctrl.completeWaiterRequest('w1', req as any);
    expect(svc.completeWaiterRequest).toHaveBeenCalledWith('w1', 'staff-1', 't1');
  });

  it('getActiveBillRequests forwards req.tenantId', async () => {
    await ctrl.getActiveBillRequests(req as any);
    expect(svc.getActiveBillRequests).toHaveBeenCalledWith('t1');
  });

  it('acknowledgeBillRequest forwards id, actor, tenantId', async () => {
    await ctrl.acknowledgeBillRequest('b1', req as any);
    expect(svc.acknowledgeBillRequest).toHaveBeenCalledWith('b1', 'staff-1', 't1');
  });

  it('completeBillRequest forwards id, actor, tenantId', async () => {
    await ctrl.completeBillRequest('b1', req as any);
    expect(svc.completeBillRequest).toHaveBeenCalledWith('b1', 'staff-1', 't1');
  });
});
