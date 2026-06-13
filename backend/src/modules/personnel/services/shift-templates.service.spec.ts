import { ShiftTemplatesService } from './shift-templates.service';
import { mockPrismaClient, MockPrismaClient } from '../../../common/test/prisma-mock.service';

/**
 * Branch-scope regression: a branch-A manager must not be able to
 * read, edit, or delete branch-B shift templates. `create` already
 * writes branchId; these tests pin findAll/update/remove to the same
 * (tenantId, branchId) compound predicate built by `branchScope()`.
 */
describe('ShiftTemplatesService (branch scope)', () => {
  let prisma: MockPrismaClient;
  let svc: ShiftTemplatesService;

  const scope = {
    tenantId: 't-1',
    branchId: 'b-1',
    userId: 'u-1',
    role: 'MANAGER',
  } as any;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new ShiftTemplatesService(prisma as any);
  });

  it('findAll filters by branchId', async () => {
    (prisma.shiftTemplate.findMany as any).mockResolvedValue([]);
    await svc.findAll(scope);
    const where = (prisma.shiftTemplate.findMany as any).mock.calls[0][0].where;
    expect(where.branchId).toBe('b-1');
    expect(where.tenantId).toBe('t-1');
  });

  it('update scopes the IDOR guard by branchId', async () => {
    (prisma.shiftTemplate.findFirst as any).mockResolvedValue({ id: 'st-1' });
    (prisma.shiftTemplate.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.shiftTemplate.findFirstOrThrow as any).mockResolvedValue({
      id: 'st-1',
    });

    await svc.update(scope, 'st-1', {} as any);

    const findWhere = (prisma.shiftTemplate.findFirst as any).mock.calls[0][0]
      .where;
    expect(findWhere.id).toBe('st-1');
    expect(findWhere.branchId).toBe('b-1');
    expect(findWhere.tenantId).toBe('t-1');

    const updateWhere = (prisma.shiftTemplate.updateMany as any).mock.calls[0][0]
      .where;
    expect(updateWhere.branchId).toBe('b-1');
    expect(updateWhere.tenantId).toBe('t-1');
  });

  it('remove scopes the lookup and delete by branchId', async () => {
    (prisma.shiftTemplate.findFirst as any).mockResolvedValue({ id: 'st-1' });
    (prisma.shiftAssignment.count as any).mockResolvedValue(0);
    (prisma.shiftTemplate.delete as any).mockResolvedValue({ id: 'st-1' });

    await svc.remove(scope, 'st-1');

    const findWhere = (prisma.shiftTemplate.findFirst as any).mock.calls[0][0]
      .where;
    expect(findWhere.branchId).toBe('b-1');
    expect(findWhere.tenantId).toBe('t-1');

    const deleteWhere = (prisma.shiftTemplate.delete as any).mock.calls[0][0]
      .where;
    expect(deleteWhere.branchId).toBe('b-1');
    expect(deleteWhere.tenantId).toBe('t-1');
  });
});
