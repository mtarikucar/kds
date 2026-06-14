import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { IntegrationsService } from './integrations.service';
import {
  mockPrismaClient,
  MockPrismaClient,
} from '../../../common/test/prisma-mock.service';
import {
  decryptJson,
  encryptJson,
  isEncryptedPayload,
} from '../../../common/helpers/encryption.helper';
import { IntegrationType } from './dto/create-integration.dto';

/**
 * Behaviour locks for IntegrationsService (security-critical credential
 * store):
 *
 *  - Encryption at rest: SENSITIVE integration types (PAYMENT_GATEWAY,
 *    THIRD_PARTY_API, DELIVERY_APP, ACCOUNTING, CRM) persist `config` as an
 *    AES-GCM envelope, NOT plaintext; the round-trip decrypts to the
 *    original. Hardware/POS types store plain JSON.
 *  - Redaction: client-facing reads (findAll/findByType/findOne and the
 *    return of create/update/toggle) replace api-key/secret/token/password
 *    fields with ***REDACTED*** for sensitive types — never the raw value.
 *  - Internal decrypt path: findOneWithSecrets returns the real plaintext
 *    credentials (adapter boundary).
 *  - Tenant scoping: every read/write carries tenantId in the WHERE, and
 *    mutating ops use a defence-in-depth updateMany/deleteMany {id, tenantId}
 *    that throws NotFound on a 0-row claim (cross-tenant write protection).
 *  - Conflict: duplicate (type, provider) create surfaces ConflictException.
 *  - updateDeviceStatus refuses to write into a sensitive credentials blob.
 */
describe('IntegrationsService', () => {
  let prisma: MockPrismaClient;
  let svc: IntegrationsService;

  const TENANT = 't-1';
  const OTHER = 't-other';

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
    svc = new IntegrationsService(prisma as any);
  });

  // ----------------------------------------------------------------
  // Encryption at rest
  // ----------------------------------------------------------------

  it('create encrypts the config of a sensitive integration before persisting', async () => {
    (prisma.integrationSettings.findFirst as any).mockResolvedValue(null); // no dup
    let stored: any = null;
    (prisma.integrationSettings.create as any).mockImplementation(
      async ({ data }: any) => {
        stored = data;
        return { id: 'int-1', tenantId: TENANT, ...data };
      },
    );

    await svc.create(TENANT, {
      integrationType: IntegrationType.PAYMENT_GATEWAY,
      provider: 'stripe',
      name: 'Stripe',
      config: { apiKey: 'sk_live_secret', publicId: 'pk_123' },
    } as any);

    // On disk it must be an AES-GCM envelope, NOT plaintext.
    expect(isEncryptedPayload(stored.config)).toBe(true);
    expect(JSON.stringify(stored.config)).not.toContain('sk_live_secret');
    // ...and it round-trips back to the original plaintext.
    expect(decryptJson(stored.config)).toEqual({
      apiKey: 'sk_live_secret',
      publicId: 'pk_123',
    });
  });

  it('create stores hardware config as plain JSON (non-sensitive type)', async () => {
    (prisma.integrationSettings.findFirst as any).mockResolvedValue(null);
    let stored: any = null;
    (prisma.integrationSettings.create as any).mockImplementation(
      async ({ data }: any) => {
        stored = data;
        return { id: 'int-2', tenantId: TENANT, ...data };
      },
    );

    await svc.create(TENANT, {
      integrationType: IntegrationType.POS_HARDWARE,
      provider: 'epson',
      name: 'Printer',
      config: { connection_type: 'Serial', port: 'COM3' },
    } as any);

    expect(isEncryptedPayload(stored.config)).toBe(false);
    expect(stored.config).toEqual({ connection_type: 'Serial', port: 'COM3' });
  });

  // ----------------------------------------------------------------
  // Redaction on client-facing reads
  // ----------------------------------------------------------------

  it('findOne redacts sensitive keys for a sensitive integration', async () => {
    (prisma.integrationSettings.findFirst as any).mockResolvedValue({
      id: 'int-1',
      tenantId: TENANT,
      integrationType: 'PAYMENT_GATEWAY',
      provider: 'stripe',
      // Stored encrypted on disk — simulate the at-rest shape.
      config: encryptJson({
        apiKey: 'sk_live_secret',
        webhookSecret: 'whsec_x',
        publicId: 'pk_visible',
      }),
    });

    const out = await svc.findOne('int-1', TENANT);

    expect(out.config.apiKey).toBe('***REDACTED***');
    expect(out.config.webhookSecret).toBe('***REDACTED***');
    // Non-sensitive keys survive.
    expect(out.config.publicId).toBe('pk_visible');
    // The raw secret never leaks anywhere in the response.
    expect(JSON.stringify(out)).not.toContain('sk_live_secret');
  });

  it('findAll redacts every sensitive row and is tenant-scoped', async () => {
    (prisma.integrationSettings.findMany as any).mockResolvedValue([
      {
        id: 'int-1',
        tenantId: TENANT,
        integrationType: 'CRM',
        provider: 'hubspot',
        config: encryptJson(
          { token: 'tok_secret' },
        ),
      },
    ]);

    const out = await svc.findAll(TENANT);

    const where = (prisma.integrationSettings.findMany as any).mock.calls[0][0]
      .where;
    expect(where.tenantId).toBe(TENANT);
    expect(out[0].config.token).toBe('***REDACTED***');
    expect(JSON.stringify(out)).not.toContain('tok_secret');
  });

  it('findOneWithSecrets returns DECRYPTED plaintext credentials (adapter boundary)', async () => {
    (prisma.integrationSettings.findFirst as any).mockResolvedValue({
      id: 'int-1',
      tenantId: TENANT,
      integrationType: 'PAYMENT_GATEWAY',
      provider: 'stripe',
      config: encryptJson({
        apiKey: 'sk_live_secret',
      }),
    });

    const out = await svc.findOneWithSecrets('int-1', TENANT);

    // Internal callers must get the real key, not the redaction marker.
    expect(out.config.apiKey).toBe('sk_live_secret');
  });

  it('toPublicView returns hardware config verbatim (no redaction)', async () => {
    (prisma.integrationSettings.findFirst as any).mockResolvedValue({
      id: 'int-2',
      tenantId: TENANT,
      integrationType: 'THERMAL_PRINTER',
      provider: 'epson',
      config: { connection_type: 'Serial', secret: 'not-actually-encrypted' },
    });

    const out = await svc.findOne('int-2', TENANT);
    // Hardware rows are not in SENSITIVE set → returned as-is, not redacted.
    expect(out.config.connection_type).toBe('Serial');
    expect(out.config.secret).toBe('not-actually-encrypted');
  });

  // ----------------------------------------------------------------
  // Tenant scoping on reads / writes
  // ----------------------------------------------------------------

  it('findOne scopes the lookup by id + tenantId and throws NotFound on miss', async () => {
    (prisma.integrationSettings.findFirst as any).mockResolvedValue(null);

    await expect(svc.findOne('int-x', TENANT)).rejects.toThrow(
      NotFoundException,
    );
    const where = (prisma.integrationSettings.findFirst as any).mock.calls[0][0]
      .where;
    expect(where.id).toBe('int-x');
    expect(where.tenantId).toBe(TENANT);
  });

  it('findByType scopes by tenantId + integrationType', async () => {
    (prisma.integrationSettings.findMany as any).mockResolvedValue([]);

    await svc.findByType(TENANT, 'DELIVERY_APP');

    const where = (prisma.integrationSettings.findMany as any).mock.calls[0][0]
      .where;
    expect(where.tenantId).toBe(TENANT);
    expect(where.integrationType).toBe('DELIVERY_APP');
  });

  it('update proves ownership then claims with a compound {id, tenantId} updateMany', async () => {
    (prisma.integrationSettings.findFirst as any).mockResolvedValue({
      id: 'int-1',
      tenantId: TENANT,
      integrationType: 'POS_HARDWARE',
      provider: 'epson',
      config: {},
    });
    (prisma.integrationSettings.updateMany as any).mockResolvedValue({
      count: 1,
    });
    (prisma.integrationSettings.findFirstOrThrow as any).mockResolvedValue({
      id: 'int-1',
      tenantId: TENANT,
      integrationType: 'POS_HARDWARE',
      provider: 'epson',
      config: { name: 'new' },
    });

    await svc.update('int-1', TENANT, { name: 'new' } as any);

    const claimWhere = (prisma.integrationSettings.updateMany as any).mock
      .calls[0][0].where;
    expect(claimWhere.id).toBe('int-1');
    expect(claimWhere.tenantId).toBe(TENANT);
  });

  it('update encrypts an incoming config when the integration type is sensitive', async () => {
    (prisma.integrationSettings.findFirst as any).mockResolvedValue({
      id: 'int-1',
      tenantId: TENANT,
      integrationType: 'PAYMENT_GATEWAY',
      provider: 'stripe',
      config: {},
    });
    let claimData: any = null;
    (prisma.integrationSettings.updateMany as any).mockImplementation(
      async ({ data }: any) => {
        claimData = data;
        return { count: 1 };
      },
    );
    (prisma.integrationSettings.findFirstOrThrow as any).mockResolvedValue({
      id: 'int-1',
      tenantId: TENANT,
      integrationType: 'PAYMENT_GATEWAY',
      provider: 'stripe',
      config: claimData?.config,
    });

    await svc.update('int-1', TENANT, {
      config: { apiKey: 'sk_rotated' },
    } as any);

    expect(isEncryptedPayload(claimData.config)).toBe(true);
    expect(decryptJson(claimData.config)).toEqual({ apiKey: 'sk_rotated' });
  });

  it('update throws NotFound for a cross-tenant id (ownership findFirst miss)', async () => {
    (prisma.integrationSettings.findFirst as any).mockResolvedValue(null);

    await expect(
      svc.update('int-1', OTHER, { name: 'x' } as any),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.integrationSettings.updateMany).not.toHaveBeenCalled();
  });

  it('delete scopes by {id, tenantId} and throws NotFound when nothing was deleted', async () => {
    (prisma.integrationSettings.deleteMany as any).mockResolvedValue({
      count: 0,
    });

    await expect(svc.delete('int-1', TENANT)).rejects.toThrow(
      NotFoundException,
    );
    const where = (prisma.integrationSettings.deleteMany as any).mock.calls[0][0]
      .where;
    expect(where.id).toBe('int-1');
    expect(where.tenantId).toBe(TENANT);
  });

  it('delete returns the deleted marker on a 1-row claim', async () => {
    (prisma.integrationSettings.deleteMany as any).mockResolvedValue({
      count: 1,
    });
    await expect(svc.delete('int-1', TENANT)).resolves.toEqual({
      id: 'int-1',
      deleted: true,
    });
  });

  // ----------------------------------------------------------------
  // Conflict
  // ----------------------------------------------------------------

  it('create throws Conflict when a (type, provider) integration already exists', async () => {
    (prisma.integrationSettings.findFirst as any).mockResolvedValue({
      id: 'existing',
      tenantId: TENANT,
    });

    await expect(
      svc.create(TENANT, {
        integrationType: IntegrationType.PAYMENT_GATEWAY,
        provider: 'stripe',
        name: 'Stripe',
        config: {},
      } as any),
    ).rejects.toThrow(ConflictException);
    expect(prisma.integrationSettings.create).not.toHaveBeenCalled();
    // Dup check is tenant-scoped.
    const where = (prisma.integrationSettings.findFirst as any).mock.calls[0][0]
      .where;
    expect(where.tenantId).toBe(TENANT);
    expect(where.provider).toBe('stripe');
  });

  // ----------------------------------------------------------------
  // toggleStatus / enable-disable
  // ----------------------------------------------------------------

  it('toggleStatus claims {id, tenantId} with isEnabled and throws NotFound on 0-row', async () => {
    (prisma.integrationSettings.updateMany as any).mockResolvedValue({
      count: 0,
    });

    await expect(svc.toggleStatus('int-1', TENANT, true)).rejects.toThrow(
      NotFoundException,
    );
    const call = (prisma.integrationSettings.updateMany as any).mock.calls[0][0];
    expect(call.where.id).toBe('int-1');
    expect(call.where.tenantId).toBe(TENANT);
    expect(call.data.isEnabled).toBe(true);
  });

  it('toggleStatus returns the redacted public view on success', async () => {
    (prisma.integrationSettings.updateMany as any).mockResolvedValue({
      count: 1,
    });
    (prisma.integrationSettings.findFirst as any).mockResolvedValue({
      id: 'int-1',
      tenantId: TENANT,
      integrationType: 'PAYMENT_GATEWAY',
      provider: 'stripe',
      isEnabled: false,
      config: encryptJson({
        apiKey: 'sk_x',
      }),
    });

    const out = await svc.toggleStatus('int-1', TENANT, false);
    expect(out.config.apiKey).toBe('***REDACTED***');
  });

  // ----------------------------------------------------------------
  // updateDeviceStatus guard + hardware merge
  // ----------------------------------------------------------------

  it('updateDeviceStatus refuses to write into a sensitive credentials blob', async () => {
    (prisma.integrationSettings.findFirst as any).mockResolvedValue({
      id: 'int-1',
      tenantId: TENANT,
      integrationType: 'PAYMENT_GATEWAY',
      provider: 'stripe',
      config: {},
    });

    await expect(
      svc.updateDeviceStatus('int-1', TENANT, { hacked: 'key' }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.integrationSettings.updateMany).not.toHaveBeenCalled();
  });

  it('updateDeviceStatus merges status into a hardware config and stamps last_updated', async () => {
    (prisma.integrationSettings.findFirst as any).mockResolvedValue({
      id: 'int-2',
      tenantId: TENANT,
      integrationType: 'THERMAL_PRINTER',
      provider: 'epson',
      config: { connection_type: 'Serial' },
    });
    let claimData: any = null;
    (prisma.integrationSettings.updateMany as any).mockImplementation(
      async ({ data }: any) => {
        claimData = data;
        return { count: 1 };
      },
    );

    const out = await svc.updateDeviceStatus('int-2', TENANT, {
      paper: 'low',
    });

    expect(out).toEqual({ success: true });
    // Existing config preserved, status merged in.
    expect(claimData.config.connection_type).toBe('Serial');
    expect(claimData.config.device_status.paper).toBe('low');
    expect(claimData.config.device_status.last_updated).toBeInstanceOf(Date);
  });

  // ----------------------------------------------------------------
  // getHardwareConfig mapping
  // ----------------------------------------------------------------

  it('getHardwareConfig maps enabled hardware rows into the desktop device shape', async () => {
    (prisma.integrationSettings.findMany as any).mockResolvedValue([
      {
        id: 'dev-1',
        tenantId: TENANT,
        integrationType: 'THERMAL_PRINTER',
        provider: 'Front Printer',
        isEnabled: true,
        config: {
          auto_connect: false,
          connection_type: 'USB',
          connection_config: { vid: '0x1' },
          device_settings: { width: 80 },
        },
      },
    ]);

    const out = await svc.getHardwareConfig(TENANT);

    const where = (prisma.integrationSettings.findMany as any).mock.calls[0][0]
      .where;
    expect(where.tenantId).toBe(TENANT);
    expect(where.isEnabled).toBe(true);
    expect(where.integrationType.in).toContain('THERMAL_PRINTER');

    expect(out.devices[0]).toEqual({
      id: 'dev-1',
      name: 'Front Printer',
      device_type: 'THERMAL_PRINTER',
      enabled: true,
      auto_connect: false,
      connection: { connection_type: 'USB', config: { vid: '0x1' } },
      settings: { width: 80 },
    });
  });
});
