import {
  Injectable,
  Optional,
  Logger,
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as bcrypt from "bcryptjs";
import { createHash, randomBytes } from "crypto";
import { PrismaService } from "../../../prisma/prisma.service";
import { MetricsService } from "../../../common/metrics/metrics.service";
import { EmailService } from "../../../common/services/email.service";
import { TenantStatus } from "../../../common/constants/subscription.enum";
import {
  ForgotPasswordDto,
  ResetPasswordDto,
  ChangePasswordDto,
} from "../dto/password-reset.dto";

// Dummy bcrypt hash used to normalize timing between "user not found" and
// "bad password" paths. bcrypt.compare against this hash takes the same
// work-factor cost as a real password check, so an attacker cannot use
// response-time deltas to enumerate which emails are registered.
// Computed once at module load with cost 12 (matches the default).
const DUMMY_BCRYPT_HASH = bcrypt.hashSync(
  "dummy-password-for-timing-normalization",
  12,
);

/**
 * PasswordService — owns password hashing/comparison (bcrypt + cost), the
 * credential-validation path (validateUser, incl. timing normalization and
 * the auth_login_failures_total counters), and the forgot/reset/change
 * password flows. Extracted verbatim from AuthService; all $transaction
 * boundaries (atomic token consume + family revoke) and guards are preserved
 * byte-for-byte.
 *
 * MetricsService is @Optional so auth never depends on the metrics registry.
 */
@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private emailService: EmailService,
    @Optional() private metrics?: MetricsService,
  ) {}

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  /**
   * bcrypt work factor. 12 is the 2026 baseline; allow tenants to tune via
   * env so production can bump cost without a code change.
   */
  bcryptCost(): number {
    const raw = this.configService.get<string>("BCRYPT_COST");
    const parsed = raw ? parseInt(raw, 10) : NaN;
    if (Number.isFinite(parsed) && parsed >= 10 && parsed <= 15) {
      return parsed;
    }
    return 12;
  }

  async hash(password: string): Promise<string> {
    return bcrypt.hash(password, this.bcryptCost());
  }

  private async logUserActivity(
    userId: string,
    tenantId: string,
    action: string,
    ip?: string,
    userAgent?: string,
    metadata?: any,
  ): Promise<void> {
    try {
      await this.prisma.userActivity.create({
        data: {
          userId,
          tenantId,
          action,
          ip,
          userAgent,
          metadata,
        },
      });
    } catch (error) {
      this.logger.error("Failed to log user activity", error as any);
    }
  }

  async validateUser(email: string, password: string): Promise<any> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        password: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        tenantId: true,
        tenant: { select: { status: true } },
      },
    });

    // Defer all account-state disclosure until after a successful password
    // check, so the endpoint cannot be used to enumerate registered emails.
    // When there is no matching user we STILL run bcrypt.compare against a
    // throwaway hash so the response time does not leak registration state
    // (timing-based email enumeration).
    if (!user) {
      await bcrypt.compare(password, DUMMY_BCRYPT_HASH).catch(() => false);
      this.metrics?.incCounter(
        "auth_login_failures_total",
        "Failed login attempts, labeled by reason",
        { reason: "unknown_user" },
      );
      return null;
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      this.metrics?.incCounter(
        "auth_login_failures_total",
        "Failed login attempts, labeled by reason",
        { reason: "bad_password" },
      );
      return null;
    }

    if (user.status === "PENDING_APPROVAL") {
      throw new UnauthorizedException(
        "Hesabınız henüz onaylanmadı. Lütfen yönetici onayını bekleyin.",
      );
    }
    if (user.status !== "ACTIVE") {
      throw new UnauthorizedException("User account is inactive");
    }
    if (user.tenant?.status !== TenantStatus.ACTIVE) {
      throw new UnauthorizedException("Your restaurant account is not active");
    }

    const { password: _, tenant: __, ...result } = user;
    return result;
  }

  /**
   * Send password reset email
   * Generates a secure reset token and sends it via email
   */
  async forgotPassword(
    forgotPasswordDto: ForgotPasswordDto,
  ): Promise<{ message: string }> {
    const { email } = forgotPasswordDto;

    // Find user
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    // Don't reveal if user exists or not (security best practice)
    if (!user) {
      return {
        message:
          "If an account with that email exists, a password reset link has been sent.",
      };
    }

    // Generate high-entropy reset token (sent via email in raw form, stored hashed)
    const rawToken = randomBytes(32).toString("hex");
    const resetTokenHash = this.hashToken(rawToken);
    const resetTokenExpiry = new Date();
    resetTokenExpiry.setHours(resetTokenExpiry.getHours() + 1); // Token valid for 1 hour

    // Store only the hash so a DB leak does not yield usable tokens
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        resetTokenHash,
        resetTokenExpiry,
      },
    });

    // Send password reset email with the raw token
    await this.emailService.sendPasswordResetEmail(user.email, rawToken);

    return {
      message:
        "If an account with that email exists, a password reset link has been sent.",
    };
  }

  /**
   * Reset password using token
   */
  async resetPassword(
    resetPasswordDto: ResetPasswordDto,
  ): Promise<{ message: string }> {
    const { token, newPassword } = resetPasswordDto;

    // Lookup by the hash of the incoming token (constant-time-ish via unique index)
    const resetTokenHash = this.hashToken(token);
    const user = await this.prisma.user.findFirst({
      where: {
        resetTokenHash,
        resetTokenExpiry: {
          gt: new Date(), // Token not expired
        },
      },
      select: { id: true },
    });

    if (!user) {
      throw new BadRequestException("Invalid or expired reset token");
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, this.bcryptCost());

    // Atomic consume: the update filters on `resetTokenHash` too, so two
    // concurrent requests with the same token can't both succeed. The first
    // transaction nulls the hash; the second one's updateMany sees zero
    // affected rows and we reject it as already-used. Without this guard
    // the race window between findFirst and update allowed the same token
    // to mint two password changes in parallel.
    //
    // We also revoke refresh tokens in the same transaction so a stolen
    // token can't mint fresh access tokens after the reset.
    const [updateResult] = await this.prisma.$transaction([
      this.prisma.user.updateMany({
        where: { id: user.id, resetTokenHash },
        data: {
          password: hashedPassword,
          resetTokenHash: null,
          resetTokenExpiry: null,
          tokenVersion: { increment: 1 },
        },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    if (updateResult.count === 0) {
      // Lost the race: another request already consumed this token.
      throw new BadRequestException("Invalid or expired reset token");
    }

    // Audit: reset-password successfully consumed a valid token. We had
    // to refetch tenantId because the initial findFirst only selected id
    // (to keep the constant-time guarantee tight).
    const tenantOnly = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { tenantId: true },
    });
    if (tenantOnly) {
      await this.logUserActivity(
        user.id,
        tenantOnly.tenantId,
        "PASSWORD_RESET",
      );
    }

    return {
      message: "Password has been reset successfully",
    };
  }

  /**
   * Change password for authenticated user
   */
  async changePassword(
    userId: string,
    changePasswordDto: ChangePasswordDto,
  ): Promise<{ message: string }> {
    const { currentPassword, newPassword } = changePasswordDto;

    // Get user with password
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException("User not found");
    }

    // Verify current password
    const isPasswordValid = await bcrypt.compare(
      currentPassword,
      user.password,
    );

    if (!isPasswordValid) {
      throw new BadRequestException("Current password is incorrect");
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, this.bcryptCost());

    // Update password + bump tokenVersion + revoke refresh tokens so all
    // prior sessions (including on other devices) are force-logged-out.
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          password: hashedPassword,
          tokenVersion: { increment: 1 },
        },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    // Audit trail for incident response: who changed their password
    // when. Failure is swallowed because losing an audit entry shouldn't
    // block a successful password change.
    await this.logUserActivity(userId, user.tenantId, "PASSWORD_CHANGED");

    return {
      message: "Password changed successfully",
    };
  }
}
