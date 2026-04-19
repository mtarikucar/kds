import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Ip,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CustomersService } from './customers.service';
import { LoyaltyService } from './loyalty.service';
import { CustomerSessionService } from './customer-session.service';
import { PhoneVerificationService } from './phone-verification.service';
import { ReferralService } from './referral.service';
import {
  ApplyReferralCodeDto,
  CreatePublicSessionDto,
  IdentifyCustomerDto,
  SendOTPDto,
  VerifyOTPDto,
} from './dto/customer.dto';
import { normalizePhone } from './customers.helpers';

/**
 * Guest-facing endpoints reachable from the QR-menu subdomain. Every
 * mutation resolves `tenantId` from the server-side session record instead
 * of accepting it from the request body, except for `createSession` where
 * the tenantId bootstraps the session in the first place. Rate limits are
 * tight because there is no auth wall behind the throttler.
 */
@ApiTags('customer-public')
@Controller('customer-public')
export class CustomerPublicController {
  constructor(
    private customersService: CustomersService,
    private loyaltyService: LoyaltyService,
    private sessionService: CustomerSessionService,
    private phoneVerificationService: PhoneVerificationService,
    private referralService: ReferralService,
  ) {}

  // ========================================
  // SESSION MANAGEMENT
  // ========================================

  @Post('sessions')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create a new customer session' })
  @ApiResponse({ status: 201, description: 'Session created successfully' })
  async createSession(
    @Body() dto: CreatePublicSessionDto,
    @Headers('user-agent') userAgent: string,
    @Ip() ipAddress: string,
  ) {
    return this.sessionService.createSession(dto.tenantId, dto.tableId, {
      userAgent,
      ipAddress,
    });
  }

  @Get('sessions/:sessionId')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Get session information' })
  async getSession(@Param('sessionId') sessionId: string) {
    return this.sessionService.getSession(sessionId);
  }

  @Post('sessions/validate')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Validate a session' })
  async validateSession(@Body('sessionId') sessionId: string) {
    const isValid = await this.sessionService.validateSession(sessionId);
    return { valid: isValid };
  }

  // ========================================
  // CUSTOMER IDENTIFICATION
  // ========================================

  @Post('identify')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Identify customer by phone number' })
  async identifyCustomer(@Body() dto: IdentifyCustomerDto) {
    const session = await this.sessionService.requireSession(dto.sessionId);

    const customer = await this.customersService.findOrCreateByPhone(
      dto.phone,
      session.tenantId,
      { name: dto.name, email: dto.email },
    );

    const updatedSession = await this.sessionService.linkCustomerToSession(
      dto.sessionId,
      customer.id,
      normalizePhone(dto.phone),
    );

    if (customer.totalOrders === 0 && customer.loyaltyPoints === 0) {
      const bonusResult = await this.loyaltyService.awardWelcomeBonus(
        customer.id,
        session.tenantId,
      );
      return {
        session: updatedSession,
        customer,
        welcomeBonus: {
          points: bonusResult.transaction.points,
          newBalance: bonusResult.newBalance,
        },
      };
    }

    return { session: updatedSession, customer };
  }

  // ========================================
  // CUSTOMER PROFILE & LOYALTY
  // ========================================

  @Get('profile')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Get customer profile by session' })
  async getProfile(@Query('sessionId') sessionId: string) {
    const session = await this.sessionService.requireSession(sessionId);
    if (!session.customerId) {
      throw new BadRequestException('Customer not identified in this session');
    }
    return this.customersService.getCustomerProfile(session.customerId, session.tenantId);
  }

  @Get('loyalty/balance')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Get loyalty points balance' })
  async getLoyaltyBalance(@Query('sessionId') sessionId: string) {
    const session = await this.sessionService.requireSession(sessionId);
    if (!session.customerId) {
      return {
        points: 0,
        redeemableAmount: 0,
        canRedeem: false,
        identified: false,
      };
    }
    const balance = await this.loyaltyService.getBalance(session.customerId, session.tenantId);
    return { ...balance, identified: true };
  }

  @Get('loyalty/transactions')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Get loyalty transaction history' })
  async getLoyaltyTransactions(
    @Query('sessionId') sessionId: string,
    @Query('limit') limit?: string,
  ) {
    const session = await this.sessionService.requireSession(sessionId);
    if (!session.customerId) {
      throw new BadRequestException('Customer not identified in this session');
    }
    const parsedLimit = limit ? parseInt(limit, 10) : 50;
    return this.loyaltyService.getTransactionHistory(
      session.customerId,
      session.tenantId,
      Number.isFinite(parsedLimit) ? parsedLimit : 50,
    );
  }

  @Get('loyalty/config')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Get loyalty program configuration' })
  async getLoyaltyConfig() {
    return this.loyaltyService.getLoyaltyConfig();
  }

  @Get('loyalty/tier')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Get customer tier status' })
  async getTierStatus(@Query('sessionId') sessionId: string) {
    const session = await this.sessionService.requireSession(sessionId);
    if (!session.customerId) {
      throw new BadRequestException('Customer not identified in this session');
    }
    return this.loyaltyService.getTierStatus(session.customerId, session.tenantId);
  }

  // ========================================
  // PHONE VERIFICATION
  // ========================================

  @Post('phone/send-otp')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Send OTP to phone number' })
  async sendOTP(@Body() dto: SendOTPDto) {
    const session = await this.sessionService.requireSession(dto.sessionId);
    return this.phoneVerificationService.sendOTP(dto.phone, dto.sessionId, session.tenantId);
  }

  @Post('phone/verify-otp')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Verify OTP code' })
  async verifyOTP(@Body() dto: VerifyOTPDto) {
    const session = await this.sessionService.requireSession(dto.sessionId);
    const result = await this.phoneVerificationService.verifyOTP(
      dto.phone,
      dto.code,
      dto.sessionId,
      session.tenantId,
    );

    if (result.verified) {
      const canonical = normalizePhone(dto.phone);
      const customer = await this.customersService.findByPhone(canonical, session.tenantId);
      if (customer) {
        await this.customersService.markPhoneVerified(customer.id, session.tenantId);
      }
    }
    return result;
  }

  @Get('phone/verification-status/:verificationId')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Get verification status' })
  async getVerificationStatus(
    @Param('verificationId') verificationId: string,
    @Query('sessionId') sessionId: string,
  ) {
    const session = await this.sessionService.requireSession(sessionId);
    return this.phoneVerificationService.getVerificationStatus(verificationId, session.tenantId);
  }

  // ========================================
  // REFERRAL SYSTEM
  // ========================================

  @Post('referral/generate')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Generate referral code for the current session customer' })
  async generateReferralCode(@Body('sessionId') sessionId: string) {
    const session = await this.sessionService.requireSession(sessionId);
    if (!session.customerId) {
      throw new BadRequestException('Customer not identified in this session');
    }
    const code = await this.referralService.generateReferralCode(
      session.customerId,
      session.tenantId,
    );
    return { referralCode: code };
  }

  @Post('referral/apply')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Apply referral code (phone must be verified)' })
  async applyReferralCode(@Body() dto: ApplyReferralCodeDto) {
    const session = await this.sessionService.requireSession(dto.sessionId);
    if (!session.customerId) {
      throw new BadRequestException('Customer not identified in this session');
    }
    return this.referralService.applyReferralCode(
      session.customerId,
      dto.referralCode,
      session.tenantId,
    );
  }

  @Get('referral/stats')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Get referral statistics' })
  async getReferralStats(@Query('sessionId') sessionId: string) {
    const session = await this.sessionService.requireSession(sessionId);
    if (!session.customerId) {
      throw new BadRequestException('Customer not identified in this session');
    }
    return this.referralService.getReferralStats(session.customerId, session.tenantId);
  }
}
