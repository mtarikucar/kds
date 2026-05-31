/**
 * Unit spec for the bootstrap-v3-tenants script. Calls the exported
 * helpers directly with a hand-rolled Prisma mock — no testcontainer
 * required. The DB-layer CHECK constraints + FK Restrict are exercised
 * by integration cutover in staging; this spec guards the script's
 * orchestration logic.
 */
import {
  ensureMainBranchForTenants,
  verifyInvariants,
} from './bootstrap-v3-tenants';

type MockTenant = { id: string; timezone: string | null; name: string };
type MockBranch = { id: string; tenantId: string; status: string };

function makePrismaMock(state: {
  tenants: MockTenant[];
  branches: MockBranch[];
  adminsWithoutHome?: number;
  invariantOrphans?: MockTenant[];
  restrictedOrphans?: number;
}) {
  let createdCount = 0;
  const findManyCalls: any[] = [];
  return {
    tenant: {
      findMany: jest.fn(async (args: any) => {
        findManyCalls.push(args);
        // The first call (ensureMainBranchForTenants) selects {id,
        // timezone, name}. The second (verifyInvariants) filters on
        // `branches: { none: ... }`. Distinguish by `where`.
        if (args?.where?.branches) {
          return state.invariantOrphans ?? [];
        }
        return state.tenants;
      }),
    },
    branch: {
      findFirst: jest.fn(async ({ where }: any) => {
        const found = state.branches.find(
          (b) => b.tenantId === where.tenantId && b.status === where.status,
        );
        return found ? { id: found.id } : null;
      }),
      create: jest.fn(async ({ data }: any) => {
        createdCount++;
        const row: MockBranch = {
          id: `b-new-${createdCount}`,
          tenantId: data.tenantId,
          status: 'active',
        };
        state.branches.push(row);
        return { id: row.id };
      }),
    },
    user: {
      updateMany: jest.fn(async () => ({
        count: state.adminsWithoutHome ?? 0,
      })),
      count: jest.fn(async () => state.restrictedOrphans ?? 0),
    },
    findManyCalls,
  };
}

describe('bootstrap-v3-tenants', () => {
  it('creates a Main branch for every tenant lacking one and stamps ADMINs', async () => {
    const state = {
      tenants: [
        { id: 't-1', timezone: 'UTC', name: 'Alpha' },
        { id: 't-2', timezone: 'Europe/Istanbul', name: 'Beta' },
      ],
      branches: [
        { id: 'b-existing', tenantId: 't-1', status: 'active' },
      ],
      adminsWithoutHome: 1,
    };
    const prisma: any = makePrismaMock(state);

    const result = await ensureMainBranchForTenants(prisma);

    expect(prisma.branch.create).toHaveBeenCalledTimes(1);
    expect(prisma.branch.create.mock.calls[0][0]).toMatchObject({
      data: {
        tenantId: 't-2',
        name: 'Main',
        status: 'active',
        timezone: 'Europe/Istanbul',
      },
    });
    expect(prisma.user.updateMany).toHaveBeenCalledTimes(2);
    expect(result.createdBranches).toBe(1);
    expect(result.stampedAdmins).toBe(2); // 1 per tenant × 2 tenants
  });

  it('is idempotent — tenants with an existing active branch see no new create', async () => {
    const state = {
      tenants: [{ id: 't-1', timezone: 'UTC', name: 'Alpha' }],
      branches: [{ id: 'b-existing', tenantId: 't-1', status: 'active' }],
      adminsWithoutHome: 0,
    };
    const prisma: any = makePrismaMock(state);

    const result = await ensureMainBranchForTenants(prisma);

    expect(prisma.branch.create).not.toHaveBeenCalled();
    expect(result.createdBranches).toBe(0);
  });

  it('verifyInvariants throws when a tenant has no active branch', async () => {
    const prisma: any = makePrismaMock({
      tenants: [],
      branches: [],
      invariantOrphans: [{ id: 't-orphan', name: 'X', timezone: null }],
    });
    await expect(verifyInvariants(prisma)).rejects.toThrow(
      /no active branch/,
    );
  });

  it('verifyInvariants throws when a restricted user has no primaryBranchId', async () => {
    const prisma: any = makePrismaMock({
      tenants: [],
      branches: [],
      restrictedOrphans: 3,
    });
    await expect(verifyInvariants(prisma)).rejects.toThrow(
      /restricted-role/,
    );
  });

  it('verifyInvariants is silent when both invariants hold', async () => {
    const prisma: any = makePrismaMock({
      tenants: [],
      branches: [],
    });
    await expect(verifyInvariants(prisma)).resolves.toBeUndefined();
  });
});
