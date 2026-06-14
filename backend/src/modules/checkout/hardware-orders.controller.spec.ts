import { HardwareOrdersController } from './hardware-orders.controller';

/**
 * Thin-controller spec for HardwareOrdersController. listMine reads the
 * tenantId off the JWT and forwards the (already-validated) status filter;
 * getMine forwards tenantId + path id. Tenant scoping is the security
 * boundary here (pre-v2.8.89 any role could enumerate), so the tenantId
 * forwarding is asserted explicitly.
 */
describe('HardwareOrdersController', () => {
  let orders: { listMine: jest.Mock; getMine: jest.Mock };
  let ctrl: HardwareOrdersController;

  beforeEach(() => {
    orders = {
      listMine: jest.fn().mockResolvedValue([]),
      getMine: jest.fn().mockResolvedValue({ id: 'ho-1' }),
    };
    ctrl = new HardwareOrdersController(orders as any);
  });

  it('listMine forwards tenantId + the status filter from the validated query', () => {
    ctrl.listMine({ user: { tenantId: 't1' } }, { status: 'SHIPPED' } as any);
    expect(orders.listMine).toHaveBeenCalledWith('t1', 'SHIPPED');
  });

  it('listMine forwards an undefined status when the query omits it', () => {
    ctrl.listMine({ user: { tenantId: 't1' } }, {} as any);
    expect(orders.listMine).toHaveBeenCalledWith('t1', undefined);
  });

  it('getMine forwards tenantId + path id', () => {
    ctrl.getMine({ user: { tenantId: 't1' } }, 'ho-9');
    expect(orders.getMine).toHaveBeenCalledWith('t1', 'ho-9');
  });
});
