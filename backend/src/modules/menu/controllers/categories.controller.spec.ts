import { CategoriesController } from './categories.controller';

/**
 * Thin-controller spec for CategoriesController. Each handler forwards
 * req.tenantId (+ dto/id) to CategoriesService; findAll maps the optional
 * ListQueryDto limit/offset into the service options object (undefined when
 * the query is absent → full-list default preserved).
 */
describe('CategoriesController', () => {
  let svc: Record<string, jest.Mock>;
  let ctrl: CategoriesController;
  const req = { tenantId: 't1' };

  beforeEach(() => {
    svc = {
      create: jest.fn().mockResolvedValue({ id: 'c1' }),
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({ id: 'c1' }),
      update: jest.fn().mockResolvedValue({ id: 'c1' }),
      remove: jest.fn().mockResolvedValue({ id: 'c1' }),
    };
    ctrl = new CategoriesController(svc as any);
  });

  it('create forwards dto + tenantId', () => {
    const dto = { name: 'Sides' } as any;
    ctrl.create(dto, req as any);
    expect(svc.create).toHaveBeenCalledWith(dto, 't1');
  });

  it('findAll maps query limit/offset into options', () => {
    ctrl.findAll(req as any, { limit: 10, offset: 5 } as any);
    expect(svc.findAll).toHaveBeenCalledWith('t1', { limit: 10, offset: 5 });
  });

  it('findAll passes undefined limit/offset when query is absent (full-list default)', () => {
    ctrl.findAll(req as any);
    expect(svc.findAll).toHaveBeenCalledWith('t1', { limit: undefined, offset: undefined });
  });

  it('findOne forwards id + tenantId', () => {
    ctrl.findOne('c1', req as any);
    expect(svc.findOne).toHaveBeenCalledWith('c1', 't1');
  });

  it('update forwards id, dto, tenantId', () => {
    const dto = { name: 'X' } as any;
    ctrl.update('c1', dto, req as any);
    expect(svc.update).toHaveBeenCalledWith('c1', dto, 't1');
  });

  it('remove forwards id + tenantId', () => {
    ctrl.remove('c1', req as any);
    expect(svc.remove).toHaveBeenCalledWith('c1', 't1');
  });
});
