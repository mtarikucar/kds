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
import { SplitBillDto } from '../dto/split-bill.dto';
import { PayItemsDto } from '../dto/pay-items.dto';
import { WriteOffOrderDto } from '../dto/write-off.dto';
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
    return this.paymentsService.create(
      orderId,
      createPaymentDto,
      req.tenantId,
      req.user?.id ?? null,
    );
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiOperation({ summary: 'Get all payments for an order (ADMIN, MANAGER, WAITER)' })
  @ApiResponse({ status: 200, description: 'List of payments' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  findAll(@Param('orderId') orderId: string, @Request() req) {
    return this.paymentsService.findByOrder(orderId, req.tenantId);
  }

  @Post('split')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiOperation({ summary: 'Split bill and create multiple payments' })
  @ApiResponse({ status: 201, description: 'Split payments created' })
  splitBill(
    @Param('orderId') orderId: string,
    @Body() dto: SplitBillDto,
    @Request() req,
  ) {
    return this.paymentsService.splitBill(
      orderId,
      dto,
      req.tenantId,
      req.user?.id ?? null,
    );
  }

  @Post('items')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiOperation({
    summary:
      'Settle specific OrderItem units in one payment (progressive "Dutch-style" pay)',
  })
  @ApiResponse({ status: 201, description: 'Per-item payment created' })
  @ApiResponse({
    status: 400,
    description:
      'Invalid input (overpayment, duplicate item, item not on order, or order in non-payable state)',
  })
  @ApiResponse({ status: 404, description: 'Order not found' })
  payByItems(
    @Param('orderId') orderId: string,
    @Body() dto: PayItemsDto,
    @Request() req,
  ) {
    return this.paymentsService.payByItems(
      orderId,
      dto,
      req.tenantId,
      req.user?.id ?? null,
    );
  }

  @Get('payable-items')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiOperation({
    summary: 'Per-item paid/remaining breakdown for the progressive payment UI',
  })
  @ApiResponse({ status: 200, description: 'Order paid/remaining items summary' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  getPayableItems(@Param('orderId') orderId: string, @Request() req) {
    return this.paymentsService.getPayableItems(orderId, req.tenantId);
  }

  @Post('write-off')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary:
      'Absorb the remaining balance as a house loss (no-show, comp). MANAGER+ only.',
  })
  @ApiResponse({ status: 201, description: 'Order written off, table released' })
  @ApiResponse({
    status: 400,
    description: 'Order is already paid, cancelled, or has nothing left to write off',
  })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  writeOff(
    @Param('orderId') orderId: string,
    @Body() dto: WriteOffOrderDto,
    @Request() req,
  ) {
    return this.paymentsService.writeOff(
      orderId,
      dto,
      req.tenantId,
      req.user?.id ?? null,
    );
  }
}
