/**
 * Create a mock Redis client for testing
 */
export function mockRedisClient() {
  return {
    get: jest.fn(),
    set: jest.fn(),
    setex: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
    eval: jest.fn(),
    pexpire: jest.fn(),
    quit: jest.fn().mockResolvedValue('OK'),
    on: jest.fn(),
    off: jest.fn(),
    disconnect: jest.fn(),
  };
}

export type MockRedisClient = ReturnType<typeof mockRedisClient>;

/**
 * Configure mock Redis for idempotency service testing
 */
export function configureMockRedisForIdempotency(
  redisMock: MockRedisClient,
  options?: {
    isDuplicate?: boolean;
    existingRecord?: object | null;
  },
) {
  const { isDuplicate = false, existingRecord = null } = options || {};

  redisMock.exists.mockResolvedValue(isDuplicate ? 1 : 0);
  redisMock.get.mockResolvedValue(
    existingRecord ? JSON.stringify(existingRecord) : null,
  );
  redisMock.setex.mockResolvedValue('OK');
  redisMock.del.mockResolvedValue(1);
}

/**
 * Configure mock Redis for distributed lock service testing
 */
export function configureMockRedisForLock(
  redisMock: MockRedisClient,
  options?: {
    lockAcquired?: boolean;
    lockToken?: string;
    lockReleased?: boolean;
    lockExtended?: boolean;
    isLocked?: boolean;
  },
) {
  const {
    lockAcquired = true,
    lockToken = 'test-lock-token',
    lockReleased = true,
    lockExtended = true,
    isLocked = false,
  } = options || {};

  // For acquireLock - SET NX returns 'OK' if lock acquired, null otherwise
  redisMock.set.mockResolvedValue(lockAcquired ? 'OK' : null);

  // For releaseLock - Lua script returns 1 if released, 0 otherwise
  redisMock.eval.mockImplementation(async (script: string, numKeys: number, ...args: unknown[]) => {
    // Check if this is a release script (contains "del")
    if (script.includes('del')) {
      return lockReleased ? 1 : 0;
    }
    // Check if this is an extend script (contains "pexpire")
    if (script.includes('pexpire')) {
      return lockExtended ? 1 : 0;
    }
    return 0;
  });

  // For isLocked
  redisMock.exists.mockResolvedValue(isLocked ? 1 : 0);
}
