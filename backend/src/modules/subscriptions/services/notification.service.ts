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

  /**
   * Send trial started email
   */
  async sendTrialStarted(email: string, tenantName: string, planName: string, trialDays: number) {
    return this.sendEmail({
      to: email,
      subject: `Your ${planName} trial has started!`,
      template: 'trial-started',
      context: {
        tenantName,
        planName,
        trialDays,
        expiryDate: new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toLocaleDateString(),
      },
    });
  }

  /**
   * Send trial ending reminder
   */
  async sendTrialEndingReminder(email: string, tenantName: string, planName: string, daysRemaining: number) {
    return this.sendEmail({
      to: email,
      subject: `Your trial ends in ${daysRemaining} days`,
      template: 'trial-ending',
      context: {
        tenantName,
        planName,
        daysRemaining,
      },
    });
  }

  /**
   * Send trial expired notification
   */
  async sendTrialExpired(email: string, tenantName: string, planName: string) {
    return this.sendEmail({
      to: email,
      subject: 'Your trial has expired',
      template: 'trial-expired',
      context: {
        tenantName,
        planName,
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
      subject: 'Payment received - Thank you!',
      template: 'payment-successful',
      context: {
        tenantName,
        amount,
        currency,
        invoiceNumber,
        paymentDate: new Date().toLocaleDateString(),
      },
    });
  }

  /**
   * Send payment failed email
   */
  async sendPaymentFailed(email: string, tenantName: string, amount: number, reason: string) {
    return this.sendEmail({
      to: email,
      subject: 'Payment failed - Action required',
      template: 'payment-failed',
      context: {
        tenantName,
        amount,
        reason,
      },
    });
  }

  /**
   * Send subscription activated email
   */
  async sendSubscriptionActivated(email: string, tenantName: string, planName: string, billingCycle: string) {
    return this.sendEmail({
      to: email,
      subject: `Your ${planName} subscription is now active`,
      template: 'subscription-activated',
      context: {
        tenantName,
        planName,
        billingCycle,
      },
    });
  }

  /**
   * Send subscription cancelled email
   */
  async sendSubscriptionCancelled(email: string, tenantName: string, planName: string, endDate: Date) {
    return this.sendEmail({
      to: email,
      subject: 'Subscription cancelled',
      template: 'subscription-cancelled',
      context: {
        tenantName,
        planName,
        endDate: endDate.toLocaleDateString(),
      },
    });
  }

  /**
   * Send subscription cancelled immediately email
   */
  async sendSubscriptionCancelledImmediate(email: string, tenantName: string, planName: string, reason?: string) {
    return this.sendEmail({
      to: email,
      subject: 'Subscription cancelled',
      template: 'subscription-cancelled-immediate',
      context: {
        tenantName,
        planName,
        reason: reason || 'No reason provided',
        cancelledDate: new Date().toLocaleDateString(),
      },
    });
  }

  /**
   * Send subscription will cancel at period end email
   */
  async sendSubscriptionWillCancel(email: string, tenantName: string, planName: string, endDate: Date, reason?: string) {
    return this.sendEmail({
      to: email,
      subject: 'Subscription cancellation scheduled',
      template: 'subscription-will-cancel',
      context: {
        tenantName,
        planName,
        reason: reason || 'No reason provided',
        endDate: endDate.toLocaleDateString(),
      },
    });
  }

  /**
   * Send invoice ready notification
   */
  async sendInvoiceReady(email: string, tenantName: string, invoiceNumber: string, amount: number, pdfUrl?: string) {
    return this.sendEmail({
      to: email,
      subject: `Invoice ${invoiceNumber} is ready`,
      template: 'invoice-ready',
      context: {
        tenantName,
        invoiceNumber,
        amount,
        pdfUrl,
      },
    });
  }

  /**
   * Send plan upgraded email
   */
  async sendPlanUpgraded(email: string, tenantName: string, oldPlan: string, newPlan: string) {
    return this.sendEmail({
      to: email,
      subject: `Plan upgraded to ${newPlan}`,
      template: 'plan-upgraded',
      context: {
        tenantName,
        oldPlan,
        newPlan,
      },
    });
  }

  /**
   * Send plan downgraded email
   */
  async sendPlanDowngraded(email: string, tenantName: string, oldPlan: string, newPlan: string, effectiveDate: Date) {
    return this.sendEmail({
      to: email,
      subject: `Plan change scheduled`,
      template: 'plan-downgraded',
      context: {
        tenantName,
        oldPlan,
        newPlan,
        effectiveDate: effectiveDate.toLocaleDateString(),
      },
    });
  }

  /**
   * Send plan change confirmation email
   */
  async sendPlanChangeConfirmation(email: string, tenantName: string, newPlanName: string) {
    return this.sendEmail({
      to: email,
      subject: `Plan changed to ${newPlanName}`,
      template: 'plan-change-confirmation',
      context: {
        tenantName,
        planName: newPlanName,
        changeDate: new Date().toLocaleDateString(),
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
}
