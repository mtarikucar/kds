import { ReservationsController } from './reservations.controller';
import { BranchScope } from '../../../common/scoping/branch-scope';
import { UserRole } from '../../../common/constants/roles.enum';

/**
 * Thin-controller spec for the staff ReservationsController. Lifecycle handlers
 * forward the BranchScope (+ id, dto). confirm/cancel additionally pass
 * scope.userId as the acting user; reject unwraps dto.rejectionReason. Settings
 * routes are tenant-wide (read req.tenantId, hit the settings service).
 */
describe('ReservationsController', () => {
  let svc: Record<string, jest.Mock>;
  let settings: Record<string, jest.Mock>;
  let ctrl: ReservationsController;

  const scope: BranchScope = {
    tenantId: 't1',
    branchId: 'b1',
    userId: 'u1',
    role: UserRole.MANAGER,
  };

  beforeEach(() => {
    svc = {
      findAll: jest.fn().mockResolvedValue([]),
      getStats: jest.fn().mockResolvedValue({}),
      findOne: jest.fn().mockResolvedValue({ id: 'r1' }),
      update: jest.fn().mockResolvedValue({ id: 'r1' }),
      confirm: jest.fn().mockResolvedValue({ id: 'r1' }),
      reject: jest.fn().mockResolvedValue({ id: 'r1' }),
      seat: jest.fn().mockResolvedValue({ id: 'r1' }),
      complete: jest.fn().mockResolvedValue({ id: 'r1' }),
      noShow: jest.fn().mockResolvedValue({ id: 'r1' }),
      cancel: jest.fn().mockResolvedValue({ id: 'r1' }),
      remove: jest.fn().mockResolvedValue({ id: 'r1' }),
    };
    settings = {
      getOrCreate: jest.fn().mockResolvedValue({ id: 's1' }),
      update: jest.fn().mockResolvedValue({ id: 's1' }),
    };
    ctrl = new ReservationsController(svc as any, settings as any);
  });

  it('findAll forwards scope + query', () => {
    const query = { status: 'PENDING' } as any;
    ctrl.findAll(scope, query);
    expect(svc.findAll).toHaveBeenCalledWith(scope, query);
  });

  it('getStats forwards scope + date', () => {
    ctrl.getStats(scope, '2026-03-01');
    expect(svc.getStats).toHaveBeenCalledWith(scope, '2026-03-01');
  });

  it('findOne forwards scope + id', () => {
    ctrl.findOne(scope, 'r1');
    expect(svc.findOne).toHaveBeenCalledWith(scope, 'r1');
  });

  it('update forwards scope, id, dto', () => {
    const dto = { notes: 'x' } as any;
    ctrl.update(scope, 'r1', dto);
    expect(svc.update).toHaveBeenCalledWith(scope, 'r1', dto);
  });

  it('confirm forwards scope, id AND scope.userId as actor', () => {
    ctrl.confirm(scope, 'r1');
    expect(svc.confirm).toHaveBeenCalledWith(scope, 'r1', 'u1');
  });

  it('reject unwraps dto.rejectionReason', () => {
    ctrl.reject(scope, 'r1', { rejectionReason: 'full' } as any);
    expect(svc.reject).toHaveBeenCalledWith(scope, 'r1', 'full');
  });

  it('seat forwards scope + id', () => {
    ctrl.seat(scope, 'r1');
    expect(svc.seat).toHaveBeenCalledWith(scope, 'r1');
  });

  it('complete forwards scope + id', () => {
    ctrl.complete(scope, 'r1');
    expect(svc.complete).toHaveBeenCalledWith(scope, 'r1');
  });

  it('noShow forwards scope + id', () => {
    ctrl.noShow(scope, 'r1');
    expect(svc.noShow).toHaveBeenCalledWith(scope, 'r1');
  });

  it('cancelAdmin forwards scope, id AND scope.userId', () => {
    ctrl.cancelAdmin(scope, 'r1');
    expect(svc.cancel).toHaveBeenCalledWith(scope, 'r1', 'u1');
  });

  it('remove forwards scope + id', () => {
    ctrl.remove(scope, 'r1');
    expect(svc.remove).toHaveBeenCalledWith(scope, 'r1');
  });

  it('getSettings reads req.tenantId and hits the settings service', () => {
    ctrl.getSettings({ tenantId: 't1' } as any);
    expect(settings.getOrCreate).toHaveBeenCalledWith('t1');
  });

  it('updateSettings forwards req.tenantId + dto to the settings service', () => {
    const dto = { isEnabled: true } as any;
    ctrl.updateSettings({ tenantId: 't1' } as any, dto);
    expect(settings.update).toHaveBeenCalledWith('t1', dto);
  });
});
