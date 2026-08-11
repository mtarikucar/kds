import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { BusinessException } from "../../common/exceptions/business.exception";
import { ErrorCode } from "../../common/interfaces/error-response.interface";
import { CreditKind } from "../entitlements/entitlement-keys.const";

/**
 * Consumption kinds. FRAME and OCR-parse draw from the PHOTO balance (same
 * image-scale vendor cost); MODEL3D has its own pool — a Meshy model is a
 * ~₺12 charge, roughly nine times a photo. SMS is metered per message.
 */
export type { CreditKind };

const KIND_LABEL: Record<CreditKind, string> = {
  PHOTO: "görsel",
  VIDEO: "video",
  MODEL3D: "3D model",
  SMS: "SMS",
};

const PACK_FOR_KIND: Record<CreditKind, string> = {
  PHOTO: "credit_ai_photo_100",
  VIDEO: "credit_ai_video_20",
  MODEL3D: "credit_ai_3d_10",
  SMS: "credit_sms_500",
};

export interface CreditBalance {
  kind: CreditKind;
  /** Units bought and not voided. */
  granted: number;
  /** Units consumed and not refunded. */
  used: number;
  /** granted − used. Never negative in practice; clamped for display. */
  remaining: number;
}

/**
 * Prepaid consumption credits.
 *
 * Replaces the monthly AI quota. Two things changed and both are deliberate:
 *
 *  1. NO MONTHLY WINDOW. Credits are bought and valid until consumed, so the
 *     balance is a lifetime sum rather than a per-calendar-month count. A
 *     tenant who buys 100 images in March and uses 40 has 60 in December.
 *
 *  2. NOT AN ENTITLEMENT. The entitlement set is cached in-process for 30
 *     seconds; a stale balance during a burst is a real money bug, because
 *     every generation is a live vendor charge. The balance is therefore read
 *     inside the advisory-locked claim transaction, never from the engine, and
 *     `credit.*` grants are skipped by the projector entirely.
 *
 * What did NOT change is the refund machinery, which was already right: the
 * consumption ledger has no FK to products or jobs, so "delete the product →
 * get the credit back" cannot farm free generations, and a failed generation
 * voids its row so a failure never costs the customer anything.
 */
@Injectable()
export class CreditService {
  private readonly logger = new Logger(CreditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Lifetime balance for one kind. */
  async balance(tenantId: string, kind: CreditKind): Promise<number> {
    const [granted, used] = await Promise.all([
      this.prisma.creditLot.aggregate({
        _sum: { units: true },
        where: { tenantId, kind, voided: false },
      }),
      this.prisma.creditLedger.aggregate({
        _sum: { units: true },
        where: { tenantId, kind, voided: false },
      }),
    ]);
    return (granted._sum.units ?? 0) - (used._sum.units ?? 0);
  }

  /** Every balance, for the credits panel. */
  async balances(tenantId: string): Promise<CreditBalance[]> {
    const [lots, ledger] = await Promise.all([
      this.prisma.creditLot.groupBy({
        by: ["kind"],
        _sum: { units: true },
        where: { tenantId, voided: false },
      }),
      this.prisma.creditLedger.groupBy({
        by: ["kind"],
        _sum: { units: true },
        where: { tenantId, voided: false },
      }),
    ]);
    const grantedBy = new Map(lots.map((l) => [l.kind, l._sum.units ?? 0]));
    const usedBy = new Map(ledger.map((l) => [l.kind, l._sum.units ?? 0]));

    return (Object.keys(KIND_LABEL) as CreditKind[]).map((kind) => {
      const granted = grantedBy.get(kind) ?? 0;
      const used = usedBy.get(kind) ?? 0;
      return { kind, granted, used, remaining: Math.max(0, granted - used) };
    });
  }

  /**
   * Atomically spend `units`, or throw 402.
   *
   * The advisory lock is what makes N parallel generate requests unable to
   * overdraw: without it each request reads the same balance, each finds it
   * sufficient, and the tenant gets generations they did not pay for. The lock
   * is transaction-scoped (`pg_advisory_xact_lock`), so it releases on commit
   * or rollback and cannot leak on a pooled connection.
   *
   * Returns the ledger row id — hold onto it: `attachJob()` links it to a
   * ProductMediaJob, `void()` refunds it when the generation never happens.
   */
  async claim(
    tenantId: string,
    kind: CreditKind,
    units: number,
    ref?: { type: string; id?: string },
  ): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`credits:${tenantId}:${kind}`}, 0))`;

      const [granted, used] = await Promise.all([
        tx.creditLot.aggregate({
          _sum: { units: true },
          where: { tenantId, kind, voided: false },
        }),
        tx.creditLedger.aggregate({
          _sum: { units: true },
          where: { tenantId, kind, voided: false },
        }),
      ]);
      const remaining = (granted._sum.units ?? 0) - (used._sum.units ?? 0);

      if (remaining < units) {
        throw new BusinessException(
          remaining <= 0
            ? `${KIND_LABEL[kind]} kontörünüz kalmadı. Mağazadan kontör paketi alarak devam edebilirsiniz.`
            : `Yetersiz ${KIND_LABEL[kind]} kontörü (${remaining} kaldı, ${units} gerekiyor).`,
          ErrorCode.QUOTA_EXCEEDED,
          HttpStatus.PAYMENT_REQUIRED,
          {
            kind,
            remaining: Math.max(0, remaining),
            requested: units,
            // The storefront code the client can deep-link straight to.
            offerCode: PACK_FOR_KIND[kind],
          },
        );
      }

      // FIFO attribution: oldest unspent lot first, so a time-boxed promo lot
      // (if one is ever issued) burns before a lot that never expires.
      const lot = await tx.creditLot.findFirst({
        where: { tenantId, kind, voided: false },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });

      const row = await tx.creditLedger.create({
        data: {
          tenantId,
          kind,
          units,
          lotId: lot?.id ?? null,
          refType: ref?.type ?? null,
          refId: ref?.id ?? null,
        },
        select: { id: true },
      });
      return row.id;
    });
  }

  /** Link a claim to the job it paid for, so a later failure can refund it. */
  async attachRef(ledgerId: string, refType: string, refId: string) {
    await this.prisma.creditLedger.update({
      where: { id: ledgerId },
      data: { refType, refId },
    });
  }

  /** Refund a claim that never became work. Idempotent. */
  async void(ledgerId: string): Promise<void> {
    await this.prisma.creditLedger.updateMany({
      where: { id: ledgerId, voided: false },
      data: { voided: true },
    });
  }

  /** Refund the claim behind a failed job. Idempotent. */
  async voidByRef(refId: string): Promise<void> {
    const res = await this.prisma.creditLedger.updateMany({
      where: { refId, voided: false },
      data: { voided: true },
    });
    if (res.count > 0) {
      this.logger.log(`Refunded credits for failed ref ${refId}`);
    }
  }

  /**
   * Refund claims that never became work.
   *
   * A hard process kill between `claim()` and the job insert strands a
   * `voided:false` row with no ref that neither `void()` (the process died)
   * nor `voidByRef()` (nothing to match) can reach. Live claims attach within
   * seconds, so a one-hour grace cannot race a real claim; the updateMany is
   * idempotent, so multi-replica runs are harmless and need no lock.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async sweepOrphanClaims(): Promise<void> {
    const res = await this.prisma.creditLedger.updateMany({
      where: {
        voided: false,
        refId: null,
        createdAt: { lt: new Date(Date.now() - 60 * 60 * 1000) },
      },
      data: { voided: true },
    });
    if (res.count > 0) {
      this.logger.warn(
        `Voided ${res.count} orphan credit claim(s) that never became work`,
      );
    }
  }

  /** Operator grant. Mirrors a purchase but with no payment and an audit source. */
  async grant(
    tenantId: string,
    kind: CreditKind,
    units: number,
    actorId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.prisma;
    return client.creditLot.create({
      data: {
        tenantId,
        kind,
        units,
        source: `comp:admin:${actorId}`,
        priceCents: 0,
      },
    });
  }
}
