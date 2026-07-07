import { IoAdapter } from "@nestjs/platform-socket.io";

/**
 * The RedisIoAdapter is load-bearing infra for horizontal scale: with it,
 * room broadcasts fan out across replicas via Redis pub/sub; without it a
 * 2+ pod deployment silently drops realtime events for clients on other
 * replicas. Equally critical is the FALLBACK contract — a missing or
 * unreachable Redis must NOT crash boot; single-node dev keeps the
 * in-memory adapter. These specs lock both: wire-on-connect, and
 * graceful fallback on (a) no config and (b) connect failure.
 */

const createClientMock = jest.fn((..._args: any[]) => undefined as any);
const createAdapterMock = jest.fn((..._args: any[]) => "REDIS_ADAPTER_CTOR");

jest.mock("redis", () => ({
  createClient: (...args: any[]) => createClientMock(...args),
}));
jest.mock("@socket.io/redis-adapter", () => ({
  createAdapter: (...args: any[]) => createAdapterMock(...args),
}));

// Imported after the mocks are registered.
import { RedisIoAdapter } from "./redis-io.adapter";

function fakeRedisClient(connect: jest.Mock) {
  const client: any = {
    on: jest.fn(),
    connect,
    quit: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
  };
  client.duplicate = jest.fn(() => client);
  return client;
}

describe("RedisIoAdapter", () => {
  const app = {} as any;
  let superSpy: jest.SpyInstance;
  let server: { adapter: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.REDIS_URL;
    delete process.env.REDIS_HOST;
    delete process.env.REDIS_PORT;
    delete process.env.SOCKET_ADAPTER_REQUIRE_REDIS;
    server = { adapter: jest.fn() };
    // Stub the parent IoAdapter.createIOServer so we don't spin a real
    // socket.io server; we only assert whether the Redis adapter gets wired.
    superSpy = jest
      .spyOn(IoAdapter.prototype, "createIOServer")
      .mockReturnValue(server as any);
  });

  afterEach(() => superSpy.mockRestore());

  it("falls back to the in-memory adapter when no Redis is configured (no throw, no adapter wired)", async () => {
    const adapter = new RedisIoAdapter(app);

    await expect(adapter.connectToRedis()).resolves.toBeUndefined();
    adapter.createIOServer(0);

    expect(createClientMock).not.toHaveBeenCalled();
    expect(createAdapterMock).not.toHaveBeenCalled();
    expect(server.adapter).not.toHaveBeenCalled();
  });

  it("builds a redis:// URL from REDIS_HOST/REDIS_PORT when REDIS_URL is absent", async () => {
    process.env.REDIS_HOST = "cache";
    process.env.REDIS_PORT = "6380";
    const client = fakeRedisClient(jest.fn().mockResolvedValue(undefined));
    createClientMock.mockReturnValue(client);

    const adapter = new RedisIoAdapter(app);
    await adapter.connectToRedis();

    expect(createClientMock).toHaveBeenCalledWith(
      expect.objectContaining({ url: "redis://cache:6380" }),
    );
  });

  it("wires the Redis adapter onto the IO server when Redis connects", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const client = fakeRedisClient(jest.fn().mockResolvedValue(undefined));
    createClientMock.mockReturnValue(client);

    const adapter = new RedisIoAdapter(app);
    await adapter.connectToRedis();
    adapter.createIOServer(0);

    expect(createAdapterMock).toHaveBeenCalledTimes(1);
    expect(server.adapter).toHaveBeenCalledWith("REDIS_ADAPTER_CTOR");
  });

  it("falls back gracefully when Redis connection fails (no throw, no adapter wired)", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const client = fakeRedisClient(
      jest.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    );
    createClientMock.mockReturnValue(client);

    const adapter = new RedisIoAdapter(app);
    await expect(adapter.connectToRedis()).resolves.toBeUndefined();
    adapter.createIOServer(0);

    expect(createAdapterMock).not.toHaveBeenCalled();
    expect(server.adapter).not.toHaveBeenCalled();
    // both pub + sub clients get torn down on failure
    expect(client.disconnect).toHaveBeenCalled();
  });

  // Multi-replica opt-in (audit 2026-07): when an operator runs >1 replica they
  // set SOCKET_ADAPTER_REQUIRE_REDIS=true so a missing/broken Redis adapter
  // FAILS BOOT (crash-loop → restart retries) instead of silently latching to
  // the in-memory adapter, which would drop cross-replica events for half the
  // clients. Default (flag unset) keeps the degrade-only single-node behaviour.
  it("refuses to boot when SOCKET_ADAPTER_REQUIRE_REDIS=true but no Redis is configured", async () => {
    process.env.SOCKET_ADAPTER_REQUIRE_REDIS = "true";

    const adapter = new RedisIoAdapter(app);

    await expect(adapter.connectToRedis()).rejects.toThrow(
      /SOCKET_ADAPTER_REQUIRE_REDIS/,
    );
  });

  it("refuses to boot when SOCKET_ADAPTER_REQUIRE_REDIS=true and Redis connection fails (after cleanup)", async () => {
    process.env.SOCKET_ADAPTER_REQUIRE_REDIS = "true";
    process.env.REDIS_URL = "redis://localhost:6379";
    const client = fakeRedisClient(
      jest.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    );
    createClientMock.mockReturnValue(client);

    const adapter = new RedisIoAdapter(app);

    await expect(adapter.connectToRedis()).rejects.toThrow(/ECONNREFUSED/);
    // clients are still torn down before the throw
    expect(client.disconnect).toHaveBeenCalled();
    expect(createAdapterMock).not.toHaveBeenCalled();
  });
});
