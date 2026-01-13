import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DistributedLockService } from './distributed-lock.service';

// Mock ioredis
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    set: jest.fn(),
    exists: jest.fn(),
    eval: jest.fn(),
    quit: jest.fn().mockResolvedValue('OK'),
    on: jest.fn(),
  }));
});

const Redis = require('ioredis');

describe('DistributedLockService', () => {
  let service: DistributedLockService;
  let redisMock: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    Redis.mockClear();
    jest.useFakeTimers();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DistributedLockService,
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

    service = module.get<DistributedLockService>(DistributedLockService);
    redisMock = Redis.mock.results[0].value;
  });

  afterEach(async () => {
    jest.useRealTimers();
    await service.onModuleDestroy();
  });

  describe('acquireLock', () => {
    it('should acquire lock successfully', async () => {
      redisMock.set.mockResolvedValue('OK');

      const token = await service.acquireLock('test-lock');

      expect(token).toBeDefined();
      expect(redisMock.set).toHaveBeenCalledWith(
        'kafka:lock:test-lock',
        expect.any(String),
        'PX',
        30000,
        'NX',
      );
    });

    it('should use custom TTL when provided', async () => {
      redisMock.set.mockResolvedValue('OK');

      await service.acquireLock('test-lock', { ttlMs: 60000 });

      expect(redisMock.set).toHaveBeenCalledWith(
        'kafka:lock:test-lock',
        expect.any(String),
        'PX',
        60000,
        'NX',
      );
    });

    it('should retry on contention', async () => {
      redisMock.set
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('OK');

      const tokenPromise = service.acquireLock('test-lock', { retryCount: 3, retryDelayMs: 10 });

      // Fast-forward through retries
      await jest.runAllTimersAsync();

      const token = await tokenPromise;

      expect(token).toBeDefined();
      expect(redisMock.set).toHaveBeenCalledTimes(3);
    });

    it('should return null after max retries', async () => {
      redisMock.set.mockResolvedValue(null);

      const tokenPromise = service.acquireLock('test-lock', { retryCount: 2, retryDelayMs: 10 });

      await jest.runAllTimersAsync();

      const token = await tokenPromise;

      expect(token).toBeNull();
      expect(redisMock.set).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it('should return null on Redis error after retries', async () => {
      redisMock.set.mockRejectedValue(new Error('Redis error'));

      const tokenPromise = service.acquireLock('test-lock', { retryCount: 0 });

      await jest.runAllTimersAsync();

      const token = await tokenPromise;

      expect(token).toBeNull();
    });
  });

  describe('releaseLock', () => {
    it('should release lock with matching token', async () => {
      redisMock.eval.mockResolvedValue(1);

      const result = await service.releaseLock('test-lock', 'valid-token');

      expect(result).toBe(true);
      expect(redisMock.eval).toHaveBeenCalledWith(
        expect.stringContaining('del'),
        1,
        'kafka:lock:test-lock',
        'valid-token',
      );
    });

    it('should fail when token mismatch', async () => {
      redisMock.eval.mockResolvedValue(0);

      const result = await service.releaseLock('test-lock', 'invalid-token');

      expect(result).toBe(false);
    });

    it('should handle Redis error gracefully', async () => {
      redisMock.eval.mockRejectedValue(new Error('Redis error'));

      const result = await service.releaseLock('test-lock', 'token');

      expect(result).toBe(false);
    });
  });

  describe('withLock', () => {
    it('should execute function when lock acquired', async () => {
      redisMock.set.mockResolvedValue('OK');
      redisMock.eval.mockResolvedValue(1);

      const fn = jest.fn().mockResolvedValue('result');

      const result = await service.withLock('test-lock', fn);

      expect(result.acquired).toBe(true);
      expect(result.result).toBe('result');
      expect(fn).toHaveBeenCalled();
    });

    it('should return acquired:false when lock not acquired', async () => {
      redisMock.set.mockResolvedValue(null);

      const fn = jest.fn().mockResolvedValue('result');

      const resultPromise = service.withLock('test-lock', fn, { retryCount: 0 });

      await jest.runAllTimersAsync();

      const result = await resultPromise;

      expect(result.acquired).toBe(false);
      expect(result.result).toBeNull();
      expect(fn).not.toHaveBeenCalled();
    });

    it('should release lock after function execution', async () => {
      redisMock.set.mockResolvedValue('OK');
      redisMock.eval.mockResolvedValue(1);

      await service.withLock('test-lock', async () => 'done');

      expect(redisMock.eval).toHaveBeenCalled();
    });

    it('should release lock even on function error', async () => {
      redisMock.set.mockResolvedValue('OK');
      redisMock.eval.mockResolvedValue(1);

      const fn = jest.fn().mockRejectedValue(new Error('Function error'));

      await expect(service.withLock('test-lock', fn)).rejects.toThrow('Function error');
      expect(redisMock.eval).toHaveBeenCalled();
    });
  });

  describe('extendLock', () => {
    it('should extend TTL for valid lock', async () => {
      redisMock.eval.mockResolvedValue(1);

      const result = await service.extendLock('test-lock', 'valid-token', 60000);

      expect(result).toBe(true);
      expect(redisMock.eval).toHaveBeenCalledWith(
        expect.stringContaining('pexpire'),
        1,
        'kafka:lock:test-lock',
        'valid-token',
        60000,
      );
    });

    it('should fail for token mismatch', async () => {
      redisMock.eval.mockResolvedValue(0);

      const result = await service.extendLock('test-lock', 'invalid-token', 60000);

      expect(result).toBe(false);
    });

    it('should handle Redis error gracefully', async () => {
      redisMock.eval.mockRejectedValue(new Error('Redis error'));

      const result = await service.extendLock('test-lock', 'token', 60000);

      expect(result).toBe(false);
    });
  });

  describe('isLocked', () => {
    it('should return true when locked', async () => {
      redisMock.exists.mockResolvedValue(1);

      const result = await service.isLocked('test-lock');

      expect(result).toBe(true);
      expect(redisMock.exists).toHaveBeenCalledWith('kafka:lock:test-lock');
    });

    it('should return false when not locked', async () => {
      redisMock.exists.mockResolvedValue(0);

      const result = await service.isLocked('test-lock');

      expect(result).toBe(false);
    });

    it('should return false on Redis error', async () => {
      redisMock.exists.mockRejectedValue(new Error('Redis error'));

      const result = await service.isLocked('test-lock');

      expect(result).toBe(false);
    });
  });

  describe('onModuleDestroy', () => {
    it('should close Redis connection', async () => {
      await service.onModuleDestroy();

      expect(redisMock.quit).toHaveBeenCalled();
    });
  });
});
