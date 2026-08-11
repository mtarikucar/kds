import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { generateInvoiceNumber } from "../../common/helpers/invoice-number.helper";
import { CartQuote } from "./checkout.types";

export interface CreateTenantInvoiceInput {
  tenantId: string;
  quote: CartQuote;
  paymentRef: string;
  /** purchase | renewal | credit | hardware | comp */
  kind: string;
  renewalCycleId?: string | null;
  referralCode?: string | null;
  referredByMarketingUserId?: string | null;
  issuedAt?: Date;
}

/**
 * Itemized invoices for the à-la-carte world.
 *
 * Writes to `tenant_invoices`, NOT to the legacy `invoices` table. That table
 * requires a `subscriptionId` behind a cascade FK and holds records Turkish
 * VUK requires retaining for years; relaxing the column would produce a down
 * migration that could only be honest by deleting tax records.
 *
 * Numbering deliberately shares the legacy `InvoiceCounter` through
 * `invoice-number.helper`. Two independent sequences over the same
 * `INV-{YYYYMM}-{seq}-{hex}` format would eventually mint the same string, and
 * the resulting unique-violation surfaces inside settlement — after the card
 * has been charged.
 */
@Injectable()
export class TenantInvoiceService {
  private readonly logger = new Logger(TenantInvoiceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Must be called INSIDE the provisioning transaction. A tenant with a
   * granted product and no invoice (or an invoice for a rolled-back grant) is
   * the kind of inconsistency nobody notices until an audit.
   *
   * Idempotent on `paymentRef` (unique): a PayTR webhook replay returns the
   * existing invoice rather than minting a second number for the same money.
   */
  async createFromQuote(
    tx: Prisma.TransactionClient,
    input: CreateTenantInvoiceInput,
  ) {
    const existing = await tx.tenantInvoice.findUnique({
      where: { paymentRef: input.paymentRef },
      include: { lines: true },
    });
    if (existing) return existing;

    const issuedAt = input.issuedAt ?? new Date();
    const invoiceNumber = await generateInvoiceNumber(tx, issuedAt);

    // Frozen at issuance so a later tenant edit never rewrites history.
    const tenant = await tx.tenant.findUnique({
      where: { id: input.tenantId },
      select: { taxId: true },
    });

    const q = input.quote;
    // The invoice period spans the widest period any line provisions, so a
    // cart of licence + module reads as one term rather than several.
    const periods = q.lines
      .map((l) => l.meta?.periodEnd)
      .filter((v): v is string => !!v)
      .map((v) => new Date(v));
    const starts = q.lines
      .map((l) => l.meta?.periodStart)
      .filter((v): v is string => !!v)
      .map((v) => new Date(v));

    return tx.tenantInvoice.create({
      data: {
        tenantId: input.tenantId,
        invoiceNumber,
        status: "PAID",
        kind: input.kind,
        paymentRef: input.paymentRef,
        renewalCycleId: input.renewalCycleId ?? null,
        // NET / KDV / GROSS exactly as the quote computed them: line prices
        // are KDV-inclusive and the tax is derived OUT, never added on top.
        subtotalCents: q.subtotalCents,
        taxCents: q.taxCents,
        shippingCents: q.shippingCents,
        totalCents: q.totalCents,
        currency: q.currency,
        periodStart: starts.length
          ? new Date(Math.min(...starts.map((d) => d.getTime())))
          : null,
        periodEnd: periods.length
          ? new Date(Math.max(...periods.map((d) => d.getTime())))
          : null,
        issuedAt,
        paidAt: issuedAt,
        taxIdSnapshot: tenant?.taxId ?? null,
        referralCode: input.referralCode ?? null,
        referredByMarketingUserId: input.referredByMarketingUserId ?? null,
        lines: {
          create: q.lines.map((l, i) => ({
            lineNo: i + 1,
            kind: l.meta?.kind ?? l.type,
            code: l.code,
            // Snapshot the name — the catalog may be renamed later, and a
            // reissued PDF must still say what the customer bought.
            name: l.name,
            qty: l.qty,
            unitCents: l.unitCents,
            subtotalCents: l.subtotalCents,
            prorationMeta:
              l.meta?.prorationMode != null
                ? ({
                    annualPriceCents: l.meta.annualPriceCents,
                    prorationMode: l.meta.prorationMode,
                    proratedDays: l.meta.proratedDays,
                    cycleDays: l.meta.cycleDays,
                  } as Prisma.InputJsonValue)
                : Prisma.JsonNull,
            periodStart: l.meta?.periodStart
              ? new Date(l.meta.periodStart)
              : null,
            periodEnd: l.meta?.periodEnd ? new Date(l.meta.periodEnd) : null,
          })),
        },
      },
      include: { lines: true },
    });
  }

  /** Tenant-facing invoice list for the billing page. */
  async listForTenant(tenantId: string, take = 50) {
    return this.prisma.tenantInvoice.findMany({
      where: { tenantId },
      orderBy: { issuedAt: "desc" },
      take,
      include: { lines: { orderBy: { lineNo: "asc" } } },
    });
  }

  async findForTenant(tenantId: string, invoiceId: string) {
    return this.prisma.tenantInvoice.findFirst({
      where: { id: invoiceId, tenantId },
      include: { lines: { orderBy: { lineNo: "asc" } } },
    });
  }
}
