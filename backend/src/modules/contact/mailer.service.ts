import { Injectable, Logger } from "@nestjs/common";
import * as nodemailer from "nodemailer";
import * as handlebars from "handlebars";
import * as fs from "fs";
import * as path from "path";
import { maskEmail } from "../../common/helpers/pii-mask.helper";

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private transporter: nodemailer.Transporter;

  constructor() {
    this.initializeTransporter();
  }

  private initializeTransporter() {
    // Check if email is configured
    if (!process.env.EMAIL_HOST || !process.env.EMAIL_PORT) {
      this.logger.warn(
        "Email service not configured. EMAIL_HOST and EMAIL_PORT environment variables are required.",
      );
      return;
    }

    this.transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: parseInt(process.env.EMAIL_PORT, 10),
      secure: process.env.EMAIL_SECURE === "true", // true for 465, false for other ports
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
    });

    this.logger.log("Email transporter initialized successfully");
  }

  private async loadTemplate(
    templateName: string,
    context: any,
  ): Promise<string> {
    try {
      // Same webpack-bundle gotcha iter-23 documents in
      // subscriptions/services/notification.service.ts: NestJS+webpack
      // collapses every .ts into dist/main.js, so at runtime __dirname
      // is /app/dist/ regardless of source location. The old form
      // (path.join(__dirname, 'templates', ...)) tried to load from
      // /app/dist/templates/ in prod — a directory the Dockerfile never
      // creates — so every contact-form admin + user-confirmation email
      // raised "Failed to load email template" and was swallowed by the
      // catch boundaries below. process.cwd() pins the resolution to
      // the backend root in both dev AND prod, matching the source
      // layout the Dockerfile preserves at /app/src/modules/contact/
      // templates/ (see the COPY rule added to backend/Dockerfile in
      // this same commit).
      const templatePath = path.join(
        process.cwd(),
        "src/modules/contact/templates",
        `${templateName}.hbs`,
      );
      const templateContent = fs.readFileSync(templatePath, "utf-8");
      const template = handlebars.compile(templateContent);
      return template(context);
    } catch (error) {
      this.logger.error(`Failed to load template ${templateName}`, error);
      throw new Error(`Failed to load email template: ${templateName}`);
    }
  }

  async sendAdminNotification(data: {
    name: string;
    email: string;
    phone?: string;
    message: string;
  }): Promise<boolean> {
    if (!this.transporter) {
      this.logger.warn(
        "Email transporter not configured. Skipping admin notification.",
      );
      return false;
    }

    try {
      const html = await this.loadTemplate("admin-notification", {
        ...data,
        timestamp: new Date().toLocaleString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          timeZoneName: "short",
        }),
      });

      const mailOptions = {
        from: process.env.EMAIL_FROM || "noreply@hummytummy.com",
        to: process.env.ADMIN_EMAIL || "contact@hummytummy.com",
        subject: `New Contact Form Submission from ${data.name}`,
        html,
      };

      await this.transporter.sendMail(mailOptions);
      this.logger.log(
        `Admin notification sent for contact form from ${maskEmail(data.email)}`,
      );
      return true;
    } catch (error) {
      this.logger.error("Failed to send admin notification", error);
      return false;
    }
  }

  // NOTE: a `sendUserConfirmation` / `sendBothEmails` helper used to
  // live here. Both were deleted in iter-58.
  //
  // The user-confirmation flow sent an email TO the address the public
  // contact form submitted. Since that address is attacker-controlled, an
  // attacker posting `email = victim@x` turned the SMTP sender into a
  // spam cannon that mailed `victim@x` on demand under the platform's
  // From: identity (and counted against our deliverability reputation).
  // contact.service.ts dropped the call in the iter-19 audit; the
  // methods stayed behind as dead code, ready to be re-wired by a
  // future change that didn't read the comment. Removed now so the
  // primitive can't come back without re-implementing it.
}
