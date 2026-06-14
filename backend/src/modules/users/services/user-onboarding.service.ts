import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import { UpdateOnboardingDto } from "../dto/update-onboarding.dto";

/** Default shape returned/merged when a user has no onboarding data yet. */
const DEFAULT_ONBOARDING = {
  hasSeenWelcome: false,
  tourProgress: {} as Record<string, unknown>,
  skipAllTours: false,
};

/**
 * Per-user onboarding/tour state. Extracted verbatim from UsersService
 * (god-file split) — a self-contained concern reading/writing only
 * user.onboardingData, so it lives on its own and UsersService keeps the
 * identity/lifecycle surface.
 */
@Injectable()
export class UserOnboardingService {
  constructor(private prisma: PrismaService) {}

  async getOnboarding(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { onboardingData: true },
    });

    if (!user) {
      throw new NotFoundException("User not found");
    }

    return user.onboardingData || DEFAULT_ONBOARDING;
  }

  async updateOnboarding(
    userId: string,
    updateOnboardingDto: UpdateOnboardingDto,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { onboardingData: true },
    });

    if (!user) {
      throw new NotFoundException("User not found");
    }

    const currentData = (user.onboardingData as any) || DEFAULT_ONBOARDING;

    const updatedData = {
      hasSeenWelcome:
        updateOnboardingDto.hasSeenWelcome ??
        currentData.hasSeenWelcome ??
        false,
      skipAllTours:
        updateOnboardingDto.skipAllTours ?? currentData.skipAllTours ?? false,
      tourProgress: {
        ...(currentData.tourProgress || {}),
        ...(updateOnboardingDto.tourProgress || {}),
      },
    };

    await this.prisma.user.update({
      where: { id: userId },
      data: { onboardingData: updatedData as any },
    });

    return updatedData;
  }
}
