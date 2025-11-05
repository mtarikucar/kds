import { Controller, Post, Get, Body, Param, Query, Headers, Ip, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CustomersService } from './customers.service';
import { LoyaltyService } from './loyalty.service';
import { CustomerSessionService } from './customer-session.service';

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

@ApiTags('customer-public')
@Controller('customer-public')
export class CustomerPublicController {
  constructor(
    private customersService: CustomersService,
    private loyaltyService: LoyaltyService,
    private sessionService: CustomerSessionService,
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
}
