import { ApiProperty } from '@nestjs/swagger';

export class PaymentMethodBreakdown {
  @ApiProperty({ description: 'Payment method' })
  method: string;

  @ApiProperty({ description: 'Total amount for this method' })
  totalAmount: number;

  @ApiProperty({ description: 'Number of transactions' })
  count: number;
}

export class SalesReportDto {
  @ApiProperty({ description: 'Total sales amount' })
  totalSales: number;

  @ApiProperty({ description: 'Number of orders' })
  orderCount: number;

  @ApiProperty({ description: 'Average order value' })
  averageOrderValue: number;

  @ApiProperty({ description: 'Breakdown by payment method', type: [PaymentMethodBreakdown] })
  paymentMethodBreakdown: PaymentMethodBreakdown[];

  @ApiProperty({ description: 'Start date of the report' })
  startDate: Date;

  @ApiProperty({ description: 'End date of the report' })
  endDate: Date;
}
