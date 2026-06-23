import { ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { DeliveryConfigService } from "./delivery-config.service";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../../common/test/prisma-mock.service";
import {
  decryptJson,
  decryptString,
  isEncryptedPayload,
} from "../../../common/helpers/encryption.helper";

/**
 * Behaviour locks for config (security-critical credential store):
 *
 *  - Encryption at rest: credentials are stored as an AES-GCM envelope
 *    (NOT plaintext) and access tokens as a "v1:" blob; both round-trip
 *    back to the original via the internal decrypt path.
 *  - Client-facing reads (findAll/findOne) NEVER leak credentials or
 *    accessToken — only boolean presence flags.
 *  - Tenant scoping: every read/write carries tenantId in the WHERE, and
 *    mutating ops use a defence-in-depth updateMany {id, tenantId} that
 *    throws NotFound on a 0-row claim (cross-tenant write protection).
 *  - Credential rotation invalidates the cached token + resets the
 *    circuit-breaker counters.
 *  - Circuit breaker: recordError auto-disables once errorCount crosses
 *    the threshold; resetErrorCount / updateToken clear it.
 *  - P2002 uniqueness collisions surface as a friendly ConflictException.
 */
describe("DeliveryConfigService", () => {
  let prisma: MockPrismaClient;
  let adapterFactory: any;
  let adapter: any;
  let outbox: { append: jest.Mock };
  let svc: DeliveryConfigService;

  const originalKey = process.env.ENCRYPTION_MASTER_KEY;
  beforeAll(() => {
    process.env.ENCRYPTION_MASTER_KEY =
      "test-master-key-at-least-32-chars-long-xx";
  });
  afterAll(() => {
    if (originalKey === undefined) delete process.env.ENCRYPTION_MASTER_KEY;
    else process.env.ENCRYPTION_MASTER_KEY = originalKey;
  });

  beforeEach(() => {
    prisma = mockPrismaClient();
    adapter = {
      testConnection: jest.fn().mockResolvedValue(true),
      openRestaurant: jest.fn().mockResolvedValue(undefined),
      closeRestaurant: jest.fn().mockResolvedValue(undefined),
    };
    adapterFactory = { getAdapter: jest.fn().mockReturnValue(adapter) };
    outbox = { append: jest.fn().mockResolvedValue("evt-1") };
    svc = new DeliveryConfigService(
      prisma as any,
      adapterFactory,
      outbox as any,
    );
  });

  describe("encryption at rest", () => {
    it("create() stores credentials as an AES-GCM envelope, not plaintext, that round-trips", async () => {
      (prisma.deliveryPlatformConfig.findFirst as any).mockResolvedValue(null);
      let writtenCredentials: any;
      (prisma.deliveryPlatformConfig.create as any).mockImplementation(
        async ({ data }: any) => {
          writtenCredentials = data.credentials;
          return { id: "cfg-1", ...data };
        },
      );

      const secret = { apiKey: "super-secret", vendorId: "v-1" };
      await svc.create("t1", { platform: "GETIR", credentials: secret } as any);

      // Stored value is an encrypted envelope, NOT the raw object.
      expect(isEncryptedPayload(writtenCredentials)).toBe(true);
      const serialized = JSON.stringify(writtenCredentials);
      expect(serialized).not.toContain("super-secret");
      // ...and it decrypts back to the original.
      expect(decryptJson(writtenCredentials)).toEqual(secret);
    });

    it("updateToken() encrypts the access token as a v1: blob that decrypts back", async () => {
      let written: any;
      (prisma.deliveryPlatformConfig.update as any).mockImplementation(
        async ({ data }: any) => {
          written = data;
          return { id: "cfg-1", ...data };
        },
      );

      await svc.updateToken(
        "cfg-1",
        "plaintext-access-token",
        new Date("2030-01-01"),
      );

      expect(typeof written.accessToken).toBe("string");
      expect(written.accessToken.startsWith("v1:")).toBe(true);
      expect(written.accessToken).not.toContain("plaintext-access-token");
      expect(decryptString(written.accessToken)).toBe("plaintext-access-token");
      // Writing a fresh token clears the circuit-breaker state.
      expect(written).toMatchObject({
        errorCount: 0,
        lastError: null,
        lastErrorAt: null,
      });
    });

    it("findOneInternal() decrypts stored credentials + token for adapter use", async () => {
      const {
        encryptJson,
        encryptString,
      } = require("../../../common/helpers/encryption.helper");
      (prisma.deliveryPlatformConfig.findFirst as any).mockResolvedValue({
        id: "cfg-1",
        tenantId: "t1",
        platform: "GETIR",
        credentials: encryptJson({ apiKey: "k" }),
        accessToken: encryptString("tok-123"),
      });

      const cfg: any = await svc.findOneInternal("t1", "GETIR");

      expect(cfg.credentials).toEqual({ apiKey: "k" });
      expect(cfg.accessToken).toBe("tok-123");
    });
  });

  describe("client-facing reads never leak secrets", () => {
    it("findAll() strips credentials + accessToken, exposing only presence flags, scoped to tenant", async () => {
      (prisma.deliveryPlatformConfig.findMany as any).mockResolvedValue([
        {
          id: "c1",
          tenantId: "t1",
          platform: "GETIR",
          credentials: { apiKey: "x" },
          accessToken: "v1:zzz",
        },
      ]);

      const out: any = await svc.findAll("t1");

      expect(prisma.deliveryPlatformConfig.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: "t1", deletedAt: null } }),
      );
      expect(out[0]).not.toHaveProperty("credentials");
      expect(out[0]).not.toHaveProperty("accessToken");
      expect(out[0]).toMatchObject({
        hasCredentials: true,
        hasAccessToken: true,
      });
    });

    it("findOne() throws NotFound and never returns raw secrets", async () => {
      (prisma.deliveryPlatformConfig.findFirst as any).mockResolvedValue(null);

      await expect(svc.findOne("t1", "GETIR")).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.deliveryPlatformConfig.findFirst).toHaveBeenCalledWith({
        where: { tenantId: "t1", platform: "GETIR", deletedAt: null },
      });
    });
  });

  describe("tenant scoping / defence-in-depth on writes", () => {
    it("update() claims the row with updateMany {id, tenantId} and throws NotFound on a 0-row claim", async () => {
      (prisma.deliveryPlatformConfig.findFirst as any).mockResolvedValue({
        id: "cfg-1",
        tenantId: "t1",
        platform: "GETIR",
      });
      (prisma.deliveryPlatformConfig.updateMany as any).mockResolvedValue({
        count: 0,
      });

      await expect(
        svc.update("t1", "GETIR", { isEnabled: false } as any),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.deliveryPlatformConfig.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "cfg-1", tenantId: "t1", deletedAt: null },
        }),
      );
    });

    it("delete() soft-deletes via a tenant-scoped updateMany (deletedAt set, disabled)", async () => {
      (prisma.deliveryPlatformConfig.findFirst as any).mockResolvedValue({
        id: "cfg-1",
        tenantId: "t1",
        platform: "GETIR",
      });
      (prisma.deliveryPlatformConfig.updateMany as any).mockResolvedValue({
        count: 1,
      });
      (
        prisma.deliveryPlatformConfig.findUniqueOrThrow as any
      ).mockResolvedValue({ id: "cfg-1" });

      await svc.delete("t1", "GETIR");

      const call = (prisma.deliveryPlatformConfig.updateMany as any).mock
        .calls[0][0];
      expect(call.where).toMatchObject({
        id: "cfg-1",
        tenantId: "t1",
        deletedAt: null,
      });
      expect(call.data).toMatchObject({ isEnabled: false });
      expect(call.data.deletedAt).toBeInstanceOf(Date);
    });

    it("toggleRestaurant() also writes with a tenant-scoped updateMany", async () => {
      (prisma.deliveryPlatformConfig.findFirst as any).mockResolvedValue({
        id: "cfg-1",
        tenantId: "t1",
        platform: "GETIR",
        credentials: null,
        accessToken: null,
      });
      (prisma.deliveryPlatformConfig.updateMany as any).mockResolvedValue({
        count: 1,
      });
      (
        prisma.deliveryPlatformConfig.findUniqueOrThrow as any
      ).mockResolvedValue({ id: "cfg-1" });

      await svc.toggleRestaurant("t1", "GETIR", true);

      expect(adapter.openRestaurant).toHaveBeenCalled();
      expect(prisma.deliveryPlatformConfig.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "cfg-1", tenantId: "t1", deletedAt: null },
          data: { restaurantOpen: true },
        }),
      );
    });
  });

  describe("credential rotation", () => {
    it("rotating credentials nulls the cached token + resets circuit-breaker counters", async () => {
      (prisma.deliveryPlatformConfig.findFirst as any).mockResolvedValue({
        id: "cfg-1",
        tenantId: "t1",
        platform: "GETIR",
      });
      let writtenData: any;
      (prisma.deliveryPlatformConfig.updateMany as any).mockImplementation(
        async ({ data }: any) => {
          writtenData = data;
          return { count: 1 };
        },
      );
      (
        prisma.deliveryPlatformConfig.findUniqueOrThrow as any
      ).mockResolvedValue({ id: "cfg-1" });

      await svc.update("t1", "GETIR", {
        credentials: { apiKey: "new" },
      } as any);

      expect(isEncryptedPayload(writtenData.credentials)).toBe(true);
      expect(writtenData).toMatchObject({
        accessToken: null,
        tokenExpiresAt: null,
        errorCount: 0,
        lastError: null,
        lastErrorAt: null,
      });
    });
  });

  describe("branch routing + environment", () => {
    it("update() maps environment and connects a branch when branchId is provided", async () => {
      (prisma.deliveryPlatformConfig.findFirst as any).mockResolvedValue({
        id: "cfg-1",
        tenantId: "t1",
        platform: "GETIR",
      });
      // The branch belongs to the tenant (security check passes).
      (prisma.branch.findFirst as any).mockResolvedValue({ id: "br-1" });
      let writtenData: any;
      (prisma.deliveryPlatformConfig.updateMany as any).mockImplementation(
        async ({ data }: any) => {
          writtenData = data;
          return { count: 1 };
        },
      );
      (
        prisma.deliveryPlatformConfig.findUniqueOrThrow as any
      ).mockResolvedValue({ id: "cfg-1" });

      await svc.update("t1", "GETIR", {
        environment: "sandbox",
        branchId: "br-1",
      } as any);

      expect(prisma.branch.findFirst).toHaveBeenCalledWith({
        where: { id: "br-1", tenantId: "t1" },
        select: { id: true },
      });
      expect(writtenData.environment).toBe("sandbox");
      expect(writtenData.branch).toEqual({ connect: { id: "br-1" } });
    });

    it("update() disconnects the branch when branchId is null (restores fallback)", async () => {
      (prisma.deliveryPlatformConfig.findFirst as any).mockResolvedValue({
        id: "cfg-1",
        tenantId: "t1",
        platform: "GETIR",
      });
      let writtenData: any;
      (prisma.deliveryPlatformConfig.updateMany as any).mockImplementation(
        async ({ data }: any) => {
          writtenData = data;
          return { count: 1 };
        },
      );
      (
        prisma.deliveryPlatformConfig.findUniqueOrThrow as any
      ).mockResolvedValue({ id: "cfg-1" });

      await svc.update("t1", "GETIR", { branchId: null } as any);

      expect(writtenData.branch).toEqual({ disconnect: true });
    });
  });

  describe("branchId tenant validation (security)", () => {
    it("create() rejects a branchId that is NOT a branch of the caller's tenant", async () => {
      (prisma.deliveryPlatformConfig.findFirst as any).mockResolvedValue(null);
      // Cross-tenant / unknown branch: findFirst scoped to {id, tenantId}
      // returns nothing.
      (prisma.branch.findFirst as any).mockResolvedValue(null);

      await expect(
        svc.create("t1", {
          platform: "GETIR",
          branchId: "br-other-tenant",
        } as any),
      ).rejects.toThrow(/not a branch of this tenant/i);
      // The write must never happen.
      expect(prisma.deliveryPlatformConfig.create).not.toHaveBeenCalled();
      expect(prisma.branch.findFirst).toHaveBeenCalledWith({
        where: { id: "br-other-tenant", tenantId: "t1" },
        select: { id: true },
      });
    });

    it("create() persists when the branchId is a valid branch of the tenant", async () => {
      (prisma.deliveryPlatformConfig.findFirst as any).mockResolvedValue(null);
      (prisma.branch.findFirst as any).mockResolvedValue({ id: "br-1" });
      let writtenData: any;
      (prisma.deliveryPlatformConfig.create as any).mockImplementation(
        async ({ data }: any) => {
          writtenData = data;
          return { id: "cfg-1", ...data };
        },
      );

      await svc.create("t1", { platform: "GETIR", branchId: "br-1" } as any);

      expect(writtenData.branchId).toBe("br-1");
    });

    it("create() with no branchId skips the branch lookup (fallback applies)", async () => {
      (prisma.deliveryPlatformConfig.findFirst as any).mockResolvedValue(null);
      (prisma.deliveryPlatformConfig.create as any).mockResolvedValue({
        id: "cfg-1",
      });

      await svc.create("t1", { platform: "GETIR" } as any);

      expect(prisma.branch.findFirst).not.toHaveBeenCalled();
    });

    it("update() rejects a branchId that is NOT a branch of the caller's tenant", async () => {
      (prisma.deliveryPlatformConfig.findFirst as any).mockResolvedValue({
        id: "cfg-1",
        tenantId: "t1",
        platform: "GETIR",
      });
      (prisma.branch.findFirst as any).mockResolvedValue(null);

      await expect(
        svc.update("t1", "GETIR", { branchId: "br-other-tenant" } as any),
      ).rejects.toThrow(/not a branch of this tenant/i);
      // The write must never happen.
      expect(prisma.deliveryPlatformConfig.updateMany).not.toHaveBeenCalled();
    });

    it("update() with branchId=null clears the override without a branch lookup", async () => {
      (prisma.deliveryPlatformConfig.findFirst as any).mockResolvedValue({
        id: "cfg-1",
        tenantId: "t1",
        platform: "GETIR",
      });
      let writtenData: any;
      (prisma.deliveryPlatformConfig.updateMany as any).mockImplementation(
        async ({ data }: any) => {
          writtenData = data;
          return { count: 1 };
        },
      );
      (
        prisma.deliveryPlatformConfig.findUniqueOrThrow as any
      ).mockResolvedValue({ id: "cfg-1" });

      await svc.update("t1", "GETIR", { branchId: null } as any);

      expect(prisma.branch.findFirst).not.toHaveBeenCalled();
      expect(writtenData.branch).toEqual({ disconnect: true });
    });

    it("update() maps a P2025 on the branch connect to a 400 (TOCTOU)", async () => {
      (prisma.deliveryPlatformConfig.findFirst as any).mockResolvedValue({
        id: "cfg-1",
        tenantId: "t1",
        platform: "GETIR",
      });
      // Ownership check passes...
      (prisma.branch.findFirst as any).mockResolvedValue({ id: "br-1" });
      // ...but the connect then fails (row vanished between check and write).
      (prisma.deliveryPlatformConfig.updateMany as any).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("Record to connect not found", {
          code: "P2025",
          clientVersion: "6.x",
        } as any),
      );

      await expect(
        svc.update("t1", "GETIR", { branchId: "br-1" } as any),
      ).rejects.toThrow(/not a branch of this tenant/i);
    });
  });

  describe("circuit breaker", () => {
    it("recordError truncates the message to 500 chars and auto-disables once threshold is crossed", async () => {
      const longErr = "x".repeat(900);
      let firstUpdateData: any;
      (prisma.deliveryPlatformConfig.update as any)
        .mockImplementationOnce(async ({ data }: any) => {
          firstUpdateData = data;
          return {
            id: "cfg-1",
            tenantId: "t1",
            platform: "GETIR",
            branchId: "b1",
            errorCount: 10,
            isEnabled: true,
            lastError: "boom",
            lastErrorAt: new Date("2030-01-01T00:00:00.000Z"),
          };
        })
        .mockResolvedValueOnce({ id: "cfg-1", isEnabled: false });

      await svc.recordError("cfg-1", longErr);

      expect(firstUpdateData.lastError).toHaveLength(500);
      expect(firstUpdateData.errorCount).toEqual({ increment: 1 });
      // Second update call is the auto-disable.
      const secondCall = (prisma.deliveryPlatformConfig.update as any).mock
        .calls[1][0];
      expect(secondCall.data).toEqual({ isEnabled: false });
    });

    it("recordError emits a delivery.platform.auto_disabled.v1 tenant alert when the breaker trips", async () => {
      (prisma.deliveryPlatformConfig.update as any)
        .mockResolvedValueOnce({
          id: "cfg-1",
          tenantId: "t1",
          platform: "GETIR",
          branchId: "b1",
          errorCount: 10,
          isEnabled: true,
          lastError: "token expired",
          lastErrorAt: new Date("2030-01-01T00:00:00.000Z"),
        })
        .mockResolvedValueOnce({ id: "cfg-1", isEnabled: false });

      await svc.recordError("cfg-1", "token expired");

      expect(outbox.append).toHaveBeenCalledTimes(1);
      const arg = outbox.append.mock.calls[0][0];
      expect(arg.type).toBe("delivery.platform.auto_disabled.v1");
      expect(arg.tenantId).toBe("t1");
      expect(arg.idempotencyKey).toBe("delivery-auto-disabled:cfg-1:10");
      expect(arg.payload).toMatchObject({
        tenantId: "t1",
        configId: "cfg-1",
        platform: "GETIR",
        branchId: "b1",
        errorCount: 10,
        lastError: "token expired",
        lastErrorAt: "2030-01-01T00:00:00.000Z",
      });
    });

    it("recordError does NOT auto-disable (or alert) while below threshold", async () => {
      (prisma.deliveryPlatformConfig.update as any).mockResolvedValue({
        id: "cfg-1",
        tenantId: "t1",
        platform: "GETIR",
        errorCount: 3,
        isEnabled: true,
      });

      await svc.recordError("cfg-1", "boom");

      // Only the single increment update — no second disabling update.
      expect(
        (prisma.deliveryPlatformConfig.update as any).mock.calls,
      ).toHaveLength(1);
      expect(outbox.append).not.toHaveBeenCalled();
    });

    it("recordError does not throw when the alert emit fails (best-effort)", async () => {
      outbox.append.mockRejectedValueOnce(new Error("bus down"));
      (prisma.deliveryPlatformConfig.update as any)
        .mockResolvedValueOnce({
          id: "cfg-1",
          tenantId: "t1",
          platform: "GETIR",
          branchId: null,
          errorCount: 10,
          isEnabled: true,
          lastError: "x",
          lastErrorAt: new Date(),
        })
        .mockResolvedValueOnce({ id: "cfg-1", isEnabled: false });

      await expect(svc.recordError("cfg-1", "x")).resolves.toBeDefined();
      // The disable write still happened.
      expect(
        (prisma.deliveryPlatformConfig.update as any).mock.calls,
      ).toHaveLength(2);
    });

    it("recordError does not re-disable (or re-alert) an already-disabled config at threshold", async () => {
      (prisma.deliveryPlatformConfig.update as any).mockResolvedValue({
        id: "cfg-1",
        tenantId: "t1",
        platform: "GETIR",
        errorCount: 12,
        isEnabled: false,
      });

      await svc.recordError("cfg-1", "boom");

      expect(
        (prisma.deliveryPlatformConfig.update as any).mock.calls,
      ).toHaveLength(1);
      expect(outbox.append).not.toHaveBeenCalled();
    });
  });

  describe("uniqueness conflicts", () => {
    it("create() rejects a duplicate platform config for the tenant with ConflictException (pre-check)", async () => {
      (prisma.deliveryPlatformConfig.findFirst as any).mockResolvedValue({
        id: "existing",
      });

      await expect(
        svc.create("t1", { platform: "GETIR" } as any),
      ).rejects.toThrow(ConflictException);
      expect(prisma.deliveryPlatformConfig.create).not.toHaveBeenCalled();
    });

    it("create() maps a P2002 (remoteRestaurantId collision) to ConflictException", async () => {
      (prisma.deliveryPlatformConfig.findFirst as any).mockResolvedValue(null);
      (prisma.deliveryPlatformConfig.create as any).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "6.x",
        } as any),
      );

      await expect(
        svc.create("t1", {
          platform: "GETIR",
          remoteRestaurantId: "r-1",
        } as any),
      ).rejects.toThrow(ConflictException);
    });
  });
});
