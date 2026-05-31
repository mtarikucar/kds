import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { UpdateAccountingSettingsDto } from '../dto/accounting-settings.dto';
import {
  encryptString,
  decryptString,
} from '../../../common/helpers/encryption.helper';

/**
 * Field names that contain secrets and must be encrypted at rest with
 * the application's AES-256-GCM master key (the same pattern used by
 * `delivery-config.service.ts` for marketplace API keys). A DB leak of
 * the plain rows would otherwise hand over Foriba/Logo/Parasut creds
 * for every tenant.
 */
const ENCRYPTED_FIELDS = [
  'parasutClientSecret',
  'parasutPassword',
  'logoPassword',
  'foribaPassword',
] as const;

function encryptDto<T extends Record<string, any>>(dto: T): T {
  const out: any = { ...dto };
  for (const k of ENCRYPTED_FIELDS) {
    const v = out[k];
    if (typeof v === 'string' && v.length > 0 && !v.startsWith('v1:')) {
      out[k] = encryptString(v);
    }
  }
  return out;
}

@Injectable()
export class AccountingSettingsService {
  constructor(private prisma: PrismaService) {}

  async findByTenant(tenantId: string) {
    return this.prisma.accountingSettings.upsert({
      where: { tenantId },
      update: {},
      create: { tenantId },
    });
  }

  async update(tenantId: string, dto: UpdateAccountingSettingsDto) {
    const safeDto = encryptDto(dto);
    return this.prisma.accountingSettings.upsert({
      where: { tenantId },
      update: safeDto,
      create: { tenantId, ...safeDto },
    });
  }

  /**
   * Read credentials in plaintext for adapter use. Encrypted blobs are
   * recognised by the `v1:` prefix; legacy plaintext rows pass through
   * unchanged, so this rollout is backwards-compatible with existing data.
   */
  async getDecryptedCredentials(tenantId: string) {
    const settings = await this.prisma.accountingSettings.findUnique({
      where: { tenantId },
    });
    if (!settings) return null;
    const out: any = { ...settings };
    for (const k of ENCRYPTED_FIELDS) {
      const v = (out as any)[k];
      if (typeof v === 'string' && v.length > 0) {
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
      parasutClientSecret, parasutPassword,
      logoPassword, foribaPassword,
      ...safe
    } = settings;
    return {
      ...safe,
      hasParasutCredentials: !!(parasutClientSecret && settings.parasutUsername),
      hasLogoCredentials: !!(logoPassword && settings.logoUsername),
      hasForibaCredentials: !!(foribaPassword && settings.foribaUsername),
    };
  }

  /**
   * Mint the next invoice number for this tenant. Pass a transaction
   * client so the number is rolled back with the surrounding SalesInvoice
   * create if that fails — prevents sequence gaps that complicate audits.
   * The atomic `{ increment: 1 }` upsert already prevents number duplication
   * (two concurrent calls get distinct nextInvoiceNumber values).
   */
  async getNextInvoiceNumber(
    tenantId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    const db = tx ?? this.prisma;
    const settings = await db.accountingSettings.upsert({
      where: { tenantId },
      update: { nextInvoiceNumber: { increment: 1 } },
      create: { tenantId, nextInvoiceNumber: 2 },
    });

    const prefix = settings.invoicePrefix || 'FTR';
    const num = (settings.nextInvoiceNumber || 2) - 1; // We incremented, so subtract 1 to get current
    return `${prefix}-${String(num).padStart(6, '0')}`;
  }
}
