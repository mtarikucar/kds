import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { LegalDocumentKind } from "../constants";
import { PublishLegalDocumentDto } from "../dto/publish-document.dto";

@Injectable()
export class LegalDocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fetch the active (`isCurrent=true`) version of a legal document for
   * the given kind + locale. Used by both:
   *   - the public /legal/documents/:kind/current endpoint (page render)
   *   - ConsentService.verifyCurrentConsentsAccepted (id reconciliation)
   *
   * Falls back to Turkish if the requested locale has no row, because
   * the KVKK / mesafeli / refund contracts are TR-canonical and the
   * non-TR translations are informational only at launch.
   */
  async getCurrent(kind: LegalDocumentKind, locale = "tr") {
    const exact = await this.prisma.legalDocument.findFirst({
      where: { kind, locale, isCurrent: true },
    });
    if (exact) return exact;

    if (locale !== "tr") {
      const trFallback = await this.prisma.legalDocument.findFirst({
        where: { kind, locale: "tr", isCurrent: true },
      });
      if (trFallback) return trFallback;
    }

    throw new NotFoundException(
      `No current legal document of kind ${kind} (locale=${locale}). ` +
        `Did the seed run? Did an admin de-activate the current version without publishing a replacement?`,
    );
  }

  /**
   * List all documents — for the admin UI's "history" view. Most recent
   * first. Doesn't filter by isCurrent because admins need to see the
   * full audit chain.
   */
  async listAll(kind?: LegalDocumentKind, locale?: string) {
    return this.prisma.legalDocument.findMany({
      where: {
        ...(kind ? { kind } : {}),
        ...(locale ? { locale } : {}),
      },
      orderBy: [{ kind: "asc" }, { createdAt: "desc" }],
    });
  }

  /**
   * Publish a new version. Atomic swap: the previous isCurrent row for
   * the same (kind, locale) gets isCurrent=false, the new row gets
   * isCurrent=true. Both happen in one $transaction so a partial write
   * can't leave two `isCurrent=true` rows for the same kind.
   */
  async publish(dto: PublishLegalDocumentDto) {
    const existing = await this.prisma.legalDocument.findUnique({
      where: {
        kind_version_locale: {
          kind: dto.kind,
          version: dto.version,
          locale: dto.locale,
        },
      },
    });
    if (existing) {
      throw new BadRequestException(
        `Version ${dto.version} already exists for ${dto.kind}/${dto.locale}. Use a new version number.`,
      );
    }

    const effectiveAt = dto.effectiveAt
      ? new Date(dto.effectiveAt)
      : new Date();

    // Serializable isolation: without it, two concurrent publish calls
    // for the same (kind, locale) with different version numbers would
    // both updateMany the prior isCurrent row (idempotent — fine), then
    // both insert their own isCurrent=true row — landing the table with
    // TWO active versions and breaking the "atomic swap" promise the
    // comment above makes. Serializable serialises them so the second
    // attempt's updateMany flips the first attempt's newly-inserted row
    // back to false before its own insert.
    return this.prisma.$transaction(async (tx) => {
      await tx.legalDocument.updateMany({
        where: { kind: dto.kind, locale: dto.locale, isCurrent: true },
        data: { isCurrent: false },
      });
      return tx.legalDocument.create({
        data: {
          kind: dto.kind,
          version: dto.version,
          locale: dto.locale,
          title: dto.title,
          bodyMarkdown: dto.bodyMarkdown,
          effectiveAt,
          isCurrent: true,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
