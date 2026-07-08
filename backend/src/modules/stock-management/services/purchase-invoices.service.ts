import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { BranchScope, branchScope } from "../../../common/scoping/branch-scope";

interface CreateInvoiceInput {
  supplierId: string;
  purchaseOrderId?: string;
  invoiceNumber: string;
  invoiceDate: string;
  subtotal: number;
  taxAmount: number;
  notes?: string;
}

const D = (v: Prisma.Decimal | number | string | null | undefined) =>
  v == null ? new Prisma.Decimal(0) : new Prisma.Decimal(v as any);

/**
 * Accounts-Payable vendor bills with a 3-way match. A bill can be linked to a
 * PurchaseOrder; on create (and on demand) the invoice total is matched against
 * what was actually RECEIVED (GRN = Σ quantityReceived × unitPrice). Within
 * tolerance (max of 1 kuruş / 1% of received) → MATCHED, otherwise DISCREPANCY
 * so it can't be approved/paid blind. taxAmount is the deductible input VAT
 * (indirilecek KDV). Bills are deduped per (supplier, invoiceNumber).
 */
@Injectable()
export class PurchaseInvoicesService {
  constructor(private prisma: PrismaService) {}

  private tolerance(receivedTotal: Prisma.Decimal): Prisma.Decimal {
    const onePct = receivedTotal.mul("0.01");
    return onePct.gt("0.01") ? onePct : new Prisma.Decimal("0.01");
  }

  /** 3-way match breakdown for a PO vs a given invoice total. */
  async computeMatch(
    scope: BranchScope,
    purchaseOrderId: string,
    invoiceTotal: Prisma.Decimal,
  ) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, ...branchScope(scope) },
      include: {
        items: {
          select: {
            quantityOrdered: true,
            quantityReceived: true,
            unitPrice: true,
          },
        },
      },
    });
    if (!po) {
      throw new BadRequestException("Linked purchase order not found");
    }

    const orderedTotal = po.items.reduce(
      (s, i) => s.add(D(i.quantityOrdered).mul(i.unitPrice)),
      new Prisma.Decimal(0),
    );
    const receivedTotal = po.items.reduce(
      (s, i) => s.add(D(i.quantityReceived).mul(i.unitPrice)),
      new Prisma.Decimal(0),
    );
    const variance = invoiceTotal.sub(receivedTotal);
    const tol = this.tolerance(receivedTotal);
    const matched = variance.abs().lte(tol);

    return {
      orderedTotal: orderedTotal.toDecimalPlaces(2).toNumber(),
      receivedTotal: receivedTotal.toDecimalPlaces(2).toNumber(),
      invoiceTotal: invoiceTotal.toDecimalPlaces(2).toNumber(),
      variance: variance.toDecimalPlaces(2).toNumber(),
      tolerance: tol.toDecimalPlaces(2).toNumber(),
      matched,
      status: matched ? "MATCHED" : "DISCREPANCY",
    };
  }

  async create(scope: BranchScope, userId: string, dto: CreateInvoiceInput) {
    const dup = await this.prisma.purchaseInvoice.findFirst({
      where: {
        tenantId: scope.tenantId,
        supplierId: dto.supplierId,
        invoiceNumber: dto.invoiceNumber,
      },
    });
    if (dup) {
      throw new ConflictException(
        "An invoice with this number already exists for this supplier",
      );
    }

    const total = D(dto.subtotal).add(D(dto.taxAmount));
    let status = "RECEIVED";
    let matchVariance: Prisma.Decimal | null = null;
    if (dto.purchaseOrderId) {
      const match = await this.computeMatch(
        scope,
        dto.purchaseOrderId,
        total,
      );
      status = match.status;
      matchVariance = new Prisma.Decimal(match.variance);
    }

    return this.prisma.purchaseInvoice.create({
      data: {
        tenantId: scope.tenantId,
        branchId: scope.branchId,
        supplierId: dto.supplierId,
        purchaseOrderId: dto.purchaseOrderId ?? null,
        invoiceNumber: dto.invoiceNumber,
        invoiceDate: new Date(dto.invoiceDate),
        subtotal: D(dto.subtotal),
        taxAmount: D(dto.taxAmount),
        total,
        status,
        matchVariance,
        notes: dto.notes ?? null,
        createdById: userId,
      },
    });
  }

  async list(
    scope: BranchScope,
    opts?: { status?: string; supplierId?: string; limit?: number },
  ) {
    return this.prisma.purchaseInvoice.findMany({
      where: {
        ...branchScope(scope),
        ...(opts?.status ? { status: opts.status } : {}),
        ...(opts?.supplierId ? { supplierId: opts.supplierId } : {}),
      },
      orderBy: { invoiceDate: "desc" },
      take: Math.min(opts?.limit ?? 50, 200),
    });
  }

  async getMatch(scope: BranchScope, invoiceId: string) {
    const invoice = await this.prisma.purchaseInvoice.findFirst({
      where: { id: invoiceId, ...branchScope(scope) },
    });
    if (!invoice) throw new NotFoundException("Invoice not found");
    if (!invoice.purchaseOrderId) {
      return { linked: false, invoiceTotal: Number(invoice.total) };
    }
    return {
      linked: true,
      ...(await this.computeMatch(
        scope,
        invoice.purchaseOrderId,
        D(invoice.total),
      )),
    };
  }

  /** Approve a matched/discrepant invoice (a DISCREPANCY needs a manager's ok). */
  async approve(scope: BranchScope, invoiceId: string) {
    const claim = await this.prisma.purchaseInvoice.updateMany({
      where: {
        id: invoiceId,
        ...branchScope(scope),
        status: { in: ["MATCHED", "DISCREPANCY", "RECEIVED"] },
      },
      data: { status: "APPROVED" },
    });
    if (claim.count === 0) {
      throw new BadRequestException(
        "Invoice not found or not in an approvable state",
      );
    }
    return this.prisma.purchaseInvoice.findFirst({
      where: { id: invoiceId, ...branchScope(scope) },
    });
  }

  async markPaid(scope: BranchScope, invoiceId: string) {
    const claim = await this.prisma.purchaseInvoice.updateMany({
      where: { id: invoiceId, ...branchScope(scope), status: "APPROVED" },
      data: { status: "PAID" },
    });
    if (claim.count === 0) {
      throw new BadRequestException(
        "Invoice must be APPROVED before it can be marked paid",
      );
    }
    return this.prisma.purchaseInvoice.findFirst({
      where: { id: invoiceId, ...branchScope(scope) },
    });
  }
}
