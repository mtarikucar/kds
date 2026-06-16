import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { Request, Response } from "express";
import { SuperAdminAuthService } from "../services/superadmin-auth.service";
import { SuperAdminLoginDto } from "../dto/login.dto";
import {
  Verify2FADto,
  Enable2FADto,
  Disable2FADto,
  RegenerateBackupCodesDto,
} from "../dto/verify-2fa.dto";
import { SuperAdminRefreshTokenDto } from "../dto/refresh-token.dto";
import { SuperAdminGuard } from "../guards/superadmin.guard";
import {
  SuperAdminPublic,
  SuperAdminRoute,
} from "../decorators/superadmin.decorator";
import { CurrentSuperAdmin } from "../decorators/current-superadmin.decorator";
import { getClientIp } from "../../../common/helpers/client-ip.helper";

// Aggressive per-endpoint throttle budgets. Superadmin routes are the
// highest-privilege surface in the product — treating them tighter than
// tenant auth is appropriate.
const LOGIN_THROTTLE = { default: { limit: 5, ttl: 60_000 } };
const VERIFY_2FA_THROTTLE = { default: { limit: 5, ttl: 60_000 } };
const REFRESH_THROTTLE = { default: { limit: 30, ttl: 60_000 } };

// The superadmin refresh token rides an httpOnly cookie (mirrors the tenant
// flow in auth.controller.ts) so a superadmin SESSION survives a page reload
// WITHOUT the highest-privilege tokens ever sitting in localStorage where XSS
// could exfiltrate them. httpOnly = no JS access; sameSite:strict = no CSRF;
// path scopes the cookie to the superadmin auth routes only.
const SA_REFRESH_COOKIE = "superAdminRefreshToken";
const SA_REFRESH_COOKIE_PATH = "/api/superadmin/auth";
const SA_REFRESH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7d; JWT exp still governs validity.
function setSaRefreshCookie(res: Response, token: string) {
  res.cookie(SA_REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: SA_REFRESH_COOKIE_PATH,
    maxAge: SA_REFRESH_MAX_AGE_MS,
  });
}
function clearSaRefreshCookie(res: Response) {
  res.clearCookie(SA_REFRESH_COOKIE, { path: SA_REFRESH_COOKIE_PATH });
}

@ApiTags("SuperAdmin Auth")
@Controller("superadmin/auth")
@UseGuards(SuperAdminGuard)
@SuperAdminRoute()
export class SuperAdminAuthController {
  constructor(private readonly authService: SuperAdminAuthService) {}

  @Post("login")
  @SuperAdminPublic()
  @Throttle(LOGIN_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "SuperAdmin login (requires 2FA already enrolled)" })
  async login(
    @Body() loginDto: SuperAdminLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = getClientIp(req);
    const userAgent = req.headers["user-agent"];
    const result = await this.authService.login(loginDto, ip, userAgent);
    // Only the fully-authenticated branch carries a refresh token (the 2FA
    // tempToken branch does not). Set the cookie so a reload stays signed in.
    const refreshToken = (result as { refreshToken?: string }).refreshToken;
    if (refreshToken) setSaRefreshCookie(res, refreshToken);
    return result;
  }

  @Post("verify-2fa")
  @SuperAdminPublic()
  @Throttle(VERIFY_2FA_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Verify 2FA code or backup code" })
  async verify2FA(
    @Body() verify2FADto: Verify2FADto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = getClientIp(req);
    const userAgent = req.headers["user-agent"];
    const result = await this.authService.verify2FA(
      verify2FADto,
      ip,
      userAgent,
    );
    const refreshToken = (result as { refreshToken?: string }).refreshToken;
    if (refreshToken) setSaRefreshCookie(res, refreshToken);
    return result;
  }

  // 2FA lifecycle is fully authenticated now. The prior
  // setup-with-token / enable-with-token endpoints were removed because
  // they let anyone with the password self-enroll 2FA and log in.
  @Get("2fa/setup")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Begin 2FA setup (authenticated)" })
  async setup2FA(@CurrentSuperAdmin("id") superAdminId: string) {
    return this.authService.setup2FA(superAdminId);
  }

  @Post("2fa/enable")
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Confirm 2FA setup; returns one-time backup codes" })
  async enable2FA(
    @CurrentSuperAdmin("id") superAdminId: string,
    @Body() enable2FADto: Enable2FADto,
  ) {
    return this.authService.enable2FA(superAdminId, enable2FADto);
  }

  @Post("2fa/disable")
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Disable 2FA (requires current password + TOTP)" })
  async disable2FA(
    @CurrentSuperAdmin("id") superAdminId: string,
    @Body() dto: Disable2FADto,
  ) {
    return this.authService.disable2FA(
      superAdminId,
      dto.currentPassword,
      dto.code,
    );
  }

  @Post("2fa/regenerate-backup-codes")
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Regenerate 2FA backup codes (invalidates old ones)",
  })
  async regenerateBackupCodes(
    @CurrentSuperAdmin("id") superAdminId: string,
    @Body() dto: RegenerateBackupCodesDto,
  ) {
    return this.authService.regenerateBackupCodes(superAdminId, dto.code);
  }

  @Post("logout")
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "SuperAdmin logout (revokes all tokens)" })
  async logout(
    @CurrentSuperAdmin("id") superAdminId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = getClientIp(req);
    const userAgent = req.headers["user-agent"];
    clearSaRefreshCookie(res);
    return this.authService.logout(superAdminId, ip, userAgent);
  }

  @Post("refresh")
  @SuperAdminPublic()
  @Throttle(REFRESH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Refresh the access token using the httpOnly refresh cookie",
  })
  async refresh(
    @Body() dto: SuperAdminRefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Cookie is the primary source (survives reload, not JS-readable); the
    // body is a backward-compatible fallback for an in-memory token.
    const token = req.cookies?.[SA_REFRESH_COOKIE] ?? dto.refreshToken;
    if (!token) {
      throw new UnauthorizedException("Missing refresh token");
    }
    const result = await this.authService.refreshToken(token);
    // Rotation: persist the freshly-minted refresh token back to the cookie.
    if (result.refreshToken) setSaRefreshCookie(res, result.refreshToken);
    return result;
  }

  @Get("me")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get current SuperAdmin profile" })
  async getProfile(@CurrentSuperAdmin() superAdmin: any) {
    return superAdmin;
  }
}
