import { BadRequestException, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { PartnerApiKeyService } from "./partner-api-key.service";

function sha256Hex(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

describe("PartnerApiKeyService", () => {
  let prisma: any;
  let service: PartnerApiKeyService;

  beforeEach(() => {
    prisma = {
      partnerApiKey: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(({ data, select }) => ({
          id: "key1",
          keyId: data.keyId,
          name: data.name,
          scopes: data.scopes,
          allowedReturnOrigins: data.allowedReturnOrigins,
          allowedBranchIds: data.allowedBranchIds,
          status: "active",
          lastUsedAt: null,
          createdBy: data.createdBy ?? null,
          createdAt: new Date(),
          revokedAt: null,
          // emulate that `select` omits secretHash
          ...(select ? {} : { secretHash: data.secretHash }),
        })),
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      screenSession: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      customerSession: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      // $transaction(cb) runs the callback against the same mock client.
      $transaction: jest.fn().mockImplementation((cb: any) => cb(prisma)),
    };
    service = new PartnerApiKeyService(prisma);
  });

  it("issues a key, returns the raw secret once, stores only the sha256 hash", async () => {
    const result = await service.issue("t1", "user1", {
      name: "Partner X",
      scopes: ["menu:read", "orders:write"],
    });
    expect(result.secret).toMatch(/^pk_live_secret_/);
    expect(result.keyId).toMatch(/^pk_live_/);
    // The create call stored sha256(secret), not the raw secret.
    const stored = prisma.partnerApiKey.create.mock.calls[0][0].data.secretHash;
    expect(stored).toBe(sha256Hex(result.secret));
    expect(stored).not.toContain(result.secret);
    // The returned row object never carries secretHash.
    expect((result as any).secretHash).toBeUndefined();
  });

  it("enforces the per-tenant cap", async () => {
    prisma.partnerApiKey.count.mockResolvedValue(10);
    await expect(
      service.issue("t1", "user1", { name: "n", scopes: ["menu:read"] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("authenticates a correct (keyId, secret) pair and rejects a wrong secret", async () => {
    const secret = "pk_live_secret_abc";
    prisma.partnerApiKey.findFirst.mockResolvedValue({
      id: "key1",
      keyId: "pk_live_x",
      secretHash: sha256Hex(secret),
      status: "active",
      tenantId: "t1",
    });
    await expect(
      service.authenticate("pk_live_x", secret),
    ).resolves.toMatchObject({
      id: "key1",
    });
    await expect(
      service.authenticate("pk_live_x", "pk_live_secret_WRONG"),
    ).resolves.toBeNull();
  });

  it("returns null when the key does not exist / is revoked", async () => {
    prisma.partnerApiKey.findFirst.mockResolvedValue(null);
    await expect(
      service.authenticate("pk_live_x", "whatever"),
    ).resolves.toBeNull();
  });

  it("revokes a key, cascades to screen sessions AND deactivates their backing CustomerSessions", async () => {
    const oid = "a".repeat(64);
    prisma.screenSession.findMany.mockResolvedValue([
      { orderingSessionId: oid },
    ]);
    await service.revoke("t1", "key1");
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.partnerApiKey.updateMany).toHaveBeenCalledWith({
      where: { id: "key1", tenantId: "t1" },
      data: expect.objectContaining({ status: "revoked" }),
    });
    expect(prisma.screenSession.updateMany).toHaveBeenCalledWith({
      where: { partnerApiKeyId: "key1", status: "active" },
      data: expect.objectContaining({ status: "revoked" }),
    });
    // The leaky gap the review caught: the backing ordering identity must die.
    expect(prisma.customerSession.updateMany).toHaveBeenCalledWith({
      where: { sessionId: { in: [oid] } },
      data: { isActive: false },
    });
  });

  it("throws NotFound when revoking a missing/cross-tenant key", async () => {
    prisma.partnerApiKey.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.revoke("t1", "nope")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
