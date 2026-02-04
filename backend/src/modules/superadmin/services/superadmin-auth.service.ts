import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import * as speakeasy from 'speakeasy';
import * as QRCode from 'qrcode';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  SuperAdminLoginDto,
  SuperAdminLoginResponseDto,
} from '../dto/login.dto';
import { Verify2FADto, Setup2FAResponseDto, Enable2FADto } from '../dto/verify-2fa.dto';
import { SuperAdminAuditService } from './superadmin-audit.service';
import { AuditAction, EntityType } from '../dto/audit-filter.dto';

@Injectable()
export class SuperAdminAuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private auditService: SuperAdminAuditService,
  ) {}

  async login(
    loginDto: SuperAdminLoginDto,
    ip?: string,
    userAgent?: string,
  ): Promise<SuperAdminLoginResponseDto> {
    const { email, password } = loginDto;

    const superAdmin = await this.prisma.superAdmin.findUnique({
      where: { email },
    });

    if (!superAdmin) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if account is locked
    if (superAdmin.lockedUntil && superAdmin.lockedUntil > new Date()) {
      const remainingMinutes = Math.ceil(
        (superAdmin.lockedUntil.getTime() - Date.now()) / 60000,
      );
      throw new UnauthorizedException(
        `Account locked. Try again in ${remainingMinutes} minutes.`,
      );
    }

    // Check if account is active
    if (superAdmin.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is inactive');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, superAdmin.password);

    if (!isPasswordValid) {
      // Increment failed login attempts
      const failedLogins = superAdmin.failedLogins + 1;
      const updateData: any = { failedLogins };

      // Lock account after 5 failed attempts for 30 minutes
      if (failedLogins >= 5) {
        const lockUntil = new Date();
        lockUntil.setMinutes(lockUntil.getMinutes() + 30);
        updateData.lockedUntil = lockUntil;
      }

      await this.prisma.superAdmin.update({
        where: { id: superAdmin.id },
        data: updateData,
      });

      throw new UnauthorizedException('Invalid credentials');
    }

    // Reset failed login attempts on successful password verification
    await this.prisma.superAdmin.update({
      where: { id: superAdmin.id },
      data: {
        failedLogins: 0,
        lockedUntil: null,
      },
    });

    // Generate temporary token for 2FA verification or setup
    const tempToken = this.jwtService.sign(
      {
        sub: superAdmin.id,
        email: superAdmin.email,
        type: 'superadmin-2fa-pending',
      },
      {
        secret: this.configService.get<string>('SUPERADMIN_JWT_SECRET'),
        expiresIn: '10m',
      },
    );

    // Check if 2FA is enabled
    if (superAdmin.twoFactorEnabled) {
      return {
        requiresTwoFactor: true,
        tempToken,
      };
    }

    // If 2FA is not enabled, return temp token to set up 2FA
    return {
      requiresTwoFactor: false,
      requires2FASetup: true,
      tempToken,
      superAdmin: {
        id: superAdmin.id,
        email: superAdmin.email,
        firstName: superAdmin.firstName,
        lastName: superAdmin.lastName,
      },
    };
  }

  async verify2FA(
    verify2FADto: Verify2FADto,
    ip?: string,
    userAgent?: string,
  ): Promise<SuperAdminLoginResponseDto> {
    const { tempToken, code } = verify2FADto;

    try {
      const payload = this.jwtService.verify(tempToken, {
        secret: this.configService.get<string>('SUPERADMIN_JWT_SECRET'),
      });

      if (payload.type !== 'superadmin-2fa-pending') {
        throw new UnauthorizedException('Invalid token');
      }

      const superAdmin = await this.prisma.superAdmin.findUnique({
        where: { id: payload.sub },
      });

      if (!superAdmin || !superAdmin.twoFactorSecret) {
        throw new UnauthorizedException('Invalid credentials');
      }

      // Verify TOTP code with wider window for time sync issues
      const isValid = speakeasy.totp.verify({
        secret: superAdmin.twoFactorSecret,
        encoding: 'base32',
        token: code,
        window: 4, // Allow 4 steps tolerance (2 minutes before/after)
      });

      if (!isValid) {
        throw new UnauthorizedException('Invalid 2FA code');
      }

      // Update last login
      await this.prisma.superAdmin.update({
        where: { id: superAdmin.id },
        data: {
          lastLogin: new Date(),
          lastLoginIp: ip,
        },
      });

      // Log successful login
      await this.auditService.log({
        action: AuditAction.LOGIN,
        entityType: EntityType.SUPER_ADMIN,
        entityId: superAdmin.id,
        actorId: superAdmin.id,
        actorEmail: superAdmin.email,
        metadata: { ip, userAgent },
      });

      return this.generateTokens(superAdmin);
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  async setup2FA(superAdminId: string): Promise<Setup2FAResponseDto> {
    const superAdmin = await this.prisma.superAdmin.findUnique({
      where: { id: superAdminId },
    });

    if (!superAdmin) {
      throw new UnauthorizedException('SuperAdmin not found');
    }

    return this.generateAndStore2FASecret(superAdmin);
  }

  async setup2FAWithToken(tempToken: string): Promise<Setup2FAResponseDto> {
    try {
      const payload = this.jwtService.verify(tempToken, {
        secret: this.configService.get<string>('SUPERADMIN_JWT_SECRET'),
      });

      if (payload.type !== 'superadmin-2fa-pending') {
        throw new UnauthorizedException('Invalid token');
      }

      const superAdmin = await this.prisma.superAdmin.findUnique({
        where: { id: payload.sub },
      });

      if (!superAdmin) {
        throw new UnauthorizedException('SuperAdmin not found');
      }

      return this.generateAndStore2FASecret(superAdmin);
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  private async generateAndStore2FASecret(
    superAdmin: { id: string; email: string },
  ): Promise<Setup2FAResponseDto> {
    // Generate secret
    const secret = speakeasy.generateSecret({
      name: `KDS SuperAdmin (${superAdmin.email})`,
      issuer: 'KDS',
      length: 32,
    });

    // Store secret temporarily (will be confirmed when enabling 2FA)
    await this.prisma.superAdmin.update({
      where: { id: superAdmin.id },
      data: {
        twoFactorSecret: secret.base32,
      },
    });

    // Generate QR code
    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

    return {
      secret: secret.base32,
      qrCodeUrl,
      otpauthUrl: secret.otpauth_url,
    };
  }

  async enable2FA(
    superAdminId: string,
    enable2FADto: Enable2FADto,
  ): Promise<{ message: string }> {
    const superAdmin = await this.prisma.superAdmin.findUnique({
      where: { id: superAdminId },
    });

    if (!superAdmin || !superAdmin.twoFactorSecret) {
      throw new BadRequestException('Please set up 2FA first');
    }

    // Verify the code with wider window for time sync issues
    const isValid = speakeasy.totp.verify({
      secret: superAdmin.twoFactorSecret,
      encoding: 'base32',
      token: enable2FADto.code,
      window: 4, // Allow 4 steps tolerance (2 minutes before/after)
    });

    if (!isValid) {
      throw new BadRequestException('Invalid verification code');
    }

    // Enable 2FA
    await this.prisma.superAdmin.update({
      where: { id: superAdminId },
      data: {
        twoFactorEnabled: true,
      },
    });

    // Log 2FA enabled
    await this.auditService.log({
      action: AuditAction.UPDATE,
      entityType: EntityType.SUPER_ADMIN,
      entityId: superAdminId,
      actorId: superAdminId,
      actorEmail: superAdmin.email,
      newData: { twoFactorEnabled: true },
    });

    return { message: '2FA enabled successfully' };
  }

  async enable2FAWithToken(
    tempToken: string,
    code: string,
  ): Promise<SuperAdminLoginResponseDto> {
    try {
      const payload = this.jwtService.verify(tempToken, {
        secret: this.configService.get<string>('SUPERADMIN_JWT_SECRET'),
      });

      if (payload.type !== 'superadmin-2fa-pending') {
        throw new UnauthorizedException('Invalid token');
      }

      const superAdmin = await this.prisma.superAdmin.findUnique({
        where: { id: payload.sub },
      });

      if (!superAdmin || !superAdmin.twoFactorSecret) {
        throw new BadRequestException('Please set up 2FA first');
      }

      // Verify the code with wider window for time sync issues
      const isValid = speakeasy.totp.verify({
        secret: superAdmin.twoFactorSecret,
        encoding: 'base32',
        token: code,
        window: 4, // Allow 4 steps tolerance (2 minutes before/after)
      });

      // Debug: Generate current expected code for troubleshooting
      if (!isValid) {
        const expectedCode = speakeasy.totp({
          secret: superAdmin.twoFactorSecret,
          encoding: 'base32',
        });
        console.log('2FA Debug - Expected code:', expectedCode, 'Received:', code);
        throw new BadRequestException('Invalid verification code');
      }

      // Enable 2FA
      await this.prisma.superAdmin.update({
        where: { id: superAdmin.id },
        data: {
          twoFactorEnabled: true,
          lastLogin: new Date(),
        },
      });

      // Log 2FA enabled
      await this.auditService.log({
        action: AuditAction.UPDATE,
        entityType: EntityType.SUPER_ADMIN,
        entityId: superAdmin.id,
        actorId: superAdmin.id,
        actorEmail: superAdmin.email,
        newData: { twoFactorEnabled: true },
      });

      // Return tokens since 2FA is now enabled
      return this.generateTokens(superAdmin);
    } catch (error) {
      if (
        error instanceof UnauthorizedException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  async logout(
    superAdminId: string,
    ip?: string,
    userAgent?: string,
  ): Promise<{ message: string }> {
    const superAdmin = await this.prisma.superAdmin.findUnique({
      where: { id: superAdminId },
      select: { email: true },
    });

    if (superAdmin) {
      await this.auditService.log({
        action: AuditAction.LOGOUT,
        entityType: EntityType.SUPER_ADMIN,
        entityId: superAdminId,
        actorId: superAdminId,
        actorEmail: superAdmin.email,
        metadata: { ip, userAgent },
      });
    }

    return { message: 'Logged out successfully' };
  }

  async refreshToken(
    refreshToken: string,
  ): Promise<SuperAdminLoginResponseDto> {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('SUPERADMIN_JWT_REFRESH_SECRET'),
      });

      if (payload.type !== 'superadmin-refresh') {
        throw new UnauthorizedException('Invalid token type');
      }

      const superAdmin = await this.prisma.superAdmin.findUnique({
        where: { id: payload.sub },
      });

      if (!superAdmin || superAdmin.status !== 'ACTIVE') {
        throw new UnauthorizedException('SuperAdmin not found or inactive');
      }

      return this.generateTokens(superAdmin);
    } catch (error) {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  private generateTokens(superAdmin: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  }): SuperAdminLoginResponseDto {
    const accessToken = this.jwtService.sign(
      {
        sub: superAdmin.id,
        email: superAdmin.email,
        type: 'superadmin',
      },
      {
        secret: this.configService.get<string>('SUPERADMIN_JWT_SECRET'),
        expiresIn: '1h', // Short-lived access token for security
      },
    );

    const refreshToken = this.jwtService.sign(
      {
        sub: superAdmin.id,
        email: superAdmin.email,
        type: 'superadmin-refresh',
      },
      {
        secret: this.configService.get<string>('SUPERADMIN_JWT_REFRESH_SECRET'),
        expiresIn: '7d',
      },
    );

    return {
      requiresTwoFactor: false,
      accessToken,
      refreshToken,
      superAdmin: {
        id: superAdmin.id,
        email: superAdmin.email,
        firstName: superAdmin.firstName,
        lastName: superAdmin.lastName,
      },
    };
  }

  async createInitialSuperAdmin(
    email: string,
    password: string,
    firstName: string,
    lastName: string,
  ): Promise<{ id: string; email: string }> {
    // Check if any superadmin exists
    const existingCount = await this.prisma.superAdmin.count();
    if (existingCount > 0) {
      throw new BadRequestException('SuperAdmin already exists');
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const superAdmin = await this.prisma.superAdmin.create({
      data: {
        email,
        password: hashedPassword,
        firstName,
        lastName,
        status: 'ACTIVE',
        twoFactorEnabled: false, // Will need to set up 2FA on first login
      },
      select: {
        id: true,
        email: true,
      },
    });

    return superAdmin;
  }
}
