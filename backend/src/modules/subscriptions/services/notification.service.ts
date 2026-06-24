import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as nodemailer from "nodemailer";
import { Transporter } from "nodemailer";
import * as handlebars from "handlebars";
import * as fsp from "fs/promises";
import * as path from "path";
import { maskEmail } from "../../../common/helpers/pii-mask.helper";

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
  // Iter-97: cache compiled handlebars templates. Templates change only
  // on deploy, so a Map that lives for the process lifetime is fine.
  // Pre-fix every email send re-read the .hbs file from disk
  // (fs.readFileSync — sync, blocking the event loop) and recompiled
  // via handlebars.compile (regex + AST + codegen). With cron-driven
  // bursts like sendTrialEndingReminder firing for every trial-ending
  // tenant in one tick, this serialized the email queue on disk I/O
  // and CPU compile time.
  private readonly templateCache = new Map<
    string,
    HandlebarsTemplateDelegate
  >();

  constructor(private configService: ConfigService) {
    // process.cwd() instead of __dirname — same reasoning EmailService
    // documents (common/services/email.service.ts:26). NestJS+webpack
    // bundles to a single dist/main.js, so __dirname at runtime is
    // /app/dist/ regardless of source location. Combined with the
    // `path.join(__dirname, '../templates/emails')` form, prod
    // accidentally resolved to /app/templates/emails/ — same dir
    // EmailService uses — but DEV resolved to
    // backend/src/modules/subscriptions/templates/emails/, forcing
    // 17 templates to be maintained in two locations to make dev work.
    // process.cwd() collapses both environments onto the same canonical
    // dir (backend/templates/emails/), making the subscriptions/
    // template duplicates obviously dead.
    this.templatesPath = path.join(process.cwd(), "templates/emails");
    this.initializeTransporter();
  }

  private initializeTransporter() {
    const emailConfig = {
      host: this.configService.get("EMAIL_HOST", "smtpout.secureserver.net"),
      port: this.configService.get("EMAIL_PORT", 587),
      secure: this.configService.get("EMAIL_SECURE", false),
      auth: {
        user: this.configService.get("EMAIL_USER"),
        pass: this.configService.get("EMAIL_PASSWORD"),
      },
    };

    if (!emailConfig.auth.user || !emailConfig.auth.pass) {
      this.logger.warn(
        "Email credentials not configured. Email notifications will be disabled.",
      );
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
        from: this.configService.get(
          "EMAIL_FROM",
          "noreply@restaurant-pos.com",
        ),
        to: options.to,
        subject: options.subject,
        html,
      });

      this.logger.log(
        `Email sent to ${maskEmail(options.to)}: ${options.subject}`,
      );
      return true;
    } catch (error) {
      this.logger.error(`Failed to send email: ${error.message}`);
      return false;
    }
  }

  /**
   * Render email template. Templates are compiled once per process and
   * memoized in `templateCache`; subsequent renders skip the disk read
   * and the handlebars.compile pass. See class field for context on the
   * pre-fix hot path.
   */
  private async renderTemplate(
    templateName: string,
    context: Record<string, any>,
  ): Promise<string> {
    try {
      const template = await this.loadTemplate(templateName);
      return template(context);
    } catch (error) {
      this.logger.error(
        `Failed to render template ${templateName}: ${error.message}`,
      );
      // Return a simple fallback template
      return `<p>${context.message || "Notification from HummyTummy"}</p>`;
    }
  }

  private async loadTemplate(
    templateName: string,
  ): Promise<HandlebarsTemplateDelegate> {
    const cached = this.templateCache.get(templateName);
    if (cached) return cached;
    const templatePath = path.join(this.templatesPath, `${templateName}.hbs`);
    const source = await fsp.readFile(templatePath, "utf-8");
    const compiled = handlebars.compile(source);
    this.templateCache.set(templateName, compiled);
    return compiled;
  }

  /** App base URL used in template links. */
  private get appUrl(): string {
    return this.configService.get<string>("APP_URL") ?? "http://localhost:5173";
  }

  /**
   * Send trial-started email. Subjects/bodies are Turkish — the product
   * targets the Turkish market and recipients are virtually always
   * Turkish-speaking. Locale-aware i18n can be layered on later.
   */
  async sendTrialStarted(
    email: string,
    tenantName: string,
    planName: string,
    trialDays: number,
  ) {
    return this.sendEmail({
      to: email,
      subject: `${planName} deneme süreniz başladı`,
      template: "trial-started",
      context: {
        tenantName,
        planName,
        trialDays,
        expiryDate: new Date(
          Date.now() + trialDays * 24 * 60 * 60 * 1000,
        ).toLocaleDateString("tr-TR"),
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
      template: "trial-ending",
      context: {
        tenantName,
        planName,
        daysRemaining,
        planId: extras?.planId ?? "",
        billingCycle: extras?.billingCycle ?? "MONTHLY",
        appUrl: this.appUrl,
      },
    });
  }

  /**
   * Send subscription-expiry reminder. Manual-renewal model: cron
   * fires this at 7-day, 3-day, and 1-day windows before
   * `currentPeriodEnd` so the tenant has time to re-purchase. The CTA
   * link drops them on `/subscription/plans?renew=1` which pre-fills
   * the current plan for a one-click re-checkout.
   */
  async sendSubscriptionExpiryReminder(
    email: string,
    tenantName: string,
    planName: string,
    expiresAt: Date,
    daysRemaining: 7 | 3 | 1,
  ) {
    const subject =
      daysRemaining === 1
        ? `${tenantName} aboneliğiniz YARIN sona eriyor`
        : `${tenantName} aboneliğiniz ${daysRemaining} gün içinde sona eriyor`;
    return this.sendEmail({
      to: email,
      subject,
      template: "subscription-expiry-reminder",
      context: {
        tenantName,
        planName,
        daysRemaining,
        expiresAt: expiresAt.toISOString().slice(0, 10),
        renewUrl: `${this.appUrl}/subscription/plans?renew=1`,
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
      subject: "Deneme süreniz sona erdi",
      template: "trial-expired",
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
      subject: "Ödemeniz alındı - Teşekkür ederiz",
      template: "payment-successful",
      context: {
        tenantName,
        amount,
        currency,
        invoiceNumber,
        paymentDate: new Date().toLocaleDateString("tr-TR"),
        appUrl: this.appUrl,
      },
    });
  }

  /** Date formatter pinned to tr-TR; receipts always render Turkish for
   *  the Turkish-market product. */
  private formatDate(d: Date): string {
    return d.toLocaleDateString("tr-TR");
  }

  /**
   * Send payment failed email
   */
  async sendPaymentFailed(
    email: string,
    tenantName: string,
    amount: number,
    reason: string,
  ) {
    return this.sendEmail({
      to: email,
      subject: "Ödeme başarısız - İşlem gerekiyor",
      template: "payment-failed",
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
  async sendSubscriptionActivated(
    email: string,
    tenantName: string,
    planName: string,
    billingCycle: string,
  ) {
    return this.sendEmail({
      to: email,
      subject: `${planName} aboneliğiniz aktif`,
      template: "subscription-activated",
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
  async sendSubscriptionCancelled(
    email: string,
    tenantName: string,
    planName: string,
    endDate: Date,
  ) {
    return this.sendEmail({
      to: email,
      subject: "Aboneliğiniz iptal edildi",
      template: "subscription-cancelled",
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
  async sendSubscriptionCancelledImmediate(
    email: string,
    tenantName: string,
    planName: string,
    reason?: string,
  ) {
    return this.sendEmail({
      to: email,
      subject: "Aboneliğiniz iptal edildi",
      template: "subscription-cancelled-immediate",
      context: {
        tenantName,
        planName,
        reason: reason || "Belirtilmedi",
        cancelledDate: this.formatDate(new Date()),
        appUrl: this.appUrl,
      },
    });
  }

  /**
   * Send subscription will cancel at period end email
   */
  async sendSubscriptionWillCancel(
    email: string,
    tenantName: string,
    planName: string,
    endDate: Date,
    reason?: string,
  ) {
    return this.sendEmail({
      to: email,
      subject: "Abonelik iptali planlandı",
      template: "subscription-will-cancel",
      context: {
        tenantName,
        planName,
        reason: reason || "Belirtilmedi",
        endDate: this.formatDate(endDate),
        appUrl: this.appUrl,
      },
    });
  }

  /**
   * Send invoice ready notification
   */
  async sendInvoiceReady(
    email: string,
    tenantName: string,
    invoiceNumber: string,
    amount: number,
    pdfUrl?: string,
  ) {
    return this.sendEmail({
      to: email,
      subject: `${invoiceNumber} numaralı faturanız hazır`,
      template: "invoice-ready",
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
  async sendPlanUpgraded(
    email: string,
    tenantName: string,
    oldPlan: string,
    newPlan: string,
  ) {
    return this.sendEmail({
      to: email,
      subject: `${newPlan} planına yükseltildi`,
      template: "plan-upgraded",
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
  async sendPlanDowngraded(
    email: string,
    tenantName: string,
    oldPlan: string,
    newPlan: string,
    effectiveDate: Date,
  ) {
    return this.sendEmail({
      to: email,
      subject: "Plan değişikliği planlandı",
      template: "plan-downgraded",
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
  async sendPlanChangeConfirmation(
    email: string,
    tenantName: string,
    newPlanName: string,
  ) {
    return this.sendEmail({
      to: email,
      subject: `Planınız ${newPlanName} olarak güncellendi`,
      template: "plan-change-confirmation",
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
  async sendPaymentRetryNotification(
    email: string,
    tenantName: string,
    amount: number,
    currency: string,
    nextRetryDate: Date,
  ) {
    return this.sendEmail({
      to: email,
      subject: "Payment retry scheduled",
      template: "payment-retry",
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
  async sendSubscriptionPastDue(
    email: string,
    tenantName: string,
    planName: string,
    amount: number,
    currency: string,
  ) {
    return this.sendEmail({
      to: email,
      subject: `${planName} aboneliğiniz ödemesi gecikti — yenileyin`,
      template: "subscription-past-due",
      context: {
        tenantName,
        planName,
        amount,
        currency,
        renewUrl: `${this.appUrl}/subscription/plans?renew=1`,
        appUrl: this.appUrl,
      },
    });
  }

  /**
   * Notify the operator that a recurring marketplace add-on lapsed. Manual-
   * renewal model (no PayTR card vault): when a recurring add-on's paid
   * period ends it goes `past_due` (entitlement kept live through grace) and
   * the operator must re-pay through the marketplace/checkout to keep it; if
   * grace elapses without re-payment it is `expired` and the capability is
   * revoked. So the add-on never silently stops, this fires at both stages.
   */
  async sendAddOnPastDue(
    email: string,
    tenantName: string,
    addOnCode: string,
    stage: "past_due" | "expired",
  ) {
    const subject =
      stage === "expired"
        ? `Eklenti süresi doldu — ${addOnCode}`
        : `Eklenti yenileme gerekiyor — ${addOnCode}`;
    return this.sendEmail({
      to: email,
      subject,
      template: "addon-past-due",
      context: {
        tenantName,
        addOnCode,
        expired: stage === "expired",
        renewUrl: `${this.appUrl}/marketplace?renew=${encodeURIComponent(addOnCode)}`,
        appUrl: this.appUrl,
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
      template: "welcome",
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
    const adminEmail = this.configService.get(
      "ADMIN_EMAIL",
      "admin@hummytummy.com",
    );

    return this.sendEmail({
      to: adminEmail,
      subject: `International Subscription Request - ${tenantName}`,
      template: "international-subscription-request",
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
      subject: "Subscription Request Received",
      template: "international-request-confirmation",
      context: {
        tenantName,
        planName,
        requestDate: new Date().toLocaleString(),
      },
    });
  }
}
