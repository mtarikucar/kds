import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LegalDocumentsService } from './legal-documents.service';
import { mockPrismaClient, MockPrismaClient } from '../../../common/test/prisma-mock.service';
import { LegalDocumentKind } from '../constants';

/**
 * Behaviour-level tests for the publish path. The pre-check + serializable
 * txn flow has two distinct paths that surface a duplicate:
 *   - the pre-check findUnique sees the existing row → throw BadRequest
 *   - the pre-check misses (concurrent insert), the @@unique constraint
 *     trips at commit time → P2002 must be translated to the same friendly
 *     BadRequest message (iter-30)
 */
describe('LegalDocumentsService.publish', () => {
  let prisma: MockPrismaClient;
  let svc: LegalDocumentsService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new LegalDocumentsService(prisma as any);
  });

  const dto = {
    kind: LegalDocumentKind.KVKK,
    version: '1.1',
    locale: 'tr',
    title: 'Test',
    bodyMarkdown: 'body',
  };

  it('throws BadRequest when the pre-check finds the version already exists', async () => {
    prisma.legalDocument.findUnique.mockResolvedValue({
      id: 'existing', kind: 'KVKK', version: '1.1', locale: 'tr',
    } as any);

    await expect(svc.publish(dto)).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('translates a P2002 unique-constraint violation to BadRequest (iter-30)', async () => {
    // Pre-check misses — race window — then the @@unique([kind,version,
    // locale]) index trips inside the txn. Before iter-30 this surfaced
    // as a raw 500 to the superadmin; now they get the same "use a new
    // version" guidance the pre-check would have produced.
    prisma.legalDocument.findUnique.mockResolvedValue(null);
    (prisma.$transaction as any).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '6.x',
      } as any),
    );

    await expect(svc.publish(dto)).rejects.toMatchObject({
      message: expect.stringMatching(/already exists.*Use a new version/),
    });
  });

  it('re-raises non-P2002 errors unchanged so we never swallow real failures', async () => {
    prisma.legalDocument.findUnique.mockResolvedValue(null);
    const original = new Error('connection pool exhausted');
    (prisma.$transaction as any).mockRejectedValue(original);

    await expect(svc.publish(dto)).rejects.toBe(original);
  });

  it('happy path: serializable transaction flips prior isCurrent and creates the new row', async () => {
    prisma.legalDocument.findUnique.mockResolvedValue(null);
    (prisma.$transaction as any).mockImplementation(async (cb: any) => {
      const tx = {
        legalDocument: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          create: jest.fn().mockResolvedValue({ id: 'new', ...dto, isCurrent: true }),
        },
      };
      return cb(tx);
    });

    const out: any = await svc.publish(dto);
    expect(out.id).toBe('new');
    expect(out.isCurrent).toBe(true);
  });
});
