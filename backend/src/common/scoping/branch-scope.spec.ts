import { branchScope, loadBranchSettings, BranchScope } from './branch-scope';
import { UserRole } from '../constants/roles.enum';

describe('branchScope helper', () => {
  it('returns the (tenantId, branchId) compound predicate', () => {
    const scope: BranchScope = {
      tenantId: 't-1',
      branchId: 'b-1',
      userId: 'u-1',
      role: UserRole.ADMIN,
    };
    expect(branchScope(scope)).toEqual({ tenantId: 't-1', branchId: 'b-1' });
  });

  it('does not include userId / role — those drive authorization, not query predicates', () => {
    const scope: BranchScope = {
      tenantId: 't-1',
      branchId: 'b-1',
      userId: 'u-1',
      role: UserRole.ADMIN,
    };
    const where = branchScope(scope);
    expect(where).not.toHaveProperty('userId');
    expect(where).not.toHaveProperty('role');
  });
});

/**
 * v3.0.1 — loadBranchSettings switched from findUnique({ compound-unique
 * with branchId: null }) to findFirst({ tenantId, branchId }) because
 * Prisma's generated client rejects NULL on a compound-unique field at
 * the validation layer, regardless of the underlying DB constraint.
 * findFirst hits the same compound index, so cost is unchanged.
 */
describe('loadBranchSettings', () => {
  const scope: BranchScope = {
    tenantId: 't-1',
    branchId: 'b-1',
    userId: 'u-1',
    role: UserRole.ADMIN,
  };

  it('returns the branch-override row when one exists', async () => {
    const overrideRow = { id: 'r-override', branchId: 'b-1' };
    const delegate = {
      findFirst: jest.fn().mockResolvedValueOnce(overrideRow),
    };
    const result = await loadBranchSettings(delegate, scope);
    expect(result).toBe(overrideRow);
    expect(delegate.findFirst).toHaveBeenCalledTimes(1);
    expect(delegate.findFirst).toHaveBeenCalledWith({
      where: { tenantId: 't-1', branchId: 'b-1' },
    });
  });

  it('falls back to the tenant-default row when no override exists', async () => {
    const defaultRow = { id: 'r-default', branchId: null };
    const delegate = {
      findFirst: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(defaultRow),
    };
    const result = await loadBranchSettings(delegate, scope);
    expect(result).toBe(defaultRow);
    expect(delegate.findFirst).toHaveBeenCalledTimes(2);
    expect(delegate.findFirst).toHaveBeenLastCalledWith({
      where: { tenantId: 't-1', branchId: null },
    });
  });

  it('returns null when neither override nor default exists', async () => {
    const delegate = {
      findFirst: jest.fn().mockResolvedValue(null),
    };
    const result = await loadBranchSettings(delegate, scope);
    expect(result).toBeNull();
    expect(delegate.findFirst).toHaveBeenCalledTimes(2);
  });

  it('merges extra `select` arguments into both lookups', async () => {
    const delegate = {
      findFirst: jest.fn().mockResolvedValueOnce({ id: 'r-1' }),
    };
    await loadBranchSettings(delegate, scope, {
      select: { enableCustomerSelfPay: true },
    });
    expect(delegate.findFirst).toHaveBeenCalledWith({
      select: { enableCustomerSelfPay: true },
      where: { tenantId: 't-1', branchId: 'b-1' },
    });
  });

  it('returns the override row even when an extra `select` is passed', async () => {
    const row = { id: 'r-x' };
    const delegate = {
      findFirst: jest.fn().mockResolvedValueOnce(row),
    };
    const result = await loadBranchSettings(delegate, scope, {
      select: { foo: true },
    });
    expect(result).toBe(row);
    // Only one lookup — the override hit short-circuits the fallback.
    expect(delegate.findFirst).toHaveBeenCalledTimes(1);
  });
});
