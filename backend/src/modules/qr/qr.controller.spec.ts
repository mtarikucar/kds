import { QrController } from './qr.controller';

/**
 * Thin-controller spec for QrController. Settings handlers forward
 * req.tenantId (+ dto). getQrCodes computes a baseUrl: env FRONTEND_URL wins;
 * otherwise it derives one from the request host (the :3000→:5173 dev rule and
 * production same-domain fallback). Verifies the URL-derivation branches.
 */
describe('QrController', () => {
  let svc: Record<string, jest.Mock>;
  let ctrl: QrController;
  const OLD_ENV = process.env.FRONTEND_URL;

  beforeEach(() => {
    svc = {
      getSettings: jest.fn().mockResolvedValue({}),
      createSettings: jest.fn().mockResolvedValue({}),
      updateSettings: jest.fn().mockResolvedValue({}),
      deleteSettings: jest.fn().mockResolvedValue({}),
      getQrCodes: jest.fn().mockResolvedValue({}),
    };
    ctrl = new QrController(svc as any);
    delete process.env.FRONTEND_URL;
  });

  afterAll(() => {
    if (OLD_ENV === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = OLD_ENV;
  });

  it('getSettings forwards req.tenantId', () => {
    ctrl.getSettings({ tenantId: 't1' } as any);
    expect(svc.getSettings).toHaveBeenCalledWith('t1');
  });

  it('createSettings forwards tenantId + dto', () => {
    const dto = { primaryColor: '#fff' } as any;
    ctrl.createSettings({ tenantId: 't1' } as any, dto);
    expect(svc.createSettings).toHaveBeenCalledWith('t1', dto);
  });

  it('updateSettings forwards tenantId + dto', () => {
    const dto = { showPrices: false } as any;
    ctrl.updateSettings({ tenantId: 't1' } as any, dto);
    expect(svc.updateSettings).toHaveBeenCalledWith('t1', dto);
  });

  it('deleteSettings forwards tenantId', () => {
    ctrl.deleteSettings({ tenantId: 't1' } as any);
    expect(svc.deleteSettings).toHaveBeenCalledWith('t1');
  });

  describe('getQrCodes baseUrl derivation', () => {
    it('uses FRONTEND_URL env when set', () => {
      process.env.FRONTEND_URL = 'https://app.example.com';
      ctrl.getQrCodes({ tenantId: 't1' } as any);
      expect(svc.getQrCodes).toHaveBeenCalledWith('t1', 'https://app.example.com');
    });

    it('maps a :3000 dev host to :5173 (Vite)', () => {
      const req = {
        tenantId: 't1',
        protocol: 'http',
        get: (h: string) => (h === 'host' ? 'localhost:3000' : undefined),
      };
      ctrl.getQrCodes(req as any);
      expect(svc.getQrCodes).toHaveBeenCalledWith('t1', 'http://localhost:5173');
    });

    it('falls back to localhost:5173 for a bare localhost host', () => {
      const req = {
        tenantId: 't1',
        protocol: 'http',
        get: (h: string) => (h === 'host' ? 'localhost' : undefined),
      };
      ctrl.getQrCodes(req as any);
      expect(svc.getQrCodes).toHaveBeenCalledWith('t1', 'http://localhost:5173');
    });

    it('uses same protocol+host for a production domain', () => {
      const req = {
        tenantId: 't1',
        protocol: 'https',
        get: (h: string) => (h === 'host' ? 'menu.example.com' : undefined),
      };
      ctrl.getQrCodes(req as any);
      expect(svc.getQrCodes).toHaveBeenCalledWith('t1', 'https://menu.example.com');
    });
  });
});
