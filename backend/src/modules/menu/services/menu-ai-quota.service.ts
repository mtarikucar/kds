import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../../../prisma/prisma.service";
import { EntitlementService } from "../../entitlements/entitlement.service";
import { BusinessException } from "../../../common/exceptions/business.exception";
import { ErrorCode } from "../../../common/interfaces/error-response.interface";
import { isUnlimited } from "../../../common/constants/subscription-plans.const";

/** Quota kinds. FRAME + OCR-parse draw from the PHOTO allowance (same
    image-scale vendor cost); MODEL3D has its own pool — a Meshy model is a
    ~₺12 charge, ~9× a photo. */
export type AiQuotaKind = "PHOTO" | "VIDEO" | "MODEL3D";

const KIND_TO_LIMIT_COLUMN: Record<AiQuotaKind, string> = {
  PHOTO: "maxMonthlyAiPhotos",
  VIDEO: "maxMonthlyAiVideos",
  MODEL3D: "maxMonthlyAi3dModels",
};

const KIND_LABEL: Record<AiQuotaKind, string> = {
  PHOTO: "photo",
  VIDEO: "video",
  MODEL3D: "3D model",
};

export interface AiQuotaUsage {
  used: number;
  limit: number; // -1 = unlimited
  remaining: number; // Infinity-safe: -1 limit → -1 (FE treats as unlimited)
}

/**
 * Monthly AI-generation quota for the menu AI studio, backed by the
 * append-only ai_generation_usage ledger.
 *
 * Why a ledger and not "count ProductMediaJob rows": jobs cascade-delete with
 * their product, so counting jobs lets "delete product → quota refunded" farm
 * unlimited generations. Ledger rows have no product FK and survive.
 *
 * claim() is ATOMIC: pg_advisory_xact_lock(tenant) + count + insert in one
 * transaction, so N parallel generate requests can never overdraw the cap
 * (each video is a real ~$0.42 vendor charge — a burst race is a money bug,
 * the same class as the order-limit TOCTOU the guard tolerates for free rows).
 * A failed generation refunds automatically: failJob / a fal submit error
 * voids the ledger row.
 */
@Injectable()
export class MenuAiQuotaService {
  private readonly logger = new Logger(MenuAiQuotaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementService,
  ) {}

  /** Start of the current calendar month in server-local time — the same
      window convention PlanFeatureGuard.checkLimit uses for MONTHLY_ORDERS. */
  private monthStart(): Date {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /** Effective cap for a kind: entitlement engine first (projected plan +
      add-ons + overrides), then the PlanFeatureGuard-style plan-only fallback
      for tenants whose grants haven't been projected yet. Missing everywhere
      → 0 (deny): generations cost money, so the failure mode is "locked",
      never "free". */
  private async resolveLimit(
    tenantId: string,
    kind: AiQuotaKind,
  ): Promise<number> {
    const column = KIND_TO_LIMIT_COLUMN[kind];
    try {
      const set = await this.entitlements.getForTenant(tenantId, null);
      const engineLimit = set?.limits?.[`limit.${column}`];
      if (typeof engineLimit === "number" && Number.isFinite(engineLimit)) {
        return engineLimit;
      }
    } catch (err: any) {
      this.logger.warn(
        `Entitlement engine unavailable for tenant=${tenantId} (${err?.message}); falling back to plan columns`,
      );
    }
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { limitOverrides: true, currentPlan: true },
    });
    const overrides = (tenant?.limitOverrides ?? {}) as Record<string, number>;
    const overridden = overrides[column];
    if (typeof overridden === "number" && Number.isFinite(overridden)) {
      return overridden;
    }
    const planValue = (tenant?.currentPlan as Record<string, unknown> | null)?.[
      column
    ];
    return typeof planValue === "number" && Number.isFinite(planValue)
      ? planValue
      : 0;
  }

  private async usedUnits(
    tx: Pick<PrismaService, "aiGenerationUsage">,
    tenantId: string,
    kind: AiQuotaKind,
  ): Promise<number> {
    const agg = await tx.aiGenerationUsage.aggregate({
      _sum: { units: true },
      where: {
        tenantId,
        kind,
        voided: false,
        createdAt: { gte: this.monthStart() },
      },
    });
    return agg._sum.units ?? 0;
  }

  /** Read-only usage view for the AI-studio header / usage panels. */
  async getUsage(tenantId: string, kind: AiQuotaKind): Promise<AiQuotaUsage> {
    const [limit, used] = await Promise.all([
      this.resolveLimit(tenantId, kind),
      this.usedUnits(this.prisma, tenantId, kind),
    ]);
    return {
      used,
      limit,
      remaining: isUnlimited(limit) ? -1 : Math.max(0, limit - used),
    };
  }

  /**
   * Atomically claim `units` from the tenant's monthly allowance, or throw
   * 402 QUOTA_EXCEEDED. Returns the ledger row id — hold onto it: attachJob()
   * links it to the ProductMediaJob once one exists, voidUsage()/voidByJob()
   * refund it when the generation never happens or fails.
   */
  async claim(
    tenantId: string,
    kind: AiQuotaKind,
    units: number,
  ): Promise<string> {
    const limit = await this.resolveLimit(tenantId, kind);
    if (limit === 0) {
      throw new BusinessException(
        `Your plan has no AI ${KIND_LABEL[kind]} allowance. Upgrade to Profesyonel or Kurumsal to generate menu ${KIND_LABEL[kind]}s.`,
        ErrorCode.QUOTA_EXCEEDED,
        HttpStatus.PAYMENT_REQUIRED,
        { kind, used: 0, limit, requested: units },
      );
    }
    return this.prisma.$transaction(async (tx) => {
      if (!isUnlimited(limit)) {
        // Per-tenant advisory xact lock (auto-released at commit/rollback —
        // no session-lock leak on pooled connections). Serialises concurrent
        // claims so count+insert is race-free.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ai-quota:${tenantId}`}, 0))`;
        const used = await this.usedUnits(tx as any, tenantId, kind);
        if (used + units > limit) {
          throw new BusinessException(
            `Monthly AI ${KIND_LABEL[kind]} allowance reached (${used}/${limit}). It renews at the start of next month — or upgrade your plan for a higher cap.`,
            ErrorCode.QUOTA_EXCEEDED,
            HttpStatus.PAYMENT_REQUIRED,
            { kind, used, limit, requested: units },
          );
        }
      }
      const row = await tx.aiGenerationUsage.create({
        data: { tenantId, kind, units },
        select: { id: true },
      });
      return row.id;
    });
  }

  /** Link a claimed ledger row to its ProductMediaJob so a later failJob can
      refund it by job id. */
  async attachJob(usageId: string, jobId: string): Promise<void> {
    await this.prisma.aiGenerationUsage.update({
      where: { id: usageId },
      data: { jobId },
    });
  }

  /** Refund a claim that never became a job (fal submit threw, simulator
      download failed). Idempotent. */
  async voidUsage(usageId: string): Promise<void> {
    await this.prisma.aiGenerationUsage.updateMany({
      where: { id: usageId, voided: false },
      data: { voided: true },
    });
  }

  /** Refund the claim behind a FAILED job (adapter error, poll timeout).
      Idempotent; no-op for jobs that predate quota tracking. */
  async voidByJob(jobId: string): Promise<void> {
    const res = await this.prisma.aiGenerationUsage.updateMany({
      where: { jobId, voided: false },
      data: { voided: true },
    });
    if (res.count > 0) {
      this.logger.log(`Refunded AI quota for failed job ${jobId}`);
    }
  }

  /** Refund claims that never became jobs. A hard process kill between
      claim() and the job insert (deploys happen per change here) strands a
      voided=false row with jobId=null that neither voidUsage (process died)
      nor voidByJob (nothing to match) can ever reach. Live claims attach
      within seconds, so the 1-hour grace makes racing a real claim
      impossible; the updateMany is idempotent, so multi-replica double-runs
      are harmless (no advisory lock needed). */
  @Cron(CronExpression.EVERY_HOUR)
  async sweepOrphanClaims(): Promise<void> {
    const res = await this.prisma.aiGenerationUsage.updateMany({
      where: {
        voided: false,
        jobId: null,
        createdAt: { lt: new Date(Date.now() - 60 * 60 * 1000) },
      },
      data: { voided: true },
    });
    if (res.count > 0) {
      this.logger.warn(
        `Voided ${res.count} orphan AI-quota claim(s) that never became jobs`,
      );
    }
  }
}
