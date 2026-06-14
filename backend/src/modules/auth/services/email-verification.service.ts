import {
  Injectable,
  Inject,
  forwardRef,
  Logger,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { PrismaService } from "../../../prisma/prisma.service";
import { EmailService } from "../../../common/services/email.service";
import { NotificationsService } from "../../notifications/notifications.service";
import { NotificationType } from "../../notifications/dto/create-notification.dto";

/**
 * EmailVerificationService — owns the 6-digit email verification lifecycle:
 * code generation, sending (email + in-app notification), and the atomic
 * single-use verification. Extracted verbatim from AuthService; the
 * timing-safe comparison and atomic `updateMany` consume are preserved
 * byte-for-byte.
 *
 * NotificationsService is wired through the same forwardRef the original
 * AuthService used.
 */
@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
    @Inject(forwardRef(() => NotificationsService))
    private notificationsService: NotificationsService,
  ) {}

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  /**
   * Generate a 6-digit verification code (uniformly distributed via crypto RNG).
   * Scope is per-user, so no cross-user uniqueness loop is needed.
   */
  private generateVerificationCode(): string {
    // 1,000,000 values → 0-999,999, formatted as 6 digits
    const n = randomBytes(4).readUInt32BE(0) % 1_000_000;
    return n.toString().padStart(6, "0");
  }

  /**
   * Send email verification code
   * Generates a 6-digit code, stores its sha256 hash, emails the raw code.
   */
  async sendEmailVerification(
    userId: string,
  ): Promise<{ message: string; codeExpiry: Date }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException("User not found");
    }

    if (user.emailVerified) {
      return {
        message: "Email is already verified",
        codeExpiry: null,
      };
    }

    // Generate 6-digit verification code
    const verificationCode = this.generateVerificationCode();
    const codeExpires = new Date();
    codeExpires.setHours(codeExpires.getHours() + 1); // Code valid for 1 hour

    // Store only the hash so a DB leak does not yield usable codes
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerificationCodeHash: this.hashToken(verificationCode),
        emailVerificationCodeExpires: codeExpires,
      },
    });

    // Send verification email with raw code
    await this.emailService.sendEmailVerificationCode(
      user.email,
      verificationCode,
      `${user.firstName} ${user.lastName}`,
    );

    // Send in-app notification (without code - code is only in email)
    try {
      await this.notificationsService.createAndSend({
        title: "E-posta Doğrulaması Gereklidir",
        message:
          "E-posta adresinize gönderilen 6 haneli doğrulama kodunu kullanarak hesabınızı doğrulamanız gerekmektedir. Lütfen e-posta kutunuzu kontrol ediniz.",
        type: NotificationType.WARNING,
        userId: user.id,
        tenantId: user.tenantId,
        data: {
          action: "EMAIL_VERIFICATION_REQUIRED",
          expiresAt: codeExpires.toISOString(),
        },
        expiresAt: codeExpires.toISOString(),
      });
    } catch (error) {
      // Log error but don't fail if notification sending fails
      this.logger.error(
        "Failed to send verification notification",
        error as any,
      );
    }

    return {
      message: "Verification code sent successfully to your email",
      codeExpiry: codeExpires,
    };
  }

  /**
   * Verify email using 6-digit code, scoped to the account identified by email.
   */
  async verifyEmailWithCode(
    email: string,
    code: string,
  ): Promise<{ message: string; verified: boolean }> {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    // Constant-time hash comparison + atomic single-use consumption.
    // The previous implementation read the user, did a plain `!==` on
    // the hash (timing-attackable; an attacker can probe digit-by-digit
    // by measuring response time), and then ran a separate UPDATE. Two
    // concurrent /verify-email calls could both pass the check and
    // both run the update — letting a stolen code be redeemed twice
    // (matters less for email-verify than reset-password, but the
    // pattern should be consistent). `updateMany` with the hash as part
    // of the WHERE clause makes the consumption atomic; the first
    // request wins, the second sees `count === 0`.
    const submitted = this.hashToken(code);
    const submittedOk =
      !!user?.emailVerificationCodeHash &&
      Buffer.byteLength(user.emailVerificationCodeHash) ===
        Buffer.byteLength(submitted) &&
      timingSafeEqual(
        Buffer.from(user.emailVerificationCodeHash),
        Buffer.from(submitted),
      );

    // Return the same error for "no user" and "bad code" so the endpoint cannot
    // be used to enumerate which emails are registered.
    if (
      !user ||
      !user.emailVerificationCodeExpires ||
      user.emailVerificationCodeExpires <= new Date() ||
      !submittedOk
    ) {
      throw new BadRequestException("Invalid or expired verification code");
    }

    // Atomic claim: filter by the current hash so a concurrent verify
    // with the same code can't double-consume. `count === 0` means we
    // lost the race (or the row was mutated mid-flight) → reject.
    const consumed = await this.prisma.user.updateMany({
      where: {
        id: user.id,
        emailVerificationCodeHash: user.emailVerificationCodeHash,
      },
      data: {
        emailVerified: true,
        emailVerificationCodeHash: null,
        emailVerificationCodeExpires: null,
      },
    });
    if (consumed.count === 0) {
      throw new BadRequestException("Invalid or expired verification code");
    }

    // Send success notification
    try {
      await this.notificationsService.createAndSend({
        title: "Email Başarıyla Doğrulandı",
        message:
          "Email adresiniz başarıyla doğrulandı. Artık tüm özelliklere erişebilirsiniz.",
        type: NotificationType.SUCCESS,
        userId: user.id,
        tenantId: user.tenantId,
      });
    } catch (error) {
      // Log error but don't fail if notification sending fails
      this.logger.error(
        "Failed to send verification success notification",
        error as any,
      );
    }

    return {
      message: "Email verified successfully",
      verified: true,
    };
  }
}
