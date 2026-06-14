import { BadRequestException, NotFoundException } from "@nestjs/common";
import { DesktopAppService } from "./desktop-app.service";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../common/test/prisma-mock.service";

/**
 * Complements desktop-app.service.spec.ts (signature contract) with the
 * release-lifecycle decision branches: duplicate-version guard, the
 * publish/unpublish idempotency guards, findLatest/no-release, and the
 * numeric semver comparison that gates checkForUpdates. The existing spec
 * covers the per-platform signature gating; here we pin the
 * "is there even an update?" decision and the admin state machine.
 */
function release(over: Partial<any> = {}) {
  return {
    id: "rel-1",
    version: "1.2.0",
    published: false,
    pubDate: new Date("2026-01-01T00:00:00.000Z"),
    releaseNotes: "notes",
    windowsUrl: "https://cdn/win.msi",
    windowsSignature: "sigwin",
    macArmUrl: null,
    macArmSignature: null,
    macIntelUrl: null,
    macIntelSignature: null,
    linuxUrl: null,
    linuxSignature: null,
    downloadCount: 0,
    ...over,
  };
}

describe("DesktopAppService — release lifecycle", () => {
  let prisma: MockPrismaClient;
  let svc: DesktopAppService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new DesktopAppService(prisma as any);
  });

  describe("create", () => {
    it("rejects a duplicate version", async () => {
      prisma.desktopRelease.findUnique.mockResolvedValue(release() as any);
      await expect(
        svc.create({ version: "1.2.0" } as any),
      ).rejects.toThrow("Release version 1.2.0 already exists");
      expect(prisma.desktopRelease.create).not.toHaveBeenCalled();
    });

    it("creates a fresh version, stamping updatedAt", async () => {
      prisma.desktopRelease.findUnique.mockResolvedValue(null as any);
      prisma.desktopRelease.create.mockResolvedValue(release() as any);
      await svc.create({ version: "1.2.0" } as any);
      const arg = prisma.desktopRelease.create.mock.calls[0][0] as any;
      expect(arg.data.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe("findLatest", () => {
    it("throws NotFound when there is no published release", async () => {
      prisma.desktopRelease.findFirst.mockResolvedValue(null as any);
      await expect(svc.findLatest()).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("publish / unpublish guards", () => {
    it("publish rejects an already-published release", async () => {
      prisma.desktopRelease.findUnique.mockResolvedValue(
        release({ published: true }) as any,
      );
      await expect(svc.publish("rel-1")).rejects.toThrow(
        "Release is already published",
      );
    });

    it("publish flips published=true and stamps pubDate", async () => {
      prisma.desktopRelease.findUnique.mockResolvedValue(
        release({ published: false }) as any,
      );
      prisma.desktopRelease.update.mockResolvedValue(
        release({ published: true }) as any,
      );
      await svc.publish("rel-1");
      const arg = prisma.desktopRelease.update.mock.calls[0][0] as any;
      expect(arg.data.published).toBe(true);
      expect(arg.data.pubDate).toBeInstanceOf(Date);
    });

    it("unpublish rejects a release that is not published", async () => {
      prisma.desktopRelease.findUnique.mockResolvedValue(
        release({ published: false }) as any,
      );
      await expect(svc.unpublish("rel-1")).rejects.toThrow(
        "Release is not published",
      );
    });
  });

  describe("trackDownload", () => {
    it("swallows update errors (analytics must never break a download)", async () => {
      prisma.desktopRelease.update.mockRejectedValue(new Error("db down"));
      await expect(
        svc.trackDownload("1.2.0", "windows-x86_64"),
      ).resolves.toBeUndefined();
    });
  });

  describe("checkForUpdates — version decision", () => {
    it("returns null when no published release exists", async () => {
      prisma.desktopRelease.findFirst.mockResolvedValue(null as any);
      expect(
        await svc.checkForUpdates("windows-x86_64", "1.0.0"),
      ).toBeNull();
    });

    it("returns null when the client is already on the same version", async () => {
      prisma.desktopRelease.findFirst.mockResolvedValue(
        release({ version: "1.2.0", published: true }) as any,
      );
      expect(
        await svc.checkForUpdates("windows-x86_64", "1.2.0"),
      ).toBeNull();
    });

    it("returns null when the client version is NEWER than the latest published", async () => {
      prisma.desktopRelease.findFirst.mockResolvedValue(
        release({ version: "1.2.0", published: true }) as any,
      );
      expect(
        await svc.checkForUpdates("windows-x86_64", "1.5.0"),
      ).toBeNull();
    });

    it("returns a manifest when the latest published is strictly newer (and platform is signed)", async () => {
      prisma.desktopRelease.findFirst.mockResolvedValue(
        release({ version: "1.2.0", published: true }) as any,
      );
      const manifest = await svc.checkForUpdates("windows-x86_64", "1.1.0");
      expect(manifest).not.toBeNull();
      expect(manifest!.version).toBe("1.2.0");
      expect(manifest!.platforms["windows-x86_64"]).toEqual({
        url: "https://cdn/win.msi",
        signature: "sigwin",
      });
    });

    it("compares numeric semver per-segment, not lexically (1.10.0 > 1.9.0)", async () => {
      prisma.desktopRelease.findFirst.mockResolvedValue(
        release({ version: "1.10.0", published: true }) as any,
      );
      // Lexical string compare would call "1.10.0" < "1.9.0" and serve no
      // update; the numeric compare must recognise 1.10.0 as newer.
      const manifest = await svc.checkForUpdates("windows-x86_64", "1.9.0");
      expect(manifest).not.toBeNull();
      expect(manifest!.version).toBe("1.10.0");
    });

    it("tolerates a leading v prefix on the release version", async () => {
      prisma.desktopRelease.findFirst.mockResolvedValue(
        release({ version: "v1.3.0", published: true }) as any,
      );
      const manifest = await svc.checkForUpdates("windows-x86_64", "1.2.0");
      expect(manifest).not.toBeNull();
    });

    it("returns null when the newer release does not build the requested platform", async () => {
      // Only windows is built/signed; a darwin client gets no manifest.
      prisma.desktopRelease.findFirst.mockResolvedValue(
        release({ version: "1.2.0", published: true }) as any,
      );
      expect(
        await svc.checkForUpdates("darwin-aarch64", "1.0.0"),
      ).toBeNull();
    });
  });
});
