import {
  CatalogController,
  TenantCatalogController,
  SuperadminCatalogController,
} from './catalog.controller';
import { HARDWARE_CATEGORIES } from './category-vocabulary';

/**
 * Thin-controller specs for the three catalog controllers:
 *  - public listing/lookup forwards the query/param (and the categories route
 *    returns the static vocabulary, not a service call)
 *  - tenant quote-request reads req.user.tenantId
 *  - superadmin CRUD forwards body/params and splits receiveStock body into
 *    (id, qty, serials)
 */
describe('CatalogController (public)', () => {
  let svc: Record<string, jest.Mock>;
  let ctrl: CatalogController;

  beforeEach(() => {
    svc = {
      listPublic: jest.fn().mockResolvedValue([]),
      findBySkuPublicOrThrow: jest.fn().mockResolvedValue({ sku: 'x' }),
    };
    ctrl = new CatalogController(svc as any);
  });

  it('listPublic forwards the category filter', () => {
    ctrl.listPublic('printer');
    expect(svc.listPublic).toHaveBeenCalledWith({ category: 'printer' });
  });

  it('listPublic forwards undefined category when omitted', () => {
    ctrl.listPublic();
    expect(svc.listPublic).toHaveBeenCalledWith({ category: undefined });
  });

  it('categories returns the static vocabulary without touching the service', () => {
    expect(ctrl.categories()).toBe(HARDWARE_CATEGORIES);
  });

  it('bySku routes through the public-view helper (no serials leak)', () => {
    ctrl.bySku('pos-lane3000');
    expect(svc.findBySkuPublicOrThrow).toHaveBeenCalledWith('pos-lane3000');
  });
});

describe('TenantCatalogController', () => {
  it('requestQuote forwards req.user.tenantId + body', () => {
    const svc = { requestQuote: jest.fn().mockResolvedValue({ id: 'lead-1' }) };
    const ctrl = new TenantCatalogController(svc as any);
    const body = { sku: 'yazarkasa-x', contactPerson: 'A' } as any;
    ctrl.requestQuote({ user: { tenantId: 't1' } }, body);
    expect(svc.requestQuote).toHaveBeenCalledWith('t1', body);
  });
});

describe('SuperadminCatalogController', () => {
  let svc: Record<string, jest.Mock>;
  let ctrl: SuperadminCatalogController;

  beforeEach(() => {
    svc = {
      listAdmin: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'p1' }),
      update: jest.fn().mockResolvedValue({ id: 'p1' }),
      archive: jest.fn().mockResolvedValue({ id: 'p1' }),
      receiveStock: jest.fn().mockResolvedValue({ ok: true }),
    };
    ctrl = new SuperadminCatalogController(svc as any);
  });

  it('list forwards status + category filters', () => {
    ctrl.list('published', 'printer');
    expect(svc.listAdmin).toHaveBeenCalledWith({ status: 'published', category: 'printer' });
  });

  it('create forwards the body', () => {
    const body = { sku: 'x' } as any;
    ctrl.create(body);
    expect(svc.create).toHaveBeenCalledWith(body);
  });

  it('update forwards id + body', () => {
    const body = { name: 'X' } as any;
    ctrl.update('p1', body);
    expect(svc.update).toHaveBeenCalledWith('p1', body);
  });

  it('archive forwards the id', () => {
    ctrl.archive('p1');
    expect(svc.archive).toHaveBeenCalledWith('p1');
  });

  it('receive splits the body into (id, qty, serials)', () => {
    ctrl.receive('p1', { qty: 5, serials: ['s1', 's2'] } as any);
    expect(svc.receiveStock).toHaveBeenCalledWith('p1', 5, ['s1', 's2']);
  });
});
