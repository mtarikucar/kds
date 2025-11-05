import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PhoneVerificationService {
  constructor(
    private prisma: PrismaService,
  ) {}

  /**
   * Generate a 6-digit OTP code
   */
  private generateOTP(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * Send OTP to phone number (creates verification record)
   * In production, this would integrate with SMS provider (Twilio, AWS SNS, etc.)
   */
  async sendOTP(phone: string, sessionId: string | null, tenantId: string): Promise<{
    verificationId: string;
    expiresAt: Date;
    message: string;
  }> {
    // Validate phone format (basic E.164 check)
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    if (!phoneRegex.test(phone)) {
      throw new BadRequestException('Invalid phone number format. Use E.164 format (e.g., +905551234567)');
    }

    // Check for recent verification attempts (rate limiting)
    const recentAttempt = await this.prisma.phoneVerification.findFirst({
      where: {
        phone,
        tenantId,
        createdAt: {
          gte: new Date(Date.now() - 60000), // Within last minute
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (recentAttempt) {
      throw new BadRequestException('Please wait 60 seconds before requesting another code');
    }

    // Generate OTP
    const code = this.generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60000); // 10 minutes

    // Create verification record
    const verification = await this.prisma.phoneVerification.create({
      data: {
        phone,
        code,
        expiresAt,
        sessionId,
        tenantId,
        attempts: 0,
        maxAttempts: 3,
      },
    });

    // TODO: In production, integrate with SMS provider here
    // Example: await this.smsService.send(phone, `Your verification code: ${code}`);

    console.log(`[PhoneVerification] OTP for ${phone}: ${code} (expires: ${expiresAt})`);

    return {
      verificationId: verification.id,
      expiresAt: verification.expiresAt,
      message: 'Verification code sent to your phone',
    };
  }

  /**
   * Verify OTP code
   */
  async verifyOTP(phone: string, code: string, tenantId: string): Promise<{
    verified: boolean;
    verificationId: string;
  }> {
    // Find the most recent unverified verification for this phone
    const verification = await this.prisma.phoneVerification.findFirst({
      where: {
        phone,
        tenantId,
        verified: false,
        expiresAt: {
          gte: new Date(), // Not expired
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!verification) {
      throw new BadRequestException('No active verification found or code expired');
    }

    // Check if max attempts reached
    if (verification.attempts >= verification.maxAttempts) {
      throw new BadRequestException('Maximum verification attempts reached. Please request a new code.');
    }

    // Increment attempts
    await this.prisma.phoneVerification.update({
      where: { id: verification.id },
      data: { attempts: verification.attempts + 1 },
    });

    // Verify code
    if (verification.code !== code) {
      const remainingAttempts = verification.maxAttempts - (verification.attempts + 1);
      throw new UnauthorizedException(
        `Invalid verification code. ${remainingAttempts} attempts remaining.`
      );
    }

    // Mark as verified
    await this.prisma.phoneVerification.update({
      where: { id: verification.id },
      data: {
        verified: true,
        verifiedAt: new Date(),
      },
    });

    return {
      verified: true,
      verificationId: verification.id,
    };
  }

  /**
   * Check if a phone number is verified for a session
   */
  async isPhoneVerified(phone: string, tenantId: string): Promise<boolean> {
    const verification = await this.prisma.phoneVerification.findFirst({
      where: {
        phone,
        tenantId,
        verified: true,
      },
      orderBy: { verifiedAt: 'desc' },
    });

    return !!verification;
  }

  /**
   * Get verification status
   */
  async getVerificationStatus(verificationId: string): Promise<any> {
    const verification = await this.prisma.phoneVerification.findUnique({
      where: { id: verificationId },
      select: {
        id: true,
        phone: true,
        verified: true,
        expiresAt: true,
        attempts: true,
        maxAttempts: true,
        createdAt: true,
        verifiedAt: true,
      },
    });

    if (!verification) {
      throw new BadRequestException('Verification not found');
    }

    return {
      ...verification,
      expired: verification.expiresAt < new Date(),
      attemptsRemaining: verification.maxAttempts - verification.attempts,
    };
  }

  /**
   * Cleanup expired verifications (can be called by cron job)
   */
  async cleanupExpiredVerifications(): Promise<number> {
    const result = await this.prisma.phoneVerification.deleteMany({
      where: {
        verified: false,
        expiresAt: {
          lt: new Date(Date.now() - 24 * 60 * 60000), // Older than 24 hours
        },
      },
    });

    console.log(`[PhoneVerification] Cleaned up ${result.count} expired verifications`);
    return result.count;
  }
}
