import { NotFoundException } from '@nestjs/common';
import { LegalDocumentsService } from './legal-documents.service';
import {
  mockPrismaClient,
  MockPrismaClient,
} from '../../../common/test/prisma-mock.service';
import { LegalDocumentKind } from '../constants';

/**
 * Spec for the read paths of LegalDocumentsService that the existing
 * publish-focused spec does not exercise: getCurrent's locale → TR
 * fallback chain and its NotFound terminus, plus listAll's optional
 * filter building.
 */
describe('LegalDocumentsService.getCurrent', () => {
  let prisma: MockPrismaClient;
  let svc: LegalDocumentsService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new LegalDocumentsService(prisma as any);
  });

  it('returns the exact-locale current document when one exists (no fallback query)', async () => {
    const doc = { id: 'd-en', kind: 'KVKK', locale: 'en', isCurrent: true };
    (prisma.legalDocument.findFirst as any).mockResolvedValue(doc);

    const res = await svc.getCurrent(LegalDocumentKind.KVKK, 'en');

    expect(res).toBe(doc);
    // exact hit => only one query, the where targets the requested locale
    expect(prisma.legalDocument.findFirst as any).toHaveBeenCalledTimes(1);
    const where = (prisma.legalDocument.findFirst as any).mock.calls[0][0].where;
    expect(where).toEqual({
      kind: LegalDocumentKind.KVKK,
      locale: 'en',
      isCurrent: true,
    });
  });

  it('falls back to the Turkish current document when the requested locale has none', async () => {
    const trDoc = { id: 'd-tr', kind: 'KVKK', locale: 'tr', isCurrent: true };
    (prisma.legalDocument.findFirst as any)
      .mockResolvedValueOnce(null) // requested locale 'de' miss
      .mockResolvedValueOnce(trDoc); // tr fallback hit

    const res = await svc.getCurrent(LegalDocumentKind.KVKK, 'de');

    expect(res).toBe(trDoc);
    // the second query explicitly targets locale 'tr'
    const fallbackWhere = (prisma.legalDocument.findFirst as any).mock
      .calls[1][0].where;
    expect(fallbackWhere.locale).toBe('tr');
  });

  it('does NOT attempt a tr-fallback when the requested locale is already tr', async () => {
    (prisma.legalDocument.findFirst as any).mockResolvedValue(null);

    await expect(
      svc.getCurrent(LegalDocumentKind.KVKK, 'tr'),
    ).rejects.toBeInstanceOf(NotFoundException);

    // locale === 'tr' short-circuits the fallback branch => single query
    expect(prisma.legalDocument.findFirst as any).toHaveBeenCalledTimes(1);
  });

  it('throws NotFound when neither the requested locale nor the tr fallback exists', async () => {
    (prisma.legalDocument.findFirst as any)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    await expect(
      svc.getCurrent(LegalDocumentKind.KVKK, 'fr'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.legalDocument.findFirst as any).toHaveBeenCalledTimes(2);
  });
});

describe('LegalDocumentsService.listAll', () => {
  let prisma: MockPrismaClient;
  let svc: LegalDocumentsService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new LegalDocumentsService(prisma as any);
  });

  it('passes an empty where (full audit chain) when no filters given', async () => {
    (prisma.legalDocument.findMany as any).mockResolvedValue([]);

    await svc.listAll();

    const args = (prisma.legalDocument.findMany as any).mock.calls[0][0];
    expect(args.where).toEqual({});
    // ordered kind asc, createdAt desc (newest version per kind first)
    expect(args.orderBy).toEqual([{ kind: 'asc' }, { createdAt: 'desc' }]);
  });

  it('includes only the supplied filters in the where', async () => {
    (prisma.legalDocument.findMany as any).mockResolvedValue([]);

    await svc.listAll(LegalDocumentKind.REFUND_POLICY, 'tr');

    const where = (prisma.legalDocument.findMany as any).mock.calls[0][0].where;
    expect(where).toEqual({ kind: LegalDocumentKind.REFUND_POLICY, locale: 'tr' });
  });
});
