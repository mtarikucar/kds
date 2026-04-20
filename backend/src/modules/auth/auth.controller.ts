import { Controller, Post, Get, Body, UseGuards, Req, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { GoogleAuthDto, AppleAuthDto } from './dto/social-auth.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { ForgotPasswordDto, ResetPasswordDto, ChangePasswordDto } from './dto/password-reset.dto';
import { VerifyEmailCodeDto } from './dto/verify-email-code.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { UnauthorizedException } from '@nestjs/common';

// Per-endpoint throttle budgets for sensitive auth actions
const LOGIN_THROTTLE = { default: { limit: 5, ttl: 60_000 } };
const REGISTER_THROTTLE = { default: { limit: 3, ttl: 3_600_000 } };
const FORGOT_THROTTLE = { default: { limit: 5, ttl: 60_000 } };
const VERIFY_THROTTLE = { default: { limit: 5, ttl: 60_000 } };
const SOCIAL_THROTTLE = { default: { limit: 3, ttl: 3_600_000 } };

// Refresh-token cookie. `/api/auth` path scopes it to refresh + logout;
// httpOnly blocks JS access (XSS mitigation), sameSite: strict blocks
// CSRF. Secure is on outside development.
const REFRESH_COOKIE = 'refreshToken';
const REFRESH_COOKIE_OPTS = (maxAgeMs: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/api/auth',
  maxAge: maxAgeMs,
});
// Default 30 days — service-side lifetime still governed by JWT exp.
const REFRESH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, REFRESH_COOKIE_OPTS(REFRESH_COOKIE_MAX_AGE_MS));
}

function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
}

/**
 * Strip the refresh token from the response body so the only channel it
 * travels in is the httpOnly cookie (not readable by JS; not persisted
 * in localStorage).
 */
function stripRefresh(result: AuthResponseDto): Omit<AuthResponseDto, 'refreshToken'> {
  const { refreshToken: _r, ...rest } = result;
  return rest;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle(REGISTER_THROTTLE)
  @Post('register')
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({ status: 201, description: 'User successfully registered' })
  @ApiResponse({ status: 409, description: 'Email already in use' })
  async register(
    @Body() registerDto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.register(registerDto);
    if (result.refreshToken) {
      setRefreshCookie(res, result.refreshToken);
    }
    return stripRefresh(result);
  }

  @Public()
  @Throttle(LOGIN_THROTTLE)
  @Post('login')
  @ApiOperation({ summary: 'Login user' })
  @ApiResponse({ status: 200, description: 'User successfully logged in' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(
    @Body() loginDto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = req.ip || req.headers['x-forwarded-for']?.toString();
    const userAgent = req.headers['user-agent'];
    const result = await this.authService.login(loginDto, ip, userAgent);
    if (result.refreshToken) {
      setRefreshCookie(res, result.refreshToken);
    }
    return stripRefresh(result);
  }

  @Public()
  @Post('refresh')
  @ApiOperation({ summary: 'Refresh access token using httpOnly refresh cookie' })
  @ApiResponse({ status: 200, description: 'Token successfully refreshed' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) {
      throw new UnauthorizedException('Missing refresh token');
    }
    const ip = req.ip || req.headers['x-forwarded-for']?.toString();
    const userAgent = req.headers['user-agent'];
    const result = await this.authService.refreshToken(token, ip, userAgent);
    setRefreshCookie(res, result.refreshToken);
    return stripRefresh(result);
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, description: 'User profile retrieved' })
  async getProfile(@CurrentUser('id') userId: string) {
    return this.authService.getProfile(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Log out and revoke all refresh tokens for this user' })
  @ApiResponse({ status: 200, description: 'Logged out' })
  async logout(
    @CurrentUser('id') userId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = req.ip || req.headers['x-forwarded-for']?.toString();
    const userAgent = req.headers['user-agent'];
    const result = await this.authService.logout(userId, ip, userAgent);
    clearRefreshCookie(res);
    return result;
  }

  @Public()
  @Throttle(FORGOT_THROTTLE)
  @Post('forgot-password')
  @ApiOperation({ summary: 'Request password reset' })
  @ApiResponse({ status: 200, description: 'Password reset email sent (if user exists)' })
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.forgotPassword(forgotPasswordDto);
  }

  @Public()
  @Throttle(FORGOT_THROTTLE)
  @Post('reset-password')
  @ApiOperation({ summary: 'Reset password with token' })
  @ApiResponse({ status: 200, description: 'Password successfully reset' })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetPasswordDto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change password for authenticated user' })
  @ApiResponse({ status: 200, description: 'Password successfully changed' })
  @ApiResponse({ status: 400, description: 'Current password incorrect' })
  async changePassword(
    @CurrentUser('id') userId: string,
    @Body() changePasswordDto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(userId, changePasswordDto);
  }

  @Public()
  @Throttle(VERIFY_THROTTLE)
  @Post('verify-email')
  @ApiOperation({ summary: 'Verify email with 6-digit code' })
  @ApiResponse({ status: 200, description: 'Email successfully verified' })
  @ApiResponse({ status: 400, description: 'Invalid or expired verification code' })
  async verifyEmail(@Body() dto: VerifyEmailCodeDto) {
    return this.authService.verifyEmailWithCode(dto.email, dto.code);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle(VERIFY_THROTTLE)
  @Post('resend-verification')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Resend email verification' })
  @ApiResponse({ status: 200, description: 'Verification email sent' })
  async resendVerification(@CurrentUser('id') userId: string) {
    return this.authService.sendEmailVerification(userId);
  }

  @Public()
  @Throttle(SOCIAL_THROTTLE)
  @Post('google')
  @ApiOperation({ summary: 'Authenticate with Google OAuth' })
  @ApiResponse({ status: 200, description: 'Successfully authenticated with Google' })
  @ApiResponse({ status: 401, description: 'Invalid Google token' })
  async googleAuth(
    @Body() googleAuthDto: GoogleAuthDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.googleAuth(googleAuthDto);
    setRefreshCookie(res, result.refreshToken);
    return stripRefresh(result);
  }

  @Public()
  @Throttle(SOCIAL_THROTTLE)
  @Post('apple')
  @ApiOperation({ summary: 'Authenticate with Apple Sign-In' })
  @ApiResponse({ status: 200, description: 'Successfully authenticated with Apple' })
  @ApiResponse({ status: 401, description: 'Invalid Apple token' })
  async appleAuth(
    @Body() appleAuthDto: AppleAuthDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.appleAuth(appleAuthDto);
    setRefreshCookie(res, result.refreshToken);
    return stripRefresh(result);
  }
}
