import { Controller, Post, Get, Body, Param, Query, Headers, Ip, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CustomersService } from './customers.service';
import { LoyaltyService } from './loyalty.service';
import { CustomerSessionService } from './customer-session.service';
import { PhoneVerificationService } from './phone-verification.service';
import { ReferralService } from './referral.service';

// DTO classes for request validation
class CreateSessionDto {
  tenantId: string;
  tableId?: string;
}

class IdentifyCustomerDto {
  sessionId: string;
  phone: string;
  name?: string;
  email?: string;
}

class GetLoyaltyBalanceDto {
  sessionId: string;
}

class SendOTPDto {
  phone: string;
  sessionId?: string;
  tenantId: string;
}

class VerifyOTPDto {
  phone: string;
  code: string;
  tenantId: string;
}

class ApplyReferralCodeDto {
  customerId: string;
  referralCode: string;
  tenantId: string;
}

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
  @ApiOperation({ summary: 'Create a new customer session' })
  @ApiResponse({ status: 201, description: 'Session created successfully' })
  async createSession(
    @Body() dto: CreateSessionDto,
    @Headers('user-agent') userAgent: string,
    @Ip() ipAddress: string,
  ) {
    return this.sessionService.createSession(dto.tenantId, dto.tableId, {
      userAgent,
      ipAddress,
    });
  }

  @Get('sessions/:sessionId')
  @ApiOperation({ summary: 'Get session information' })
  @ApiResponse({ status: 200, description: 'Session retrieved successfully' })
  async getSession(@Param('sessionId') sessionId: string) {
    return this.sessionService.getSession(sessionId);
  }

  @Post('sessions/validate')
  @ApiOperation({ summary: 'Validate a session' })
  @ApiResponse({ status: 200, description: 'Session validation result' })
  async validateSession(@Body('sessionId') sessionId: string) {
    const isValid = await this.sessionService.validateSession(sessionId);
    return { valid: isValid };
  }

  // ========================================
  // CUSTOMER IDENTIFICATION
  // ========================================

  @Post('identify')
  @ApiOperation({ summary: 'Identify customer by phone number' })
  @ApiResponse({ status: 200, description: 'Customer identified successfully' })
  async identifyCustomer(@Body() dto: IdentifyCustomerDto) {
    // Validate session
    const session = await this.sessionService.getSession(dto.sessionId);

    // Find or create customer by phone
    const customer = await this.customersService.findOrCreateByPhone(
      dto.phone,
      session.tenantId,
      {
        name: dto.name,
        email: dto.email,
      },
    );

    // Link customer to session
    const updatedSession = await this.sessionService.linkCustomerToSession(
      dto.sessionId,
      customer.id,
      dto.phone,
    );

    // Check if this is a new customer and award welcome bonus
    if (customer.totalOrders === 0 && customer.loyaltyPoints === 0) {
      const bonusResult = await this.loyaltyService.awardWelcomeBonus(customer.id);
      return {
        session: updatedSession,
        customer,
        welcomeBonus: {
          points: bonusResult.transaction.points,
          newBalance: bonusResult.newBalance,
        },
      };
    }

    return {
      session: updatedSession,
      customer,
    };
  }

  // ========================================
  // CUSTOMER PROFILE & LOYALTY
  // ========================================

  @Get('profile')
  @ApiOperation({ summary: 'Get customer profile by session' })
  @ApiResponse({ status: 200, description: 'Customer profile retrieved' })
  async getProfile(@Query('sessionId') sessionId: string) {
    const session = await this.sessionService.getSession(sessionId);

    if (!session.customerId) {
      throw new BadRequestException('Customer not identified in this session');
    }

    return this.customersService.getCustomerProfile(session.customerId, session.tenantId);
  }

  @Get('loyalty/balance')
  @ApiOperation({ summary: 'Get loyalty points balance' })
  @ApiResponse({ status: 200, description: 'Loyalty balance retrieved' })
  async getLoyaltyBalance(@Query('sessionId') sessionId: string) {
    const session = await this.sessionService.getSession(sessionId);

    if (!session.customerId) {
      return {
        points: 0,
        redeemableAmount: 0,
        canRedeem: false,
        identified: false,
      };
    }

    const balance = await this.loyaltyService.getBalance(session.customerId);
    return {
      ...balance,
      identified: true,
    };
  }

  @Get('loyalty/transactions')
  @ApiOperation({ summary: 'Get loyalty transaction history' })
  @ApiResponse({ status: 200, description: 'Transaction history retrieved' })
  async getLoyaltyTransactions(
    @Query('sessionId') sessionId: string,
    @Query('limit') limit?: number,
  ) {
    const session = await this.sessionService.getSession(sessionId);

    if (!session.customerId) {
      throw new BadRequestException('Customer not identified in this session');
    }

    return this.loyaltyService.getTransactionHistory(
      session.customerId,
      limit ? parseInt(limit.toString()) : 50,
    );
  }

  @Get('loyalty/config')
  @ApiOperation({ summary: 'Get loyalty program configuration' })
  @ApiResponse({ status: 200, description: 'Loyalty config retrieved' })
  async getLoyaltyConfig() {
    return this.loyaltyService.getLoyaltyConfig();
  }

  @Get('loyalty/tier')
  @ApiOperation({ summary: 'Get customer tier status' })
  @ApiResponse({ status: 200, description: 'Tier status retrieved' })
  async getTierStatus(@Query('sessionId') sessionId: string) {
    const session = await this.sessionService.getSession(sessionId);

    if (!session.customerId) {
      throw new BadRequestException('Customer not identified in this session');
    }

    return this.loyaltyService.getTierStatus(session.customerId);
  }

  // ========================================
  // PHONE VERIFICATION
  // ========================================

  @Post('phone/send-otp')
  @ApiOperation({ summary: 'Send OTP to phone number' })
  @ApiResponse({ status: 200, description: 'OTP sent successfully' })
  async sendOTP(@Body() dto: SendOTPDto) {
    return this.phoneVerificationService.sendOTP(dto.phone, dto.sessionId || null, dto.tenantId);
  }

  @Post('phone/verify-otp')
  @ApiOperation({ summary: 'Verify OTP code' })
  @ApiResponse({ status: 200, description: 'Phone verified successfully' })
  async verifyOTP(@Body() dto: VerifyOTPDto) {
    const result = await this.phoneVerificationService.verifyOTP(dto.phone, dto.code, dto.tenantId);

    // If verification successful, update customer phoneVerified status
    if (result.verified) {
      // Find customer by phone
      const customer = await this.customersService.findByPhone(dto.phone, dto.tenantId);
      if (customer) {
        await this.customersService.update(customer.id, { phoneVerified: true }, dto.tenantId);
      }
    }

    return result;
  }

  @Get('phone/verification-status/:verificationId')
  @ApiOperation({ summary: 'Get verification status' })
  @ApiResponse({ status: 200, description: 'Verification status retrieved' })
  async getVerificationStatus(@Param('verificationId') verificationId: string) {
    return this.phoneVerificationService.getVerificationStatus(verificationId);
  }

  // ========================================
  // REFERRAL SYSTEM
  // ========================================

  @Post('referral/generate')
  @ApiOperation({ summary: 'Generate referral code for customer' })
  @ApiResponse({ status: 200, description: 'Referral code generated' })
  async generateReferralCode(@Body('customerId') customerId: string) {
    const code = await this.referralService.generateReferralCode(customerId);
    return { referralCode: code };
  }

  @Post('referral/apply')
  @ApiOperation({ summary: 'Apply referral code' })
  @ApiResponse({ status: 200, description: 'Referral code applied successfully' })
  async applyReferralCode(@Body() dto: ApplyReferralCodeDto) {
    return this.referralService.applyReferralCode(dto.customerId, dto.referralCode, dto.tenantId);
  }

  @Get('referral/stats')
  @ApiOperation({ summary: 'Get referral statistics' })
  @ApiResponse({ status: 200, description: 'Referral stats retrieved' })
  async getReferralStats(@Query('sessionId') sessionId: string) {
    const session = await this.sessionService.getSession(sessionId);

    if (!session.customerId) {
      throw new BadRequestException('Customer not identified in this session');
    }

    return this.referralService.getReferralStats(session.customerId);
  }
}
