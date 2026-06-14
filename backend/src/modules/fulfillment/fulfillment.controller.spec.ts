import {
  InstallationController,
  SuperadminInstallationController,
  WarrantyController,
  SuperadminShipmentsController,
} from './fulfillment.controller';

/**
 * Thin-controller specs for the four fulfillment controllers. The
 * load-bearing logic beyond forwarding is the ISO-string → Date mapping:
 *  - InstallationController.request maps preferredDates[] to Date[]
 *  - SuperadminInstallationController.schedule maps scheduledFor to a Date
 *    and derives tenant from the row (does NOT forward a body tenantId)
 */
describe('InstallationController (tenant)', () => {
  let svc: Record<string, jest.Mock>;
  let ctrl: InstallationController;

  beforeEach(() => {
    svc = {
      create: jest.fn().mockResolvedValue({ id: 'i1' }),
      list: jest.fn().mockResolvedValue([]),
    };
    ctrl = new InstallationController(svc as any);
  });

  it('request forwards tenantId and maps preferredDates strings to Date objects', () => {
    ctrl.request(
      { user: { tenantId: 't1' } },
      { productId: 'p1', preferredDates: ['2026-03-01T10:00:00Z'] } as any,
    );
    const [tenantId, payload] = svc.create.mock.calls[0];
    expect(tenantId).toBe('t1');
    expect(payload.preferredDates[0]).toBeInstanceOf(Date);
    expect(payload.preferredDates[0].toISOString()).toBe('2026-03-01T10:00:00.000Z');
  });

  it('request leaves preferredDates undefined when absent (optional-chain map)', () => {
    ctrl.request({ user: { tenantId: 't1' } }, { productId: 'p1' } as any);
    expect(svc.create.mock.calls[0][1].preferredDates).toBeUndefined();
  });

  it('list forwards tenantId + status filter', () => {
    ctrl.list({ user: { tenantId: 't1' } }, 'PENDING');
    expect(svc.list).toHaveBeenCalledWith('t1', 'PENDING');
  });
});

describe('SuperadminInstallationController', () => {
  let svc: Record<string, jest.Mock>;
  let ctrl: SuperadminInstallationController;

  beforeEach(() => {
    svc = {
      listAll: jest.fn().mockResolvedValue([]),
      scheduleByOps: jest.fn().mockResolvedValue({ id: 'i1' }),
      completeByOps: jest.fn().mockResolvedValue({ id: 'i1' }),
      cancel: jest.fn().mockResolvedValue({ id: 'i1' }),
    };
    ctrl = new SuperadminInstallationController(svc as any);
  });

  it('list forwards status + assignedTo filters', () => {
    ctrl.list('SCHEDULED', 'tech-1');
    expect(svc.listAll).toHaveBeenCalledWith('SCHEDULED', 'tech-1');
  });

  it('schedule maps scheduledFor to a Date and forwards assignedTo (tenant derived from row)', () => {
    ctrl.schedule('i1', { scheduledFor: '2026-03-02T09:00:00Z', assignedTo: 'tech-1' } as any);
    const [id, when, who] = svc.scheduleByOps.mock.calls[0];
    expect(id).toBe('i1');
    expect(when).toBeInstanceOf(Date);
    expect(when.toISOString()).toBe('2026-03-02T09:00:00.000Z');
    expect(who).toBe('tech-1');
  });

  it('complete forwards id + notes', () => {
    ctrl.complete('i1', { notes: 'done' } as any);
    expect(svc.completeByOps).toHaveBeenCalledWith('i1', 'done');
  });

  it('cancel forwards id + reason', () => {
    ctrl.cancel('i1', { reason: 'obsolete' } as any);
    expect(svc.cancel).toHaveBeenCalledWith('i1', 'obsolete');
  });
});

describe('WarrantyController', () => {
  it('file forwards tenantId, serial id, and body', () => {
    const svc = { fileClaim: jest.fn().mockResolvedValue({ id: 'c1' }) };
    const ctrl = new WarrantyController(svc as any);
    const body = { description: 'broken' } as any;
    ctrl.file({ user: { tenantId: 't1' } }, 'serial-9', body);
    expect(svc.fileClaim).toHaveBeenCalledWith('t1', 'serial-9', body);
  });
});

describe('SuperadminShipmentsController', () => {
  let svc: Record<string, jest.Mock>;
  let ctrl: SuperadminShipmentsController;

  beforeEach(() => {
    svc = {
      createShipment: jest.fn().mockResolvedValue({ id: 'sh1' }),
      markDelivered: jest.fn().mockResolvedValue({ id: 'sh1' }),
      listForOrder: jest.fn().mockResolvedValue([]),
    };
    ctrl = new SuperadminShipmentsController(svc as any);
  });

  it('create forwards orderId + body', () => {
    const body = { carrier: 'X' } as any;
    ctrl.create('order-1', body);
    expect(svc.createShipment).toHaveBeenCalledWith('order-1', body);
  });

  it('markDelivered forwards shipmentId', () => {
    ctrl.markDelivered('sh1');
    expect(svc.markDelivered).toHaveBeenCalledWith('sh1');
  });

  it('list forwards orderId', () => {
    ctrl.list('order-1');
    expect(svc.listForOrder).toHaveBeenCalledWith('order-1');
  });
});
