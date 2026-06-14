import { ModifiersController } from './modifiers.controller';

/**
 * Thin-controller spec for ModifiersController. Note this controller reads the
 * tenant id from req.user.tenantId (NOT req.tenantId) — a regression in that
 * mapping would silently cross tenants, so the tests assert it explicitly.
 * findAll* handlers also fold includeInactive/groupId + ListQueryDto into the
 * service call.
 */
describe('ModifiersController', () => {
  let svc: Record<string, jest.Mock>;
  let ctrl: ModifiersController;
  const req = { user: { tenantId: 't1' } };

  beforeEach(() => {
    svc = {
      createGroup: jest.fn().mockResolvedValue({ id: 'g1' }),
      findAllGroups: jest.fn().mockResolvedValue([]),
      findOneGroup: jest.fn().mockResolvedValue({ id: 'g1' }),
      updateGroup: jest.fn().mockResolvedValue({ id: 'g1' }),
      deleteGroup: jest.fn().mockResolvedValue({ id: 'g1' }),
      createModifier: jest.fn().mockResolvedValue({ id: 'm1' }),
      findAllModifiers: jest.fn().mockResolvedValue([]),
      findOneModifier: jest.fn().mockResolvedValue({ id: 'm1' }),
      updateModifier: jest.fn().mockResolvedValue({ id: 'm1' }),
      deleteModifier: jest.fn().mockResolvedValue({ id: 'm1' }),
      assignModifiersToProduct: jest.fn().mockResolvedValue({ ok: true }),
      getProductModifiers: jest.fn().mockResolvedValue([]),
      removeModifierGroupFromProduct: jest.fn().mockResolvedValue({ ok: true }),
    };
    ctrl = new ModifiersController(svc as any);
  });

  it('createGroup forwards dto + req.user.tenantId', async () => {
    const dto = { name: 'sauces' } as any;
    await ctrl.createGroup(dto, req as any);
    expect(svc.createGroup).toHaveBeenCalledWith(dto, 't1');
  });

  it('findAllGroups forwards tenantId, includeInactive, mapped options', async () => {
    await ctrl.findAllGroups(req as any, true, { limit: 5, offset: 2 } as any);
    expect(svc.findAllGroups).toHaveBeenCalledWith('t1', true, { limit: 5, offset: 2 });
  });

  it('findAllGroups passes undefined options when query absent', async () => {
    await ctrl.findAllGroups(req as any);
    expect(svc.findAllGroups).toHaveBeenCalledWith('t1', undefined, {
      limit: undefined,
      offset: undefined,
    });
  });

  it('findOneGroup forwards id + tenantId', async () => {
    await ctrl.findOneGroup('g1', req as any);
    expect(svc.findOneGroup).toHaveBeenCalledWith('g1', 't1');
  });

  it('updateGroup forwards id, dto, tenantId', async () => {
    const dto = { isActive: false } as any;
    await ctrl.updateGroup('g1', dto, req as any);
    expect(svc.updateGroup).toHaveBeenCalledWith('g1', dto, 't1');
  });

  it('deleteGroup forwards id + tenantId', async () => {
    await ctrl.deleteGroup('g1', req as any);
    expect(svc.deleteGroup).toHaveBeenCalledWith('g1', 't1');
  });

  it('createModifier forwards dto + tenantId', async () => {
    const dto = { name: 'cheese', groupId: 'g1' } as any;
    await ctrl.createModifier(dto, req as any);
    expect(svc.createModifier).toHaveBeenCalledWith(dto, 't1');
  });

  it('findAllModifiers forwards tenantId, groupId, includeUnavailable, options', async () => {
    await ctrl.findAllModifiers(req as any, 'g1', false, { limit: 3 } as any);
    expect(svc.findAllModifiers).toHaveBeenCalledWith('t1', 'g1', false, {
      limit: 3,
      offset: undefined,
    });
  });

  it('updateModifier forwards id, dto, tenantId', async () => {
    const dto = { priceAdjustment: 5 } as any;
    await ctrl.updateModifier('m1', dto, req as any);
    expect(svc.updateModifier).toHaveBeenCalledWith('m1', dto, 't1');
  });

  it('deleteModifier forwards id + tenantId', async () => {
    await ctrl.deleteModifier('m1', req as any);
    expect(svc.deleteModifier).toHaveBeenCalledWith('m1', 't1');
  });

  it('assignModifiersToProduct forwards productId, dto, tenantId', async () => {
    const dto = { groupIds: ['g1'] } as any;
    await ctrl.assignModifiersToProduct('p1', dto, req as any);
    expect(svc.assignModifiersToProduct).toHaveBeenCalledWith('p1', dto, 't1');
  });

  it('getProductModifiers forwards productId + tenantId', async () => {
    await ctrl.getProductModifiers('p1', req as any);
    expect(svc.getProductModifiers).toHaveBeenCalledWith('p1', 't1');
  });

  it('removeModifierGroupFromProduct forwards both path params + tenantId', async () => {
    await ctrl.removeModifierGroupFromProduct('p1', 'g1', req as any);
    expect(svc.removeModifierGroupFromProduct).toHaveBeenCalledWith('p1', 'g1', 't1');
  });
});
