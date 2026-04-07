import {
  IsString,
  IsEnum,
  IsNumber,
  IsArray,
  IsOptional,
  IsUUID,
  ValidateNested,
  Min,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod } from '../../../common/constants/order-status.enum';

export enum SplitType {
  EQUAL = 'EQUAL',
  BY_ITEMS = 'BY_ITEMS',
  CUSTOM = 'CUSTOM',
}

export class SplitPaymentEntry {
  @ApiProperty({ description: 'Payment amount for this split' })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiProperty({ enum: PaymentMethod })
  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  @ApiPropertyOptional({ description: 'Label for this split (e.g., person name)' })
  @IsString()
  @IsOptional()
  label?: string;

  @ApiPropertyOptional({ description: 'Order item IDs this split covers (for BY_ITEMS mode)' })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  orderItemIds?: string[];
}

export class SplitBillDto {
  @ApiProperty({ enum: SplitType })
  @IsEnum(SplitType)
  splitType: SplitType;

  @ApiPropertyOptional({ description: 'Number of equal parts (for EQUAL mode)' })
  @IsNumber()
  @Min(2)
  @IsOptional()
  numberOfParts?: number;

  @ApiProperty({ description: 'Individual split payments', type: [SplitPaymentEntry] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SplitPaymentEntry)
  @ArrayMinSize(1)
  payments: SplitPaymentEntry[];

  @ApiPropertyOptional({ description: 'Customer phone for linking' })
  @IsString()
  @IsOptional()
  customerPhone?: string;
}

export class GroupBillSummaryDto {
  @ApiProperty({ description: 'Table group ID' })
  @IsString()
  groupId: string;
}
