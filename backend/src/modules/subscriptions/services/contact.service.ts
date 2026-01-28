import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationService } from './notification.service';

export enum ContactMethod {
  WHATSAPP = 'WHATSAPP',
  EMAIL = 'EMAIL',
}

export interface ContactInquiry {
  tenantId: string;
  tenantName: string;
  planId: string;
  planName: string;
  billingCycle: string;
  method: ContactMethod;
  customerEmail: string;
  customerName: string;
}

// Fixed contact information
const CONTACT_INFO = {
  whatsapp: '+905060687100',
  email: 'admin@hummytummy.com',
};

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * Generate WhatsApp link with pre-filled message
   */
  getWhatsAppLink(planName: string, billingCycle: string, tenantName: string): string {
    const billingCycleText = billingCycle === 'MONTHLY' ? 'Aylik' : 'Yillik';
    const message = encodeURIComponent(
      `Merhaba, ${tenantName} restoran icin ${planName} (${billingCycleText}) plani hakkinda bilgi almak istiyorum.`
    );
    return `https://wa.me/${CONTACT_INFO.whatsapp.replace('+', '')}?text=${message}`;
  }

  /**
   * Generate Email mailto link with pre-filled subject and body
   */
  getEmailLink(planName: string, billingCycle: string, tenantName: string): string {
    const billingCycleText = billingCycle === 'MONTHLY' ? 'Aylik' : 'Yillik';
    const subject = encodeURIComponent(`Abonelik Talebi - ${tenantName}`);
    const body = encodeURIComponent(
      `Merhaba,\n\n${tenantName} restoran icin ${planName} (${billingCycleText}) plani hakkinda bilgi almak istiyorum.\n\nSaygılarımla`
    );
    return `mailto:${CONTACT_INFO.email}?subject=${subject}&body=${body}`;
  }

  /**
   * Get contact information
   */
  getContactInfo() {
    return {
      whatsapp: CONTACT_INFO.whatsapp,
      email: CONTACT_INFO.email,
    };
  }

  /**
   * Record contact inquiry for tracking purposes
   */
  async recordContactInquiry(inquiry: ContactInquiry): Promise<void> {
    this.logger.log(
      `Contact inquiry recorded: ${inquiry.tenantName} - ${inquiry.planName} - ${inquiry.method}`
    );

    // Notify admin about the inquiry
    await this.notifyAdmin(inquiry);
  }

  /**
   * Notify admin about subscription inquiry
   */
  async notifyAdmin(inquiry: ContactInquiry): Promise<void> {
    try {
      await this.notificationService.sendContactInquiryNotification(
        inquiry.customerEmail,
        inquiry.customerName,
        inquiry.tenantName,
        inquiry.tenantId,
        inquiry.planName,
        inquiry.billingCycle,
        inquiry.method,
      );
    } catch (error) {
      this.logger.error(`Failed to notify admin about contact inquiry: ${error.message}`);
    }
  }
}
