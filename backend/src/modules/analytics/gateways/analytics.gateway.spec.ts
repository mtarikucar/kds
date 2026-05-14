import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AnalyticsGateway } from './analytics.gateway';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  mockPrismaClient,
  MockPrismaClient,
} from '../../../common/test/prisma-mock.service';
import { encryptString } from '../../../common/helpers/encryption.helper';

describe('AnalyticsGateway', () => {
  let gateway: AnalyticsGateway;
  let prisma: MockPrismaClient;

  // CORS_ORIGIN must be set so the @WebSocketGateway decorator's corsOrigin()
  // helper doesn't throw in non-production. (See analytics.gateway.ts:15-23.)
  const originalCorsOrigin = process.env.CORS_ORIGIN;
  beforeAll(() => {
    process.env.CORS_ORIGIN = 'http://localhost:5173';
    // ENCRYPTION_MASTER_KEY must be set so encryptString/decryptString work.
    // The helper hashes any string ≥32 chars to a 32-byte AES-256 key, so a
    // simple hex string is fine for tests.
    process.env.ENCRYPTION_MASTER_KEY =
      process.env.ENCRYPTION_MASTER_KEY ||
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  });
  afterAll(() => {
    if (originalCorsOrigin === undefined) {
      delete process.env.CORS_ORIGIN;
    } else {
      process.env.CORS_ORIGIN = originalCorsOrigin;
    }
  });

  beforeEach(async () => {
    prisma = mockPrismaClient();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsGateway,
        {
          provide: JwtService,
          useValue: { verify: jest.fn(), sign: jest.fn() },
        },
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    gateway = module.get(AnalyticsGateway);
  });

  describe('getDeviceConfig (Bug C — decrypt streamUrl on WebSocket→edge path)', () => {
    it('returns the streamUrl decrypted, not the AES ciphertext', async () => {
      const plaintextRtspUrl =
        'rtsp://camerauser:supersecret@cam-01.local/stream1';
      const encrypted = encryptString(plaintextRtspUrl);

      prisma.camera.findFirst.mockResolvedValue({
        id: 'cam-1',
        streamUrl: encrypted,
        calibrationData: null,
      } as any);

      const config = await (gateway as any).getDeviceConfig(
        'cam-1',
        'tenant-1',
      );

      expect(config).not.toBeNull();
      expect(config.cameraId).toBe('cam-1');
      expect(config.cameraUrl).toBe(plaintextRtspUrl);
      // Sanity: ciphertext must differ from plaintext or the assertion above
      // could pass vacuously.
      expect(encrypted).not.toBe(plaintextRtspUrl);
    });

    it('returns an empty cameraUrl (not throwing) when streamUrl is null', async () => {
      prisma.camera.findFirst.mockResolvedValue({
        id: 'cam-2',
        streamUrl: null,
        calibrationData: null,
      } as any);

      const config = await (gateway as any).getDeviceConfig(
        'cam-2',
        'tenant-1',
      );

      expect(config).not.toBeNull();
      expect(config.cameraUrl).toBe('');
    });

    it('returns null when the camera does not exist for the tenant', async () => {
      prisma.camera.findFirst.mockResolvedValue(null);

      const config = await (gateway as any).getDeviceConfig(
        'missing',
        'tenant-1',
      );

      expect(config).toBeNull();
    });
  });
});
