import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { InvoiceStatus } from '../../../common/constants/subscription.enum';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Generate a unique invoice number
   */
  private generateInvoiceNumber(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `INV-${year}${month}${day}-${random}`;
  }

  /**
   * Create an invoice for a subscription payment
   */
  async createInvoice(
    subscriptionId: string,
    paymentId: string | null,
    amount: number,
    currency: string,
    periodStart: Date,
    periodEnd: Date,
    description?: string,
  ) {
    try {
      const invoiceNumber = this.generateInvoiceNumber();

      // Calculate tax (you can customize this based on your requirements)
      const taxRate = 0; // 0% for now, adjust as needed
      const subtotal = amount;
      const tax = subtotal * taxRate;
      const total = subtotal + tax;

      const invoice = await this.prisma.invoice.create({
        data: {
          subscriptionId,
          paymentId,
          invoiceNumber,
          status: paymentId ? InvoiceStatus.PAID : InvoiceStatus.OPEN,
          subtotal,
          tax,
          total,
          currency,
          periodStart,
          periodEnd,
          dueDate: new Date(), // Due immediately
          paidAt: paymentId ? new Date() : null,
          description: description || `Subscription invoice for ${periodStart.toLocaleDateString()} - ${periodEnd.toLocaleDateString()}`,
        },
      });

      this.logger.log(`Invoice created: ${invoice.invoiceNumber} for subscription ${subscriptionId}`);
      return invoice;
    } catch (error) {
      this.logger.error(`Failed to create invoice: ${error.message}`);
      throw error;
    }
  }

  /**
   * Mark invoice as paid
   */
  async markInvoiceAsPaid(invoiceId: string, paymentId: string) {
    try {
      return await this.prisma.invoice.update({
        where: { id: invoiceId },
        data: {
          status: InvoiceStatus.PAID,
          paidAt: new Date(),
          paymentId,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to mark invoice as paid: ${error.message}`);
      throw error;
    }
  }

  /**
   * Mark invoice as void
   */
  async voidInvoice(invoiceId: string) {
    try {
      return await this.prisma.invoice.update({
        where: { id: invoiceId },
        data: {
          status: InvoiceStatus.VOID,
          voidedAt: new Date(),
        },
      });
    } catch (error) {
      this.logger.error(`Failed to void invoice: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get invoices for a subscription
   */
  async getSubscriptionInvoices(subscriptionId: string) {
    return await this.prisma.invoice.findMany({
      where: { subscriptionId },
      orderBy: { createdAt: 'desc' },
      include: {
        payment: true,
      },
    });
  }

  /**
   * Get invoice by number
   */
  async getInvoiceByNumber(invoiceNumber: string) {
    return await this.prisma.invoice.findUnique({
      where: { invoiceNumber },
      include: {
        subscription: {
          include: {
            plan: true,
            tenant: true,
          },
        },
        payment: true,
      },
    });
  }

  /**
   * Get all invoices for a tenant
   */
  async getTenantInvoices(tenantId: string) {
    return await this.prisma.invoice.findMany({
      where: {
        subscription: {
          tenantId,
        },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        subscription: {
          include: {
            plan: true,
          },
        },
        payment: true,
      },
    });
  }

  /**
   * Calculate proration for plan changes
   */
  calculateProration(
    currentAmount: number,
    newAmount: number,
    daysRemaining: number,
    totalDaysInPeriod: number,
  ): number {
    // Calculate unused amount from current plan
    const unusedAmount = (currentAmount / totalDaysInPeriod) * daysRemaining;

    // Calculate amount for new plan for remaining days
    const newPlanAmount = (newAmount / totalDaysInPeriod) * daysRemaining;

    // Return the difference (positive for upgrade, negative for downgrade)
    return newPlanAmount - unusedAmount;
  }

  /**
   * Get days remaining in billing period
   */
  getDaysRemaining(periodEnd: Date): number {
    const now = new Date();
    const diff = periodEnd.getTime() - now.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }

  /**
   * Get total days in billing period
   */
  getTotalDaysInPeriod(periodStart: Date, periodEnd: Date): number {
    const diff = periodEnd.getTime() - periodStart.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }
}
