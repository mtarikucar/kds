import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  Res,
  NotFoundException,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../auth/guards/tenant.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../../common/constants/roles.enum';
import { BillingService } from '../services/billing.service';
import { InvoicePdfService } from '../services/invoice-pdf.service';

@Controller('invoices')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class InvoiceController {
  constructor(
    private readonly billingService: BillingService,
    private readonly invoicePdfService: InvoicePdfService,
  ) {}

  /**
   * Get invoice by ID
   */
  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async getInvoice(@Param('id') id: string) {
    const invoice = await this.billingService.getInvoiceByNumber(id);
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    return invoice;
  }

  /**
   * Download invoice PDF/HTML
   */
  @Get(':id/download')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async downloadInvoice(@Param('id') id: string, @Res() res: Response) {
    const invoice = await this.billingService.getInvoiceByNumber(id);

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    // Generate PDF if it doesn't exist
    if (!invoice.pdfUrl || !this.invoicePdfService.invoicePdfExists(invoice.invoiceNumber)) {
      await this.invoicePdfService.generateInvoicePdf(invoice.id);
    }

    // Read and return the file
    const fileContent = this.invoicePdfService.readInvoiceFile(invoice.invoiceNumber);

    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Content-Disposition', `inline; filename="invoice-${invoice.invoiceNumber}.html"`);
    res.send(fileContent);
  }

  /**
   * Generate PDF for invoice
   */
  @Post(':id/generate-pdf')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async generatePdf(@Param('id') id: string) {
    const pdfUrl = await this.invoicePdfService.generateInvoicePdf(id);
    return { success: true, pdfUrl };
  }
}
