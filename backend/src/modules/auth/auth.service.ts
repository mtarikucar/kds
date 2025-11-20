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
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AuthResponseDto, UserResponseDto } from './dto/auth-response.dto';
import { ForgotPasswordDto, ResetPasswordDto, ChangePasswordDto } from './dto/password-reset.dto';
import { UserRole } from '../../common/constants/roles.enum';
import { EmailService } from '../../common/services/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/dto/create-notification.dto';
import {
  ResourceAlreadyExistsException,
  ResourceNotFoundException,
  InvalidCredentialsException,
  ValidationException,
} from '../../common/exceptions';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private emailService: EmailService,
    @Inject(forwardRef(() => NotificationsService))
    private notificationsService: NotificationsService,
  ) {}

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

      // Generate a subdomain from restaurant name
      const subdomain = registerDto.restaurantName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

      // Check if subdomain already exists, if so, append a random string
      let finalSubdomain = subdomain;
      const existingTenant = await this.prisma.tenant.findUnique({
        where: { subdomain },
      });

      if (existingTenant) {
        finalSubdomain = `${subdomain}-${Math.random().toString(36).substring(2, 8)}`;
      }

      // Get FREE plan
      const freePlan = await this.prisma.subscriptionPlan.findUnique({
        where: { name: 'FREE' },
      });

      if (!freePlan) {
        throw new ResourceNotFoundException('FREE subscription plan');
      }

      // Create new tenant with FREE subscription
      const tenant = await this.prisma.tenant.create({
        data: {
          name: registerDto.restaurantName,
          subdomain: finalSubdomain,
          paymentRegion: registerDto.paymentRegion || 'INTERNATIONAL',
          currentPlanId: freePlan.id,
        },
      });

      // Create FREE subscription for new tenant
      const now = new Date();
      const currentPeriodEnd = new Date(now);
      currentPeriodEnd.setFullYear(currentPeriodEnd.getFullYear() + 10); // FREE plan never expires

      await this.prisma.subscription.create({
        data: {
          tenantId: tenant.id,
          planId: freePlan.id,
          status: 'ACTIVE',
          billingCycle: 'MONTHLY',
          paymentProvider: registerDto.paymentRegion === 'TURKEY' ? 'IYZICO' : 'STRIPE',
          startDate: now,
          currentPeriodStart: now,
          currentPeriodEnd: currentPeriodEnd,
          isTrialPeriod: false,
          amount: 0,
          currency: freePlan.currency,
          autoRenew: true,
          cancelAtPeriodEnd: false,
        },
      });

      tenantId = tenant.id;
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
    const hashedPassword = await bcrypt.hash(registerDto.password, 10);

    // Create user
    const user = await this.prisma.user.create({
      data: {
        email: registerDto.email,
        password: hashedPassword,
        firstName: registerDto.firstName,
        lastName: registerDto.lastName,
        role: userRole,
        tenantId,
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

    // Send email verification code automatically after registration
    try {
      await this.sendEmailVerification(user.id);
    } catch (error) {
      // Log error but don't fail registration if email sending fails
      console.error('Failed to send verification email:', error);
    }

    return this.generateTokens(user);
  }

  async login(loginDto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.validateUser(loginDto.email, loginDto.password);

    if (!user) {
      throw new InvalidCredentialsException();
    }

    return this.generateTokens(user);
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
      },
    });

    if (!user) {
      return null;
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('User account is inactive');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return null;
    }

    const { password: _, ...result } = user;
    return result;
  }

  async refreshToken(refreshToken: string): Promise<AuthResponseDto> {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
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

      if (!user || user.status !== 'ACTIVE') {
        throw new UnauthorizedException('User not found or inactive');
      }

      return this.generateTokens(user);
    } catch (error) {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  private async generateTokens(user: UserResponseDto): Promise<AuthResponseDto> {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_SECRET'),
      expiresIn: this.configService.get<string>('JWT_EXPIRES_IN') || '7d',
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') || '30d',
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

    // Generate reset token
    const resetToken = uuidv4();
    const resetTokenExpiry = new Date();
    resetTokenExpiry.setHours(resetTokenExpiry.getHours() + 1); // Token valid for 1 hour

    // Store token in database
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        resetToken,
        resetTokenExpiry,
      },
    });

    // Send password reset email
    await this.emailService.sendPasswordResetEmail(user.email, resetToken);

    return {
      message: 'If an account with that email exists, a password reset link has been sent.',
    };
  }

  /**
   * Reset password using token
   */
  async resetPassword(resetPasswordDto: ResetPasswordDto): Promise<{ message: string }> {
    const { token, newPassword } = resetPasswordDto;

    // Find user by reset token
    const user = await this.prisma.user.findFirst({
      where: {
        resetToken: token,
        resetTokenExpiry: {
          gt: new Date(), // Token not expired
        },
      },
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password and clear reset token
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        resetToken: null,
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
    const hashedPassword = await bcrypt.hash(newPassword, 10);

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
   * Generate a 6-digit verification code
   * Ensures uniqueness across active codes
   */
  private async generateVerificationCode(): Promise<string> {
    let code: string;
    let isUnique = false;

    while (!isUnique) {
      // Generate 6-digit random number
      code = Math.floor(100000 + Math.random() * 900000).toString();

      // Check if code is already in use (not expired)
      const existingUser = await this.prisma.user.findFirst({
        where: {
          emailVerificationCode: code,
          emailVerificationCodeExpires: {
            gt: new Date(),
          },
        },
      });

      if (!existingUser) {
        isUnique = true;
      }
    }

    return code;
  }

  /**
   * Send email verification code
   * Generates a 6-digit code and sends it via email
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
    const verificationCode = await this.generateVerificationCode();
    const codeExpires = new Date();
    codeExpires.setHours(codeExpires.getHours() + 1); // Code valid for 1 hour

    // Store code in database
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerificationCode: verificationCode,
        emailVerificationCodeExpires: codeExpires,
      },
    });

    // Send verification email with code
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
   * Verify email using 6-digit code
   */
  async verifyEmailWithCode(code: string): Promise<{ message: string; verified: boolean }> {
    // Find user by verification code
    const user = await this.prisma.user.findFirst({
      where: {
        emailVerificationCode: code,
        emailVerificationCodeExpires: {
          gt: new Date(), // Code not expired
        },
      },
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired verification code');
    }

    // Mark email as verified and clear code
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        emailVerificationCode: null,
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
}
