import { ExtractJwt, Strategy } from "passport-jwt";
import { PassportStrategy } from "@nestjs/passport";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../../prisma/prisma.service";

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  tenantId: string;
  type?: "user";
  /** Token-version stamp. Incrementing User.tokenVersion invalidates every
   * previously-issued access token. Omitted on legacy tokens — treated as 0. */
  ver?: number;
  /** v3.0.0 — the user's home branch. Hard-restricted roles
   *  (WAITER/KITCHEN/COURIER) must always carry this; ADMIN/MANAGER
   *  may carry null when they roam. */
  primaryBranchId?: string | null;
  /** v3.0.0 — the branch the SPA had pinned when this token was
   *  minted. The X-Branch-Id header overrides on a per-request basis. */
  activeBranchId?: string | null;
  /** v3.0.0 — branches the user may switch into. ADMIN with an empty
   *  list = wildcard tenant access (owner accounts). MANAGER must have
   *  every roam-able branch listed. WAITER/KITCHEN/COURIER never carry
   *  more than one element here; BranchGuard ignores it for those
   *  roles in favour of primaryBranchId. */
  allowedBranchIds?: string[];
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    const secret = configService.get<string>("JWT_SECRET");
    if (!secret) {
      throw new Error("JWT_SECRET is not configured");
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
      algorithms: ["HS256"],
    });
  }

  async validate(payload: JwtPayload) {
    if (payload.type && payload.type !== "user") {
      throw new UnauthorizedException("Invalid token type");
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
        primaryBranchId: true,
        tenant: { select: { status: true } },
      },
    });

    if (!user || user.status !== "ACTIVE") {
      throw new UnauthorizedException("User not found or inactive");
    }

    if (user.tenant?.status !== "ACTIVE") {
      throw new UnauthorizedException("Your restaurant account is not active");
    }

    // Token revocation check. Tokens issued before the current tokenVersion
    // are rejected so password-reset / admin-lockout / suspicious-login
    // handlers can invalidate all live sessions by bumping the counter.
    const tokenVer = payload.ver ?? 0;
    if (tokenVer !== user.tokenVersion) {
      throw new UnauthorizedException("Token has been revoked");
    }

    const { tenant: _tenant, tokenVersion: _ver, ...result } = user;
    // BranchGuard reads activeBranchId / allowedBranchIds straight off
    // req.user — JWT is authoritative for both (header may override
    // activeBranchId per-request; allow-list refreshes at token mint,
    // max 15 min staleness).
    return {
      ...result,
      activeBranchId: payload.activeBranchId ?? null,
      allowedBranchIds: payload.allowedBranchIds ?? [],
    };
  }
}
