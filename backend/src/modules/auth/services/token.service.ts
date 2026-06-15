import { Injectable, Optional, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { createHash, randomBytes } from "crypto";
import { PrismaService } from "../../../prisma/prisma.service";
import { MetricsService } from "../../../common/metrics/metrics.service";
import { TenantStatus } from "../../../common/constants/subscription.enum";
import { AuthResponseDto, UserResponseDto } from "../dto/auth-response.dto";
import { resolvePrimaryBranchId } from "./resolve-primary-branch";

/**
 * TokenService — owns access/refresh token mint, rotation, and refresh-token
 * verification. Extracted verbatim from AuthService; the logic (including the
 * v3.0.1 round-6 audit ordering: stored lookup -> user lookup -> ver check ->
 * atomic single-use claim -> family revoke on reuse) is preserved byte-for-byte.
 *
 * MetricsService is @Optional so the service never depends on the metrics
 * registry being wired (matches the original AuthService contract).
 */
@Injectable()
export class TokenService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    @Optional() private metrics?: MetricsService,
  ) {}

  hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  async generateTokens(
    // Loose input shape — `generateTokens` populates primaryBranchId
    // and allowedBranchIds itself from the DB, so callers can pass
    // a plain Prisma row select without first having to read the
    // branch context. The returned AuthResponseDto.user is the full
    // UserResponseDto with both fields surfaced.
    user: Omit<UserResponseDto, "primaryBranchId" | "allowedBranchIds">,
    ip?: string,
    userAgent?: string,
  ): Promise<AuthResponseDto> {
    // Read tokenVersion + branch context in a single round trip. JWT
    // carries primaryBranchId + activeBranchId (defaults to the home
    // branch) + the resolved allowedBranchIds list so BranchGuard can
    // decide without a DB hit. List freshness: max one JWT lifetime
    // (15 min) since allow-list changes only land at next token mint.
    const row = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: {
        tokenVersion: true,
        primaryBranchId: true,
        branchAssignments: { select: { branchId: true } },
      },
    });
    // Owner ADMIN/MANAGER accounts predating the v3.0.0 branch system (or
    // any user the backfill missed) carry a null primaryBranchId. Resolve
    // the tenant's home branch so the response/JWT always hand the SPA a
    // concrete branchId — otherwise its branchScopeStore resolves null and
    // the api-client rejects every branch-scoped request client-side.
    const primaryBranchId = await resolvePrimaryBranchId(
      this.prisma,
      user.tenantId,
      row?.primaryBranchId ?? null,
    );
    const allowedBranchIds = (row?.branchAssignments ?? []).map(
      (a) => a.branchId,
    );
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      type: "user" as const,
      ver: row?.tokenVersion ?? 0,
      primaryBranchId,
      // activeBranchId mirrors primaryBranchId at issuance — the SPA
      // pins a different value per-request via X-Branch-Id without
      // minting a fresh token.
      activeBranchId: primaryBranchId,
      allowedBranchIds,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>("JWT_SECRET"),
      expiresIn: this.configService.get<string>("JWT_EXPIRES_IN") || "15m",
      algorithm: "HS256",
    });

    const refreshExpiresIn =
      this.configService.get<string>("JWT_REFRESH_EXPIRES_IN") || "30d";
    // jti makes the refresh token unique even when two issuances land in
    // the same second (same iat → same payload → same JWT bytes → same
    // tokenHash → P2002 on the unique constraint). The access token
    // doesn't need it because it isn't persisted server-side.
    const refreshToken = this.jwtService.sign(
      { ...payload, jti: randomBytes(8).toString("hex") },
      {
        secret: this.configService.get<string>("JWT_REFRESH_SECRET"),
        expiresIn: refreshExpiresIn,
        algorithm: "HS256",
      },
    );

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
      user: {
        ...user,
        // Surface the branch claims to the SPA so its branchScopeStore
        // can hydrate on login without a separate /me round-trip.
        primaryBranchId,
        allowedBranchIds,
      },
    };
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
        secret: this.configService.get<string>("JWT_REFRESH_SECRET"),
        algorithms: ["HS256"],
      });
    } catch (_err) {
      throw new UnauthorizedException("Invalid refresh token");
    }

    if (payload.type && payload.type !== "user") {
      throw new UnauthorizedException("Invalid token type");
    }

    const tokenHash = this.hashToken(refreshToken);

    // v3.0.1 round-6 audit fix — check `payload.ver` against
    // `user.tokenVersion` BEFORE the atomic rotation claim. Pre-fix
    // the version check ran AFTER the claim had already revoked the
    // presented token, so a stale-ver token replayed after a password
    // reset would (a) burn the row and (b) revoke the entire refresh
    // family — a DoS vector against the legitimate session via one
    // pre-rotation token. Verifying ver first lets a stale token fail
    // cleanly without touching any other refresh row; the actual race
    // protection still lives in the conditional `updateMany` below.
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (!stored || stored.expiresAt <= new Date()) {
      throw new UnauthorizedException("Invalid refresh token");
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
        tokenVersion: true,
        tenant: { select: { status: true } },
      },
    });

    if (!user || user.status !== "ACTIVE") {
      throw new UnauthorizedException("User not found or inactive");
    }
    if (user.tenant?.status !== TenantStatus.ACTIVE) {
      throw new UnauthorizedException("Your restaurant account is not active");
    }

    // ver check before the rotation claim. A stale-ver replay returns
    // a clean 401 without burning the row or family-revoking the
    // user's other refresh tokens. The genuine "newly-revoked token
    // arriving milliseconds before the user logs back in" case is
    // indistinguishable from a replay — but the legitimate post-
    // password-reset path already issues a fresh refresh, so the
    // legitimate flow doesn't depend on the stale row succeeding.
    const refreshVer = (payload as any).ver ?? 0;
    if (refreshVer !== user.tokenVersion) {
      throw new UnauthorizedException("Token has been revoked");
    }

    // Atomic claim: only one in-flight refresh call wins the rotation.
    // The previous flow read the row, checked revokedAt, then updated
    // separately — two parallel refreshes with the same cookie could
    // both pass that check and both mint a fresh pair (TOCTOU). The
    // conditional updateMany on `revokedAt: null` serializes them, and
    // the loser sees count===0 and falls into the replay branch below.
    const claimed = await this.prisma.refreshToken.updateMany({
      where: {
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { revokedAt: new Date() },
    });

    if (claimed.count === 0) {
      // The token was already revoked (legitimate rotation, logout, or
      // replay of a rotated-out token). Treat as a theft signal and
      // revoke the whole family so a stolen token can't keep minting.
      await this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      this.metrics?.incCounter(
        "auth_refresh_reuse_total",
        "Refresh-token reuse (theft signal) detections that family-revoked a user",
      );
      throw new UnauthorizedException("Refresh token reuse detected");
    }

    const { tenant: _t, tokenVersion: _ver, ...userForToken } = user;
    return this.generateTokens(userForToken, ip, userAgent);
  }

  /**
   * Revoke every active refresh token for a user (logout / password change
   * / reset). Returns the updateMany result so callers can inspect counts.
   */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
