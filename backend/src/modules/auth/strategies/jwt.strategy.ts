import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  tenantId: string;
  /** Token-version stamp. Incrementing User.tokenVersion invalidates every
   * previously-issued access/refresh token. Omitted on legacy tokens
   * issued before this field was added — treated as 0. */
  ver?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
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
        tokenVersion: true,
      },
    });

    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('User not found or inactive');
    }

    // Token revocation check: password reset / admin lockout / suspicious-
    // login bumps User.tokenVersion, invalidating every token issued
    // before the bump. Legacy tokens without `ver` default to 0, matching
    // the default column value so existing sessions don't break.
    const tokenVer = payload.ver ?? 0;
    if (tokenVer !== user.tokenVersion) {
      throw new UnauthorizedException('Token has been revoked');
    }

    const { tokenVersion: _v, ...result } = user;
    return result;
  }
}
