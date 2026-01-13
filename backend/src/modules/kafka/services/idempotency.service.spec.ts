import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { IdempotencyService } from './idempotency.service';

// Mock ioredis
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    exists: jest.fn(),
    get: jest.fn(),
    setex: jest.fn(),
    del: jest.fn(),
    quit: jest.fn().mockResolvedValue('OK'),
    on: jest.fn(),
  }));
});

const Redis = require('ioredis');

describe('IdempotencyService', () => {
  let service: IdempotencyService;
  let redisMock: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    Redis.mockClear();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdempotencyService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              if (key === 'REDIS_URL') return 'redis://localhost:6379';
              return defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<IdempotencyService>(IdempotencyService);
    redisMock = Redis.mock.results[0].value;
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  describe('isDuplicate', () => {
    it('should return true when key exists in Redis', async () => {
      redisMock.exists.mockResolvedValue(1);

      const result = await service.isDuplicate('test-key');

      expect(result).toBe(true);
      expect(redisMock.exists).toHaveBeenCalledWith('kafka:idempotency:test-key');
    });

    it('should return false when key does not exist', async () => {
      redisMock.exists.mockResolvedValue(0);

      const result = await service.isDuplicate('test-key');

      expect(result).toBe(false);
    });

    it('should return false on Redis error (fail-open)', async () => {
      redisMock.exists.mockRejectedValue(new Error('Redis connection failed'));

      const result = await service.isDuplicate('test-key');

      expect(result).toBe(false);
    });
  });

  describe('markProcessed', () => {
    it('should store record with correct TTL', async () => {
      redisMock.setex.mockResolvedValue('OK');

      await service.markProcessed('test-key', { correlationId: 'corr-123' }, 3600);

      expect(redisMock.setex).toHaveBeenCalledWith(
        'kafka:idempotency:test-key',
        3600,
        expect.stringContaining('corr-123'),
      );
    });

    it('should use default TTL when not provided', async () => {
      redisMock.setex.mockResolvedValue('OK');

      await service.markProcessed('test-key', { correlationId: 'corr-123' });

      expect(redisMock.setex).toHaveBeenCalledWith(
        'kafka:idempotency:test-key',
        86400, // 24 hours in seconds
        expect.any(String),
      );
    });

    it('should not throw on Redis error', async () => {
      redisMock.setex.mockRejectedValue(new Error('Redis write failed'));

      await expect(
        service.markProcessed('test-key', { correlationId: 'corr-123' }),
      ).resolves.not.toThrow();
    });

    it('should store processedAt timestamp', async () => {
      redisMock.setex.mockResolvedValue('OK');

      await service.markProcessed('test-key', { correlationId: 'corr-123' });

      const storedData = JSON.parse(redisMock.setex.mock.calls[0][2]);
      expect(storedData.processedAt).toBeDefined();
    });
  });

  describe('getRecord', () => {
    it('should return parsed record when exists', async () => {
      const record = {
        processedAt: '2024-01-01T12:00:00.000Z',
        correlationId: 'corr-123',
        result: 'success',
      };
      redisMock.get.mockResolvedValue(JSON.stringify(record));

      const result = await service.getRecord('test-key');

      expect(result).toEqual(record);
    });

    it('should return null when not exists', async () => {
      redisMock.get.mockResolvedValue(null);

      const result = await service.getRecord('test-key');

      expect(result).toBeNull();
    });

    it('should return null on Redis error', async () => {
      redisMock.get.mockRejectedValue(new Error('Redis read failed'));

      const result = await service.getRecord('test-key');

      expect(result).toBeNull();
    });
  });

  describe('removeRecord', () => {
    it('should delete key from Redis', async () => {
      redisMock.del.mockResolvedValue(1);

      await service.removeRecord('test-key');

      expect(redisMock.del).toHaveBeenCalledWith('kafka:idempotency:test-key');
    });

    it('should not throw on Redis error', async () => {
      redisMock.del.mockRejectedValue(new Error('Redis delete failed'));

      await expect(service.removeRecord('test-key')).resolves.not.toThrow();
    });
  });

  describe('generateWebhookKey', () => {
    it('should generate key with all parts', () => {
      const key = service.generateWebhookKey(
        'tenant-1',
        'GETIR',
        'order-123',
        'ORDER_CREATED',
      );

      expect(key).toBe('tenant-1:GETIR:order-123:ORDER_CREATED');
    });

    it('should generate key without eventType when not provided', () => {
      const key = service.generateWebhookKey(
        'tenant-1',
        'GETIR',
        'order-123',
      );

      expect(key).toBe('tenant-1:GETIR:order-123');
    });
  });

  describe('onModuleDestroy', () => {
    it('should close Redis connection', async () => {
      await service.onModuleDestroy();

      expect(redisMock.quit).toHaveBeenCalled();
    });
  });
});
