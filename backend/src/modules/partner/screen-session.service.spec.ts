import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { ScreenSessionService, MintingKey } from "./screen-session.service";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const KEY: MintingKey = {
  id: "key1",
  tenantId: "t1",
  scopes: ["menu:read", "orders:write", "realtime:subscribe"],
  allowedBranchIds: [],
};

describe("ScreenSessionService", () => {
  let prisma: any;
  let customerSessions: any;
  let service: ScreenSessionService;

  beforeEach(() => {
    prisma = {
      branch: {
        findFirst: jest.fn().mockResolvedValue({ id: "b1", status: "active" }),
      },
      table: { findFirst: jest.fn().mockResolvedValue({ id: "tbl1" }) },
      screenSession: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(({ data }) => ({
          id: "ss1",
          tenantId: data.tenantId,
          branchId: data.branchId,
          tableId: data.tableId ?? null,
          partnerApiKeyId: data.partnerApiKeyId,
          orderingSessionId: data.orderingSessionId,
          scopes: data.scopes,
          tokenExpiresAt: data.tokenExpiresAt,
          refreshExpiresAt: data.refreshExpiresAt,
          status: "active",
          lastSeenAt: null,
          createdAt: new Date(),
        })),
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      customerSession: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    customerSessions = {
      createForScreen: jest.fn().mockResolvedValue({
        sessionId: "a".repeat(64),
        expiresAt: new Date(),
      }),
      extendSession: jest.fn().mockResolvedValue(undefined),
    };
    service = new ScreenSessionService(prisma, customerSessions);
  });

  it("mints a screen token bound to branch/table, stores only hashes, backs a CustomerSession", async () => {
    const res = await service.mint(KEY, {
      branchId: "b1",
      tableId: "tbl1",
      scopes: ["menu:read", "orders:write"],
    });
    expect(res.screenToken).toContain(".");
    expect(res.refreshToken).toContain(".");
    expect(res.orderingSessionId).toBe("a".repeat(64));
    expect(res.scopes).toEqual(["menu:read", "orders:write"]); // ⊆ key scopes
    const stored = prisma.screenSession.create.mock.calls[0][0].data;
    expect(stored.tokenHash).toBe(sha(res.screenToken));
    expect(stored.refreshTokenHash).toBe(sha(res.refreshToken));
    expect(customerSessions.createForScreen).toHaveBeenCalledWith(
      "t1",
      "tbl1",
      expect.any(Number),
    );
  });

  it("rejects a branch not permitted by the key", async () => {
    const restricted: MintingKey = { ...KEY, allowedBranchIds: ["other"] };
    await expect(
      service.mint(restricted, { branchId: "b1" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects when requested scopes are not a subset of the key's", async () => {
    await expect(
      service.mint(KEY, { branchId: "b1", scopes: ["payments:write"] as any }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("authenticate returns null for an expired token", async () => {
    prisma.screenSession.findFirst.mockResolvedValue({
      id: "ss1",
      tokenExpiresAt: new Date(Date.now() - 1000),
      orderingSessionId: "a".repeat(64),
      scopes: [],
    });
    await expect(service.authenticate("Screen-tok")).resolves.toBeNull();
  });

  it("refresh rotates tokens and extends the backing session", async () => {
    prisma.screenSession.findFirst.mockResolvedValue({
      id: "ss1",
      refreshExpiresAt: new Date(Date.now() + 1000),
      orderingSessionId: "a".repeat(64),
    });
    const res = await service.refresh(KEY, "old-refresh");
    expect(res.screenToken).toContain(".");
    expect(prisma.screenSession.updateMany).toHaveBeenCalled();
    expect(customerSessions.extendSession).toHaveBeenCalledWith(
      "a".repeat(64),
      expect.any(Date),
    );
  });

  it("refresh throws when the rotation races to zero rows", async () => {
    prisma.screenSession.findFirst.mockResolvedValue({
      id: "ss1",
      refreshExpiresAt: new Date(Date.now() + 1000),
      orderingSessionId: "a".repeat(64),
    });
    prisma.screenSession.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.refresh(KEY, "old-refresh")).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
