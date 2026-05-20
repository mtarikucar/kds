import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { CHECKOUT_REQUIRED_KINDS, LegalDocumentKind } from "../constants";

export interface ConsentContext {
  userId: string;
  ipAddress?: string;
  userAgent?: string;
  /** Optional FK back to the subscription this consent was given for.
   *  Null at create-intent time (the row doesn't exist yet); the
   *  PayTR webhook can backfill if needed. */
  subscriptionId?: string;
}

@Injectable()
export class ConsentService {
  private readonly logger = new Logger(ConsentService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Verify the ids the user just checked at checkout are exactly the
   * three `isCurrent=true` documents for KVKK / DISTANCE_SALES /
   * REFUND_POLICY, then write three Consent rows in one transaction.
   *
   * Rejection cases:
   *   - Less than three ids → 400 "Tüm yasal belgeleri onaylamanız gerekiyor"
   *   - An id points to a document whose isCurrent=false → 400 "Yasal
   *     belge güncellendi, lütfen yeni versiyonu kabul edin"
   *   - The three ids don't cover all of KVKK/DISTANCE_SALES/REFUND
   *     → 400 "Eksik onay: {kind}"
   *
   * Returns the three Consent rows created. Idempotency: we do NOT
   * uniq-constraint on (userId, documentId) — re-acceptance is legal
   * (the user might be subscribing to a new plan after the previous
   * one ended) and we want each acceptance separately audited.
   */
  async verifyAndRecord(
    acceptedDocumentIds: string[],
    ctx: ConsentContext,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    if (
      !acceptedDocumentIds ||
      acceptedDocumentIds.length < CHECKOUT_REQUIRED_KINDS.length
    ) {
      throw new BadRequestException(
        `Devam etmek için tüm yasal belgeleri (${CHECKOUT_REQUIRED_KINDS.join(", ")}) onaylamanız gerekiyor.`,
      );
    }

    const client = tx ?? this.prisma;

    // Resolve current docs for the three required kinds. One round trip.
    const currentDocs = await client.legalDocument.findMany({
      where: {
        kind: { in: [...CHECKOUT_REQUIRED_KINDS] },
        locale: "tr",
        isCurrent: true,
      },
    });

    const byId = new Map(currentDocs.map((d) => [d.id, d]));
    const presentKinds = new Set<string>();

    for (const id of acceptedDocumentIds) {
      const doc = byId.get(id);
      if (!doc) {
        // Either id is bogus, or it points to an outdated version (id
        // not in the current set). Force the user to re-fetch + re-accept.
        throw new BadRequestException(
          "Bir veya birden fazla yasal belge güncellendi. Lütfen sayfayı yenileyip yeni versiyonları onaylayın.",
        );
      }
      presentKinds.add(doc.kind);
    }

    const missing = CHECKOUT_REQUIRED_KINDS.filter((k) => !presentKinds.has(k));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Eksik yasal onay: ${missing.join(", ")}. Tüm onayları işaretleyin.`,
      );
    }

    // Write three Consent rows. createMany is fine — no unique conflict
    // (we deliberately allow repeated acceptance for audit completeness).
    await client.consent.createMany({
      data: currentDocs.map((doc) => ({
        userId: ctx.userId,
        documentId: doc.id,
        documentKind: doc.kind,
        documentVersion: doc.version,
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent ?? null,
        subscriptionId: ctx.subscriptionId ?? null,
      })),
    });

    this.logger.log(
      `Recorded consents user=${ctx.userId} kinds=${[...presentKinds].join(",")} ip=${ctx.ipAddress ?? "-"}`,
    );
  }

  /**
   * Has this user accepted the current version of each required kind?
   * Reads the most recent Consent per kind and compares to the current
   * document version. Useful for the post-login "we updated our terms"
   * modal — out of scope for v1, but exposed here so the UI can adopt
   * it without a service change.
   */
  async hasAllCurrentConsents(userId: string): Promise<boolean> {
    const currentDocs = await this.prisma.legalDocument.findMany({
      where: {
        kind: { in: [...CHECKOUT_REQUIRED_KINDS] },
        locale: "tr",
        isCurrent: true,
      },
      select: { kind: true, version: true },
    });

    for (const doc of currentDocs) {
      const accepted = await this.prisma.consent.findFirst({
        where: {
          userId,
          documentKind: doc.kind,
          documentVersion: doc.version,
        },
        select: { id: true },
      });
      if (!accepted) return false;
    }
    return true;
  }
}
