import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { UpdateAccountingSettingsDto } from "../dto/accounting-settings.dto";
import {
  encryptString,
  decryptString,
} from "../../../common/helpers/encryption.helper";

/**
 * Field names that contain secrets and must be encrypted at rest with
 * the application's AES-256-GCM master key (the same pattern used by
 * `delivery-config.service.ts` for marketplace API keys). A DB leak of
 * the plain rows would otherwise hand over Foriba/Logo/Parasut creds
 * for every tenant.
 */
const ENCRYPTED_FIELDS = [
  "parasutClientSecret",
  "parasutPassword",
  "logoPassword",
  "foribaPassword",
] as const;

function encryptDto<T extends Record<string, any>>(dto: T): T {
  const out: any = { ...dto };
  for (const k of ENCRYPTED_FIELDS) {
    const v = out[k];
    if (typeof v === "string" && v.length > 0 && !v.startsWith("v1:")) {
      out[k] = encryptString(v);
    }
  }
  return out;
}

@Injectable()
export class AccountingSettingsService {
  constructor(private prisma: PrismaService) {}

  // v3.0.1 — findFirst + opportunistic create/update. The compound
  // unique (tenantId, branchId) with nullable branchId trips Prisma's
  // client-side validation on upsert; see branch-scope helper note.
  async findByTenant(tenantId: string) {
    const existing = await this.prisma.accountingSettings.findFirst({
      where: { tenantId, branchId: null },
    });
    if (existing) return existing;
    try {
      return await this.prisma.accountingSettings.create({
        data: { tenantId },
      });
    } catch (e: any) {
      if (e?.code === "P2002") {
        const row = await this.prisma.accountingSettings.findFirst({
          where: { tenantId, branchId: null },
        });
        if (row) return row;
      }
      throw e;
    }
  }

  async update(tenantId: string, dto: UpdateAccountingSettingsDto) {
    const safeDto = encryptDto(dto);
    const existing = await this.prisma.accountingSettings.findFirst({
      where: { tenantId, branchId: null },
    });
    if (existing) {
      const updated = await this.prisma.accountingSettings.updateMany({
        where: { tenantId, branchId: null },
        data: safeDto,
      });
      if (updated.count > 0) {
        return this.prisma.accountingSettings.findFirstOrThrow({
          where: { tenantId, branchId: null },
        });
      }
    }
    try {
      return await this.prisma.accountingSettings.create({
        data: { tenantId, ...safeDto },
      });
    } catch (e: any) {
      if (e?.code === "P2002") {
        await this.prisma.accountingSettings.updateMany({
          where: { tenantId, branchId: null },
          data: safeDto,
        });
        return this.prisma.accountingSettings.findFirstOrThrow({
          where: { tenantId, branchId: null },
        });
      }
      throw e;
    }
  }

  /**
   * Read credentials in plaintext for adapter use. Encrypted blobs are
   * recognised by the `v1:` prefix; legacy plaintext rows pass through
   * unchanged, so this rollout is backwards-compatible with existing data.
   */
  async getDecryptedCredentials(tenantId: string) {
    const settings = await this.prisma.accountingSettings.findFirst({
      where: { tenantId, branchId: null },
    });
    if (!settings) return null;
    const out: any = { ...settings };
    for (const k of ENCRYPTED_FIELDS) {
      const v = (out as any)[k];
      if (typeof v === "string" && v.length > 0) {
        try {
          (out as any)[k] = decryptString(v);
        } catch {
          // Decryption failed (corrupted blob or rotated key) — surface
          // as null so the caller can prompt re-entry instead of crashing.
          (out as any)[k] = null;
        }
      }
    }
    return out;
  }

  sanitize(settings: any) {
    const {
      parasutClientSecret,
      parasutPassword,
      logoPassword,
      foribaPassword,
      ...safe
    } = settings;
    return {
      ...safe,
      hasParasutCredentials: !!(
        parasutClientSecret && settings.parasutUsername
      ),
      hasLogoCredentials: !!(logoPassword && settings.logoUsername),
      hasForibaCredentials: !!(foribaPassword && settings.foribaUsername),
    };
  }

  /**
   * Mint the next invoice number for this tenant. Pass a transaction
   * client so the number is rolled back with the surrounding SalesInvoice
   * create if that fails — prevents sequence gaps that complicate audits.
   * v3.0.1: atomic increment via updateMany (compound-unique upsert
   * disallowed with branchId: null). Two concurrent calls still get
   * distinct numbers because PostgreSQL serialises the row update.
   */
  async getNextInvoiceNumber(
    tenantId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    const db = tx ?? this.prisma;
    let settings = await db.accountingSettings.findFirst({
      where: { tenantId, branchId: null },
    });
    if (settings) {
      const updated = await db.accountingSettings.updateMany({
        where: { tenantId, branchId: null },
        data: { nextInvoiceNumber: { increment: 1 } },
      });
      if (updated.count > 0) {
        settings = await db.accountingSettings.findFirstOrThrow({
          where: { tenantId, branchId: null },
        });
      }
    } else {
      try {
        settings = await db.accountingSettings.create({
          data: { tenantId, nextInvoiceNumber: 2 },
        });
      } catch (e: any) {
        if (e?.code === "P2002") {
          await db.accountingSettings.updateMany({
            where: { tenantId, branchId: null },
            data: { nextInvoiceNumber: { increment: 1 } },
          });
          settings = await db.accountingSettings.findFirstOrThrow({
            where: { tenantId, branchId: null },
          });
        } else {
          throw e;
        }
      }
    }

    const prefix = settings.invoicePrefix || "FTR";
    const num = (settings.nextInvoiceNumber || 2) - 1; // We incremented, so subtract 1 to get current
    return `${prefix}-${String(num).padStart(6, "0")}`;
  }
}
