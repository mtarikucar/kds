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
  type?: 'user';
  /** Token-version stamp. Incrementing User.tokenVersion invalidates every
   * previously-issued access token. Omitted on legacy tokens — treated as 0. */
  ver?: number;
  /**
   * v3.0.0 — primary branch the user is assigned to. WAITER/KITCHEN/COURIER
   * are hard-restricted to their primary branch; ADMIN/MANAGER may have
   * `primaryBranchId=null` (= "all branches"). Optional for backwards
   * compatibility — pre-v3 tokens without the claim trigger a one-time
   * fallback in BranchGuard (tenant's single active branch). The
   * underlying User.primaryBranchId column lands in the same release.
   */
  primaryBranchId?: string | null;
  /**
   * v3.0.0 — branch currently active for this session. BranchPicker on the
   * SPA mutates this via token refresh (or X-Branch-Id header on a single
   * request). For WAITER/KITCHEN/COURIER this must equal primaryBranchId;
   * BranchGuard enforces. Optional for backwards compat (see above).
   */
  activeBranchId?: string | null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    const secret = configService.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET is not configured');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
      algorithms: ['HS256'],
    });
  }

  async validate(payload: JwtPayload) {
    if (payload.type && payload.type !== 'user') {
      throw new UnauthorizedException('Invalid token type');
    }

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
        tenant: { select: { status: true } },
      },
    });

    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('User not found or inactive');
    }

    if (user.tenant?.status !== 'ACTIVE') {
      throw new UnauthorizedException('Your restaurant account is not active');
    }

    // Token revocation check. Tokens issued before the current tokenVersion
    // are rejected so password-reset / admin-lockout / suspicious-login
    // handlers can invalidate all live sessions by bumping the counter.
    const tokenVer = payload.ver ?? 0;
    if (tokenVer !== user.tokenVersion) {
      throw new UnauthorizedException('Token has been revoked');
    }

    const { tenant: _tenant, tokenVersion: _ver, ...result } = user;
    // v3.0.0 — forward branch claims from the JWT verbatim. BranchGuard
    // reads `req.user.primaryBranchId` + `req.user.activeBranchId` to
    // decide which scope this request runs under. Falling through if
    // the claims are absent (legacy tokens) is fine — BranchGuard's
    // fallback chain handles the missing-claim case by reading the
    // tenant's single active branch.
    return {
      ...result,
      primaryBranchId: payload.primaryBranchId ?? null,
      activeBranchId: payload.activeBranchId ?? null,
    };
  }
}
