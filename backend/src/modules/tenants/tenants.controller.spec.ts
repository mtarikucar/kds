import { TenantsController } from './tenants.controller';

/**
 * Thin-controller spec for TenantsController. The public route forwards
 * nothing; the settings routes read tenantId off req and forward the dto +
 * actor userId. Verifies req→service mapping (the tenant-id and actor are
 * pulled from the request, not the body).
 */
describe('TenantsController', () => {
  let svc: Record<string, jest.Mock>;
  let ctrl: TenantsController;

  beforeEach(() => {
    svc = {
      findAllPublic: jest.fn().mockResolvedValue([{ id: 't1' }]),
      findSettings: jest.fn().mockResolvedValue({ id: 't1' }),
      updateSettings: jest.fn().mockResolvedValue({ id: 't1' }),
    };
    ctrl = new TenantsController(svc as any);
  });

  it('findAllPublic forwards no args (public listing)', () => {
    ctrl.findAllPublic();
    expect(svc.findAllPublic).toHaveBeenCalledWith();
  });

  it('findSettings forwards req.tenantId', () => {
    ctrl.findSettings({ tenantId: 't1' } as any);
    expect(svc.findSettings).toHaveBeenCalledWith('t1');
  });

  it('updateSettings forwards tenantId, dto AND actor userId', () => {
    const dto = { timezone: 'UTC' } as any;
    ctrl.updateSettings({ tenantId: 't1', user: { userId: 'admin-1' } } as any, dto);
    expect(svc.updateSettings).toHaveBeenCalledWith('t1', dto, 'admin-1');
  });

  it('updateSettings passes undefined actor when req.user is absent (null-coalesce)', () => {
    const dto = { timezone: 'UTC' } as any;
    ctrl.updateSettings({ tenantId: 't1' } as any, dto);
    expect(svc.updateSettings).toHaveBeenCalledWith('t1', dto, undefined);
  });
});
