import {
  mockPrismaClient,
  MockPrismaClient,
} from '../../../common/test/prisma-mock.service';
import { AccountingSyncService } from './accounting-sync.service';
import { AccountingProvider } from '../constants/accounting.enum';

/**
 * Behavioural tests for the external-accounting sync path. The DB is mocked
 * and the real e-invoice adapters (Parasut/Logo/Foriba) make HTTP calls, so
 * we stub `getAdapter` to return a fake adapter — the value under test is the
 * SERVICE's dedupe / claim / state-machine logic, not the wire format.
 *
 * The audit flagged "external sync has no idempotency key". This sync path
 * does NOT pass an idempotency key to the remote; instead it relies on a
 * local "claim" (an atomic updateMany that flips externalStatus → SYNCING)
 * to serialize concurrent pushes. These specs LOCK that dedupe contract:
 *
 *   - a row already mid-flight / SYNCED is NOT pushed again (claim count 0)
 *   - only null / FAILED / PENDING rows are claimable
 *   - the same-provider externalId short-circuit skips already-synced rows
 *   - a provider swap REOPENS sync (old externalId is a stale FK)
 *   - on push failure the row is recorded FAILED + syncError (claimable again)
 *   - all writes carry tenantId (cross-tenant defence-in-depth)
 */
describe('AccountingSyncService.syncInvoice', () => {
  let prisma: MockPrismaClient;
  let settings: { findByTenant: jest.Mock; getDecryptedCredentials: jest.Mock };
  let svc: AccountingSyncService;

  const TENANT = 't-1';
  const INVOICE_ID = 'inv-1';

  const baseInvoice = {
    id: INVOICE_ID,
    tenantId: TENANT,
    invoiceNumber: 'FTR-000001',
    issueDate: new Date('2026-01-15T00:00:00.000Z'),
    dueDate: new Date('2026-02-15T00:00:00.000Z'),
    customerName: 'Acme',
    customerTaxId: '1234567890',
    customerTaxOffice: 'Kadikoy',
    currency: 'TRY',
    paymentMethod: 'CARD',
    totalAmount: 120,
    externalId: null,
    externalProvider: null,
    externalStatus: null,
    items: [
      { description: 'Burger', quantity: 2, unitPrice: 50, taxRate: 10 },
    ],
  };

  const foribaSettings = {
    provider: AccountingProvider.FORIBA,
    foribaApiUrl: 'https://foriba.test',
    foribaUsername: 'u',
    foribaPassword: 'p',
  };

  function fakeAdapter() {
    return {
      name: 'foriba',
      authenticate: jest
        .fn()
        .mockResolvedValue({ accessToken: 'tok', expiresAt: undefined }),
      pushInvoice: jest.fn().mockResolvedValue({ externalId: 'EXT-999' }),
      testConnection: jest.fn().mockResolvedValue(true),
    };
  }

  beforeEach(() => {
    prisma = mockPrismaClient();
    settings = {
      findByTenant: jest.fn(),
      // Default null → callers fall through to the findByTenant value (which
      // in tests is already plaintext). Individual tests override to assert
      // the decrypted creds are what reach the adapter.
      getDecryptedCredentials: jest.fn().mockResolvedValue(null),
    };
    svc = new AccountingSyncService(prisma as any, settings as any, { name: "MOCK", isRegisteredEFaturaUser: async () => false } as any, { name: "MOCK", isConfigured: () => true, sign: async (x: string) => x } as any);
  });

  it('is a no-op when the tenant has no accounting provider configured', async () => {
    settings.findByTenant.mockResolvedValue({
      provider: AccountingProvider.NONE,
    });

    await svc.syncInvoice(INVOICE_ID, TENANT);

    expect(prisma.salesInvoice.findFirst).not.toHaveBeenCalled();
    expect(prisma.salesInvoice.updateMany).not.toHaveBeenCalled();
  });

  it('scopes the invoice lookup by tenantId and returns quietly if missing', async () => {
    settings.findByTenant.mockResolvedValue(foribaSettings);
    (prisma.salesInvoice.findFirst as any).mockResolvedValue(null);

    await svc.syncInvoice(INVOICE_ID, TENANT);

    const where = (prisma.salesInvoice.findFirst as any).mock.calls[0][0].where;
    expect(where.id).toBe(INVOICE_ID);
    expect(where.tenantId).toBe(TENANT);
    expect(prisma.salesInvoice.updateMany).not.toHaveBeenCalled();
  });

  it('SKIPS re-sync when already synced to the SAME provider (dedupe)', async () => {
    settings.findByTenant.mockResolvedValue(foribaSettings);
    (prisma.salesInvoice.findFirst as any).mockResolvedValue({
      ...baseInvoice,
      externalId: 'EXT-OLD',
      externalProvider: AccountingProvider.FORIBA,
    });
    const adapterSpy = jest.spyOn(svc as any, 'getAdapter');

    await svc.syncInvoice(INVOICE_ID, TENANT);

    // No claim, no push: it short-circuits before touching the DB/adapter.
    expect(prisma.salesInvoice.updateMany).not.toHaveBeenCalled();
    expect(adapterSpy).not.toHaveBeenCalled();
  });

  it('RE-OPENS sync after a provider swap (stale externalId is a foreign FK)', async () => {
    settings.findByTenant.mockResolvedValue(foribaSettings);
    (prisma.salesInvoice.findFirst as any).mockResolvedValue({
      ...baseInvoice,
      externalId: 'PARASUT-123',
      externalProvider: AccountingProvider.PARASUT, // different from current FORIBA
    });
    (prisma.salesInvoice.updateMany as any).mockResolvedValue({ count: 1 });
    const adapter = fakeAdapter();
    jest.spyOn(svc as any, 'getAdapter').mockReturnValue(adapter);

    await svc.syncInvoice(INVOICE_ID, TENANT);

    expect(adapter.pushInvoice).toHaveBeenCalled();
  });

  it('authenticates with the DECRYPTED secret, never the stored v1: blob (M14 regression)', async () => {
    // findByTenant returns the encrypted blob; getDecryptedCredentials returns
    // the plaintext. The adapter MUST receive the plaintext or every push fails.
    settings.findByTenant.mockResolvedValue({
      ...foribaSettings,
      foribaPassword: 'v1:nonce:tag:ciphertext',
    });
    settings.getDecryptedCredentials.mockResolvedValue({
      ...foribaSettings,
      foribaPassword: 'real-plaintext-pass',
    });
    (prisma.salesInvoice.findFirst as any).mockResolvedValue({ ...baseInvoice });
    (prisma.salesInvoice.updateMany as any).mockResolvedValue({ count: 1 });
    const adapter = fakeAdapter();
    jest.spyOn(svc as any, 'getAdapter').mockReturnValue(adapter);

    await svc.syncInvoice(INVOICE_ID, TENANT);

    expect(settings.getDecryptedCredentials).toHaveBeenCalledWith(TENANT);
    const creds = adapter.authenticate.mock.calls[0][0];
    expect(creds.password).toBe('real-plaintext-pass');
    expect(creds.password).not.toMatch(/^v1:/);
    expect(adapter.pushInvoice).toHaveBeenCalled();
  });

  it('claims only null/FAILED/PENDING rows and aborts when the claim loses the race (count 0)', async () => {
    settings.findByTenant.mockResolvedValue(foribaSettings);
    (prisma.salesInvoice.findFirst as any).mockResolvedValue({ ...baseInvoice });
    // Another worker already owns it → claim transitions zero rows.
    (prisma.salesInvoice.updateMany as any).mockResolvedValue({ count: 0 });
    const adapter = fakeAdapter();
    jest.spyOn(svc as any, 'getAdapter').mockReturnValue(adapter);

    await svc.syncInvoice(INVOICE_ID, TENANT);

    // The claim where-clause only targets reclaimable states, never SYNCING.
    const claimWhere = (prisma.salesInvoice.updateMany as any).mock.calls[0][0]
      .where;
    expect(claimWhere.tenantId).toBe(TENANT);
    expect(claimWhere.externalStatus.in).toEqual(
      expect.arrayContaining([null, 'FAILED', 'PENDING']),
    );
    expect(claimWhere.externalStatus.in).not.toContain('SYNCING');
    expect(claimWhere.externalStatus.in).not.toContain('SYNCED');
    // The claim flips to SYNCING (the serializing marker) and clears errors.
    const claimData = (prisma.salesInvoice.updateMany as any).mock.calls[0][0]
      .data;
    expect(claimData.externalStatus).toBe('SYNCING');
    expect(claimData.syncError).toBeNull();
    // Lost the race → no push.
    expect(adapter.pushInvoice).not.toHaveBeenCalled();
    // Only the claim ran; no SYNCED write.
    expect((prisma.salesInvoice.updateMany as any).mock.calls.length).toBe(1);
  });

  it('on a successful push records externalId + provider + SYNCED, scoped to tenant', async () => {
    settings.findByTenant.mockResolvedValue(foribaSettings);
    (prisma.salesInvoice.findFirst as any).mockResolvedValue({ ...baseInvoice });
    (prisma.salesInvoice.updateMany as any).mockResolvedValue({ count: 1 });
    const adapter = fakeAdapter();
    jest.spyOn(svc as any, 'getAdapter').mockReturnValue(adapter);

    await svc.syncInvoice(INVOICE_ID, TENANT);

    // The invoice payload handed to the adapter is mapped from the row.
    const pushedData = adapter.pushInvoice.mock.calls[0][2];
    expect(pushedData.invoiceNumber).toBe('FTR-000001');
    expect(pushedData.issueDate).toBe('2026-01-15'); // ISO date-only
    expect(pushedData.totalAmount).toBe(120);
    expect(pushedData.items).toHaveLength(1);

    // Second updateMany is the success write.
    const successCall = (prisma.salesInvoice.updateMany as any).mock.calls[1][0];
    expect(successCall.where.tenantId).toBe(TENANT);
    expect(successCall.data.externalId).toBe('EXT-999');
    expect(successCall.data.externalProvider).toBe(AccountingProvider.FORIBA);
    expect(successCall.data.externalStatus).toBe('SYNCED');
    expect(successCall.data.syncedAt).toBeInstanceOf(Date);
  });

  it('carries the snapshotted seller identity into the provider payload (fake-working sweep #3)', async () => {
    settings.findByTenant.mockResolvedValue(foribaSettings);
    (prisma.salesInvoice.findFirst as any).mockResolvedValue({
      ...baseInvoice,
      sellerName: 'Lezzet Lokantası A.Ş.',
      sellerTaxId: '1234567890',
      sellerTaxOffice: 'Kadıköy',
      sellerAddress: 'Bağdat Cad. No:1',
      sellerPhone: '+902161234567',
      sellerEmail: 'fatura@lezzet.example',
    });
    (prisma.salesInvoice.updateMany as any).mockResolvedValue({ count: 1 });
    const adapter = fakeAdapter();
    jest.spyOn(svc as any, 'getAdapter').mockReturnValue(adapter);

    await svc.syncInvoice(INVOICE_ID, TENANT);

    const pushed = adapter.pushInvoice.mock.calls[0][2];
    expect(pushed.sellerName).toBe('Lezzet Lokantası A.Ş.');
    expect(pushed.sellerTaxId).toBe('1234567890');
    expect(pushed.sellerTaxOffice).toBe('Kadıköy');
    expect(pushed.sellerAddress).toBe('Bağdat Cad. No:1');
    expect(pushed.sellerPhone).toBe('+902161234567');
    expect(pushed.sellerEmail).toBe('fatura@lezzet.example');
  });

  it('falls back to current Company Info for legacy rows with no seller snapshot', async () => {
    // Legacy invoice row written before the seller columns existed (all
    // seller* null) — sync should backfill from the tenant's current
    // Company Info so the document still carries a supplier party.
    settings.findByTenant.mockResolvedValue({
      ...foribaSettings,
      companyName: 'Eski Firma Ltd.',
      companyTaxId: '9876543210',
    });
    (prisma.salesInvoice.findFirst as any).mockResolvedValue({
      ...baseInvoice,
      sellerName: null,
      sellerTaxId: null,
    });
    (prisma.salesInvoice.updateMany as any).mockResolvedValue({ count: 1 });
    const adapter = fakeAdapter();
    jest.spyOn(svc as any, 'getAdapter').mockReturnValue(adapter);

    await svc.syncInvoice(INVOICE_ID, TENANT);

    const pushed = adapter.pushInvoice.mock.calls[0][2];
    expect(pushed.sellerName).toBe('Eski Firma Ltd.');
    expect(pushed.sellerTaxId).toBe('9876543210');
  });

  it('records FAILED + syncError (so the row is reclaimable) when the adapter throws', async () => {
    settings.findByTenant.mockResolvedValue(foribaSettings);
    (prisma.salesInvoice.findFirst as any).mockResolvedValue({ ...baseInvoice });
    (prisma.salesInvoice.updateMany as any).mockResolvedValue({ count: 1 });
    const adapter = fakeAdapter();
    adapter.pushInvoice.mockRejectedValue(new Error('foriba 503'));
    jest.spyOn(svc as any, 'getAdapter').mockReturnValue(adapter);

    await svc.syncInvoice(INVOICE_ID, TENANT); // must not throw

    const failCall = (prisma.salesInvoice.updateMany as any).mock.calls[1][0];
    expect(failCall.where.tenantId).toBe(TENANT);
    expect(failCall.data.externalStatus).toBe('FAILED');
    expect(failCall.data.syncError).toBe('foriba 503');
  });

  it('does NOT flip to FAILED when the push SUCCEEDED but the local SYNCED write fails (avoids a duplicate e-fatura)', async () => {
    settings.findByTenant.mockResolvedValue(foribaSettings);
    (prisma.salesInvoice.findFirst as any).mockResolvedValue({ ...baseInvoice });
    // 1st updateMany = the claim (→ SYNCING) succeeds; 2nd = the post-push
    // SYNCED write fails (DB hiccup). The remote provider already holds the
    // invoice, so a FAILED (reclaimable) status would let a retry duplicate it.
    (prisma.salesInvoice.updateMany as any)
      .mockResolvedValueOnce({ count: 1 })
      .mockRejectedValueOnce(new Error('db hiccup'));
    const adapter = fakeAdapter(); // pushInvoice resolves { externalId: 'EXT-999' }
    jest.spyOn(svc as any, 'getAdapter').mockReturnValue(adapter);

    await svc.syncInvoice(INVOICE_ID, TENANT); // must not throw

    // Pushed exactly once, and NO write ever flips the row to FAILED — it
    // stays in its SYNCING marker state for manual/reconcile recovery.
    expect(adapter.pushInvoice).toHaveBeenCalledTimes(1);
    expect(prisma.salesInvoice.updateMany as any).toHaveBeenCalledTimes(2);
    const anyFailedWrite = (
      prisma.salesInvoice.updateMany as any
    ).mock.calls.some((c: any[]) => c[0]?.data?.externalStatus === 'FAILED');
    expect(anyFailedWrite).toBe(false);
  });

  it('aborts after claiming when no adapter resolves for the provider', async () => {
    settings.findByTenant.mockResolvedValue(foribaSettings);
    (prisma.salesInvoice.findFirst as any).mockResolvedValue({ ...baseInvoice });
    (prisma.salesInvoice.updateMany as any).mockResolvedValue({ count: 1 });
    jest.spyOn(svc as any, 'getAdapter').mockReturnValue(null);

    await svc.syncInvoice(INVOICE_ID, TENANT);

    // Only the claim happened; no success/fail write.
    expect((prisma.salesInvoice.updateMany as any).mock.calls.length).toBe(1);
  });

  it('caches the auth token per tenant+adapter so a second sync does not re-authenticate', async () => {
    settings.findByTenant.mockResolvedValue(foribaSettings);
    (prisma.salesInvoice.findFirst as any).mockResolvedValue({ ...baseInvoice });
    (prisma.salesInvoice.updateMany as any).mockResolvedValue({ count: 1 });
    const adapter = fakeAdapter();
    adapter.authenticate.mockResolvedValue({
      accessToken: 'tok',
      expiresAt: new Date(Date.now() + 3_600_000), // valid 1h
    });
    jest.spyOn(svc as any, 'getAdapter').mockReturnValue(adapter);

    await svc.syncInvoice(INVOICE_ID, TENANT);
    await svc.syncInvoice('inv-2', TENANT);

    expect(adapter.pushInvoice).toHaveBeenCalledTimes(2);
    expect(adapter.authenticate).toHaveBeenCalledTimes(1); // cached on 2nd run
  });
});

describe('AccountingSyncService.testConnection', () => {
  let prisma: MockPrismaClient;
  let settings: { findByTenant: jest.Mock; getDecryptedCredentials: jest.Mock };
  let svc: AccountingSyncService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    settings = {
      findByTenant: jest.fn(),
      // Default null → callers fall through to the findByTenant value (which
      // in tests is already plaintext). Individual tests override to assert
      // the decrypted creds are what reach the adapter.
      getDecryptedCredentials: jest.fn().mockResolvedValue(null),
    };
    svc = new AccountingSyncService(prisma as any, settings as any, { name: "MOCK", isRegisteredEFaturaUser: async () => false } as any, { name: "MOCK", isConfigured: () => true, sign: async (x: string) => x } as any);
  });

  it('returns a clean failure when no provider is configured', async () => {
    settings.findByTenant.mockResolvedValue({
      provider: AccountingProvider.NONE,
    });
    const out = await svc.testConnection('t-1');
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/no provider/i);
  });

  it('maps an adapter exception into { success:false, error } instead of throwing', async () => {
    settings.findByTenant.mockResolvedValue({
      provider: AccountingProvider.FORIBA,
      foribaUsername: 'u',
      foribaPassword: 'p',
    });
    const adapter = {
      name: 'foriba',
      testConnection: jest.fn().mockRejectedValue(new Error('bad creds')),
    };
    jest.spyOn(svc as any, 'getAdapter').mockReturnValue(adapter);

    const out = await svc.testConnection('t-1');
    expect(out).toEqual({ success: false, error: 'bad creds' });
  });

  it('passes provider-specific credentials to the adapter and returns its boolean', async () => {
    settings.findByTenant.mockResolvedValue({
      provider: AccountingProvider.FORIBA,
      foribaApiUrl: 'https://foriba.test',
      foribaUsername: 'fuser',
      foribaPassword: 'fpass',
    });
    const adapter = {
      name: 'foriba',
      testConnection: jest.fn().mockResolvedValue(true),
    };
    jest.spyOn(svc as any, 'getAdapter').mockReturnValue(adapter);

    const out = await svc.testConnection('t-1');
    expect(out.success).toBe(true);
    const creds = adapter.testConnection.mock.calls[0][0];
    expect(creds).toEqual({
      apiUrl: 'https://foriba.test',
      username: 'fuser',
      password: 'fpass',
    });
  });

  it('decrypts the stored secret before testing — the adapter must NOT receive the v1: blob', async () => {
    // findByTenant would return the encrypted blob; getDecryptedCredentials
    // returns the plaintext. testConnection must use the plaintext.
    settings.findByTenant.mockResolvedValue({
      provider: AccountingProvider.FORIBA,
      foribaApiUrl: 'https://foriba.test',
      foribaUsername: 'fuser',
      foribaPassword: 'v1:nonce:tag:ciphertext',
    });
    settings.getDecryptedCredentials.mockResolvedValue({
      provider: AccountingProvider.FORIBA,
      foribaApiUrl: 'https://foriba.test',
      foribaUsername: 'fuser',
      foribaPassword: 'real-plaintext-pass',
    });
    const adapter = {
      name: 'foriba',
      testConnection: jest.fn().mockResolvedValue(true),
    };
    jest.spyOn(svc as any, 'getAdapter').mockReturnValue(adapter);

    await svc.testConnection('t-1');

    const creds = adapter.testConnection.mock.calls[0][0];
    expect(creds.password).toBe('real-plaintext-pass');
    expect(creds.password).not.toMatch(/^v1:/);
  });
});

describe('AccountingSyncService — e-document readiness + FAILED re-sync', () => {
  const mukellef: any = { name: 'MOCK', isRegisteredEFaturaUser: async () => true };
  const signer: any = { name: 'MOCK', isConfigured: () => true, sign: async (x: string) => x };

  it('reports external-provisioning readiness', () => {
    const prisma: any = { salesInvoice: {} };
    const svc = new AccountingSyncService(prisma, {} as any, mukellef, signer);
    expect(svc.eDocumentReadiness()).toEqual({
      mukellefQuery: 'MOCK',
      signer: 'MOCK',
      signerConfigured: true,
    });
  });

  it('retries every FAILED invoice and counts the successes', async () => {
    const prisma: any = {
      salesInvoice: { findMany: jest.fn().mockResolvedValue([{ id: 'i1' }, { id: 'i2' }]) },
    };
    const svc = new AccountingSyncService(prisma, {} as any, mukellef, signer);
    const syncSpy = jest.spyOn(svc, 'syncInvoice').mockResolvedValue(undefined as any);

    const retried = await svc.resyncFailedInvoices('t1');
    expect(retried).toBe(2);
    expect(syncSpy).toHaveBeenCalledTimes(2);
    // only FAILED invoices queried
    expect(prisma.salesInvoice.findMany.mock.calls[0][0].where.externalStatus).toBe('FAILED');
  });

  it('keeps going when one invoice re-sync throws', async () => {
    const prisma: any = {
      salesInvoice: { findMany: jest.fn().mockResolvedValue([{ id: 'i1' }, { id: 'i2' }]) },
    };
    const svc = new AccountingSyncService(prisma, {} as any, mukellef, signer);
    jest.spyOn(svc, 'syncInvoice')
      .mockRejectedValueOnce(new Error('still failing'))
      .mockResolvedValueOnce(undefined as any);

    const retried = await svc.resyncFailedInvoices('t1');
    expect(retried).toBe(1); // one succeeded, one threw
  });
});
