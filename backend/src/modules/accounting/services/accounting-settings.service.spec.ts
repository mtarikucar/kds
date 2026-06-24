import {
  mockPrismaClient,
  MockPrismaClient,
} from '../../../common/test/prisma-mock.service';
import { AccountingSettingsService } from './accounting-settings.service';

/**
 * Behavioural tests for accounting settings. The DB is mocked, but two
 * security/compliance-sensitive bits run for real:
 *
 *   1. Secret fields (Foriba/Logo/Parasut passwords + Parasut client
 *      secret) are AES-256-GCM encrypted at rest before they hit the DB,
 *      and decrypted on the credentials read path. A DB leak of plaintext
 *      rows would hand over every tenant's accounting creds.
 *   2. Invoice numbering — getNextInvoiceNumber must be atomic and must
 *      refuse to run outside a transaction (sequence gaps / duplicate
 *      numbers complicate fiscal audits).
 *
 * The encrypted-blob format is `v1:iv:authTag:ciphertext`; we assert the
 * `v1:` prefix and round-trippability rather than the exact bytes.
 */
describe('AccountingSettingsService', () => {
  let prisma: MockPrismaClient;
  let svc: AccountingSettingsService;

  const originalKey = process.env.ENCRYPTION_MASTER_KEY;
  beforeAll(() => {
    process.env.ENCRYPTION_MASTER_KEY =
      'test-master-key-at-least-32-chars-long-xx';
  });
  afterAll(() => {
    if (originalKey === undefined) delete process.env.ENCRYPTION_MASTER_KEY;
    else process.env.ENCRYPTION_MASTER_KEY = originalKey;
  });

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new AccountingSettingsService(prisma as any);
  });

  describe('findByTenant', () => {
    it('scopes the lookup to the tenant-wide row (branchId: null)', async () => {
      (prisma.accountingSettings.findFirst as any).mockResolvedValue({
        id: 's-1',
        tenantId: 't-1',
        branchId: null,
      });

      const out = await svc.findByTenant('t-1');

      const where = (prisma.accountingSettings.findFirst as any).mock
        .calls[0][0].where;
      expect(where.tenantId).toBe('t-1');
      expect(where.branchId).toBeNull();
      expect(out.id).toBe('s-1');
      expect(prisma.accountingSettings.create).not.toHaveBeenCalled();
    });

    it('lazily creates a tenant row when none exists yet', async () => {
      (prisma.accountingSettings.findFirst as any).mockResolvedValue(null);
      (prisma.accountingSettings.create as any).mockResolvedValue({
        id: 's-new',
        tenantId: 't-1',
        branchId: null,
      });

      const out = await svc.findByTenant('t-1');

      const data = (prisma.accountingSettings.create as any).mock.calls[0][0]
        .data;
      expect(data.tenantId).toBe('t-1');
      expect(out.id).toBe('s-new');
    });

    it('recovers from a P2002 create race by re-reading the row', async () => {
      // Two requests for a brand-new tenant race on create; the loser
      // gets a unique-violation and must fall back to the winner's row
      // rather than throwing.
      (prisma.accountingSettings.findFirst as any)
        .mockResolvedValueOnce(null) // initial miss
        .mockResolvedValueOnce({ id: 's-won', tenantId: 't-1', branchId: null }); // post-race re-read
      (prisma.accountingSettings.create as any).mockRejectedValue({
        code: 'P2002',
      });

      const out = await svc.findByTenant('t-1');
      expect(out.id).toBe('s-won');
    });
  });

  describe('update — encryption at rest', () => {
    it('encrypts secret fields before they reach the DB on create path', async () => {
      (prisma.accountingSettings.findFirst as any).mockResolvedValue(null);
      let captured: any = null;
      (prisma.accountingSettings.create as any).mockImplementation(
        async ({ data }: any) => {
          captured = data;
          return { id: 's-1', ...data };
        },
      );

      await svc.update('t-1', {
        provider: 'FORIBA',
        foribaPassword: 'super-secret',
        foribaUsername: 'plain-user',
      } as any);

      // The secret must NOT be persisted in plaintext.
      expect(captured.foribaPassword).not.toBe('super-secret');
      expect(captured.foribaPassword.startsWith('v1:')).toBe(true);
      // Non-secret fields pass through untouched.
      expect(captured.foribaUsername).toBe('plain-user');
    });

    it('encrypts secret fields on the update path too', async () => {
      (prisma.accountingSettings.findFirst as any).mockResolvedValue({
        id: 's-1',
        tenantId: 't-1',
        branchId: null,
      });
      let captured: any = null;
      (prisma.accountingSettings.updateMany as any).mockImplementation(
        async ({ data }: any) => {
          captured = data;
          return { count: 1 };
        },
      );
      (prisma.accountingSettings.findFirstOrThrow as any).mockResolvedValue({
        id: 's-1',
      });

      await svc.update('t-1', { logoPassword: 'pw123' } as any);

      const where = (prisma.accountingSettings.updateMany as any).mock
        .calls[0][0].where;
      expect(where.tenantId).toBe('t-1');
      expect(where.branchId).toBeNull();
      expect(captured.logoPassword.startsWith('v1:')).toBe(true);
    });

    it('does NOT double-encrypt an already-encrypted (v1:) value', async () => {
      (prisma.accountingSettings.findFirst as any).mockResolvedValue(null);
      let captured: any = null;
      (prisma.accountingSettings.create as any).mockImplementation(
        async ({ data }: any) => {
          captured = data;
          return { id: 's-1', ...data };
        },
      );

      const already = 'v1:aaa:bbb:ccc';
      await svc.update('t-1', { parasutPassword: already } as any);
      expect(captured.parasutPassword).toBe(already);
    });
  });

  describe('getDecryptedCredentials', () => {
    it('round-trips an encrypted secret back to plaintext', async () => {
      // Encrypt a value through the real update path, then read it back.
      (prisma.accountingSettings.findFirst as any).mockResolvedValueOnce(null);
      let stored: any = null;
      (prisma.accountingSettings.create as any).mockImplementation(
        async ({ data }: any) => {
          stored = { id: 's-1', tenantId: 't-1', branchId: null, ...data };
          return stored;
        },
      );
      await svc.update('t-1', { foribaPassword: 'roundtrip-me' } as any);
      expect(stored.foribaPassword.startsWith('v1:')).toBe(true);

      (prisma.accountingSettings.findFirst as any).mockResolvedValueOnce(stored);
      const creds = await svc.getDecryptedCredentials('t-1');
      expect(creds.foribaPassword).toBe('roundtrip-me');
    });

    it('returns null for a secret whose blob fails to decrypt instead of crashing', async () => {
      (prisma.accountingSettings.findFirst as any).mockResolvedValue({
        id: 's-1',
        tenantId: 't-1',
        branchId: null,
        logoPassword: 'v1:bad:blob:corrupt', // malformed/undecryptable
      });

      const creds = await svc.getDecryptedCredentials('t-1');
      expect(creds.logoPassword).toBeNull();
    });

    it('returns null when there is no settings row', async () => {
      (prisma.accountingSettings.findFirst as any).mockResolvedValue(null);
      expect(await svc.getDecryptedCredentials('t-1')).toBeNull();
    });
  });

  describe('sanitize', () => {
    it('strips secret fields and exposes only boolean has*Credentials flags', () => {
      const out = svc.sanitize({
        id: 's-1',
        provider: 'FORIBA',
        foribaUsername: 'u',
        foribaPassword: 'secret',
        logoUsername: 'l',
        logoPassword: '',
        parasutUsername: null,
        parasutClientSecret: 'cs',
      });

      // raw secrets gone
      expect(out).not.toHaveProperty('foribaPassword');
      expect(out).not.toHaveProperty('logoPassword');
      expect(out).not.toHaveProperty('parasutClientSecret');
      expect(out).not.toHaveProperty('parasutPassword');
      // flags reflect (secret AND username) both present
      expect(out.hasForibaCredentials).toBe(true);
      expect(out.hasLogoCredentials).toBe(false); // empty password
      expect(out.hasParasutCredentials).toBe(false); // no username
    });
  });

  describe('getNextInvoiceNumber', () => {
    function txClient() {
      // A minimal transaction client surface used by the service.
      return {
        accountingSettings: {
          findFirst: jest.fn(),
          findFirstOrThrow: jest.fn(),
          updateMany: jest.fn(),
          create: jest.fn(),
        },
      } as any;
    }

    it('REFUSES to run outside a transaction (no tx → throws)', async () => {
      await expect(
        svc.getNextInvoiceNumber('t-1', undefined as any),
      ).rejects.toThrow(/transaction/i);
    });

    it('atomically increments and returns the CURRENT number, zero-padded with prefix', async () => {
      const tx = txClient();
      // existing row, then post-increment re-read shows nextInvoiceNumber=43
      tx.accountingSettings.findFirst.mockResolvedValue({
        tenantId: 't-1',
        branchId: null,
        invoicePrefix: 'INV',
        nextInvoiceNumber: 42,
      });
      tx.accountingSettings.updateMany.mockResolvedValue({ count: 1 });
      tx.accountingSettings.findFirstOrThrow.mockResolvedValue({
        tenantId: 't-1',
        branchId: null,
        invoicePrefix: 'INV',
        nextInvoiceNumber: 43,
      });

      const num = await svc.getNextInvoiceNumber('t-1', tx);

      // increment must be atomic on the row, scoped tenant-wide
      const incData = tx.accountingSettings.updateMany.mock.calls[0][0].data;
      expect(incData.nextInvoiceNumber).toEqual({ increment: 1 });
      const incWhere = tx.accountingSettings.updateMany.mock.calls[0][0].where;
      expect(incWhere.tenantId).toBe('t-1');
      expect(incWhere.branchId).toBeNull();
      // current number = nextInvoiceNumber(43) - 1 = 42, padded to 6 digits
      expect(num).toBe('INV-000042');
    });

    it('falls back to the default FTR prefix when none is configured', async () => {
      const tx = txClient();
      tx.accountingSettings.findFirst.mockResolvedValue({
        tenantId: 't-1',
        branchId: null,
        invoicePrefix: null,
        nextInvoiceNumber: 2,
      });
      tx.accountingSettings.updateMany.mockResolvedValue({ count: 1 });
      tx.accountingSettings.findFirstOrThrow.mockResolvedValue({
        tenantId: 't-1',
        branchId: null,
        invoicePrefix: null,
        nextInvoiceNumber: 2,
      });

      const num = await svc.getNextInvoiceNumber('t-1', tx);
      expect(num).toBe('FTR-000001');
    });

    it('seeds the row at nextInvoiceNumber=2 and returns 000001 when none exists', async () => {
      const tx = txClient();
      tx.accountingSettings.findFirst.mockResolvedValue(null);
      tx.accountingSettings.create.mockResolvedValue({
        tenantId: 't-1',
        branchId: null,
        invoicePrefix: 'FTR',
        nextInvoiceNumber: 2,
      });

      const num = await svc.getNextInvoiceNumber('t-1', tx);
      const created = tx.accountingSettings.create.mock.calls[0][0].data;
      expect(created.nextInvoiceNumber).toBe(2);
      expect(num).toBe('FTR-000001');
    });
  });

  describe('getSyncStatus', () => {
    it('reports real synced/failed/pending counts + provider flags for verification', async () => {
      (prisma.accountingSettings.findFirst as any).mockResolvedValue({
        id: 's-1',
        tenantId: 't-1',
        branchId: null,
        provider: 'PARASUT',
        autoGenerateInvoice: true,
        autoSync: true,
      });
      // total=10, synced=7, failed=2 → pending = 10 - 7 - 2 = 1
      (prisma.salesInvoice.count as any)
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(7)
        .mockResolvedValueOnce(2);
      (prisma.salesInvoice.findFirst as any).mockResolvedValue({
        syncedAt: new Date('2026-06-24T00:00:00Z'),
      });

      const out = await svc.getSyncStatus('t-1');

      expect(out).toMatchObject({
        provider: 'PARASUT',
        autoGenerateInvoice: true,
        autoSync: true,
        total: 10,
        synced: 7,
        failed: 2,
        pending: 1,
      });
      expect(out.lastSyncedAt).toEqual(new Date('2026-06-24T00:00:00Z'));
    });

    it('never returns a negative pending count when counts race', async () => {
      (prisma.accountingSettings.findFirst as any).mockResolvedValue({
        tenantId: 't-1',
        branchId: null,
        provider: 'NONE',
        autoGenerateInvoice: false,
        autoSync: false,
      });
      // synced + failed (8) momentarily exceeds total (5) under a race.
      (prisma.salesInvoice.count as any)
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(6)
        .mockResolvedValueOnce(2);
      (prisma.salesInvoice.findFirst as any).mockResolvedValue(null);

      const out = await svc.getSyncStatus('t-1');
      expect(out.pending).toBe(0);
      expect(out.lastSyncedAt).toBeNull();
    });
  });
});
