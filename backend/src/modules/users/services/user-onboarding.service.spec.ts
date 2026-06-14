import { NotFoundException } from "@nestjs/common";
import { UserOnboardingService } from "./user-onboarding.service";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../../common/test/prisma-mock.service";

/**
 * Onboarding/tour state, extracted from UsersService (god-file split). The
 * logic was previously untested; these specs lock the default-when-empty
 * shape, the partial-update merge (tourProgress is deep-merged, scalar flags
 * fall through current → default), and the not-found guard.
 */
describe("UserOnboardingService", () => {
  let prisma: MockPrismaClient;
  let svc: UserOnboardingService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new UserOnboardingService(prisma as any);
  });

  describe("getOnboarding", () => {
    it("returns the default shape when the user has no onboardingData", async () => {
      (prisma.user.findUnique as any).mockResolvedValue({ onboardingData: null });
      const out = await svc.getOnboarding("u-1");
      expect(out).toEqual({
        hasSeenWelcome: false,
        tourProgress: {},
        skipAllTours: false,
      });
    });

    it("returns stored onboardingData verbatim when present", async () => {
      const stored = {
        hasSeenWelcome: true,
        tourProgress: { pos: { lastStep: 3 } },
        skipAllTours: false,
      };
      (prisma.user.findUnique as any).mockResolvedValue({
        onboardingData: stored,
      });
      expect(await svc.getOnboarding("u-1")).toEqual(stored);
    });

    it("throws NotFound for an unknown user", async () => {
      (prisma.user.findUnique as any).mockResolvedValue(null);
      await expect(svc.getOnboarding("ghost")).rejects.toThrow(NotFoundException);
    });
  });

  describe("updateOnboarding", () => {
    it("deep-merges tourProgress and preserves untouched flags", async () => {
      (prisma.user.findUnique as any).mockResolvedValue({
        onboardingData: {
          hasSeenWelcome: true,
          skipAllTours: false,
          tourProgress: { pos: { done: true } },
        },
      });
      (prisma.user.update as any).mockResolvedValue({});

      const result = await svc.updateOnboarding("u-1", {
        tourProgress: { kds: { lastStep: 1 } },
      } as any);

      // pos retained, kds added; flags fall through from current data.
      expect(result).toEqual({
        hasSeenWelcome: true,
        skipAllTours: false,
        tourProgress: { pos: { done: true }, kds: { lastStep: 1 } },
      });
      const writeArg = (prisma.user.update as any).mock.calls[0][0];
      expect(writeArg.where).toEqual({ id: "u-1" });
      expect(writeArg.data.onboardingData).toEqual(result);
    });

    it("starts from defaults when no prior onboardingData exists", async () => {
      (prisma.user.findUnique as any).mockResolvedValue({ onboardingData: null });
      (prisma.user.update as any).mockResolvedValue({});

      const result = await svc.updateOnboarding("u-1", {
        hasSeenWelcome: true,
      } as any);

      expect(result).toEqual({
        hasSeenWelcome: true,
        skipAllTours: false,
        tourProgress: {},
      });
    });

    it("throws NotFound for an unknown user (no write)", async () => {
      (prisma.user.findUnique as any).mockResolvedValue(null);
      await expect(
        svc.updateOnboarding("ghost", { hasSeenWelcome: true } as any),
      ).rejects.toThrow(NotFoundException);
      expect((prisma.user.update as any)).not.toHaveBeenCalled();
    });
  });
});
