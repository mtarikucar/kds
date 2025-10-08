import { ApiProperty } from '@nestjs/swagger';

export class TopProductDto {
  @ApiProperty({ description: 'Product ID' })
  productId: string;

  @ApiProperty({ description: 'Product name' })
  productName: string;

  @ApiProperty({ description: 'Quantity sold' })
  quantitySold: number;

  @ApiProperty({ description: 'Total revenue' })
  revenue: number;

  @ApiProperty({ description: 'Category name' })
  categoryName?: string;
}

export class TopProductsReportDto {
  @ApiProperty({ description: 'List of top products', type: [TopProductDto] })
  products: TopProductDto[];

  @ApiProperty({ description: 'Start date of the report' })
  startDate: Date;

  @ApiProperty({ description: 'End date of the report' })
  endDate: Date;
}
