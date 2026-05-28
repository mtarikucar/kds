import { ConfigService } from '@nestjs/config';
import { UploadService } from './upload.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';

// fs/promises module-level mock — jest.spyOn can't redefine the
// individual exports (non-configurable on the namespace object),
// but jest.mock can replace the whole module.
jest.mock('fs/promises', () => ({
  readdir: jest.fn(),
  unlink: jest.fn(),
  mkdir: jest.fn().mockResolvedValue(undefined),
  access: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fsPromises = require('fs/promises');

/**
 * Iter-44 regressions:
 *
 *  1. pruneTenantLogos strips ONLY this tenant's prior logos and
 *     leaves the just-written one alone.
 *  2. getProductImages / getUnusedImages enforce the LIST_HARD_CAP=500
 *     take limit on every DB query path.
 */
describe('UploadService (iter-44)', () => {
  let prisma: MockPrismaClient;
  let config: ConfigService;
  let svc: UploadService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    config = { get: () => undefined } as any;
    svc = new UploadService(prisma as any, config);
  });

  describe('pruneTenantLogos', () => {
    beforeEach(() => {
      fsPromises.readdir.mockReset();
      fsPromises.unlink.mockReset();
    });

    it('deletes only ${tenantId}-logo-* files and skips the new one', async () => {
      fsPromises.readdir.mockResolvedValue([
        'tenant-A-logo-1000.png',
        'tenant-A-logo-2000.png',   // older — to prune
        'tenant-A-logo-3000.png',   // ← keepFilename
        'tenant-B-logo-1500.png',   // different tenant — leave alone
        'README.md',                 // unrelated — leave alone
      ]);
      fsPromises.unlink.mockResolvedValue(undefined);

      await (svc as any).pruneTenantLogos(
        '/tmp/logos',
        'tenant-A',
        'tenant-A-logo-3000.png',
      );

      const unlinkedNames = fsPromises.unlink.mock.calls.map((c: any[]) =>
        (c[0] as string).split(/[\\/]/).pop(),
      );
      // The two older tenant-A logos got pruned.
      expect(unlinkedNames).toContain('tenant-A-logo-1000.png');
      expect(unlinkedNames).toContain('tenant-A-logo-2000.png');
      // Critically: the just-written file and the other tenant's logo
      // were NOT touched.
      expect(unlinkedNames).not.toContain('tenant-A-logo-3000.png');
      expect(unlinkedNames).not.toContain('tenant-B-logo-1500.png');
      expect(unlinkedNames).not.toContain('README.md');
    });

    it('returns cleanly when the logos directory does not exist', async () => {
      fsPromises.readdir.mockRejectedValue(
        Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
      );

      await expect(
        (svc as any).pruneTenantLogos('/missing', 'tenant-A', 'tenant-A-logo-X.png'),
      ).resolves.toBeUndefined();
      expect(fsPromises.unlink).not.toHaveBeenCalled();
    });
  });

  describe('list endpoints enforce LIST_HARD_CAP', () => {
    it('getProductImages caps the tenant-wide query at 500', async () => {
      (prisma.productImage.findMany as any).mockResolvedValue([]);

      await svc.getProductImages('t1');

      const args = (prisma.productImage.findMany as any).mock.calls[0][0];
      expect(args.take).toBe(500);
    });

    it('getProductImages caps the per-product query at 500 too', async () => {
      (prisma.productToImage.findMany as any).mockResolvedValue([]);

      await svc.getProductImages('t1', 'product-1');

      const args = (prisma.productToImage.findMany as any).mock.calls[0][0];
      expect(args.take).toBe(500);
    });

    it('getUnusedImages caps the candidate set at 500', async () => {
      (prisma.productToImage.findMany as any).mockResolvedValue([]);
      (prisma.productImage.findMany as any).mockResolvedValue([]);

      await svc.getUnusedImages('t1');

      const args = (prisma.productImage.findMany as any).mock.calls[0][0];
      expect(args.take).toBe(500);
    });
  });
});
