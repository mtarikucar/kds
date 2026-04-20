import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { MarketingLoginDto } from '../dto';

const MAX_FAILED_LOGINS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;

@Injectable()
export class MarketingAuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  private bcryptCost(): number {
    const raw = this.configService.get<string>('BCRYPT_COST');
    const parsed = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed >= 10 && parsed <= 15 ? parsed : 12;
  }

  private accessSecret(): string {
    const secret = this.configService.get<string>('MARKETING_JWT_SECRET');
    if (!secret) throw new Error('MARKETING_JWT_SECRET is not configured');
    return secret;
  }

  private refreshSecret(): string {
    // No `|| accessSecret()` fallback: refresh must live in a distinct
    // realm, otherwise a stolen access token could be replayed as a
    // refresh and vice versa.
    const secret = this.configService.get<string>('MARKETING_JWT_REFRESH_SECRET');
    if (!secret) throw new Error('MARKETING_JWT_REFRESH_SECRET is not configured');
    return secret;
  }

  async login(dto: MarketingLoginDto, ip?: string) {
    const user = await this.prisma.marketingUser.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is inactive');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException('Account is temporarily locked');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);

    if (!isPasswordValid) {
      // Compute the new count locally so the lock fires on the *new*
      // value crossing the threshold, not on the already-stored value.
      const nextCount = user.failedLogins + 1;
      const locking = nextCount >= MAX_FAILED_LOGINS;
      await this.prisma.marketingUser.update({
        where: { id: user.id },
        data: {
          // When we lock, reset the counter so the lock expiry returns
          // the user to a clean slate — the prior code left
          // failedLogins=5 forever, re-locking on every future typo.
          failedLogins: locking ? 0 : nextCount,
          lockedUntil: locking ? new Date(Date.now() + LOCK_DURATION_MS) : null,
        },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.prisma.marketingUser.update({
      where: { id: user.id },
      data: {
        failedLogins: 0,
        lockedUntil: null,
        lastLogin: new Date(),
        lastLoginIp: ip,
      },
    });

    return this.generateTokens(user);
  }

  async refreshToken(token: string) {
    let payload: any;
    try {
      payload = await this.jwtService.verifyAsync(token, {
        secret: this.refreshSecret(),
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (payload.type !== 'marketing') {
      throw new UnauthorizedException('Invalid token type');
    }
    if (payload.tokenType !== 'refresh') {
      throw new UnauthorizedException('Invalid token: not a refresh token');
    }

    const user = await this.prisma.marketingUser.findUnique({
      where: { id: payload.sub },
    });

    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('User not found or inactive');
    }
    if (typeof payload.ver === 'number' && payload.ver !== user.tokenVersion) {
      throw new UnauthorizedException('Session revoked');
    }

    // Rotate: issue a fresh pair (not just a new access token) so the
    // old refresh ages out even if the client keeps presenting it.
    return this.generateTokens(user);
  }

  async logout(userId: string) {
    // Bump tokenVersion → existing access/refresh tokens become stale
    // the next time the guard or refresh endpoint reads this row.
    await this.prisma.marketingUser.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    });
    return { message: 'Logged out' };
  }

  private generateTokens(user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    avatar: string | null;
    role: string;
    tokenVersion: number;
  }) {
    const basePayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      ver: user.tokenVersion,
      type: 'marketing' as const,
    };

    const accessToken = this.jwtService.sign(basePayload, {
      secret: this.accessSecret(),
      expiresIn: '8h',
      algorithm: 'HS256',
    });

    const refreshToken = this.jwtService.sign(
      { ...basePayload, tokenType: 'refresh' },
      {
        secret: this.refreshSecret(),
        expiresIn: '7d',
        algorithm: 'HS256',
      },
    );

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        phone: user.phone,
        avatar: user.avatar,
      },
    };
  }

  async getProfile(userId: string) {
    const user = await this.prisma.marketingUser.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        avatar: true,
        role: true,
        status: true,
        lastLogin: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    return user;
  }

  async updateProfile(
    userId: string,
    data: { firstName?: string; lastName?: string; phone?: string },
  ) {
    return this.prisma.marketingUser.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        avatar: true,
        role: true,
      },
    });
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await this.prisma.marketingUser.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    const hashedPassword = await bcrypt.hash(newPassword, this.bcryptCost());
    await this.prisma.marketingUser.update({
      where: { id: userId },
      data: {
        password: hashedPassword,
        // Force-logout every session that existed before this change.
        tokenVersion: { increment: 1 },
      },
    });

    return { message: 'Password changed successfully' };
  }
}
