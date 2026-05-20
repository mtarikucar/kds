import { BadRequestException } from '@nestjs/common';
import { ConsentService } from './consent.service';
import { mockPrismaClient, MockPrismaClient } from '../../../common/test/prisma-mock.service';

describe('ConsentService', () => {
  let prisma: MockPrismaClient;
  let svc: ConsentService;

  const USER_ID = 'user-1';
  const KVKK_ID = 'doc-kvkk-current';
  const DS_ID = 'doc-distance-current';
  const REFUND_ID = 'doc-refund-current';

  const currentDocs = [
    { id: KVKK_ID, kind: 'KVKK', version: '1.0', locale: 'tr', isCurrent: true },
    {
      id: DS_ID,
      kind: 'DISTANCE_SALES',
      version: '1.0',
      locale: 'tr',
      isCurrent: true,
    },
    {
      id: REFUND_ID,
      kind: 'REFUND_POLICY',
      version: '1.0',
      locale: 'tr',
      isCurrent: true,
    },
  ];

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new ConsentService(prisma as any);
    prisma.legalDocument.findMany.mockResolvedValue(currentDocs as any);
    prisma.consent.createMany.mockResolvedValue({ count: 3 } as any);
  });

  describe('verifyAndRecord', () => {
    it('rejects an empty acceptance list with a Turkish-language 400', async () => {
      await expect(
        svc.verifyAndRecord([], { userId: USER_ID }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when the user supplies an unknown id (likely a stale version)', async () => {
      // KVKK id is wrong → not in `currentDocs`. ConsentService should
      // refuse rather than silently treat as "ignored".
      await expect(
        svc.verifyAndRecord(
          ['unknown-uuid', DS_ID, REFUND_ID],
          { userId: USER_ID },
        ),
      ).rejects.toThrow(/güncellendi/i);
    });

    it('rejects when the three ids cover only two of the three required kinds', async () => {
      // Three ids but two of them point to the same kind (KVKK twice).
      // The "missing kind" branch fires.
      const dupedSet = [
        { id: KVKK_ID, kind: 'KVKK', version: '1.0', locale: 'tr', isCurrent: true },
        {
          id: 'kvkk-old',
          kind: 'KVKK',
          version: '1.0',
          locale: 'tr',
          isCurrent: true,
        },
        {
          id: REFUND_ID,
          kind: 'REFUND_POLICY',
          version: '1.0',
          locale: 'tr',
          isCurrent: true,
        },
      ];
      prisma.legalDocument.findMany.mockResolvedValue(dupedSet as any);

      await expect(
        svc.verifyAndRecord(
          [KVKK_ID, 'kvkk-old', REFUND_ID],
          { userId: USER_ID },
        ),
      ).rejects.toThrow(/Eksik yasal onay: DISTANCE_SALES/);
    });

    it('writes three Consent rows with ip + userAgent when all ids are valid', async () => {
      await svc.verifyAndRecord(
        [KVKK_ID, DS_ID, REFUND_ID],
        {
          userId: USER_ID,
          ipAddress: '203.0.113.45',
          userAgent: 'Mozilla/5.0 (Test)',
          subscriptionId: 'sub-1',
        },
      );

      expect(prisma.consent.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            userId: USER_ID,
            documentKind: 'KVKK',
            documentVersion: '1.0',
            ipAddress: '203.0.113.45',
            userAgent: 'Mozilla/5.0 (Test)',
            subscriptionId: 'sub-1',
          }),
          expect.objectContaining({ documentKind: 'DISTANCE_SALES' }),
          expect.objectContaining({ documentKind: 'REFUND_POLICY' }),
        ]),
      });
    });

    it('still writes Consent rows when ip + userAgent are absent (renewal flows)', async () => {
      await svc.verifyAndRecord(
        [KVKK_ID, DS_ID, REFUND_ID],
        { userId: USER_ID },
      );

      const callArgs = prisma.consent.createMany.mock.calls[0][0] as { data: any[] };
      for (const row of callArgs.data) {
        expect(row.ipAddress).toBeNull();
        expect(row.userAgent).toBeNull();
      }
    });
  });

  describe('hasAllCurrentConsents', () => {
    it('returns true when the user has accepted the latest version of each required kind', async () => {
      prisma.legalDocument.findMany.mockResolvedValue([
        { kind: 'KVKK', version: '1.0' },
        { kind: 'DISTANCE_SALES', version: '1.0' },
        { kind: 'REFUND_POLICY', version: '1.0' },
      ] as any);
      prisma.consent.findFirst.mockResolvedValue({ id: 'c-1' } as any);

      await expect(svc.hasAllCurrentConsents(USER_ID)).resolves.toBe(true);
    });

    it('returns false when one of the kinds was never accepted at the current version', async () => {
      prisma.legalDocument.findMany.mockResolvedValue([
        { kind: 'KVKK', version: '2.0' },
        { kind: 'DISTANCE_SALES', version: '1.0' },
        { kind: 'REFUND_POLICY', version: '1.0' },
      ] as any);
      // First call resolves (KVKK v2.0 accepted), second resolves
      // (DISTANCE_SALES v1.0 accepted), third resolves null
      // (REFUND_POLICY v1.0 not yet accepted) → method returns false.
      prisma.consent.findFirst
        .mockResolvedValueOnce({ id: 'c-1' } as any)
        .mockResolvedValueOnce({ id: 'c-2' } as any)
        .mockResolvedValueOnce(null);

      await expect(svc.hasAllCurrentConsents(USER_ID)).resolves.toBe(false);
    });
  });
});
