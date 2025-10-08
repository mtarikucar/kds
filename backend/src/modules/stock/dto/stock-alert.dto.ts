import { ApiProperty } from '@nestjs/swagger';

export class StockAlertDto {
  @ApiProperty({ description: 'Product ID' })
  id: string;

  @ApiProperty({ description: 'Product name' })
  name: string;

  @ApiProperty({ description: 'Current stock level' })
  currentStock: number;

  @ApiProperty({ description: 'Category name' })
  categoryName: string;

  @ApiProperty({ description: 'Product image URL' })
  image?: string;

  @ApiProperty({ description: 'Product price' })
  price: number;

  @ApiProperty({ description: 'Is product available' })
  isAvailable: boolean;
}
