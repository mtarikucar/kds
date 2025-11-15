import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import * as handlebars from 'handlebars';
import * as fs from 'fs';
import * as path from 'path';

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
        'Email service not configured. EMAIL_HOST and EMAIL_PORT environment variables are required.',
      );
      return;
    }

    this.transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: parseInt(process.env.EMAIL_PORT, 10),
      secure: process.env.EMAIL_SECURE === 'true', // true for 465, false for other ports
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
    });

    this.logger.log('Email transporter initialized successfully');
  }

  private async loadTemplate(templateName: string, context: any): Promise<string> {
    try {
      const templatePath = path.join(__dirname, 'templates', `${templateName}.hbs`);
      const templateContent = fs.readFileSync(templatePath, 'utf-8');
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
      this.logger.warn('Email transporter not configured. Skipping admin notification.');
      return false;
    }

    try {
      const html = await this.loadTemplate('admin-notification', {
        ...data,
        timestamp: new Date().toLocaleString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          timeZoneName: 'short',
        }),
      });

      const mailOptions = {
        from: process.env.EMAIL_FROM || 'admin@hummytummy.com',
        to: process.env.ADMIN_EMAIL || 'admin@hummytummy.com',
        subject: `New Contact Form Submission from ${data.name}`,
        html,
      };

      await this.transporter.sendMail(mailOptions);
      this.logger.log(`Admin notification sent for contact form from ${data.email}`);
      return true;
    } catch (error) {
      this.logger.error('Failed to send admin notification', error);
      return false;
    }
  }

  async sendUserConfirmation(data: {
    name: string;
    email: string;
    message: string;
  }): Promise<boolean> {
    if (!this.transporter) {
      this.logger.warn('Email transporter not configured. Skipping user confirmation.');
      return false;
    }

    try {
      const html = await this.loadTemplate('user-confirmation', data);

      const mailOptions = {
        from: process.env.EMAIL_FROM || 'admin@hummytummy.com',
        to: data.email,
        subject: 'Thank You for Contacting HummyTummy',
        html,
      };

      await this.transporter.sendMail(mailOptions);
      this.logger.log(`Confirmation email sent to ${data.email}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to send user confirmation to ${data.email}`, error);
      return false;
    }
  }

  async sendBothEmails(data: {
    name: string;
    email: string;
    phone?: string;
    message: string;
  }): Promise<{ adminSent: boolean; userSent: boolean }> {
    const [adminSent, userSent] = await Promise.all([
      this.sendAdminNotification(data),
      this.sendUserConfirmation(data),
    ]);

    return { adminSent, userSent };
  }
}
