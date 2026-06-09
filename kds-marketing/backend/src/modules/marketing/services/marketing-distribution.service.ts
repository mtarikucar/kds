import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class MarketingDistributionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Singleton row — seeded by the schema migration so we never have to
   * handle the empty-table case. Returns the config plus a hydrated
   * `lastAssignedTo` name so the UI can show "last assigned: Ahmet Y."
   */
  async get() {
    const cfg = await this.prisma.marketingDistributionConfig.findFirst();
    if (!cfg) {
      // Defensive: seed-then-truncate would land us here. Surface a 404
      // rather than fabricate a row so the operator sees something is
      // off and re-runs the seed.
      throw new NotFoundException('Distribution config missing — re-run platform seed');
    }
    const lastAssignedTo = cfg.lastAssignedToId
      ? await this.prisma.marketingUser.findUnique({
          where: { id: cfg.lastAssignedToId },
          select: { id: true, firstName: true, lastName: true },
        })
      : null;
    return { ...cfg, lastAssignedTo };
  }

  async update(strategy: string, actorId: string) {
    const cfg = await this.prisma.marketingDistributionConfig.findFirst();
    if (!cfg) {
      throw new NotFoundException('Distribution config missing — re-run platform seed');
    }
    // Switching strategy resets the round-robin cursor so the next
    // assignment starts cleanly from the top — otherwise switching
    // away and back would skip ahead in the rep list silently.
    const resetCursor = strategy !== cfg.strategy;
    return this.prisma.marketingDistributionConfig.update({
      where: { id: cfg.id },
      data: {
        strategy,
        updatedById: actorId,
        ...(resetCursor ? { lastAssignedToId: null } : {}),
      },
    });
  }
}
