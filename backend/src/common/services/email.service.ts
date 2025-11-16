import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';
import * as fs from 'fs';
import * as path from 'path';
import * as Handlebars from 'handlebars';

// Register Handlebars helpers
Handlebars.registerHelper('currentYear', () => new Date().getFullYear());

export interface EmailOptions {
  to: string;
  subject: string;
  template: string;
  context: Record<string, any>;
}

@Injectable()
export class EmailService {
  private transporter: Transporter;
  private readonly logger = new Logger(EmailService.name);
  private readonly templatesPath: string;

  constructor(private configService: ConfigService) {
    // Use process.cwd() instead of __dirname for bundled production builds
    this.templatesPath = path.join(process.cwd(), 'templates/emails');
    this.initializeTransporter();
  }

  private initializeTransporter() {
    const host = this.configService.get<string>('EMAIL_HOST');
    const port = this.configService.get<number>('EMAIL_PORT');
    const user = this.configService.get<string>('EMAIL_USER');
    const pass = this.configService.get<string>('EMAIL_PASSWORD');

    if (!host || !user || !pass) {
      this.logger.warn(
        'Email configuration missing. Emails will be logged instead of sent.',
      );
      return;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // true for 465, false for other ports
      auth: {
        user,
        pass,
      },
    });

    // Verify connection
    this.transporter.verify((error) => {
      if (error) {
        this.logger.error('Email transporter verification failed:', error);
      } else {
        this.logger.log('Email transporter is ready to send emails');
      }
    });
  }

  /**
   * Send email using template
   */
  async sendEmail(options: EmailOptions): Promise<boolean> {
    try {
      const { to, subject, template, context } = options;

      // Compile template
      const html = await this.compileTemplate(template, context);

      // If no transporter (missing config), just log
      if (!this.transporter) {
        this.logger.log(`[EMAIL MOCK] To: ${to}`);
        this.logger.log(`[EMAIL MOCK] Subject: ${subject}`);
        this.logger.log(`[EMAIL MOCK] Template: ${template}`);
        this.logger.log(`[EMAIL MOCK] Context:`, context);
        return true;
      }

      const from = this.configService.get<string>('EMAIL_FROM') || this.configService.get<string>('EMAIL_USER');

      // Send email
      const info = await this.transporter.sendMail({
        from: `"${this.configService.get<string>('APP_NAME', 'HummyTummy')}" <${from}>`,
        to,
        subject,
        html,
      });

      this.logger.log(`Email sent successfully to ${to}. Message ID: ${info.messageId}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to send email to ${options.to}:`, error);
      return false;
    }
  }

  /**
   * Compile Handlebars template
   */
  private async compileTemplate(
    templateName: string,
    context: Record<string, any>,
  ): Promise<string> {
    try {
      const templatePath = path.join(this.templatesPath, `${templateName}.hbs`);
      const templateSource = fs.readFileSync(templatePath, 'utf-8');
      const template = Handlebars.compile(templateSource);
      return template(context);
    } catch (error) {
      this.logger.error(`Failed to compile template ${templateName}:`, error);
      throw new Error(`Email template ${templateName} not found or invalid`);
    }
  }

  /**
   * Send password reset email
   */
  async sendPasswordResetEmail(email: string, resetToken: string): Promise<boolean> {
    const resetLink = `${this.configService.get<string>('FRONTEND_URL', 'http://localhost:5173')}/reset-password?token=${resetToken}`;

    return this.sendEmail({
      to: email,
      subject: 'Password Reset Request',
      template: 'password-reset',
      context: {
        resetLink,
        expiresIn: '1 hour',
      },
    });
  }

  /**
   * Send email verification code
   * Sends a 6-digit code for email verification
   */
  async sendEmailVerificationCode(
    email: string,
    code: string,
    userName: string,
  ): Promise<boolean> {
    return this.sendEmail({
      to: email,
      subject: 'Email Doğrulama Kodu - HummyTummy',
      template: 'email-verification-code',
      context: {
        userName,
        code,
        expiresIn: '1 saat',
      },
    });
  }

  /**
   * Send welcome email
   */
  async sendWelcomeEmail(
    email: string,
    userName: string,
    restaurantName?: string,
  ): Promise<boolean> {
    return this.sendEmail({
      to: email,
      subject: 'Welcome to HummyTummy!',
      template: 'welcome',
      context: {
        userName,
        restaurantName: restaurantName || 'our platform',
        loginLink: `${this.configService.get<string>('FRONTEND_URL', 'http://localhost:5173')}/login`,
      },
    });
  }
}
