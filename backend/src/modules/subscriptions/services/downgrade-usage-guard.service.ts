import { Injectable, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";

/**
 * Downgrade usage-limit guard, extracted verbatim from SubscriptionService
 * (`getCurrentUsage` + `assertDowngradeAllowed`) so the ~45-line
 * usage-vs-new-plan-cap check is a cohesive, independently-testable unit.
 *
 * Pure query sub-responsibility: given a tenant + the target plan's caps,
 * it reads the live counts (ACTIVE users / tables / products / categories)
 * and throws a 400 listing every violated dimension, or returns silently.
 * No $transaction, no money math, no outbox/metric side-effects — a clean
 * seam with a single input/output. SubscriptionService keeps a thin
 * `assertDowngradeAllowed` facade that delegates here, so every call site
 * (changePlan, applyScheduledDowngrade) is byte-for-byte unchanged.
 *
 * The `-1` sentinel means "unlimited" per the plan-catalog convention and
 * is skipped, mirroring the engine/projector semantics.
 */
@Injectable()
export class DowngradeUsageGuardService {
  constructor(private readonly prisma: PrismaService) {}

  async assertDowngradeAllowed(
    tenantId: string,
    newPlan: {
      maxUsers: number;
      maxTables: number;
      maxProducts: number;
      maxCategories: number;
    },
  ) {
    const usage = await this.getCurrentUsage(tenantId);
    const violations: string[] = [];
    if (newPlan.maxUsers !== -1 && usage.users > newPlan.maxUsers) {
      violations.push(`Users: ${usage.users}/${newPlan.maxUsers}`);
    }
    if (newPlan.maxTables !== -1 && usage.tables > newPlan.maxTables) {
      violations.push(`Tables: ${usage.tables}/${newPlan.maxTables}`);
    }
    if (newPlan.maxProducts !== -1 && usage.products > newPlan.maxProducts) {
      violations.push(`Products: ${usage.products}/${newPlan.maxProducts}`);
    }
    if (
      newPlan.maxCategories !== -1 &&
      usage.categories > newPlan.maxCategories
    ) {
      violations.push(
        `Categories: ${usage.categories}/${newPlan.maxCategories}`,
      );
    }
    if (violations.length > 0) {
      throw new BadRequestException(
        `Cannot downgrade: current usage exceeds new plan limits. Please reduce: ${violations.join(", ")}`,
      );
    }
  }

  private async getCurrentUsage(tenantId: string) {
    const [users, tables, products, categories] = await Promise.all([
      this.prisma.user.count({ where: { tenantId, status: "ACTIVE" } }),
      this.prisma.table.count({ where: { tenantId } }),
      this.prisma.product.count({ where: { tenantId } }),
      this.prisma.category.count({ where: { tenantId } }),
    ]);
    return { users, tables, products, categories };
  }
}
