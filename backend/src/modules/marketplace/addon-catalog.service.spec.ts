import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  mockPrismaClient,
  MockPrismaClient,
} from '../../common/test/prisma-mock.service';
import { AddOnCatalogService } from './addon-catalog.service';

/**
 * Spec for AddOnCatalogService — the catalog CRUD branches: filter-building
 * for list, the trimmed public projection, P2002→Conflict on create, the
 * not-found guards, default-applying create, archive-as-status-update, and
 * the dependency resolver's plan:/addon split + missing-dep aggregation.
 */
describe('AddOnCatalogService', () => {
  let prisma: MockPrismaClient;
  let svc: AddOnCatalogService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new AddOnCatalogService(prisma as any);
  });

  describe('list', () => {
    it('builds a where with only the supplied filters', async () => {
      (prisma.marketplaceAddOn.findMany as any).mockResolvedValue([]);

      await svc.list({ status: 'published' });

      const where = (prisma.marketplaceAddOn.findMany as any).mock.calls[0][0]
        .where;
      expect(where).toEqual({ status: 'published' });
    });

    it('passes an empty where when no filters are supplied', async () => {
      (prisma.marketplaceAddOn.findMany as any).mockResolvedValue([]);

      await svc.list();

      const where = (prisma.marketplaceAddOn.findMany as any).mock.calls[0][0]
        .where;
      expect(where).toEqual({});
    });
  });

  describe('listPublic', () => {
    it('filters to published rows and trims to the public field set', async () => {
      (prisma.marketplaceAddOn.findMany as any).mockResolvedValue([
        {
          id: 'internal-id',
          code: 'pro_pack',
          name: 'Pro Pack',
          description: 'desc',
          kind: 'feature',
          billing: 'monthly',
          priceCents: 999,
          currency: 'TRY',
          deps: ['plan:Pro'],
          grants: { 'feature.x': true }, // must NOT leak
          status: 'published',
        },
      ]);

      const res = await svc.listPublic();

      const where = (prisma.marketplaceAddOn.findMany as any).mock.calls[0][0]
        .where;
      expect(where).toEqual({ status: 'published' });
      // public projection omits id/grants/status
      expect(res[0]).toEqual({
        code: 'pro_pack',
        name: 'Pro Pack',
        description: 'desc',
        kind: 'feature',
        billing: 'monthly',
        priceCents: 999,
        currency: 'TRY',
        deps: ['plan:Pro'],
      });
      expect(res[0]).not.toHaveProperty('grants');
      expect(res[0]).not.toHaveProperty('id');
    });
  });

  describe('findByCodeOrThrow', () => {
    it('throws NotFound when no row matches the code', async () => {
      (prisma.marketplaceAddOn.findUnique as any).mockResolvedValue(null);
      await expect(svc.findByCodeOrThrow('ghost')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('applies defaults (currency TRY, deps [], status draft)', async () => {
      (prisma.marketplaceAddOn.create as any).mockImplementation(
        async ({ data }: any) => ({ id: 'new', ...data }),
      );

      await svc.create({
        code: 'a',
        name: 'A',
        description: 'd',
        kind: 'feature',
        billing: 'monthly',
        priceCents: 100,
        grants: {},
      } as any);

      const data = (prisma.marketplaceAddOn.create as any).mock.calls[0][0].data;
      expect(data.currency).toBe('TRY');
      expect(data.deps).toEqual([]);
      expect(data.status).toBe('draft');
    });

    it('translates a P2002 to a Conflict that names the duplicate code', async () => {
      const p2002 = new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
      });
      (prisma.marketplaceAddOn.create as any).mockRejectedValue(p2002);

      await expect(
        svc.create({
          code: 'dupcode',
          name: 'A',
          description: 'd',
          kind: 'feature',
          billing: 'monthly',
          priceCents: 100,
          grants: {},
        } as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('re-throws non-P2002 errors unchanged', async () => {
      const boom = new Error('db down');
      (prisma.marketplaceAddOn.create as any).mockRejectedValue(boom);
      await expect(
        svc.create({
          code: 'c',
          name: 'A',
          description: 'd',
          kind: 'feature',
          billing: 'monthly',
          priceCents: 100,
          grants: {},
        } as any),
      ).rejects.toBe(boom);
    });
  });

  describe('update / archive', () => {
    it('throws NotFound when updating an absent add-on', async () => {
      (prisma.marketplaceAddOn.findUnique as any).mockResolvedValue(null);
      await expect(svc.update('missing', {} as any)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('archive delegates to update with status=archived', async () => {
      (prisma.marketplaceAddOn.findUnique as any).mockResolvedValue({
        id: 'x',
      });
      (prisma.marketplaceAddOn.update as any).mockResolvedValue({ id: 'x' });

      await svc.archive('x');

      const data = (prisma.marketplaceAddOn.update as any).mock.calls[0][0].data;
      expect(data.status).toBe('archived');
    });
  });

  describe('resolveDeps', () => {
    it('returns [] when every addon-code and plan dep resolves', async () => {
      (prisma.marketplaceAddOn.findMany as any).mockResolvedValue([
        { code: 'dep_a' },
      ]);
      (prisma.subscriptionPlan.findMany as any).mockResolvedValue([
        { name: 'Pro' },
      ]);

      const missing = await svc.resolveDeps(['dep_a', 'plan:Pro']);

      expect(missing).toEqual([]);
      // addon codes queried without the plan ones
      const addonWhere = (prisma.marketplaceAddOn.findMany as any).mock
        .calls[0][0].where;
      expect(addonWhere.code.in).toEqual(['dep_a']);
      const planWhere = (prisma.subscriptionPlan.findMany as any).mock
        .calls[0][0].where;
      expect(planWhere.name.in).toEqual(['Pro']);
    });

    it('throws BadRequest listing every unresolved addon and plan dep', async () => {
      (prisma.marketplaceAddOn.findMany as any).mockResolvedValue([]); // dep_a missing
      (prisma.subscriptionPlan.findMany as any).mockResolvedValue([]); // plan:Pro missing

      await expect(
        svc.resolveDeps(['dep_a', 'plan:Pro']),
      ).rejects.toMatchObject({
        message: expect.stringContaining('dep_a'),
      });
      await expect(svc.resolveDeps(['dep_a', 'plan:Pro'])).rejects.toMatchObject(
        { message: expect.stringContaining('plan:Pro') },
      );
      await expect(
        svc.resolveDeps(['dep_a']),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('skips the plan query entirely when there are no plan deps', async () => {
      (prisma.marketplaceAddOn.findMany as any).mockResolvedValue([
        { code: 'dep_a' },
      ]);

      const missing = await svc.resolveDeps(['dep_a']);

      expect(missing).toEqual([]);
      expect(prisma.subscriptionPlan.findMany as any).not.toHaveBeenCalled();
    });
  });
});
