import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ModifiersService } from './modifiers.service';
import {
  mockPrismaClient,
  MockPrismaClient,
} from '../../../common/test/prisma-mock.service';

/**
 * Behaviour locks for ModifiersService.
 *
 *  - Tenant scoping: every group/modifier read & write carries tenantId in
 *    the WHERE; mutating ops re-prove ownership then use a compound
 *    {id, tenantId} claim that throws NotFound on a 0-row update.
 *  - Active / availability filtering: list endpoints hide isActive=false
 *    groups and isAvailable=false modifiers unless explicitly asked to
 *    include them.
 *  - Group ↔ modifier relation: a modifier can only be created under a group
 *    that exists AND belongs to the caller's tenant.
 *  - Referential-integrity guards: a group assigned to products cannot be
 *    deleted; a modifier used in order items cannot be deleted (both 400).
 *  - Product-modifier assignment: product + every referenced group are
 *    tenant-verified; the replace is an atomic deleteMany+createMany tx;
 *    an unknown/cross-tenant group id is rejected.
 *
 *  NOTE (audit follow-up): the service performs NO min/max cross-field
 *  validation (e.g. minSelections <= maxSelections). Caps live only on the
 *  DTOs. These specs therefore lock the relation/scoping/filtering behaviour
 *  that actually exists and do not assert validation the service never does.
 */
describe('ModifiersService', () => {
  let prisma: MockPrismaClient;
  let svc: ModifiersService;

  const TENANT = 't-1';
  const OTHER = 't-other';

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new ModifiersService(prisma as any);
  });

  // ----------------------------------------------------------------
  // Groups: create / tenant stamping
  // ----------------------------------------------------------------

  it('createGroup stamps the caller tenantId onto the new group', async () => {
    (prisma.modifierGroup.create as any).mockImplementation(
      async ({ data }: any) => ({ id: 'g-1', ...data }),
    );

    await svc.createGroup({ name: 'sauces', displayName: 'Soslar' } as any, TENANT);

    const data = (prisma.modifierGroup.create as any).mock.calls[0][0].data;
    expect(data.tenantId).toBe(TENANT);
    expect(data.name).toBe('sauces');
  });

  // ----------------------------------------------------------------
  // Groups: active filtering
  // ----------------------------------------------------------------

  it('findAllGroups hides inactive groups and unavailable modifiers by default', async () => {
    (prisma.modifierGroup.findMany as any).mockResolvedValue([]);

    await svc.findAllGroups(TENANT);

    const arg = (prisma.modifierGroup.findMany as any).mock.calls[0][0];
    expect(arg.where.tenantId).toBe(TENANT);
    expect(arg.where.isActive).toBe(true);
    // Nested modifiers filtered to available only.
    expect(arg.include.modifiers.where).toEqual({ isAvailable: true });
  });

  it('findAllGroups includes inactive groups + unavailable modifiers when asked', async () => {
    (prisma.modifierGroup.findMany as any).mockResolvedValue([]);

    await svc.findAllGroups(TENANT, true);

    const arg = (prisma.modifierGroup.findMany as any).mock.calls[0][0];
    // isActive constraint dropped entirely.
    expect(arg.where.isActive).toBeUndefined();
    expect(arg.include.modifiers.where).toEqual({});
  });

  // ----------------------------------------------------------------
  // Groups: findOne scoping + NotFound
  // ----------------------------------------------------------------

  it('findOneGroup scopes by {id, tenantId} and throws NotFound on miss', async () => {
    (prisma.modifierGroup.findFirst as any).mockResolvedValue(null);

    await expect(svc.findOneGroup('g-x', TENANT)).rejects.toThrow(
      NotFoundException,
    );
    const where = (prisma.modifierGroup.findFirst as any).mock.calls[0][0].where;
    expect(where.id).toBe('g-x');
    expect(where.tenantId).toBe(TENANT);
  });

  // ----------------------------------------------------------------
  // Groups: update ownership + compound claim
  // ----------------------------------------------------------------

  it('updateGroup proves ownership then claims with a compound {id, tenantId} updateMany', async () => {
    (prisma.modifierGroup.findFirst as any).mockResolvedValue({
      id: 'g-1',
      tenantId: TENANT,
    });
    (prisma.modifierGroup.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.modifierGroup.findUnique as any).mockResolvedValue({ id: 'g-1' });

    await svc.updateGroup('g-1', { displayName: 'X' } as any, TENANT);

    const where = (prisma.modifierGroup.updateMany as any).mock.calls[0][0]
      .where;
    expect(where.id).toBe('g-1');
    expect(where.tenantId).toBe(TENANT);
  });

  it('updateGroup throws NotFound for a cross-tenant id (ownership miss, no write)', async () => {
    (prisma.modifierGroup.findFirst as any).mockResolvedValue(null);

    await expect(
      svc.updateGroup('g-1', { displayName: 'X' } as any, OTHER),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.modifierGroup.updateMany).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------------
  // Groups: delete referential-integrity guard
  // ----------------------------------------------------------------

  it('deleteGroup refuses to delete a group still assigned to products', async () => {
    (prisma.modifierGroup.findFirst as any).mockResolvedValue({
      id: 'g-1',
      tenantId: TENANT,
    });
    (prisma.productModifierGroup.count as any).mockResolvedValue(3);

    await expect(svc.deleteGroup('g-1', TENANT)).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.modifierGroup.delete).not.toHaveBeenCalled();
    // The assignment count is tenant-scoped via the group relation.
    const where = (prisma.productModifierGroup.count as any).mock.calls[0][0]
      .where;
    expect(where.groupId).toBe('g-1');
    expect(where.group).toEqual({ tenantId: TENANT });
  });

  it('deleteGroup deletes with a compound {id, tenantId} when unassigned', async () => {
    (prisma.modifierGroup.findFirst as any).mockResolvedValue({
      id: 'g-1',
      tenantId: TENANT,
    });
    (prisma.productModifierGroup.count as any).mockResolvedValue(0);
    (prisma.modifierGroup.delete as any).mockResolvedValue({ id: 'g-1' });

    await expect(svc.deleteGroup('g-1', TENANT)).resolves.toEqual({
      message: 'Modifier group deleted successfully',
    });
    const where = (prisma.modifierGroup.delete as any).mock.calls[0][0].where;
    expect(where.id).toBe('g-1');
    expect(where.tenantId).toBe(TENANT);
  });

  // ----------------------------------------------------------------
  // Modifiers: create requires an owned group
  // ----------------------------------------------------------------

  it('createModifier rejects a group that does not belong to the tenant', async () => {
    (prisma.modifierGroup.findFirst as any).mockResolvedValue(null);

    await expect(
      svc.createModifier({ groupId: 'g-foreign', name: 'Extra' } as any, TENANT),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.modifier.create).not.toHaveBeenCalled();
    // The group ownership check is tenant-scoped.
    const where = (prisma.modifierGroup.findFirst as any).mock.calls[0][0].where;
    expect(where.id).toBe('g-foreign');
    expect(where.tenantId).toBe(TENANT);
  });

  it('createModifier stamps tenantId once the group is verified', async () => {
    (prisma.modifierGroup.findFirst as any).mockResolvedValue({
      id: 'g-1',
      tenantId: TENANT,
    });
    (prisma.modifier.create as any).mockImplementation(async ({ data }: any) => ({
      id: 'm-1',
      ...data,
    }));

    await svc.createModifier(
      { groupId: 'g-1', name: 'Extra cheese', price: 5 } as any,
      TENANT,
    );

    const data = (prisma.modifier.create as any).mock.calls[0][0].data;
    expect(data.tenantId).toBe(TENANT);
    expect(data.groupId).toBe('g-1');
  });

  // ----------------------------------------------------------------
  // Modifiers: availability filtering + group filter
  // ----------------------------------------------------------------

  it('findAllModifiers hides unavailable modifiers and scopes by tenant by default', async () => {
    (prisma.modifier.findMany as any).mockResolvedValue([]);

    await svc.findAllModifiers(TENANT);

    const where = (prisma.modifier.findMany as any).mock.calls[0][0].where;
    expect(where.tenantId).toBe(TENANT);
    expect(where.isAvailable).toBe(true);
  });

  it('findAllModifiers narrows to a group and can include unavailable ones', async () => {
    (prisma.modifier.findMany as any).mockResolvedValue([]);

    await svc.findAllModifiers(TENANT, 'g-1', true);

    const where = (prisma.modifier.findMany as any).mock.calls[0][0].where;
    expect(where.groupId).toBe('g-1');
    expect(where.isAvailable).toBeUndefined();
  });

  // ----------------------------------------------------------------
  // Modifiers: findOne / update / delete scoping
  // ----------------------------------------------------------------

  it('findOneModifier scopes by {id, tenantId} and throws NotFound on miss', async () => {
    (prisma.modifier.findFirst as any).mockResolvedValue(null);

    await expect(svc.findOneModifier('m-x', TENANT)).rejects.toThrow(
      NotFoundException,
    );
    const where = (prisma.modifier.findFirst as any).mock.calls[0][0].where;
    expect(where.id).toBe('m-x');
    expect(where.tenantId).toBe(TENANT);
  });

  it('updateModifier claims with a compound {id, tenantId} updateMany', async () => {
    (prisma.modifier.findFirst as any).mockResolvedValue({
      id: 'm-1',
      tenantId: TENANT,
    });
    (prisma.modifier.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.modifier.findUnique as any).mockResolvedValue({ id: 'm-1' });

    await svc.updateModifier('m-1', { price: 9 } as any, TENANT);

    const where = (prisma.modifier.updateMany as any).mock.calls[0][0].where;
    expect(where.id).toBe('m-1');
    expect(where.tenantId).toBe(TENANT);
  });

  it('deleteModifier refuses to delete a modifier already used in order items', async () => {
    (prisma.modifier.findFirst as any).mockResolvedValue({
      id: 'm-1',
      tenantId: TENANT,
    });
    (prisma.orderItemModifier.count as any).mockResolvedValue(2);

    await expect(svc.deleteModifier('m-1', TENANT)).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.modifier.delete).not.toHaveBeenCalled();
    const where = (prisma.orderItemModifier.count as any).mock.calls[0][0].where;
    expect(where.modifierId).toBe('m-1');
    expect(where.modifier).toEqual({ tenantId: TENANT });
  });

  it('deleteModifier deletes with a compound {id, tenantId} when unused', async () => {
    (prisma.modifier.findFirst as any).mockResolvedValue({
      id: 'm-1',
      tenantId: TENANT,
    });
    (prisma.orderItemModifier.count as any).mockResolvedValue(0);
    (prisma.modifier.delete as any).mockResolvedValue({ id: 'm-1' });

    await svc.deleteModifier('m-1', TENANT);

    const where = (prisma.modifier.delete as any).mock.calls[0][0].where;
    expect(where.id).toBe('m-1');
    expect(where.tenantId).toBe(TENANT);
  });

  // ----------------------------------------------------------------
  // Product-modifier assignment
  // ----------------------------------------------------------------

  it('assignModifiersToProduct rejects an unknown product (tenant-scoped)', async () => {
    (prisma.product.findFirst as any).mockResolvedValue(null);

    await expect(
      svc.assignModifiersToProduct(
        'p-1',
        { modifierGroups: [{ groupId: 'g-1' }] } as any,
        TENANT,
      ),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    const where = (prisma.product.findFirst as any).mock.calls[0][0].where;
    expect(where.id).toBe('p-1');
    expect(where.tenantId).toBe(TENANT);
  });

  it('assignModifiersToProduct rejects when a referenced group is invalid/cross-tenant', async () => {
    (prisma.product.findFirst as any).mockResolvedValue({ id: 'p-1' });
    // Asked for two groups, only one resolves within the tenant.
    (prisma.modifierGroup.findMany as any).mockResolvedValue([{ id: 'g-1' }]);

    await expect(
      svc.assignModifiersToProduct(
        'p-1',
        {
          modifierGroups: [{ groupId: 'g-1' }, { groupId: 'g-foreign' }],
        } as any,
        TENANT,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    // The group resolution is tenant-scoped.
    const where = (prisma.modifierGroup.findMany as any).mock.calls[0][0].where;
    expect(where.tenantId).toBe(TENANT);
    expect(where.id).toEqual({ in: ['g-1', 'g-foreign'] });
  });

  it('assignModifiersToProduct atomically replaces assignments (deleteMany + createMany in one tx)', async () => {
    (prisma.product.findFirst as any)
      .mockResolvedValueOnce({ id: 'p-1' }) // ownership check
      .mockResolvedValueOnce({ id: 'p-1', modifierGroups: [] }); // final read
    (prisma.modifierGroup.findMany as any).mockResolvedValue([
      { id: 'g-1' },
      { id: 'g-2' },
    ]);
    (prisma.$transaction as any).mockResolvedValue([{ count: 1 }, { count: 2 }]);

    await svc.assignModifiersToProduct(
      'p-1',
      {
        modifierGroups: [
          { groupId: 'g-1', displayOrder: 1 },
          { groupId: 'g-2' },
        ],
      } as any,
      TENANT,
    );

    // Both the delete and create were submitted together in a single $transaction.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const ops = (prisma.$transaction as any).mock.calls[0][0];
    expect(Array.isArray(ops)).toBe(true);
    expect(ops).toHaveLength(2);
    // The deleteMany strips old assignments for the product.
    const delWhere = (prisma.productModifierGroup.deleteMany as any).mock
      .calls[0][0].where;
    expect(delWhere.productId).toBe('p-1');
    // createMany rows carry productId + groupId, defaulting displayOrder to 0.
    const createData = (prisma.productModifierGroup.createMany as any).mock
      .calls[0][0].data;
    expect(createData).toEqual([
      { productId: 'p-1', groupId: 'g-1', displayOrder: 1 },
      { productId: 'p-1', groupId: 'g-2', displayOrder: 0 },
    ]);
  });

  it('getProductModifiers rejects an unknown product and otherwise returns available modifiers', async () => {
    (prisma.product.findFirst as any).mockResolvedValue(null);
    await expect(svc.getProductModifiers('p-x', TENANT)).rejects.toThrow(
      NotFoundException,
    );

    // Happy path: nested modifiers filtered to available only.
    (prisma.product.findFirst as any).mockResolvedValue({ id: 'p-1' });
    (prisma.productModifierGroup.findMany as any).mockResolvedValue([]);
    await svc.getProductModifiers('p-1', TENANT);
    const arg = (prisma.productModifierGroup.findMany as any).mock.calls[0][0];
    expect(arg.include.group.include.modifiers.where).toEqual({
      isAvailable: true,
    });
  });

  it('removeModifierGroupFromProduct verifies product ownership then detaches the pairing', async () => {
    (prisma.product.findFirst as any).mockResolvedValue({ id: 'p-1' });
    (prisma.productModifierGroup.deleteMany as any).mockResolvedValue({
      count: 1,
    });

    await expect(
      svc.removeModifierGroupFromProduct('p-1', 'g-1', TENANT),
    ).resolves.toEqual({
      message: 'Modifier group removed from product successfully',
    });
    const ownWhere = (prisma.product.findFirst as any).mock.calls[0][0].where;
    expect(ownWhere.id).toBe('p-1');
    expect(ownWhere.tenantId).toBe(TENANT);
    const delWhere = (prisma.productModifierGroup.deleteMany as any).mock
      .calls[0][0].where;
    expect(delWhere).toEqual({ productId: 'p-1', groupId: 'g-1' });
  });
});
