import { IntegrationService } from './integration.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';

/**
 * The crypto helpers are the security-sensitive surface of this module —
 * a regression here would mean leaked tenant credentials. These tests pin
 * down per-tenant key derivation + AES-256-GCM round-trip.
 */
describe('IntegrationService crypto', () => {
  let prisma: MockPrismaClient;
  let outbox: { append: jest.Mock };
  let svc: IntegrationService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    outbox = { append: jest.fn().mockResolvedValue('outbox') };
    svc = new IntegrationService(prisma as any, outbox as any);
    process.env.INTEGRATION_KEY = 'test-key-1234';
  });

  it('encrypts and decrypts a payload back to itself', () => {
    // Access the private encrypt via the public path — decrypt is exposed.
    const enc = (svc as any).encrypt('tenant-1', 'super-secret-token');
    const dec = svc.decrypt('tenant-1', enc);
    expect(dec).toBe('super-secret-token');
  });

  it('uses a different ciphertext on every encryption (random IV)', () => {
    const a = (svc as any).encrypt('tenant-1', 'same');
    const b = (svc as any).encrypt('tenant-1', 'same');
    expect(Buffer.compare(a, b)).not.toBe(0);
  });

  it('refuses to decrypt with a different tenant key', () => {
    const enc = (svc as any).encrypt('tenant-1', 'super-secret-token');
    expect(() => svc.decrypt('tenant-2', enc)).toThrow();
  });

  it('refuses to decrypt when ciphertext has been tampered with', () => {
    const enc = (svc as any).encrypt('tenant-1', 'super-secret-token');
    // Flip a byte deep in the ciphertext (after iv+tag).
    enc[40] = enc[40] ^ 0x01;
    expect(() => svc.decrypt('tenant-1', enc)).toThrow();
  });
});
