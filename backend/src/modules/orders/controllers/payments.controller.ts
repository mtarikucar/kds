import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { PaymentsService } from '../services/payments.service';
import { CreatePaymentDto } from '../dto/create-payment.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { TenantGuard } from '../../auth/guards/tenant.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../../common/constants/roles.enum';

@ApiTags('payments')
@ApiBearerAuth()
@Controller('orders/:orderId/payments')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiOperation({ summary: 'Create a payment for an order (ADMIN, MANAGER, WAITER)' })
  @ApiResponse({ status: 201, description: 'Payment successfully created' })
  @ApiResponse({ status: 400, description: 'Invalid data or order already paid' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  create(
    @Param('orderId') orderId: string,
    @Body() createPaymentDto: CreatePaymentDto,
    @Request() req,
  ) {
    return this.paymentsService.create(orderId, createPaymentDto, req.tenantId);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiOperation({ summary: 'Get all payments for an order (ADMIN, MANAGER, WAITER)' })
  @ApiResponse({ status: 200, description: 'List of payments' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  findAll(@Param('orderId') orderId: string, @Request() req) {
    return this.paymentsService.findByOrder(orderId, req.tenantId);
  }
}
