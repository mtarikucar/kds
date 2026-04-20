import {
  Controller,
  Get,
  Post,
  Param,
  Req,
  Res,
  NotFoundException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../../common/constants/roles.enum';
import { BillingService } from '../services/billing.service';
import { InvoicePdfService } from '../services/invoice-pdf.service';

/**
 * Tenant-scoped invoice endpoints. JwtAuthGuard / TenantGuard / RolesGuard
 * are already global via APP_GUARD, so we rely on `req.tenantId` injected
 * by TenantGuard and filter every lookup by it — the prior version did a
 * global invoice-number lookup, enabling cross-tenant IDOR.
 */
@Controller('invoices')
export class InvoiceController {
  constructor(
    private readonly billingService: BillingService,
    private readonly invoicePdfService: InvoicePdfService,
  ) {}

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async getInvoice(@Param('id') invoiceNumber: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const invoice = await this.billingService.getInvoiceByNumber(
      invoiceNumber,
      tenantId,
    );
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    return invoice;
  }

  @Get(':id/download')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async downloadInvoice(
    @Param('id') invoiceNumber: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const tenantId = (req as any).tenantId;
    const invoice = await this.billingService.getInvoiceByNumber(
      invoiceNumber,
      tenantId,
    );
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    if (!this.invoicePdfService.invoicePdfExists(invoice.invoiceNumber)) {
      await this.invoicePdfService.generateInvoicePdf(invoice.id);
    }

    const fileContent = this.invoicePdfService.readInvoiceFile(invoice.invoiceNumber);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="invoice-${invoice.invoiceNumber}.pdf"`,
    );
    res.send(fileContent);
  }

  @Post(':id/generate-pdf')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async generatePdf(@Param('id') invoiceNumber: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const invoice = await this.billingService.getInvoiceByNumber(
      invoiceNumber,
      tenantId,
    );
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    const filename = await this.invoicePdfService.generateInvoicePdf(invoice.id);
    return { success: true, filename };
  }
}
