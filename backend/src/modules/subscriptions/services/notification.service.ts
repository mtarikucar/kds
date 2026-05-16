import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';
import * as handlebars from 'handlebars';
import * as fs from 'fs';
import * as path from 'path';

export interface EmailOptions {
  to: string;
  subject: string;
  template: string;
  context: Record<string, any>;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private transporter: Transporter;
  private templatesPath: string;

  constructor(private configService: ConfigService) {
    this.templatesPath = path.join(__dirname, '../templates/emails');
    this.initializeTransporter();
  }

  private initializeTransporter() {
    const emailConfig = {
      host: this.configService.get('EMAIL_HOST', 'smtpout.secureserver.net'),
      port: this.configService.get('EMAIL_PORT', 587),
      secure: this.configService.get('EMAIL_SECURE', false),
      auth: {
        user: this.configService.get('EMAIL_USER'),
        pass: this.configService.get('EMAIL_PASSWORD'),
      },
    };

    if (!emailConfig.auth.user || !emailConfig.auth.pass) {
      this.logger.warn('Email credentials not configured. Email notifications will be disabled.');
      return;
    }

    this.transporter = nodemailer.createTransport(emailConfig);
  }

  /**
   * Send email using template
   */
  async sendEmail(options: EmailOptions): Promise<boolean> {
    if (!this.transporter) {
      this.logger.warn(`Email not sent (no transporter): ${options.subject}`);
      return false;
    }

    try {
      const html = await this.renderTemplate(options.template, options.context);

      await this.transporter.sendMail({
        from: this.configService.get('EMAIL_FROM', 'noreply@restaurant-pos.com'),
        to: options.to,
        subject: options.subject,
        html,
      });

      this.logger.log(`Email sent to ${options.to}: ${options.subject}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to send email: ${error.message}`);
      return false;
    }
  }

  /**
   * Render email template
   */
  private async renderTemplate(templateName: string, context: Record<string, any>): Promise<string> {
    const templatePath = path.join(this.templatesPath, `${templateName}.hbs`);

    try {
      const templateContent = fs.readFileSync(templatePath, 'utf-8');
      const template = handlebars.compile(templateContent);
      return template(context);
    } catch (error) {
      this.logger.error(`Failed to render template ${templateName}: ${error.message}`);
      // Return a simple fallback template
      return `<p>${context.message || 'Notification from HummyTummy'}</p>`;
    }
  }

  /** App base URL used in template links. */
  private get appUrl(): string {
    return this.configService.get<string>('APP_URL') ?? 'http://localhost:5173';
  }

  /**
   * Send trial-started email. Subjects/bodies are Turkish — the product
   * targets the Turkish market and recipients are virtually always
   * Turkish-speaking. Locale-aware i18n can be layered on later.
   */
  async sendTrialStarted(email: string, tenantName: string, planName: string, trialDays: number) {
    return this.sendEmail({
      to: email,
      subject: `${planName} deneme süreniz başladı`,
      template: 'trial-started',
      context: {
        tenantName,
        planName,
        trialDays,
        expiryDate: new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toLocaleDateString('tr-TR'),
        appUrl: this.appUrl,
      },
    });
  }

  /**
   * Send trial-ending reminder. Cron fires this at 7-day, 3-day, and
   * 1-day windows before trialEnd with the appropriate daysRemaining.
   */
  async sendTrialEndingReminder(
    email: string,
    tenantName: string,
    planName: string,
    daysRemaining: number,
    extras?: { planId?: string; billingCycle?: string },
  ) {
    return this.sendEmail({
      to: email,
      subject: `Deneme süreniz ${daysRemaining} gün içinde bitiyor`,
      template: 'trial-ending',
      context: {
        tenantName,
        planName,
        daysRemaining,
        planId: extras?.planId ?? '',
        billingCycle: extras?.billingCycle ?? 'MONTHLY',
        appUrl: this.appUrl,
      },
    });
  }

  /**
   * Send trial-expired notification.
   */
  async sendTrialExpired(email: string, tenantName: string, planName: string) {
    return this.sendEmail({
      to: email,
      subject: 'Deneme süreniz sona erdi',
      template: 'trial-expired',
      context: {
        tenantName,
        planName,
        appUrl: this.appUrl,
      },
    });
  }

  /**
   * Send payment successful email
   */
  async sendPaymentSuccessful(
    email: string,
    tenantName: string,
    amount: number,
    currency: string,
    invoiceNumber: string,
  ) {
    return this.sendEmail({
      to: email,
      subject: 'Ödemeniz alındı - Teşekkür ederiz',
      template: 'payment-successful',
      context: {
        tenantName,
        amount,
        currency,
        invoiceNumber,
        paymentDate: new Date().toLocaleDateString('tr-TR'),
        appUrl: this.appUrl,
      },
    });
  }

  /** Date formatter pinned to tr-TR; receipts always render Turkish for
   *  the Turkish-market product. */
  private formatDate(d: Date): string {
    return d.toLocaleDateString('tr-TR');
  }

  /**
   * Send payment failed email
   */
  async sendPaymentFailed(email: string, tenantName: string, amount: number, reason: string) {
    return this.sendEmail({
      to: email,
      subject: 'Ödeme başarısız - İşlem gerekiyor',
      template: 'payment-failed',
      context: {
        tenantName,
        amount,
        reason,
        appUrl: this.appUrl,
      },
    });
  }

  /**
   * Send subscription activated email
   */
  async sendSubscriptionActivated(email: string, tenantName: string, planName: string, billingCycle: string) {
    return this.sendEmail({
      to: email,
      subject: `${planName} aboneliğiniz aktif`,
      template: 'subscription-activated',
      context: {
        tenantName,
        planName,
        billingCycle,
        appUrl: this.appUrl,
      },
    });
  }

  /**
   * Send subscription cancelled email
   */
  async sendSubscriptionCancelled(email: string, tenantName: string, planName: string, endDate: Date) {
    return this.sendEmail({
      to: email,
      subject: 'Aboneliğiniz iptal edildi',
      template: 'subscription-cancelled',
      context: {
        tenantName,
        planName,
        endDate: this.formatDate(endDate),
        appUrl: this.appUrl,
      },
    });
  }

  /**
   * Send subscription cancelled immediately email
   */
  async sendSubscriptionCancelledImmediate(email: string, tenantName: string, planName: string, reason?: string) {
    return this.sendEmail({
      to: email,
      subject: 'Aboneliğiniz iptal edildi',
      template: 'subscription-cancelled-immediate',
      context: {
        tenantName,
        planName,
        reason: reason || 'Belirtilmedi',
        cancelledDate: this.formatDate(new Date()),
        appUrl: this.appUrl,
      },
    });
  }

  /**
   * Send subscription will cancel at period end email
   */
  async sendSubscriptionWillCancel(email: string, tenantName: string, planName: string, endDate: Date, reason?: string) {
    return this.sendEmail({
      to: email,
      subject: 'Abonelik iptali planlandı',
      template: 'subscription-will-cancel',
      context: {
        tenantName,
        planName,
        reason: reason || 'Belirtilmedi',
        endDate: this.formatDate(endDate),
        appUrl: this.appUrl,
      },
    });
  }

  /**
   * Send invoice ready notification
   */
  async sendInvoiceReady(email: string, tenantName: string, invoiceNumber: string, amount: number, pdfUrl?: string) {
    return this.sendEmail({
      to: email,
      subject: `${invoiceNumber} numaralı faturanız hazır`,
      template: 'invoice-ready',
      context: {
        tenantName,
        invoiceNumber,
        amount,
        pdfUrl,
        appUrl: this.appUrl,
      },
    });
  }

  /**
   * Send plan upgraded email
   */
  async sendPlanUpgraded(email: string, tenantName: string, oldPlan: string, newPlan: string) {
    return this.sendEmail({
      to: email,
      subject: `${newPlan} planına yükseltildi`,
      template: 'plan-upgraded',
      context: {
        tenantName,
        oldPlan,
        newPlan,
        appUrl: this.appUrl,
      },
    });
  }

  /**
   * Send plan downgraded email
   */
  async sendPlanDowngraded(email: string, tenantName: string, oldPlan: string, newPlan: string, effectiveDate: Date) {
    return this.sendEmail({
      to: email,
      subject: 'Plan değişikliği planlandı',
      template: 'plan-downgraded',
      context: {
        tenantName,
        oldPlan,
        newPlan,
        effectiveDate: this.formatDate(effectiveDate),
        appUrl: this.appUrl,
      },
    });
  }

  /**
   * Send plan change confirmation email
   */
  async sendPlanChangeConfirmation(email: string, tenantName: string, newPlanName: string) {
    return this.sendEmail({
      to: email,
      subject: `Planınız ${newPlanName} olarak güncellendi`,
      template: 'plan-change-confirmation',
      context: {
        tenantName,
        planName: newPlanName,
        changeDate: this.formatDate(new Date()),
        appUrl: this.appUrl,
      },
    });
  }

  /**
   * Send payment retry notification
   */
  async sendPaymentRetryNotification(email: string, tenantName: string, amount: number, currency: string, nextRetryDate: Date) {
    return this.sendEmail({
      to: email,
      subject: 'Payment retry scheduled',
      template: 'payment-retry',
      context: {
        tenantName,
        amount,
        currency,
        nextRetryDate: nextRetryDate.toLocaleDateString(),
      },
    });
  }

  /**
   * Send subscription past due warning
   */
  async sendSubscriptionPastDue(email: string, tenantName: string, planName: string, amount: number, currency: string) {
    return this.sendEmail({
      to: email,
      subject: 'Subscription payment past due - Action required',
      template: 'subscription-past-due',
      context: {
        tenantName,
        planName,
        amount,
        currency,
      },
    });
  }

  /**
   * Send welcome email for new subscription
   */
  async sendWelcomeEmail(email: string, tenantName: string, planName: string) {
    return this.sendEmail({
      to: email,
      subject: `Welcome to ${planName}!`,
      template: 'welcome',
      context: {
        tenantName,
        planName,
      },
    });
  }

  /**
   * Send international subscription request to admin
   * For customers outside Turkey who want a subscription
   */
  async sendInternationalSubscriptionRequest(
    customerEmail: string,
    customerName: string,
    tenantName: string,
    tenantId: string,
    planName: string,
    planPrice: number,
    billingCycle: string,
    currency: string,
  ) {
    const adminEmail = this.configService.get('ADMIN_EMAIL', 'admin@hummytummy.com');

    return this.sendEmail({
      to: adminEmail,
      subject: `International Subscription Request - ${tenantName}`,
      template: 'international-subscription-request',
      context: {
        customerEmail,
        customerName,
        tenantName,
        tenantId,
        planName,
        planPrice,
        billingCycle,
        currency,
        requestDate: new Date().toLocaleString(),
      },
    });
  }

  /**
   * Send confirmation to customer that their international subscription request was received
   */
  async sendInternationalRequestConfirmation(
    email: string,
    tenantName: string,
    planName: string,
  ) {
    return this.sendEmail({
      to: email,
      subject: 'Subscription Request Received',
      template: 'international-request-confirmation',
      context: {
        tenantName,
        planName,
        requestDate: new Date().toLocaleString(),
      },
    });
  }

}
