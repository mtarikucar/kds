import {
  Injectable,
  Inject,
  forwardRef,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import * as appleSignin from 'apple-signin-auth';
import * as Sentry from '@sentry/node';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { GoogleAuthDto, AppleAuthDto } from './dto/social-auth.dto';
import { AuthResponseDto, UserResponseDto } from './dto/auth-response.dto';
import { ForgotPasswordDto, ResetPasswordDto, ChangePasswordDto } from './dto/password-reset.dto';
import { UserRole } from '../../common/constants/roles.enum';
import { TenantStatus } from '../../common/constants/subscription.enum';
import { EmailService } from '../../common/services/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/dto/create-notification.dto';
import {
  isSubdomainQuarantined,
  randomSubdomainSuffix,
} from '../../common/helpers/subdomain.helper';
import {
  ResourceAlreadyExistsException,
  ResourceNotFoundException,
  InvalidCredentialsException,
  ValidationException,
} from '../../common/exceptions';

@Injectable()
export class AuthService {
  private googleClient: OAuth2Client;

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * bcrypt work factor. 12 is the 2026 baseline; allow tenants to tune via
   * env so production can bump cost without a code change.
   */
  private bcryptCost(): number {
    const raw = this.configService.get<string>('BCRYPT_COST');
    const parsed = raw ? parseInt(raw, 10) : NaN;
    if (Number.isFinite(parsed) && parsed >= 10 && parsed <= 15) {
      return parsed;
    }
    return 12;
  }

  /**
   * Find a free subdomain for a new tenant. Falls back to appending a
   * cryptographically-strong 6-hex suffix when the preferred slug is taken
   * or quarantined. Uniqueness is ultimately enforced by the DB unique
   * index (P2002 is caught by the caller); this just picks a candidate.
   */
  private async allocateSubdomain(base: string): Promise<string> {
    const baseClean = base || 'restaurant';
    const preferred = baseClean;
    const preferredTaken =
      (await isSubdomainQuarantined(this.prisma, preferred)) ||
      (await this.prisma.tenant.findUnique({ where: { subdomain: preferred } }));
    if (!preferredTaken) return preferred;
    // Up to 5 attempts with random suffix — extraordinarily unlikely to collide.
    for (let i = 0; i < 5; i += 1) {
      const candidate = `${baseClean}-${randomSubdomainSuffix()}`;
      const taken =
        (await isSubdomainQuarantined(this.prisma, candidate)) ||
        (await this.prisma.tenant.findUnique({ where: { subdomain: candidate } }));
      if (!taken) return candidate;
    }
    throw new Error('Could not allocate a free subdomain');
  }

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private emailService: EmailService,
    @Inject(forwardRef(() => NotificationsService))
    private notificationsService: NotificationsService,
  ) {
    // Initialize Google OAuth client
    this.googleClient = new OAuth2Client(
      this.configService.get<string>('GOOGLE_CLIENT_ID'),
    );
  }

  async register(registerDto: RegisterDto): Promise<AuthResponseDto> {
    // Check if user already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email: registerDto.email },
    });

    if (existingUser) {
      throw new ResourceAlreadyExistsException('User', 'email', registerDto.email);
    }

    // Validate registration data
    const hasRestaurantName = !!registerDto.restaurantName;
    const hasTenantId = !!registerDto.tenantId;

    // Mutual exclusion: cannot provide both
    if (hasRestaurantName && hasTenantId) {
      throw new ValidationException('Cannot provide both restaurantName and tenantId');
    }

    // One of them must be provided
    if (!hasRestaurantName && !hasTenantId) {
      throw new ValidationException('Either restaurantName or tenantId must be provided');
    }

    let tenantId: string;
    let userRole = registerDto.role;

    // Scenario 1: Creating a new restaurant (ADMIN only)
    if (hasRestaurantName) {
      // If creating a restaurant, role must be ADMIN (or default to ADMIN)
      if (userRole && userRole !== UserRole.ADMIN) {
        throw new ValidationException('Only ADMIN role is allowed when creating a new restaurant');
      }
      userRole = UserRole.ADMIN;

      const baseSubdomain = registerDto.restaurantName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

      const finalSubdomain = await this.allocateSubdomain(baseSubdomain);

      const freePlan = await this.prisma.subscriptionPlan.findUnique({
        where: { name: 'FREE' },
      });

      if (!freePlan) {
        throw new ResourceNotFoundException('FREE subscription plan');
      }

      // Tenant + FREE subscription must be created atomically so other
      // modules never observe a tenant without a matching subscription.
      const now = new Date();
      const currentPeriodEnd = new Date(now);
      currentPeriodEnd.setFullYear(currentPeriodEnd.getFullYear() + 10);

      try {
        const tenant = await this.prisma.$transaction(async (tx) => {
          const created = await tx.tenant.create({
            data: {
              name: registerDto.restaurantName,
              subdomain: finalSubdomain,
              paymentRegion: registerDto.paymentRegion || 'INTERNATIONAL',
              currentPlanId: freePlan.id,
            },
          });
          await tx.subscription.create({
            data: {
              tenantId: created.id,
              planId: freePlan.id,
              status: 'ACTIVE',
              billingCycle: 'MONTHLY',
              paymentProvider: 'EMAIL',
              startDate: now,
              currentPeriodStart: now,
              currentPeriodEnd,
              isTrialPeriod: false,
              amount: 0,
              currency: freePlan.currency,
              autoRenew: true,
              cancelAtPeriodEnd: false,
            },
          });
          return created;
        });
        tenantId = tenant.id;
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          throw new ResourceAlreadyExistsException('Tenant', 'subdomain', finalSubdomain);
        }
        throw err;
      }
    }
    // Scenario 2: Joining an existing restaurant
    else {
      // Verify tenant exists
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: registerDto.tenantId },
      });

      if (!tenant) {
        throw new ResourceNotFoundException('Tenant', registerDto.tenantId);
      }

      // Cannot join as ADMIN (ADMIN creates their own restaurant)
      if (userRole === UserRole.ADMIN) {
        throw new ValidationException('Cannot join existing restaurant as ADMIN. ADMIN must create their own restaurant.');
      }

      // Default to WAITER if no role provided
      if (!userRole) {
        userRole = UserRole.WAITER;
      }

      tenantId = registerDto.tenantId;
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(registerDto.password, this.bcryptCost());

    // Determine user status: ADMIN creating restaurant = ACTIVE, others = PENDING_APPROVAL
    const userStatus = hasRestaurantName ? 'ACTIVE' : 'PENDING_APPROVAL';

    // Create user
    const user = await this.prisma.user.create({
      data: {
        email: registerDto.email,
        password: hashedPassword,
        firstName: registerDto.firstName,
        lastName: registerDto.lastName,
        role: userRole,
        tenantId,
        status: userStatus,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        tenantId: true,
      },
    });

    // Send email verification code automatically after registration
    try {
      await this.sendEmailVerification(user.id);
    } catch (error) {
      // Log error but don't fail registration if email sending fails
      console.error('Failed to send verification email:', error);
    }

    // If user is pending approval, notify admins and return without tokens
    if (userStatus === 'PENDING_APPROVAL') {
      try {
        await this.notificationsService.notifyAdmins(tenantId, {
          title: 'Yeni Kullanıcı Onay Bekliyor',
          message: `${user.firstName} ${user.lastName} (${user.email}) hesap onayı bekliyor.`,
          type: NotificationType.WARNING,
          data: {
            action: 'USER_APPROVAL_REQUIRED',
            userId: user.id,
          },
        });
      } catch (error) {
        console.error('Failed to notify admins about pending user:', error);
      }

      // Return response without tokens - user needs approval
      return {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          tenantId: user.tenantId,
        },
        accessToken: null,
        refreshToken: null,
        pendingApproval: true,
        message: 'Kayıt başarılı. Hesabınız yönetici onayı bekliyor.',
      } as any;
    }

    // Track successful registration in Sentry
    Sentry.captureMessage(`New user registered: ${user.email}`, {
      level: 'info',
      tags: {
        event: 'user.register',
        role: user.role,
        isNewRestaurant: String(hasRestaurantName),
      },
      extra: {
        userId: user.id,
        tenantId: user.tenantId,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    });

    return this.generateTokens(user);
  }

  async login(loginDto: LoginDto, ip?: string, userAgent?: string): Promise<AuthResponseDto> {
    const user = await this.validateUser(loginDto.email, loginDto.password);

    if (!user) {
      // Track failed login attempt
      Sentry.captureMessage(`Failed login attempt: ${loginDto.email}`, {
        level: 'warning',
        tags: {
          event: 'user.login.failed',
        },
        extra: {
          email: loginDto.email,
        },
      });

      // Log failed login attempt if we can identify the user
      const existingUser = await this.prisma.user.findUnique({
        where: { email: loginDto.email },
        select: { id: true, tenantId: true },
      });
      if (existingUser) {
        await this.logUserActivity(existingUser.id, existingUser.tenantId, 'LOGIN_FAILED', ip, userAgent);
      }

      throw new InvalidCredentialsException();
    }

    // Track successful login in Sentry
    Sentry.captureMessage(`User logged in: ${user.email}`, {
      level: 'info',
      tags: {
        event: 'user.login',
        role: user.role,
      },
      extra: {
        userId: user.id,
        tenantId: user.tenantId,
        email: user.email,
      },
    });

    // Log successful login activity
    await this.logUserActivity(user.id, user.tenantId, 'LOGIN', ip, userAgent);

    // Update last login timestamp
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    // Set user context for future errors
    Sentry.setUser({
      id: user.id,
      email: user.email,
    });

    return this.generateTokens(user, ip, userAgent);
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
      console.error('Failed to log user activity:', error);
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
    if (!user) {
      return null;
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return null;
    }

    if (user.status === 'PENDING_APPROVAL') {
      throw new UnauthorizedException('Hesabınız henüz onaylanmadı. Lütfen yönetici onayını bekleyin.');
    }
    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('User account is inactive');
    }
    if (user.tenant?.status !== TenantStatus.ACTIVE) {
      throw new UnauthorizedException('Your restaurant account is not active');
    }

    const { password: _, tenant: __, ...result } = user;
    return result;
  }

  /**
   * Rotate the refresh token. Verifies the signed JWT, looks it up in the
   * DB by its hash, revokes it, and issues a fresh access+refresh pair.
   *
   * Reuse detection: if the presented token was already revoked, we treat
   * it as a token-theft signal and revoke every active refresh token for
   * the user (forcing re-login on every session).
   */
  async refreshToken(
    refreshToken: string,
    ip?: string,
    userAgent?: string,
  ): Promise<AuthResponseDto> {
    let payload: any;
    try {
      payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        algorithms: ['HS256'],
      });
    } catch (_err) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (payload.type && payload.type !== 'user') {
      throw new UnauthorizedException('Invalid token type');
    }

    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (!stored || stored.expiresAt <= new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (stored.revokedAt) {
      // Possible replay of a rotated-out token — revoke the entire family.
      await this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: stored.userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        tenantId: true,
        tenant: { select: { status: true } },
      },
    });

    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('User not found or inactive');
    }
    if (user.tenant?.status !== TenantStatus.ACTIVE) {
      throw new UnauthorizedException('Your restaurant account is not active');
    }

    // Revoke the rotated-out token, issue a new pair.
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const { tenant: _t, ...userForToken } = user;
    return this.generateTokens(userForToken, ip, userAgent);
  }

  async logout(userId: string, ip?: string, userAgent?: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { tenantId: true },
    });
    if (user) {
      // Revoke every active refresh token, then audit.
      await this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.logUserActivity(userId, user.tenantId, 'LOGOUT', ip, userAgent);
    }
    return { message: 'Logged out' };
  }

  private async generateTokens(
    user: UserResponseDto,
    ip?: string,
    userAgent?: string,
  ): Promise<AuthResponseDto> {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      type: 'user' as const,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_SECRET'),
      expiresIn: this.configService.get<string>('JWT_EXPIRES_IN') || '15m',
      algorithm: 'HS256',
    });

    const refreshExpiresIn =
      this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') || '30d';
    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: refreshExpiresIn,
      algorithm: 'HS256',
    });

    // Persist the hash so we can revoke/rotate server-side.
    const decoded: any = this.jwtService.decode(refreshToken);
    const expiresAt = new Date(decoded.exp * 1000);
    await this.prisma.refreshToken.create({
      data: {
        tokenHash: this.hashToken(refreshToken),
        userId: user.id,
        expiresAt,
        ip,
        userAgent,
      },
    });

    return {
      accessToken,
      refreshToken,
      user,
    };
  }

  async getProfile(userId: string): Promise<UserResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        tenantId: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return user;
  }

  /**
   * Send password reset email
   * Generates a secure reset token and sends it via email
   */
  async forgotPassword(forgotPasswordDto: ForgotPasswordDto): Promise<{ message: string }> {
    const { email } = forgotPasswordDto;

    // Find user
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    // Don't reveal if user exists or not (security best practice)
    if (!user) {
      return {
        message: 'If an account with that email exists, a password reset link has been sent.',
      };
    }

    // Generate high-entropy reset token (sent via email in raw form, stored hashed)
    const rawToken = randomBytes(32).toString('hex');
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
      message: 'If an account with that email exists, a password reset link has been sent.',
    };
  }

  /**
   * Reset password using token
   */
  async resetPassword(resetPasswordDto: ResetPasswordDto): Promise<{ message: string }> {
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
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, this.bcryptCost());

    // Update password and clear reset token (invalidate on use)
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        resetTokenHash: null,
        resetTokenExpiry: null,
      },
    });

    return {
      message: 'Password has been reset successfully',
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
      throw new NotFoundException('User not found');
    }

    // Verify current password
    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);

    if (!isPasswordValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, this.bcryptCost());

    // Update password
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        password: hashedPassword,
      },
    });

    return {
      message: 'Password changed successfully',
    };
  }

  /**
   * Generate a 6-digit verification code (uniformly distributed via crypto RNG).
   * Scope is per-user, so no cross-user uniqueness loop is needed.
   */
  private generateVerificationCode(): string {
    // 1,000,000 values → 0-999,999, formatted as 6 digits
    const n = randomBytes(4).readUInt32BE(0) % 1_000_000;
    return n.toString().padStart(6, '0');
  }

  /**
   * Send email verification code
   * Generates a 6-digit code, stores its sha256 hash, emails the raw code.
   */
  async sendEmailVerification(userId: string): Promise<{ message: string; codeExpiry: Date }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.emailVerified) {
      return {
        message: 'Email is already verified',
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
        title: 'E-posta Doğrulaması Gereklidir',
        message: 'E-posta adresinize gönderilen 6 haneli doğrulama kodunu kullanarak hesabınızı doğrulamanız gerekmektedir. Lütfen e-posta kutunuzu kontrol ediniz.',
        type: NotificationType.WARNING,
        userId: user.id,
        tenantId: user.tenantId,
        data: {
          action: 'EMAIL_VERIFICATION_REQUIRED',
          expiresAt: codeExpires.toISOString(),
        },
        expiresAt: codeExpires.toISOString(),
      });
    } catch (error) {
      // Log error but don't fail if notification sending fails
      console.error('Failed to send verification notification:', error);
    }

    return {
      message: 'Verification code sent successfully to your email',
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

    // Return the same error for "no user" and "bad code" so the endpoint cannot
    // be used to enumerate which emails are registered.
    if (
      !user ||
      !user.emailVerificationCodeHash ||
      !user.emailVerificationCodeExpires ||
      user.emailVerificationCodeExpires <= new Date() ||
      user.emailVerificationCodeHash !== this.hashToken(code)
    ) {
      throw new BadRequestException('Invalid or expired verification code');
    }

    // Mark email as verified and clear code
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        emailVerificationCodeHash: null,
        emailVerificationCodeExpires: null,
      },
    });

    // Send success notification
    try {
      await this.notificationsService.createAndSend({
        title: 'Email Başarıyla Doğrulandı',
        message: 'Email adresiniz başarıyla doğrulandı. Artık tüm özelliklere erişebilirsiniz.',
        type: NotificationType.SUCCESS,
        userId: user.id,
        tenantId: user.tenantId,
      });
    } catch (error) {
      // Log error but don't fail if notification sending fails
      console.error('Failed to send verification success notification:', error);
    }

    return {
      message: 'Email verified successfully',
      verified: true,
    };
  }

  /**
   * Authenticate with Google OAuth
   * Verifies the Google token (ID token or access token) and creates/links user account
   */
  async googleAuth(googleAuthDto: GoogleAuthDto): Promise<AuthResponseDto> {
    const { credential } = googleAuthDto;

    let googleId: string;
    let email: string;
    let firstName: string;
    let lastName: string;

    try {
      // Try to verify as ID token first
      try {
        const ticket = await this.googleClient.verifyIdToken({
          idToken: credential,
          audience: this.configService.get<string>('GOOGLE_CLIENT_ID'),
        });

        const payload = ticket.getPayload();
        if (payload) {
          googleId = payload.sub;
          email = payload.email;
          firstName = payload.given_name || 'User';
          lastName = payload.family_name || '';
        }
      } catch (idTokenError) {
        // If ID token verification fails, treat the credential as an access
        // token. We must first verify the audience via the tokeninfo endpoint
        // — otherwise any valid Google access token issued for any OAuth
        // client could authenticate as that user here.
        const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID');
        const tokenInfoRes = await fetch(
          `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(credential)}`,
        );
        if (!tokenInfoRes.ok) {
          throw new UnauthorizedException('Invalid Google token');
        }
        const tokenInfo = (await tokenInfoRes.json()) as { aud?: string };
        if (!clientId || tokenInfo.aud !== clientId) {
          throw new UnauthorizedException('Google token not issued for this application');
        }

        const response = await fetch(
          `https://www.googleapis.com/oauth2/v3/userinfo`,
          {
            headers: { Authorization: `Bearer ${credential}` },
          },
        );

        if (!response.ok) {
          throw new UnauthorizedException('Invalid Google token');
        }

        const userInfo = await response.json();
        googleId = userInfo.sub;
        email = userInfo.email;
        firstName = userInfo.given_name || 'User';
        lastName = userInfo.family_name || '';
      }

      if (!email) {
        throw new BadRequestException('Email not provided by Google');
      }

      // Check if user exists by googleId
      let user = await this.prisma.user.findUnique({
        where: { googleId },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
          tenantId: true,
        },
      });

      if (user) {
        // User found by googleId - login
        if (user.status !== 'ACTIVE') {
          throw new UnauthorizedException('User account is inactive');
        }

        // Track Google login in Sentry
        Sentry.captureMessage(`User logged in via Google: ${user.email}`, {
          level: 'info',
          tags: {
            event: 'user.login.google',
            role: user.role,
          },
          extra: {
            userId: user.id,
            tenantId: user.tenantId,
            email: user.email,
          },
        });

        return this.generateTokens(user);
      }

      // Check if user exists by email (account linking)
      const existingUserByEmail = await this.prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
          tenantId: true,
          googleId: true,
        },
      });

      if (existingUserByEmail) {
        // Link Google account to existing user
        if (existingUserByEmail.status !== 'ACTIVE') {
          throw new UnauthorizedException('User account is inactive');
        }

        user = await this.prisma.user.update({
          where: { id: existingUserByEmail.id },
          data: {
            googleId,
            authProvider: existingUserByEmail.googleId ? undefined : 'google',
            emailVerified: true, // Email is verified by Google
          },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            status: true,
            tenantId: true,
          },
        });

        // Track Google account linking in Sentry
        Sentry.captureMessage(`Google account linked: ${user.email}`, {
          level: 'info',
          tags: {
            event: 'user.link.google',
            role: user.role,
          },
          extra: {
            userId: user.id,
            tenantId: user.tenantId,
            email: user.email,
          },
        });

        return this.generateTokens(user);
      }

      // New user - create tenant and user
      return this.createSocialAuthUser({
        email,
        firstName: firstName || 'User',
        lastName: lastName || '',
        googleId,
        authProvider: 'google',
      });
    } catch (error) {
      if (error instanceof UnauthorizedException || error instanceof BadRequestException) {
        throw error;
      }
      console.error('Google auth error:', error);
      throw new UnauthorizedException('Failed to authenticate with Google');
    }
  }

  /**
   * Authenticate with Apple Sign-In
   * Verifies the Apple identity token and creates/links user account
   */
  async appleAuth(appleAuthDto: AppleAuthDto): Promise<AuthResponseDto> {
    const { identityToken, firstName, lastName } = appleAuthDto;

    try {
      // Verify Apple identity token
      const applePayload = await appleSignin.verifyIdToken(identityToken, {
        audience: this.configService.get<string>('APPLE_CLIENT_ID'),
        ignoreExpiration: false,
      });

      const { sub: appleId, email } = applePayload;

      if (!email) {
        throw new BadRequestException('Email not provided by Apple');
      }

      // Check if user exists by appleId
      let user = await this.prisma.user.findUnique({
        where: { appleId },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
          tenantId: true,
        },
      });

      if (user) {
        // User found by appleId - login
        if (user.status !== 'ACTIVE') {
          throw new UnauthorizedException('User account is inactive');
        }

        // Track Apple login in Sentry
        Sentry.captureMessage(`User logged in via Apple: ${user.email}`, {
          level: 'info',
          tags: {
            event: 'user.login.apple',
            role: user.role,
          },
          extra: {
            userId: user.id,
            tenantId: user.tenantId,
            email: user.email,
          },
        });

        return this.generateTokens(user);
      }

      // Check if user exists by email (account linking)
      const existingUserByEmail = await this.prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
          tenantId: true,
          appleId: true,
        },
      });

      if (existingUserByEmail) {
        // Link Apple account to existing user
        if (existingUserByEmail.status !== 'ACTIVE') {
          throw new UnauthorizedException('User account is inactive');
        }

        user = await this.prisma.user.update({
          where: { id: existingUserByEmail.id },
          data: {
            appleId,
            authProvider: existingUserByEmail.appleId ? undefined : 'apple',
            emailVerified: true, // Email is verified by Apple
          },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            status: true,
            tenantId: true,
          },
        });

        // Track Apple account linking in Sentry
        Sentry.captureMessage(`Apple account linked: ${user.email}`, {
          level: 'info',
          tags: {
            event: 'user.link.apple',
            role: user.role,
          },
          extra: {
            userId: user.id,
            tenantId: user.tenantId,
            email: user.email,
          },
        });

        return this.generateTokens(user);
      }

      // New user - create tenant and user
      // Note: Apple only sends name on first sign-in
      return this.createSocialAuthUser({
        email,
        firstName: firstName || 'User',
        lastName: lastName || '',
        appleId,
        authProvider: 'apple',
      });
    } catch (error) {
      if (error instanceof UnauthorizedException || error instanceof BadRequestException) {
        throw error;
      }
      console.error('Apple auth error:', error);
      throw new UnauthorizedException('Failed to authenticate with Apple');
    }
  }

  /**
   * Create a new user from social auth (Google/Apple)
   * Auto-creates tenant and subscribes to FREE plan
   */
  private async createSocialAuthUser(data: {
    email: string;
    firstName: string;
    lastName: string;
    googleId?: string;
    appleId?: string;
    authProvider: string;
  }): Promise<AuthResponseDto> {
    const { email, firstName, lastName, googleId, appleId, authProvider } = data;

    // Generate restaurant name from email or name
    const restaurantName = firstName && firstName !== 'User'
      ? `${firstName}'s Restaurant`
      : `Restaurant ${email.split('@')[0]}`;

    const baseSubdomain = restaurantName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const subdomain = await this.allocateSubdomain(baseSubdomain);

    // Get FREE plan
    const freePlan = await this.prisma.subscriptionPlan.findUnique({
      where: { name: 'FREE' },
    });

    if (!freePlan) {
      throw new ResourceNotFoundException('FREE subscription plan');
    }

    const now = new Date();
    const currentPeriodEnd = new Date(now);
    currentPeriodEnd.setFullYear(currentPeriodEnd.getFullYear() + 10);

    // Tenant + subscription + user in one transaction so a failure midway
    // does not leave orphaned rows.
    let user;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: {
            name: restaurantName,
            subdomain,
            paymentRegion: 'INTERNATIONAL',
            currentPlanId: freePlan.id,
          },
        });
        await tx.subscription.create({
          data: {
            tenantId: tenant.id,
            planId: freePlan.id,
            status: 'ACTIVE',
            billingCycle: 'MONTHLY',
            paymentProvider: 'EMAIL',
            startDate: now,
            currentPeriodStart: now,
            currentPeriodEnd,
            isTrialPeriod: false,
            amount: 0,
            currency: freePlan.currency,
            autoRenew: true,
            cancelAtPeriodEnd: false,
          },
        });
        return tx.user.create({
          data: {
            email,
            password: '',
            firstName,
            lastName,
            role: UserRole.ADMIN,
            tenantId: tenant.id,
            googleId,
            appleId,
            authProvider,
            emailVerified: true,
          },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            tenantId: true,
          },
        });
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ResourceAlreadyExistsException('Tenant', 'subdomain', subdomain);
      }
      throw err;
    }

    // Track new social auth registration in Sentry
    Sentry.captureMessage(`New user registered via ${authProvider}: ${email}`, {
      level: 'info',
      tags: {
        event: 'user.register.social',
        provider: authProvider,
        role: user.role,
      },
      extra: {
        userId: user.id,
        tenantId: user.tenantId,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        restaurantName,
      },
    });

    return this.generateTokens(user);
  }
}
